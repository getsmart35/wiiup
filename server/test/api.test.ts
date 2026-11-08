import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createHttpService } from '@/api/http';
import type { DriverTrip, FareQuote, Ride, RideRequest } from '@/api/types';
import { instantFee } from '@/lib/payouts';
import { defaultCards } from '@/lib/rates';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { admin, client, driveSimTrips, FAST, memoryVault, PIER, start, THEATRE, until, type Server } from './_helpers.ts';

describe('sign-in', () => {
  let s: Server;
  before(async () => (s = await start()));
  after(() => s.app.close());

  test('rejects a wrong code and locks after five tries', async () => {
    const api = createHttpService(s.url, { getToken: () => undefined, onUnauthorized() {}, getDriverSettings: () => ({ cards: defaultCards(), plan: 'silver', subscribedAt: 0 }), getLocation: () => THEATRE.coords, vault: memoryVault() });
    for (let i = 0; i < 5; i++) await assert.rejects(api.verifySignIn({ name: 'A', phone: '3125550100', code: '0000' }), /didn't match/);
    await assert.rejects(api.verifySignIn({ name: 'A', phone: '3125550100', code: '1234' }), /Too many tries/);
  });

  test('a bad session signs the app out', async () => {
    const { api, session } = await client(s.url, 'Ava', '3125550101');
    session.token = 'not-a-real-token';
    await assert.rejects(api.getQuotes(THEATRE.coords, PIER.coords), /Sign in again/);
    assert.equal(session.signedOut, true);
  });
});

describe('rider with a simulated driver', () => {
  let s: Server;
  before(async () => (s = await start({ sim: true })));
  after(() => s.app.close());

  test('a ride goes from searching to completed', async () => {
    const { api } = await client(s.url, 'Ava Johnson', '3125550110');
    const quotes = await api.getQuotes(THEATRE.coords, PIER.coords);
    assert.deepEqual(quotes.map((q) => q.tier), ['go', 'comfort', 'xl', 'platinum']);
    assert.ok(quotes.every((q) => q.id && q.fare > 0));
    const ride = await api.requestRide({ riderName: 'ignored', pickup: THEATRE, dropoff: PIER, quote: quotes[0] });
    assert.equal(ride.riderName, 'Ava');
    const seen: string[] = [];
    let last: Ride | undefined;
    const stop = api.subscribeRide(ride.id, (r) => {
      last = r;
      if (seen.at(-1) !== r.status) seen.push(r.status);
    });
    await until('completion', () => last?.status === 'completed');
    stop();
    assert.deepEqual(seen, ['searching', 'driver_assigned', 'arriving', 'arrived', 'in_trip', 'completed']);
    assert.equal(last!.quote.fare, quotes[0].fare);
  });

  test('a ride can only use a price the server issued', async () => {
    const { api } = await client(s.url, 'Ava', '3125550111');
    const [quote] = await api.getQuotes(THEATRE.coords, PIER.coords);
    const forged: FareQuote = { ...quote, id: 'qte_made_up', fare: 1 };
    await assert.rejects(api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote: forged }), /Prices have changed/);
    // A cheaper fare on a real quote id is ignored: the server uses the price it issued
    const ride = await api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote: { ...quote, fare: 1 } });
    assert.equal(ride.quote.fare, quote.fare);
    await assert.rejects(api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote }), /Prices have changed/, 'a quote is used once');
    await api.cancelRide(ride.id);
  });

  test("a rider can't follow someone else's ride", async () => {
    const a = await client(s.url, 'Ava', '3125550112');
    const b = await client(s.url, 'Ben', '3125550113');
    const [quote] = await a.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await a.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    let leaked = false;
    const stop = b.api.subscribeRide(ride.id, () => (leaked = true));
    await new Promise((r) => setTimeout(r, 150));
    stop();
    assert.equal(leaked, false);
    await assert.rejects(b.api.cancelRide(ride.id), /not found/);
    await a.api.cancelRide(ride.id);
  });
});

describe('rider and real driver', () => {
  let s: Server;
  before(async () => (s = await start({ sim: false })));
  after(() => s.app.close());

  test('the ride is offered to the driver and both see one price', async () => {
    const driver = await client(s.url, 'Marcus Reed', '3125550120');
    const rider = await client(s.url, 'Ava', '3125550121');
    let offer: RideRequest | undefined;
    const stopOffers = driver.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await new Promise((r) => setTimeout(r, 100));

    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    let live: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (live = r));
    await until('the offer', () => offer);
    assert.equal(offer!.riderName, 'Ava');
    assert.equal(offer!.quote.fare, quote.fare);

    const trip = await driver.api.acceptRequest(offer!, THEATRE.coords, 999);
    stopOffers();
    assert.equal(trip.earnings, quote.fare, 'earnings come from the server, not the app');
    await until('driver assigned', () => live?.driver?.name === 'Marcus');
    assert.equal(live!.driver!.car, 'Vehicle details pending');

    let tripState: DriverTrip | undefined;
    const stopTrip = driver.api.subscribeDriverTrip(trip.id, (t) => (tripState = t));
    await assert.rejects(driver.api.updateDriverTrip(trip.id, 'complete'), /Can't complete/);
    for (const [action, status] of [['arrived', 'arrived'], ['start', 'in_trip'], ['complete', 'completed']] as const) {
      await driver.api.updateDriverTrip(trip.id, action);
      await until(status, () => live?.status === status);
    }
    await until('trip completed', () => tripState?.stage === 'completed');
    stopTrip();
    stopRide();
    assert.equal(live!.quote.fare, tripState!.earnings, 'the rider pays exactly what the driver earns');
  });

  test("a driver whose custom rate is above the rider's quote isn't offered the ride", async () => {
    const cards = defaultCards();
    cards.go = { useSuggested: false, custom: { ...cards.go.custom, base: 20 } };
    const driver = await client(s.url, 'Dee', '3125550122', cards);
    const rider = await client(s.url, 'Ava', '3125550123');
    let offer: RideRequest | undefined;
    const stop = driver.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await new Promise((r) => setTimeout(r, 100));
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    let last: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (last = r));
    await until('the search to time out', () => last?.status === 'cancelled', 2000);
    stop();
    stopRide();
    assert.equal(offer, undefined);
  });

  test('when the driver cancels, the ride searches again at the confirmed price', async () => {
    const d1 = await client(s.url, 'Eli', '3125550124');
    const rider = await client(s.url, 'Ava', '3125550125');
    let offer: RideRequest | undefined;
    const stop1 = d1.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await new Promise((r) => setTimeout(r, 100));
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    let last: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (last = r));
    await until('offer', () => offer);
    const trip = await d1.api.acceptRequest(offer!, THEATRE.coords, 0);
    stop1();
    await until('assigned', () => last?.driver);
    await d1.api.updateDriverTrip(trip.id, 'cancel');
    await until('searching again', () => last?.status === 'searching' && !last.driver);
    assert.equal(last!.quote.fare, quote.fare);
    await rider.api.cancelRide(ride.id);
    stopRide();
  });

  test('when the rider cancels, the driver trip ends with no earnings', async () => {
    const driver = await client(s.url, 'Fay', '3125550126');
    const rider = await client(s.url, 'Ava', '3125550127');
    let offer: RideRequest | undefined;
    const stop = driver.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await new Promise((r) => setTimeout(r, 100));
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
    await until('offer', () => offer);
    const trip = await driver.api.acceptRequest(offer!, THEATRE.coords, 0);
    stop();
    let t: DriverTrip | undefined;
    const stopTrip = driver.api.subscribeDriverTrip(trip.id, (x) => (t = x));
    await rider.api.cancelRide(ride.id);
    await until('trip cancelled', () => t?.cancelledBy === 'rider');
    stopTrip();
    assert.equal(t!.earnings, 0);
    assert.equal(t!.stage, 'completed');
  });
});

describe('driver money and plans', () => {
  let s: Server;
  before(async () => (s = await start({ sim: true })));
  after(() => s.app.close());

  test('instant payout checks the server balance and charges the fee once', async () => {
    const { api, session } = await client(s.url, 'Gus', '3125550130');
    const earned = await driveSimTrips(api, 1);
    await assert.rejects(api.requestInstantPayout(earned + 50, 0, ''), /You can cash out up to/);
    await assert.rejects(api.requestInstantPayout(0.5, 0, ''), /minimum/);
    // Sending the same request twice (same idempotency key) pays once
    const send = () =>
      fetch(`${s.url}/v1/driver/payouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': 'repeat-key-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: earned, destination: 'ignored' }),
      }).then((r) => r.json());
    const payout = await send();
    assert.deepEqual(await send(), payout);
    assert.equal(payout.fee, instantFee(earned));
    assert.equal(payout.destination, 'Debit card •••• 4242');
    await assert.rejects(api.requestInstantPayout(1, 0, ''), /up to \$0.00/, 'the balance is now zero');
  });

  test("Gold Plus can't be chosen directly, and Platinum needs admin approval", async () => {
    const { api, session } = await client(s.url, 'Hal', '3125550131');
    const put = (plan: string) =>
      fetch(`${s.url}/v1/driver/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: defaultCards(), plan }) });
    assert.equal((await put('gold_plus')).status, 400);
    assert.equal((await put('platinum')).status, 409);

    const { submittedAt } = await api.applyForPlatinum('LIV-12345');
    assert.equal(await api.getPlatinumReview(submittedAt), 'pending');
    const list = await admin(s.url, 'GET', '/v1/admin/platinum-requests?status=pending');
    const mine = list.body.find((r: { license: string }) => r.license === 'LIV-12345');
    assert.equal(mine.driver.name, 'Hal');
    assert.equal((await admin(s.url, 'POST', `/v1/admin/platinum-requests/${mine.id}/approve`)).status, 200);
    assert.equal(await api.getPlatinumReview(submittedAt), 'approved');
    assert.equal((await put('platinum')).status, 200);
  });

  test('admin routes need the admin token', async () => {
    const res = await fetch(`${s.url}/v1/admin/platinum-requests`, { headers: { Authorization: 'Bearer wrong-token-value' } });
    assert.equal(res.status, 404);
  });

  test('at the Silver limit offers stop until the driver buys Gold', async () => {
    const { api, session } = await client(s.url, 'Ivy', '3125550132');
    const status = () => fetch(`${s.url}/v1/driver/status`, { headers: { Authorization: `Bearer ${session.token}` } }).then((r) => r.json());
    await assert.rejects(api.purchaseUpgrade('gold', 450), /only available after reaching/);

    // Push fares past $1,500 with a high custom Go rate and Go-only trips
    session.cards = defaultCards();
    for (const tier of ['go', 'comfort', 'xl', 'platinum'] as const) session.cards[tier] = { useSuggested: false, custom: { ...session.cards[tier].custom, base: 20, minimum: 100 } };
    let fares = 0;
    while (fares < 1500) fares += await driveSimTrips(api, 1);
    const st = await status();
    assert.equal(st.atLimit, true);
    assert.equal(st.upgradeOption.to, 'gold');

    let offer: RideRequest | undefined;
    const stop = api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await new Promise((r) => setTimeout(r, 300));
    stop();
    assert.equal(offer, undefined, 'no offers at the limit');

    await assert.rejects(api.purchaseUpgrade('gold', 400), /available is gold for \$450/);
    await api.purchaseUpgrade('gold', 450);
    const after = await status();
    assert.equal(after.plan, 'gold');
    assert.equal(after.atLimit, false);
  });
});

describe('restart', () => {
  test('a trip with a real driver carries on after the server restarts', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'wiiup-'));
    const dbPath = join(dir, 'wiiup.db');
    try {
      let s = await start({ sim: false, dbPath });
      const port = Number(new URL(s.url).port);
      const driver = await client(s.url, 'Jo', '3125550140');
      const rider = await client(s.url, 'Ava', '3125550141');
      let offer: RideRequest | undefined;
      const stop = driver.api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
      await new Promise((r) => setTimeout(r, 100));
      const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
      const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote });
      await until('offer', () => offer);
      const trip = await driver.api.acceptRequest(offer!, THEATRE.coords, 0);
      stop();
      const [q2] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
      const searching = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote: q2 });
      await s.app.close();

      // Same database and port, so the apps reconnect on their own
      const app = createApp({ ...loadConfig({}), dbPath, sim: false, adminToken: null, platinumAutoApproveMs: null, timing: FAST });
      await app.listen(port);
      s = { app, url: s.url };
      let live: Ride | undefined;
      const stopRide = rider.api.subscribeRide(ride.id, (r) => (live = r));
      await until('the ride after restart', () => live?.status === 'arriving' || live?.status === 'driver_assigned');
      for (const action of ['arrived', 'start', 'complete'] as const) await driver.api.updateDriverTrip(trip.id, action);
      await until('completed', () => live?.status === 'completed');
      stopRide();
      let other: Ride | undefined;
      const stopOther = rider.api.subscribeRide(searching.id, (r) => (other = r));
      await until('the searching ride to be cancelled', () => other?.status === 'cancelled');
      stopOther();
      await s.app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
