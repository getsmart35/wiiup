import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ServerFrame } from '@/api/push';

/** Messages the app sends on the live socket. */
export type ClientMessage =
  | { type: 'sub'; topic: string }
  | { type: 'unsub'; topic: string }
  | { type: 'online'; location: unknown }
  | { type: 'offline' }
  | { type: 'location'; location: unknown }
  // The driver's bid board
  | { type: 'bids_on'; location: unknown }
  | { type: 'bids_off' }
  // Push receipts (src/api/push.ts)
  | { type: 'ack'; seq: unknown }
  // Replies from the phone's trip backup store
  | { type: 'vault_keys'; reqId: string; keys: unknown }
  | { type: 'vault_blob'; reqId: string; key: string; blob: unknown };

type Hooks = {
  authenticate(token: string): string | null;
  /** May this user follow `topic` (`ride:<id>` or `trip:<id>`)? */
  authorize(userId: string, topic: string): boolean;
  /** The current state for a topic, sent as soon as someone subscribes. */
  snapshot(topic: string): object | null;
  onMessage(userId: string, msg: ClientMessage): void;
  /** A socket opened for this user. */
  onConnect(userId: string): void;
  /** The user's last open socket closed. */
  onDisconnect(userId: string): void;
};

export type PushOptions = {
  /** Kept until the app acks it: resent on a slow ack and replayed after a reconnect. */
  reliable?: boolean;
  /** How long an undelivered message is still worth sending (a ride offer only lasts seconds). */
  ttlMs?: number;
  /** A newer message with the same key replaces an unacked older one, since only the latest state matters. */
  collapseKey?: string;
};

export const DEFAULT_PUSH = {
  heartbeatMs: 5000,
  /** Resend a reliable message if it isn't acked this quickly. */
  ackTimeoutMs: 3000,
  maxRedeliveries: 3,
  ttlMs: 2 * 60 * 1000,
  /** How long a disconnected user's session (and unacked messages) is kept for them to resume. */
  sessionIdleMs: 2 * 60 * 1000,
  /** Apps reconnect within this window when the server restarts, so they don't all arrive at once. */
  reconnectJitterMs: 2000,
};
export type PushTiming = typeof DEFAULT_PUSH;

/** Above this much unsent data the socket counts as slow, and messages that can be dropped are. */
const SLOW_BYTES = 1024 * 1024;
const RTT_SAMPLES = 1000;

type Client = WebSocket & { userId: string; alive: boolean };
type Pending = { seq: number; body: object; expiresAt: number; collapseKey?: string; sentAt: number; attempts: number };
/**
 * One per user. Subscriptions and unacked messages belong to the session, not the socket, so updates sent while the
 * app is between connections wait for it to resume.
 */
type Session = {
  userId: string;
  epoch: string;
  seq: number;
  outbox: Map<number, Pending>;
  sockets: Set<Client>;
  topics: Set<string>;
  idleSince: number | null;
};

/**
 * The push channel at /v1/live (protocol in src/api/push.ts), modeled on Uber's RAMEN: every message to a user is
 * numbered in one sequence per session. Messages that must arrive are kept until the app acks them, resent if an
 * ack is late, and replayed when the app reconnects and resumes. Heartbeats let the app spot a dead connection.
 */
export class Live {
  private wss = new WebSocketServer({
    noServer: true,
    // Room for a phone's whole backup list in one message
    maxPayload: 512 * 1024,
    // Large messages (a backup list, a long route) are compressed when the app supports it
    perMessageDeflate: { threshold: 1024 },
  });
  /** Topic → users following it. */
  private topics = new Map<string, Set<string>>();
  private sessions = new Map<string, Session>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private rtts: number[] = [];
  private counts = { connects: 0, resumes: 0, sent: 0, reliable: 0, acked: 0, redelivered: 0, replayed: 0, expired: 0, collapsed: 0, dropped: 0, heartbeats: 0 };

  constructor(
    server: Server,
    private hooks: Hooks,
    private timing: PushTiming = DEFAULT_PUSH,
  ) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://local');
      const userId = url.pathname === '/v1/live' ? hooks.authenticate(url.searchParams.get('token') ?? '') : null;
      if (!userId) {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
      const [epoch, seq] = (url.searchParams.get('resume') ?? '').split(':');
      const resume = epoch && Number.isInteger(Number(seq)) ? { epoch, seq: Number(seq) } : null;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws as Client, userId, resume));
    });

    this.timers.push(
      setInterval(() => this.heartbeat(), timing.heartbeatMs),
      setInterval(() => this.sweep(), Math.min(1000, timing.ackTimeoutMs)),
      // Drop sockets that stop answering pings, so a phone that lost signal goes offline
      setInterval(() => {
        for (const ws of this.wss.clients as Set<Client>) {
          if (!ws.alive) ws.terminate();
          else (ws.alive = false), ws.ping();
        }
      }, 30000),
    );
  }

  // ---------- sending ----------

  /** To everyone following a topic. Ride and trip changes are reliable; car positions aren't. */
  publish(topic: string, body: object, opts: PushOptions = {}) {
    for (const userId of this.topics.get(topic) ?? []) {
      const session = this.sessions.get(userId);
      if (session) this.deliver(session, body, opts, session.sockets);
    }
  }

  /** To all of a user's sockets. Reliable unless told otherwise, and kept for a while if they're between connections. */
  toUser(userId: string, body: object, opts: PushOptions = { reliable: true }) {
    const session = this.sessions.get(userId);
    if (session) this.deliver(session, body, opts, session.sockets);
  }

  isConnected(userId: string) {
    return (this.sessions.get(userId)?.sockets.size ?? 0) > 0;
  }

  private deliver(session: Session, body: object, opts: PushOptions, sockets: Iterable<Client>) {
    const seq = ++session.seq;
    const now = Date.now();
    if (opts.reliable) {
      if (opts.collapseKey) {
        for (const p of session.outbox.values()) {
          if (p.collapseKey === opts.collapseKey) (session.outbox.delete(p.seq), this.counts.collapsed++);
        }
      }
      session.outbox.set(seq, { seq, body, expiresAt: now + (opts.ttlMs ?? this.timing.ttlMs), collapseKey: opts.collapseKey, sentAt: now, attempts: 1 });
      this.counts.reliable++;
    }
    for (const ws of sockets) {
      // Priority: on a backed-up connection, messages that can be dropped wait for nothing
      if (!opts.reliable && ws.bufferedAmount > SLOW_BYTES) {
        this.counts.dropped++;
        continue;
      }
      this.write(ws, { t: 'msg', seq, ...(opts.reliable && { ack: true as const }), body });
    }
  }

  private write(ws: Client, frame: ServerFrame) {
    if (ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(frame));
    if (frame.t === 'msg') this.counts.sent++;
    return true;
  }

  // ---------- connections ----------

  private attach(ws: Client, userId: string, resume: { epoch: string; seq: number } | null) {
    ws.userId = userId;
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    let session = this.sessions.get(userId);
    if (!session) {
      session = { userId, epoch: randomBytes(6).toString('base64url'), seq: 0, outbox: new Map(), sockets: new Set(), topics: new Set(), idleSince: null };
      this.sessions.set(userId, session);
    }
    session.sockets.add(ws);
    session.idleSince = null;
    const resumed = resume?.epoch === session.epoch;
    this.counts.connects++;
    if (resumed) this.counts.resumes++;
    this.write(ws, { t: 'hello', epoch: session.epoch, seq: session.seq, heartbeatMs: this.timing.heartbeatMs, resumed });

    // Replay what the app hasn't acked: after its last seq if it resumed, otherwise everything still pending
    const after = resumed ? resume!.seq : 0;
    for (const p of [...session.outbox.values()].sort((a, b) => a.seq - b.seq)) {
      if (p.seq <= after || p.expiresAt < Date.now()) continue;
      p.sentAt = Date.now();
      this.write(ws, { t: 'msg', seq: p.seq, ack: true, body: p.body });
      this.counts.replayed++;
    }

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'ack') this.ack(session, msg.seq);
      else if (msg.type === 'sub' && typeof msg.topic === 'string') {
        if (!this.hooks.authorize(userId, msg.topic)) {
          this.deliver(session, { type: 'error', topic: msg.topic, message: 'Not allowed' }, {}, [ws]);
          return;
        }
        session.topics.add(msg.topic);
        const set = this.topics.get(msg.topic) ?? new Set();
        set.add(userId);
        this.topics.set(msg.topic, set);
        const snap = this.hooks.snapshot(msg.topic);
        if (snap) this.deliver(session, snap, { reliable: true, collapseKey: msg.topic }, [ws]);
      } else if (msg.type === 'unsub' && typeof msg.topic === 'string') {
        session.topics.delete(msg.topic);
        this.topics.get(msg.topic)?.delete(userId);
      } else {
        this.hooks.onMessage(userId, msg);
      }
    });

    ws.on('close', () => {
      session.sockets.delete(ws);
      if (!session.sockets.size) {
        session.idleSince = Date.now();
        this.hooks.onDisconnect(userId);
      }
    });

    this.hooks.onConnect(userId);
  }

  /** Acks are cumulative: everything up to `seq` arrived. */
  private ack(session: Session, seq: unknown) {
    if (typeof seq !== 'number') return;
    const now = Date.now();
    for (const p of session.outbox.values()) {
      if (p.seq > seq) continue;
      session.outbox.delete(p.seq);
      this.counts.acked++;
      this.rtts.push(now - p.sentAt);
    }
    if (this.rtts.length > RTT_SAMPLES) this.rtts.splice(0, this.rtts.length - RTT_SAMPLES);
  }

  private heartbeat() {
    const frame: ServerFrame = { t: 'hb', at: Date.now() };
    for (const ws of this.wss.clients as Set<Client>) {
      // A heartbeat stuck behind a backlog would only mislead, so slow sockets skip it
      if (ws.bufferedAmount <= SLOW_BYTES && this.write(ws, frame)) this.counts.heartbeats++;
    }
  }

  /** Resends late reliable messages, expires old ones, and forgets sessions nobody came back to. */
  private sweep() {
    const now = Date.now();
    for (const [userId, s] of this.sessions) {
      for (const p of s.outbox.values()) {
        if (p.expiresAt < now) {
          s.outbox.delete(p.seq);
          this.counts.expired++;
        } else if (s.sockets.size && now - p.sentAt >= this.timing.ackTimeoutMs && p.attempts <= this.timing.maxRedeliveries) {
          p.sentAt = now;
          p.attempts++;
          this.counts.redelivered++;
          for (const ws of s.sockets) this.write(ws, { t: 'msg', seq: p.seq, ack: true, body: p.body });
        }
      }
      if (!s.sockets.size && s.idleSince && now - s.idleSince > this.timing.sessionIdleMs) {
        for (const t of s.topics) this.topics.get(t)?.delete(userId);
        this.sessions.delete(userId);
      }
    }
  }

  // ---------- admin ----------

  stats() {
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const pct = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
    const sessions = [...this.sessions.values()];
    return {
      ...this.counts,
      sessions: sessions.length,
      sockets: this.wss.clients.size,
      pending: sessions.reduce((n, s) => n + s.outbox.size, 0),
      ackRttMs: { p50: pct(0.5), p95: pct(0.95), samples: sorted.length },
      deliveryRate: this.counts.reliable ? this.counts.acked / this.counts.reliable : null,
    };
  }

  /** Asks every app to reconnect (spread over the jitter window), then closes. Used on shutdown and restarts. */
  close() {
    this.timers.forEach(clearInterval);
    for (const ws of this.wss.clients as Set<Client>) {
      this.write(ws, { t: 'ctl', action: 'reconnect', afterMs: Math.floor(Math.random() * this.timing.reconnectJitterMs), reason: 'Server restarting' });
      ws.close(1012, 'Server restarting');
    }
    setTimeout(() => this.wss.clients.forEach((ws) => ws.terminate()), 500);
    this.wss.close();
  }
}
