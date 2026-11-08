import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { WebSocketServer } from 'ws';

import { createHttpService } from '@/api/http';
import type { ServerFrame } from '@/api/push';
import type { Ride } from '@/api/types';
import { defaultCards } from '@/lib/rates';
import { admin, client, memoryVault, PIER, start, THEATRE, until, type Server } from './_helpers.ts';

type Msg = Extract<ServerFrame, { t: 'msg' }>;

/** A bare socket that records every frame, for checking the protocol itself. */
async function raw(url: string, token: string, resume?: string) {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/v1/live?token=${token}${resume ? `&resume=${resume}` : ''}`);
  const frames: ServerFrame[] = [];
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));
  const hello = await until('hello', () => frames.find((f) => f.t === 'hello') as Extract<ServerFrame, { t: 'hello' }> | undefined);
  return { ws, frames, hello, send: (m: object) => ws.send(JSON.stringify(m)), msgs: () => frames.filter((f): f is Msg => f.t === 'msg') };
}

describe('push protocol', () => {
  let s: Server;
  before(async () => (s = await start({ sim: false })));
  after(() => s.app.close());

  /** A rider with a ride that is searching (no drivers online), so its state stays put. */
  async function riderWithRide(phone: string) {
    const rider = await client(s.url, 'Ava', phone);
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    return { rider, ride };
  }

  test('messages are numbered, must-deliver ones are resent until acked', async () => {
    const { rider, ride } = await riderWithRide('3125550300');
    const sock = await raw(s.url, rider.session.token!);
    assert.equal(sock.hello.resumed, false);
    sock.send({ type: 'sub', topic: `ride:${ride.id}` });
    const rideMsgs = () => sock.msgs().filter((m) => (m.body as { type: string }).type === 'ride');
    const first = await until('ride snapshot', () => rideMsgs()[0]);
    assert.equal(first.ack, true);
    assert.equal((first.body as { type: string }).type, 'ride');
    // No ack: the same message comes again
    await until('redelivery', () => sock.msgs().filter((m) => m.seq === first.seq).length >= 2 || undefined);
    sock.send({ type: 'ack', seq: first.seq });
    await new Promise((r) => setTimeout(r, 300));
    const copies = sock.msgs().filter((m) => m.seq === first.seq).length;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(sock.msgs().filter((m) => m.seq === first.seq).length, copies, 'no more copies after the ack');
    const stats = (await admin(s.url, 'GET', '/v1/admin/push/stats')).body;
    assert.ok(stats.redelivered >= 1 && stats.acked >= 1);
    assert.equal(typeof stats.ackRttMs.p95, 'number');
    sock.ws.close();
    await rider.api.cancelRide(ride.id);
  });

  test('heartbeats arrive on schedule', async () => {
    const { rider, ride } = await riderWithRide('3125550301');
    const sock = await raw(s.url, rider.session.token!);
    await new Promise((r) => setTimeout(r, 450));
    assert.ok(sock.frames.filter((f) => f.t === 'hb').length >= 3);
    sock.ws.close();
    await rider.api.cancelRide(ride.id);
  });

  test('after a reconnect the app resumes and gets what it missed', async () => {
    const { rider, ride } = await riderWithRide('3125550302');
    const one = await raw(s.url, rider.session.token!);
    one.send({ type: 'sub', topic: `ride:${ride.id}` });
    const snap = await until('snapshot', () => one.msgs().find((m) => (m.body as { type: string }).type === 'ride'));
    one.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    // While the rider is away, the ride is cancelled: that update waits for them
    await rider.api.cancelRide(ride.id);

    const two = await raw(s.url, rider.session.token!, `${one.hello.epoch}:${snap.seq}`);
    assert.equal(two.hello.resumed, true);
    const replayed = await until('replay', () => two.msgs().find((m) => (m.body as { ride?: Ride }).ride?.status === 'cancelled'));
    assert.ok(replayed.seq > snap.seq);
    assert.ok(!two.msgs().some((m) => m.seq === snap.seq), 'nothing at or before the resume point');
    two.ws.close();

    // An unknown epoch (for example after a server restart) starts a fresh count
    const three = await raw(s.url, rider.session.token!, `stale-epoch:${snap.seq}`);
    assert.equal(three.hello.resumed, false);
    three.ws.close();
  });

  test('only the latest state of a ride waits for delivery', async () => {
    const { rider, ride } = await riderWithRide('3125550303');
    const sock = await raw(s.url, rider.session.token!);
    sock.send({ type: 'sub', topic: `ride:${ride.id}` });
    await until('snapshot', () => sock.msgs().find((m) => (m.body as { type: string }).type === 'ride'));
    const before = (await admin(s.url, 'GET', '/v1/admin/push/stats')).body.collapsed;
    await rider.api.cancelRide(ride.id); // replaces the unacked snapshot
    await until('cancel arrives', () => sock.msgs().find((m) => (m.body as { ride?: Ride }).ride?.status === 'cancelled'));
    assert.ok((await admin(s.url, 'GET', '/v1/admin/push/stats')).body.collapsed > before);
    sock.ws.close();
  });

  test('on shutdown the server asks apps to reconnect', async () => {
    const other = await start({ sim: false });
    const rider = await client(other.url, 'Ava', '3125550304');
    const sock = await raw(other.url, rider.session.token!);
    await other.app.close();
    const ctl = await until('control frame', () => sock.frames.find((f) => f.t === 'ctl'));
    assert.equal(ctl.t === 'ctl' && ctl.action, 'reconnect');
  });
});

describe('app push client', () => {
  test('acks, ignores repeats, and reconnects with resume when heartbeats stop', async () => {
    // A stand-in server that sends one message and then goes silent
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    const urls: string[] = [];
    const acks: number[] = [];
    const ride = { id: 'ride_1', status: 'arriving' } as Ride;
    wss.on('connection', (ws, req) => {
      urls.push(req.url!);
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.type === 'ack') acks.push(m.seq);
      });
      ws.send(JSON.stringify({ t: 'hello', epoch: 'e1', seq: 0, heartbeatMs: 100, resumed: urls.length > 1 }));
      // Sent again on the second connection, as a server replay would
      ws.send(JSON.stringify({ t: 'msg', seq: 1, ack: true, body: { type: 'ride', ride } }));
    });
    await new Promise<void>((r) => http.listen(0, r));
    const url = `http://localhost:${(http.address() as AddressInfo).port}`;
    const api = createHttpService(url, {
      getToken: () => 'token',
      onUnauthorized() {},
      getDriverSettings: () => ({ cards: defaultCards(), plan: 'silver', subscribedAt: 0 }),
      getLocation: () => THEATRE.coords,
      vault: memoryVault(),
    });
    const seen: Ride[] = [];
    const stop = api.subscribeRide('ride_1', (r) => seen.push(r));
    try {
      await until('ack', () => acks.includes(1) || undefined);
      await until('reconnect after silence', () => urls.length >= 2 || undefined, 5000);
      assert.match(urls[1], /resume=e1%3A1/);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(seen.length, 1, 'the replayed copy is not delivered twice');
    } finally {
      stop();
      wss.close();
      http.close();
    }
  });
});
