import type { DriverTripAction, RequestRideInput, RideService, Unsubscribe } from './client';
import { HEARTBEAT_GRACE_MS, type AckFrame, type ServerFrame } from './push';
import type { Driver, DriverTrip, FareQuote, InstantPayout, LatLng, Ride, RideRequest, TripForBid } from './types';
import type { PlanId } from '@/lib/plans';
import type { RateCards } from '@/lib/rates';

/** What the HTTP service needs from the app. Passed in so this file has no app imports and runs in Node tests too. */
export type HttpDeps = {
  getToken(): string | undefined;
  /** The server no longer accepts the saved session. */
  onUnauthorized(): void;
  getDriverSettings(): { cards: RateCards; plan: PlanId; subscribedAt: number };
  /** The device's location, sent during a trip so the rider can follow the car. */
  getLocation(): LatLng;
  /**
   * The phone's trip backup store (docs/FAILOVER.md). It holds sealed blobs the server writes and reads back
   * after a failover; the app can't read them. `set` never overwrites an existing key.
   */
  vault: {
    keys(): string[] | Promise<string[]>;
    get(key: string): string | null;
    set(key: string, blob: string): void;
    delete(key: string): void;
  };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** How often a driver's location is sent while online or on a trip. */
const LOCATION_EVERY = 5000;
/** After a failover the server may need a moment to restore a trip from this phone. */
const RECOVERY_RETRIES = 8;

type LiveMessage =
  | { type: 'ride'; ride: Ride }
  | { type: 'trip'; trip: DriverTrip }
  | { type: 'request'; request: RideRequest }
  | { type: 'request_gone'; id: string }
  | { type: 'bid_board'; trips: TripForBid[] }
  | { type: 'vault'; op: 'set' | 'delete' | 'list' | 'get'; key?: string; blob?: string; reqId?: string }
  | { type: 'error'; topic?: string; message: string };

/** RideService backed by the WiiUp server (server/): REST for actions, one WebSocket for live updates. */
export function createHttpService(baseUrl: string, deps: HttpDeps): RideService {
  const root = baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, attempt = 0): Promise<T> {
    const token = deps.getToken();
    const res = await fetch(root + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401 && token) deps.onUnauthorized();
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      // The server is restoring this phone's trips after a failover: make sure the socket is up, then try again
      if (err.error === 'recovering' && attempt < RECOVERY_RETRIES) {
        connect();
        await new Promise((r) => setTimeout(r, 1000));
        return call<T>(method, path, body, headers, attempt + 1);
      }
      throw new ApiError(res.status, err.error ?? 'error', err.message ?? `Request failed (${res.status})`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const idempotencyKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

  // ---------- live socket (push protocol in ./push.ts) ----------

  const topics = new Map<string, Set<(value: never) => void>>();
  let onRequest: ((r: RideRequest) => void) | null = null;
  let online: (() => LatLng) | null = null;
  /** The driver's bid board, while it's open. */
  let board: { here: () => LatLng; cb: (trips: TripForBid[]) => void } | null = null;
  let followedTrips = 0;
  let ws: WebSocket | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  // Where to resume after a reconnect, and when the server was last heard from
  let epoch = '';
  let lastSeq = 0;
  let heardAt = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;

  const wanted = () => topics.size > 0 || online !== null || board !== null;
  const send = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const here = () => (online ?? board?.here ?? deps.getLocation)();

  function connect() {
    const token = deps.getToken();
    if (ws || !wanted() || !token) return;
    clearTimeout(retryTimer);
    const resume = epoch ? `&resume=${encodeURIComponent(`${epoch}:${lastSeq}`)}` : '';
    const socket = new WebSocket(`${root.replace(/^http/, 'ws')}/v1/live?token=${encodeURIComponent(token)}${resume}`);
    ws = socket;
    heardAt = Date.now();
    socket.onopen = () => {
      retries = 0;
      for (const topic of topics.keys()) send({ type: 'sub', topic });
      if (online) send({ type: 'online', location: here() });
      if (board) send({ type: 'bids_on', location: board.here() });
    };
    socket.onmessage = (e) => {
      if (ws !== socket) return;
      heardAt = Date.now();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (frame.t === 'hello') {
        // A new epoch means the server started a new session, so its numbering starts again
        if (!frame.resumed) lastSeq = 0;
        epoch = frame.epoch;
        clearInterval(watchdog);
        const silence = frame.heartbeatMs + HEARTBEAT_GRACE_MS;
        watchdog = setInterval(() => {
          if (ws === socket && Date.now() - heardAt > silence) reconnect(0);
        }, Math.min(1000, frame.heartbeatMs));
      } else if (frame.t === 'ctl' && frame.action === 'reconnect') {
        reconnect(frame.afterMs);
      } else if (frame.t === 'msg') {
        // Acks are cumulative; a message at or below the last one seen is a redelivery
        if (frame.seq <= lastSeq) {
          if (frame.ack) send({ type: 'ack', seq: lastSeq } satisfies AckFrame);
          return;
        }
        lastSeq = frame.seq;
        if (frame.ack) send({ type: 'ack', seq: frame.seq } satisfies AckFrame);
        handle(frame.body as LiveMessage);
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      clearInterval(watchdog);
      // Reconnect with backoff while anything still needs live updates
      if (wanted()) retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retries++));
    };
  }

  /** Drops the current socket and connects again after `afterMs`, resuming where it left off. */
  function reconnect(afterMs: number) {
    const socket = ws;
    ws = null;
    clearInterval(watchdog);
    socket?.close();
    retries = 0;
    clearTimeout(retryTimer);
    if (wanted()) retryTimer = setTimeout(connect, afterMs);
  }

  function handle(msg: LiveMessage) {
    if (msg.type === 'ride') topics.get(`ride:${msg.ride.id}`)?.forEach((cb) => (cb as (r: Ride) => void)(msg.ride));
    else if (msg.type === 'trip') topics.get(`trip:${msg.trip.id}`)?.forEach((cb) => (cb as (t: DriverTrip) => void)(msg.trip));
    else if (msg.type === 'request') onRequest?.(msg.request);
    else if (msg.type === 'bid_board') board?.cb(msg.trips);
    else if (msg.type === 'vault') void onVault(msg);
    else if (msg.type === 'error' && msg.topic && topics.has(msg.topic)) {
      // After a failover a ride can be unknown until the driver's phone restores it, so ask again
      const topic = msg.topic;
      setTimeout(() => topics.has(topic) && send({ type: 'sub', topic }), 2000);
    }
  }

  async function onVault(msg: Extract<LiveMessage, { type: 'vault' }>) {
    const { vault } = deps;
    if (msg.op === 'set' && msg.key && typeof msg.blob === 'string') vault.set(msg.key, msg.blob);
    else if (msg.op === 'delete' && msg.key) vault.delete(msg.key);
    else if (msg.op === 'list') send({ type: 'vault_keys', reqId: msg.reqId, keys: await vault.keys() });
    else if (msg.op === 'get' && msg.key) send({ type: 'vault_blob', reqId: msg.reqId, key: msg.key, blob: vault.get(msg.key) });
  }

  /** Location goes up while the driver is online or on a trip. */
  function updatePings() {
    const need = online !== null || board !== null || followedTrips > 0;
    if (need && !pingTimer) pingTimer = setInterval(() => send({ type: 'location', location: here() }), LOCATION_EVERY);
    if (!need && pingTimer) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  }

  function closeIfIdle() {
    if (wanted()) return;
    clearTimeout(retryTimer);
    clearInterval(watchdog);
    const socket = ws;
    ws = null;
    socket?.close();
  }

  function follow<T>(topic: string, cb: (value: T) => void): Unsubscribe {
    const set = topics.get(topic) ?? new Set();
    const first = set.size === 0;
    set.add(cb as (value: never) => void);
    topics.set(topic, set);
    if (!ws) connect();
    else if (first) send({ type: 'sub', topic });
    return () => {
      set.delete(cb as (value: never) => void);
      if (set.size) return;
      topics.delete(topic);
      send({ type: 'unsub', topic });
      closeIfIdle();
    };
  }

  return {
    async startSignIn(phone) {
      return call<{ demoCode?: string }>('POST', '/v1/auth/start', { phone });
    },

    async verifySignIn(input) {
      const { token } = await call<{ token: string }>('POST', '/v1/auth/verify', input);
      return { token };
    },

    async getNearbyDrivers(center) {
      return call<Driver[]>('GET', `/v1/drivers/nearby?lat=${center.latitude}&lng=${center.longitude}`);
    },

    async getQuotes(pickup, dropoff) {
      return call<FareQuote[]>('POST', '/v1/quotes', { pickup, dropoff });
    },

    async requestRide({ pickup, dropoff, quote, mode }: RequestRideInput) {
      return call<Ride>('POST', '/v1/rides', { pickup, dropoff, quote, mode });
    },

    async acceptBid(rideId, bidId) {
      await call('POST', `/v1/rides/${encodeURIComponent(rideId)}/bids/${encodeURIComponent(bidId)}/accept`);
    },

    async declineBid(rideId, bidId) {
      await call('POST', `/v1/rides/${encodeURIComponent(rideId)}/bids/${encodeURIComponent(bidId)}/decline`);
    },

    async cancelRide(rideId) {
      await call('POST', `/v1/rides/${encodeURIComponent(rideId)}/cancel`);
    },

    subscribeRide(rideId, cb) {
      return follow(`ride:${rideId}`, cb);
    },

    subscribeRequests(getLocation, cb): Unsubscribe {
      online = getLocation;
      onRequest = cb;
      updatePings();
      // Rate cards and plan first, so offers are priced from this driver's card
      call('PUT', '/v1/driver/settings', deps.getDriverSettings())
        .catch((e) => console.warn('Could not save driver settings:', e instanceof Error ? e.message : e))
        .finally(() => {
          if (online !== getLocation) return;
          if (ws) send({ type: 'online', location: getLocation() });
          else connect();
        });
      return () => {
        if (online !== getLocation) return;
        online = null;
        onRequest = null;
        send({ type: 'offline' });
        updatePings();
        closeIfIdle();
      };
    },

    // The server prices the trip from the driver's own card, so `earnings` from the app isn't sent
    async acceptRequest(request, driverLocation) {
      return call<DriverTrip>('POST', `/v1/driver/requests/${encodeURIComponent(request.id)}/accept`, { location: driverLocation });
    },

    async requestInstantPayout(amount) {
      return call<InstantPayout>('POST', '/v1/driver/payouts', { amount }, { 'Idempotency-Key': idempotencyKey() });
    },

    async purchaseUpgrade(plan, price) {
      await call('POST', '/v1/driver/upgrade', { plan, price }, { 'Idempotency-Key': idempotencyKey() });
    },

    async applyForPlatinum(license) {
      return call<{ submittedAt: number }>('POST', '/v1/driver/platinum', { license });
    },

    async getPlatinumReview(submittedAt) {
      const { status } = await call<{ status: 'pending' | 'approved' | 'rejected' }>('GET', `/v1/driver/platinum?submittedAt=${submittedAt}`);
      return status;
    },

    async updateDriverTrip(tripId, action: DriverTripAction) {
      await call('POST', `/v1/driver/trips/${encodeURIComponent(tripId)}/${action}`);
    },

    subscribeTripsForBid(getLocation, cb): Unsubscribe {
      const mine = { here: getLocation, cb };
      board = mine;
      updatePings();
      // Rate cards first, so the board is priced from this driver's card
      call('PUT', '/v1/driver/settings', deps.getDriverSettings())
        .catch((e) => console.warn('Could not save driver settings:', e instanceof Error ? e.message : e))
        .finally(() => {
          if (board !== mine) return;
          if (ws) send({ type: 'bids_on', location: getLocation() });
          else connect();
        });
      return () => {
        if (board !== mine) return;
        board = null;
        send({ type: 'bids_off' });
        updatePings();
        closeIfIdle();
      };
    },

    async placeBid(tripId, fare) {
      await call('POST', '/v1/driver/bids', { tripId, fare });
    },

    subscribeDriverTrip(tripId, cb) {
      followedTrips++;
      updatePings();
      const stop = follow(`trip:${tripId}`, cb);
      return () => {
        followedTrips--;
        updatePings();
        stop();
      };
    },
  };
}
