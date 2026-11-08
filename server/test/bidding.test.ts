import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { Ride, TripForBid } from '@/api/types';
import { bidLimits } from '@/lib/bids';
import { defaultCards } from '@/lib/rates';
import { client, PIER, start, THEATRE, until, type Server } from './_helpers.ts';

describe('bidding with simulated drivers', () => {
  let s: Server;
  before(async () => (s = await start({ sim: true })));
  after(() => s.app.close());

  test('the rider sees the three lowest bids, declines one, and accepts another', async () => {
    const rider = await client(s.url, 'Ava', '3125550400');
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote, mode: 'bid' });
    assert.equal(ride.status, 'bidding');
    let live: Ride | undefined;
    const stop = rider.api.subscribeRide(ride.id, (r) => (live = r));
    // Four simulated bids arrive; only three show, lowest first
    await new Promise((r) => setTimeout(r, 400));
    const bids = live!.bids!;
    assert.equal(bids.length, 3);
    assert.deepEqual(bids.map((b) => b.fare), [...bids.map((b) => b.fare)].sort((a, b) => a - b));
    const { min, max } = bidLimits(quote.fare);
    assert.ok(bids.every((b) => b.fare >= min && b.fare <= max));

    await rider.api.declineBid(ride.id, bids[0].id);
    await until('the next bid to fill in', () => (live!.bids!.length === 3 && !live!.bids!.some((b) => b.id === bids[0].id)) || undefined);
    const chosen = live!.bids![0];
    await rider.api.acceptBid(ride.id, chosen.id);
    await until('driver assigned', () => live?.status === 'driver_assigned' || live?.status === 'arriving' || undefined);
    assert.equal(live!.driver!.name, chosen.driver.name);
    assert.equal(live!.quote.fare, chosen.fare, 'the rider pays the bid');
    await until('completed', () => live?.status === 'completed' || undefined);
    stop();
  });

  test('a driver bids on a simulated rider trip and wins with the lowest bid', async () => {
    const driver = await client(s.url, 'Marcus', '3125550401');
    let board: TripForBid[] = [];
    const stop = driver.api.subscribeTripsForBid(() => THEATRE.coords, (t) => (board = t));
    await until('three trips', () => board.length >= 3 || undefined);
    const trip = board[0];
    assert.equal(trip.cardFare, trip.quote.fare, 'suggested rates: the card price is the standard price');
    await driver.api.placeBid(trip.id, trip.minBid);
    await until('pending', () => board.find((t) => t.id === trip.id)?.myBid?.status === 'pending' || undefined);
    const won = await until('accepted', () => board.find((t) => t.id === trip.id && t.myBid?.status === 'accepted'));
    assert.equal(won.myBid!.trip!.earnings, trip.minBid);
    stop();
  });

  test('bidding closes when the rider chooses nobody', async () => {
    const rider = await client(s.url, 'Ava', '3125550402');
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote, mode: 'bid' });
    let live: Ride | undefined;
    const stop = rider.api.subscribeRide(ride.id, (r) => (live = r));
    await until('closed', () => live?.status === 'cancelled' || undefined, 6000);
    stop();
  });
});

describe('bidding with real drivers', () => {
  let s: Server;
  before(async () => (s = await start({ sim: false })));
  after(() => s.app.close());

  test("a driver bids from their rate card and the rider's accept starts the trip", async () => {
    const cards = defaultCards();
    cards.go = { useSuggested: false, custom: { ...cards.go.custom, base: 6 } };
    const driver = await client(s.url, 'Marcus Reed', '3125550410', cards);
    const rider = await client(s.url, 'Ava', '3125550411');
    let board: TripForBid[] = [];
    const stopBoard = driver.api.subscribeTripsForBid(() => THEATRE.coords, (t) => (board = t));
    await new Promise((r) => setTimeout(r, 100));

    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote, mode: 'bid' });
    let live: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (live = r));
    const trip = await until('the trip on the board', () => board.find((t) => t.id === ride.id));
    assert.ok(trip.cardFare > quote.fare, "priced from the driver's custom card, not the rider's quote");
    assert.deepEqual({ min: trip.minBid, max: trip.maxBid }, bidLimits(trip.cardFare));

    await assert.rejects(driver.api.placeBid(ride.id, trip.maxBid + 5), /Bid between/);
    await assert.rejects(driver.api.placeBid(ride.id, trip.cardFare + 0.25), /steps/);
    const fare = trip.minBid + 1;
    await driver.api.placeBid(ride.id, fare);
    await assert.rejects(driver.api.placeBid(ride.id, fare), /already bid/);

    const bid = await until("the rider sees the driver's bid", () => live?.bids?.[0]);
    assert.equal(bid.driver.name, 'Marcus');
    assert.equal(bid.fare, fare);
    await rider.api.acceptBid(ride.id, bid.id);
    const won = await until('the driver hears they won', () => board.find((t) => t.id === ride.id && t.myBid?.status === 'accepted'));
    assert.equal(won.myBid!.trip!.earnings, fare, 'the driver earns their bid');
    await until('assigned', () => live?.driver?.name === 'Marcus' || undefined);
    assert.equal(live!.quote.fare, fare, 'the rider pays the same amount');
    for (const action of ['arrived', 'start', 'complete'] as const) await driver.api.updateDriverTrip(won.myBid!.trip!.id, action);
    await until('completed', () => live?.status === 'completed' || undefined);
    stopBoard();
    stopRide();
  });

  test('a declined driver sees the outcome, and the rider can still accept others', async () => {
    const d1 = await client(s.url, 'Dee', '3125550412');
    const rider = await client(s.url, 'Ava', '3125550413');
    let board: TripForBid[] = [];
    const stop = d1.api.subscribeTripsForBid(() => THEATRE.coords, (t) => (board = t));
    await new Promise((r) => setTimeout(r, 100));
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote, mode: 'bid' });
    let live: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (live = r));
    const trip = await until('trip', () => board.find((t) => t.id === ride.id));
    await d1.api.placeBid(ride.id, trip.cardFare);
    const bid = await until('bid', () => live?.bids?.[0]);
    await rider.api.declineBid(ride.id, bid.id);
    await until('declined on the board', () => board.find((t) => t.id === ride.id)?.myBid?.status === 'declined' || undefined);
    await until('gone from the rider', () => live?.bids?.length === 0 || undefined);
    await assert.rejects(rider.api.acceptBid(ride.id, bid.id), /no longer available/);
    await rider.api.cancelRide(ride.id);
    await until('cancelled', () => live?.status === 'cancelled' || undefined);
    stop();
    stopRide();
  });

  test('up to ten drivers can bid on a trip', async () => {
    const rider = await client(s.url, 'Ava', '3125550420');
    const drivers = await Promise.all(Array.from({ length: 11 }, (_, i) => client(s.url, `Driver ${i}`, `31255505${String(i).padStart(2, '0')}`)));
    const boards: TripForBid[][] = drivers.map(() => []);
    const stops = drivers.map((d, i) => d.api.subscribeTripsForBid(() => THEATRE.coords, (t) => (boards[i] = t)));
    await new Promise((r) => setTimeout(r, 150));
    const [quote] = await rider.api.getQuotes(THEATRE.coords, PIER.coords);
    const ride = await rider.api.requestRide({ riderName: '', pickup: THEATRE, dropoff: PIER, quote, mode: 'bid' });
    let live: Ride | undefined;
    const stopRide = rider.api.subscribeRide(ride.id, (r) => (live = r));
    const first = await until('trip on the board', () => boards[0].find((t) => t.id === ride.id));
    assert.equal(first.bidsLeft, 10);

    for (let i = 0; i < 10; i++) await drivers[i].api.placeBid(ride.id, first.cardFare);
    const last = await until('the board shows it full', () => boards[10].find((t) => t.id === ride.id && t.bidsLeft === 0));
    assert.equal(last.bidsLeft, 0);
    await assert.rejects(drivers[10].api.placeBid(ride.id, first.cardFare), /10 drivers have already bid/);
    // The rider still sees three at a time
    await until('three shown', () => live?.bids?.length === 3 || undefined);
    // A declined bid still counts toward the ten
    await rider.api.declineBid(ride.id, live!.bids![0].id);
    await assert.rejects(drivers[10].api.placeBid(ride.id, first.cardFare), /10 drivers have already bid/);
    await rider.api.cancelRide(ride.id);
    stops.forEach((stop) => stop());
    stopRide();
  });
});
