import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import type { DriverTrip, Ride, RideRequest } from '@/api/types';
import { createApp } from '../src/app.ts';
import { bump, compare, merge, parseKey, Sealer, vaultKey } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { admin, client, FAST, PIER, THEATRE, until } from './_helpers.ts';

describe('version clocks and sealing', () => {
  test('clocks order changes made in each region', () => {
    const a1 = bump(undefined, 'A');
    const a2 = bump(a1, 'A');
    const a1b1 = bump(a1, 'B');
    assert.equal(compare(a2, a1), 'after');
    assert.equal(compare(a1, a2), 'before');
    assert.equal(compare(a2, a1b1), 'concurrent');
    assert.equal(compare(merge(a2, a1b1), a2), 'after');
    assert.equal(compare({ A: 1 }, { A: 1, B: 0 }), 'equal');
  });

  test('keys carry the driver, trip and version', () => {
    const key = vaultKey('usr_1', 'trip_9', { B: 1, A: 3 });
    assert.equal(key, 'trip/usr_1/trip_9/A3.B1');
    assert.deepEqual(parseKey(key), { driverId: 'usr_1', tripId: 'trip_9', version: { A: 3, B: 1 } });
    assert.equal(parseKey('trip/../x/A1'), null);
  });

  test("a sealed backup can't be read, changed or moved to another driver", () => {
    const sealer = new Sealer([{ id: 'k1', key: Buffer.alloc(32, 7) }]);
    const blob = sealer.seal({ earnings: 25.5 }, 'usr_1|trip_9');
    assert.ok(!blob.includes('25.5'));
    assert.deepEqual(sealer.open(blob, 'usr_1|trip_9'), { earnings: 25.5 });
    assert.equal(sealer.open(blob, 'usr_2|trip_9'), null, 'another driver');
    const parts = blob.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    assert.equal(sealer.open(parts.join('.'), 'usr_1|trip_9'), null, 'changed');
    // A rotated-out key still opens older backups
    const rotated = new Sealer([{ id: 'k2', key: Buffer.alloc(32, 9) }, { id: 'k1', key: Buffer.alloc(32, 7) }]);
    assert.deepEqual(rotated.open(blob, 'usr_1|trip_9'), { earnings: 25.5 });
  });
});

async function region(name: string, dbPath: string, port = 0) {
  const app = createApp({ ...loadConfig({}), dbPath, sim: false, region: name, adminToken: 'admin-secret-token', platinumAutoApproveMs: null, timing: FAST });
  const p = await app.listen(port);
  return { app, url: `http://localhost:${p}`, port: p };
}

/** Rider books Chicago Theatre → Navy Pier and the driver accepts. The driver keeps following the trip. */
async function book(driver: Awaited<ReturnType<typeof client>>, rider: Awaited<ReturnType<typeof client>>) {
  let offer: RideRequest | undefined;
  const stop = driver.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
  await new Promise((r) => setTimeout(r, 100));
  const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
  const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
  await until('offer', () => offer);
  const trip = await driver.api.acceptRequest(offer!, THEATRE.coords, 0);
  let latest: DriverTrip = trip;
  const unfollow = driver.api.subscribeDriverTrip(trip.id, (t) => (latest = t));
  stop();
  return { ride, trip, latest: () => latest, unfollow };
}

describe('failover to another region', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiiup-failover-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('region B rebuilds trips and earnings from the driver phone', async () => {
    const a = await region('A', join(dir, 'a.db'));
    const driver = await client(a.url, 'Marcus Reed', '3125550200');
    const rider = await client(a.url, 'Ava', '3125550201');
    driver.api.subscribeRequests(() => THEATRE.coords, () => {})();
    await new Promise((r) => setTimeout(r, 100));
    // Region B's copy of the database stops here: nothing below replicates before region A fails
    a.app.store.db.exec(`VACUUM INTO '${join(dir, 'b.db')}'`);

    const first = await book(driver, rider);
    for (const action of ['arrived', 'start', 'complete'] as const) await driver.api.updateDriverTrip(first.trip.id, action);
    first.unfollow();
    const second = await book(driver, rider);
    await driver.api.updateDriverTrip(second.trip.id, 'arrived');

    // The phone holds one backup per trip: older versions are deleted as new ones arrive
    await until('two backups on the phone', () => driver.vault.map.size === 2 || undefined);
    const tripsOnPhone = driver.vault.keys().map((k) => parseKey(k)!.tripId).sort();
    assert.deepEqual(tripsOnPhone, [first.trip.id, second.trip.id].sort());
    const audit = await admin(a.url, 'GET', '/v1/admin/backup/audit');
    assert.equal(audit.body.coverage, 1);

    let live: Ride | undefined;
    const stopRide = rider.api.subscribeRide(second.ride.id, (r) => (live = r));
    await until('rider following', () => live);

    // Region A goes down. Region B takes over the same address with the stale database
    await a.app.close();
    const b = await region('B', join(dir, 'b.db'), a.port);
    try {
      let restored: { kind: string; tripId: string }[] = [];
      const started = Date.now();
      while (restored.length < 2 && Date.now() - started < 8000) {
        restored = (await admin(b.url, 'GET', '/v1/admin/failover/events')).body.events.filter((e: { kind: string }) => e.kind === 'restored');
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.deepEqual(restored.map((e) => e.tripId).sort(), [first.trip.id, second.trip.id].sort());

      // The rider's app finds the ride again, at the driver's stage
      await until('rider sees the restored ride', () => live?.status === 'arrived' && live.driver?.name === 'Marcus', 8000);

      // The trip carries on in region B
      await driver.api.updateDriverTrip(second.trip.id, 'start');
      await driver.api.updateDriverTrip(second.trip.id, 'complete');
      await until('rider sees completion', () => live?.status === 'completed', 8000);
      stopRide();
      second.unfollow();

      // Earnings for the plan limit include the trip region B only knows from the phone's tombstone
      const status = await fetch(`${b.url}/v1/driver/status`, { headers: { Authorization: `Bearer ${driver.session.token}` } }).then((r) => r.json());
      assert.equal(status.earned, Math.round((first.trip.earnings + second.trip.earnings) * 100) / 100);

      // Instant payout waits until an admin confirms the payment ledger
      await assert.rejects(driver.api.requestInstantPayout(5, 0, ''), /paused/);
      await admin(b.url, 'POST', '/v1/admin/failover/confirm-ledger');
      const payout = await driver.api.requestInstantPayout(5, 0, '');
      assert.equal(payout.amount, 5);
    } finally {
      await b.app.close();
    }
  });

  test('a backup changed on the phone is rejected', async () => {
    const a = await region('A', join(dir, 'c.db'));
    const driver = await client(a.url, 'Nia', '3125550210');
    const rider = await client(a.url, 'Ava', '3125550211');
    driver.api.subscribeRequests(() => THEATRE.coords, () => {})();
    await new Promise((r) => setTimeout(r, 100));
    a.app.store.db.exec(`VACUUM INTO '${join(dir, 'd.db')}'`);

    const { trip, unfollow } = await book(driver, rider);
    await driver.api.updateDriverTrip(trip.id, 'arrived');
    await until('backup on the phone', () => driver.vault.map.size === 1 || undefined);
    const [key] = driver.vault.keys();
    const blob = driver.vault.map.get(key)!;
    const parts = blob.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    driver.vault.map.set(key, parts.join('.'));

    await a.app.close();
    const b = await region('B', join(dir, 'd.db'), a.port);
    try {
      let rejected: { kind: string; tripId: string; detail: string }[] = [];
      const started = Date.now();
      while (!rejected.length && Date.now() - started < 8000) {
        rejected = (await admin(b.url, 'GET', '/v1/admin/failover/events')).body.events.filter((e: { kind: string }) => e.kind === 'rejected');
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(rejected[0]?.tripId, trip.id);
      assert.match(rejected[0].detail, /integrity/);
      await assert.rejects(driver.api.updateDriverTrip(trip.id, 'start'), /Trip not found/);
      unfollow();
    } finally {
      await b.app.close();
    }
  });

  test('when both regions changed a trip, the later stage wins and it is flagged', async () => {
    const a = await region('A', join(dir, 'e.db'));
    const driver = await client(a.url, 'Oti', '3125550220');
    const rider = await client(a.url, 'Ava', '3125550221');
    const { ride, trip, unfollow } = await book(driver, rider);
    // Region B's copy has the accepted trip, but not the driver's arrival
    a.app.store.db.exec(`VACUUM INTO '${join(dir, 'f.db')}'`);
    await driver.api.updateDriverTrip(trip.id, 'arrived');
    await until('arrival backed up', () => driver.vault.keys().some((k) => parseKey(k)?.version.A === 2) || undefined);
    unfollow(); // the driver's phone is away while region B takes over

    await a.app.close();
    const b = await region('B', join(dir, 'f.db'), a.port);
    try {
      // Meanwhile the rider cancels in region B
      await rider.api.cancelRide(ride.id);
      let latest: DriverTrip | undefined;
      const stop = driver.api.subscribeDriverTrip(trip.id, (t) => (latest = t));
      let conflicts: { kind: string; tripId: string; detail: string }[] = [];
      const started = Date.now();
      while (!conflicts.length && Date.now() - started < 8000) {
        conflicts = (await admin(b.url, 'GET', '/v1/admin/failover/events')).body.events.filter((e: { kind: string }) => e.kind === 'conflict');
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(conflicts[0]?.tripId, trip.id);
      assert.match(conflicts[0].detail, /server's/, 'the cancel beats the arrival');
      await until('the driver sees the cancel', () => latest?.cancelledBy === 'rider' || undefined, 8000);
      // The phone ends up with one backup, versioned by both regions
      await until('phone brought up to date', () => {
        const keys = driver.vault.keys().map((k) => parseKey(k)!);
        return (keys.length === 1 && keys[0].version.A === 2 && keys[0].version.B! >= 1) || undefined;
      }, 8000);
      stop();
    } finally {
      await b.app.close();
    }
  });
});
