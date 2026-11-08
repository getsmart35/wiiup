import type { DriverTripAction, RequestRideInput, RideService, Unsubscribe } from './client';
import type { Bid, Driver, DriverTrip, LatLng, Place, Ride, TripForBid } from './types';
import { BID_TTL_MS, BIDDING_WINDOW_MS, bidLimits, clampBid, MAX_BIDDERS, visibleBids } from '@/lib/bids';
import { TIER_ORDER, quoteFare } from '@/lib/fare';
import { tripPrice, withTripPrice } from '@/store/useRateCards';
import { distanceKm, durationMin, jitter, pointAlong, roadDistanceKm, routePath } from '@/lib/geo';

/** Simulation timings (ms). Tweak to speed up or slow down demos. */
export const MOCK_TIMING = {
  tick: 500,
  matching: 3000,
  assignedPause: 1500,
  arrival: 10000,
  arrivedPause: 3000,
  trip: 15000,
  driverToPickup: 8000,
  driverTrip: 12000,
  requestMinGap: 15000,
  requestMaxGap: 30000,
  requestTtl: 15000,
  /** When simulated drivers bid on a rider's trip, from the request. */
  bids: [1500, 3000, 4500, 7000, 10000],
  /** How long a simulated rider takes to choose after a driver bids. */
  riderChoice: 5000,
  /** A new trip appears on the driver's bid board this often. */
  bidBoardGap: 20000,
};

const FIRST_NAMES = ['Maya', 'Jordan', 'Luis', 'Aisha', 'Kenji', 'Priya', 'Marcus', 'Sofia', 'Dev', 'Elena'];
const CARS = [
  ['Toyota Camry', 'Silver'],
  ['Honda Accord', 'Black'],
  ['Tesla Model 3', 'White'],
  ['Hyundai Ioniq 5', 'Gray'],
  ['Kia Telluride', 'Blue'],
  ['Toyota Sienna', 'White'],
];
const STREETS = ['Market St', 'Valencia St', 'Mission St', 'Hayes St', 'Fillmore St', 'Castro St', 'Grand Ave', 'Ocean Ave'];

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

function fakeDriver(near: LatLng, radiusKm = 2): Driver {
  const [car, color] = pick(CARS);
  return {
    id: uid('drv'),
    name: pick(FIRST_NAMES),
    rating: Math.round((4.6 + Math.random() * 0.4) * 100) / 100,
    car,
    color,
    plate: `${randInt(1, 9)}${String.fromCharCode(65 + randInt(0, 25))}${String.fromCharCode(65 + randInt(0, 25))}${randInt(100, 999)}`,
    location: jitter(near, radiusKm),
  };
}

function fakePlace(near: LatLng, radiusKm: number): Place {
  return {
    id: uid('plc'),
    name: `${randInt(100, 2999)} ${pick(STREETS)}`,
    address: 'Nearby',
    coords: jitter(near, radiusKm),
  };
}

const delay = <T,>(value: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(value), ms));

/** Minutes remaining given distance left on a path. */
const etaFrom = (from: LatLng, to: LatLng) => durationMin(roadDistanceKm(from, to));

const PLATINUM_REVIEW_MS = 5000;
const DEMO_CODE = '1234';

export function createMockService(): RideService {
  const rides = new Map<string, Ride>();
  const rideListeners = new Map<string, Set<(r: Ride) => void>>();
  const rideTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

  /** Every bid on each bidding ride, including declined and expired ones. */
  const bidding = new Map<string, Bid[]>();

  const trips = new Map<string, DriverTrip>();
  const tripListeners = new Map<string, Set<(t: DriverTrip) => void>>();
  const tripIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // ---------- rider ----------

  function emitRide(id: string, patch: Partial<Ride>) {
    const cur = rides.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    rides.set(id, next);
    rideListeners.get(id)?.forEach((cb) => cb(next));
  }

  function later(id: string, ms: number, fn: () => void) {
    const t = setTimeout(fn, ms);
    rideTimers.set(id, [...(rideTimers.get(id) ?? []), t]);
  }

  /** Moves the ride's driver along `path` over `durationMs`, then calls `done`. */
  function animate(id: string, path: LatLng[], durationMs: number, done: () => void) {
    const start = Date.now();
    const step = () => {
      const ride = rides.get(id);
      if (!ride?.driver || ride.status === 'cancelled') return;
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const location = pointAlong(path, t);
      const end = path[path.length - 1];
      emitRide(id, {
        driver: { ...ride.driver, location },
        liveEtaMin: t >= 1 ? 0 : Math.max(1, etaFrom(location, end)),
      });
      if (t >= 1) done();
      else later(id, MOCK_TIMING.tick, step);
    };
    step();
  }

  function runRide(id: string) {
    later(id, MOCK_TIMING.matching, () => assign(id, fakeDriver(rides.get(id)!.pickup.coords, 1.5)));
  }

  /** Simulated drivers bid on the rider's trip; the rider sees the three lowest. */
  function runBidding(id: string) {
    const all: Bid[] = [];
    const show = () => emitRide(id, { bids: visibleBids(all) });
    for (const at of MOCK_TIMING.bids) {
      later(id, at, () => {
        const ride = rides.get(id);
        if (ride?.status !== 'bidding') return;
        const driver = fakeDriver(ride.pickup.coords, 2);
        const fare = clampBid(ride.quote.fare * (0.85 + Math.random() * 0.4), bidLimits(ride.quote.fare));
        const now = Date.now();
        const bid: Bid = { id: uid('bid'), rideId: id, driver, fare, etaMin: etaFrom(driver.location, ride.pickup.coords), placedAt: now, expiresAt: now + BID_TTL_MS, status: 'pending' };
        all.push(bid);
        show();
        later(id, BID_TTL_MS, () => {
          if (bid.status !== 'pending') return;
          bid.status = 'expired';
          show();
        });
      });
    }
    later(id, BIDDING_WINDOW_MS, () => {
      if (rides.get(id)?.status === 'bidding') emitRide(id, { status: 'cancelled', bids: [] });
    });
    bidding.set(id, all);
  }

  function assign(id: string, driver: Driver) {
    const ride = rides.get(id)!;
    emitRide(id, {
      status: 'driver_assigned',
      driver,
      liveEtaMin: etaFrom(driver.location, ride.pickup.coords),
    });
    later(id, MOCK_TIMING.assignedPause, () => {
      emitRide(id, { status: 'arriving' });
      const path = routePath(driver.location, ride.pickup.coords, 30);
      animate(id, path, MOCK_TIMING.arrival, () => {
        emitRide(id, { status: 'arrived', liveEtaMin: 0 });
        later(id, MOCK_TIMING.arrivedPause, () => {
          const r = rides.get(id)!;
          emitRide(id, { status: 'in_trip', liveEtaMin: r.quote.durationMin });
          const tripPath = routePath(r.pickup.coords, r.dropoff.coords, 40);
          animate(id, tripPath, MOCK_TIMING.trip, () => {
            emitRide(id, { status: 'completed', completedAt: Date.now(), liveEtaMin: 0 });
          });
        });
      });
    });
  }

  // ---------- driver ----------

  function emitTrip(id: string, patch: Partial<DriverTrip>) {
    const cur = trips.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    trips.set(id, next);
    tripListeners.get(id)?.forEach((cb) => cb(next));
  }

  function startTrip(request: DriverTrip['request'], driverLocation: LatLng, earnings: number): DriverTrip {
    const trip: DriverTrip = {
      id: uid('trip'),
      request,
      stage: 'to_pickup',
      location: driverLocation,
      liveEtaMin: etaFrom(driverLocation, request.pickup.coords),
      earnings,
      acceptedAt: Date.now(),
    };
    trips.set(trip.id, trip);
    driveTrip(trip.id, driverLocation, request.pickup.coords, MOCK_TIMING.driverToPickup, () => {});
    return trip;
  }

  // Simulated trips on a driver's bid board, and their placeBid handler while the board is open
  let board: { trips: Map<string, TripForBid>; emit: () => void; here: () => LatLng } | null = null;

  function newTripForBid(here: LatLng): TripForBid {
    const pickup = fakePlace(here, 1.5);
    let dropoff = fakePlace(pickup.coords, 6);
    while (distanceKm(pickup.coords, dropoff.coords) < 1) dropoff = fakePlace(pickup.coords, 6);
    const quote = quoteFare(pick(TIER_ORDER), pickup.coords, dropoff.coords, { etaMin: etaFrom(here, pickup.coords) });
    const cardFare = tripPrice(quote);
    const limits = bidLimits(cardFare);
    return {
      id: uid('ride'),
      riderName: pick(FIRST_NAMES),
      riderRating: Math.round((4.5 + Math.random() * 0.5) * 100) / 100,
      pickup,
      dropoff,
      quote,
      cardFare,
      minBid: limits.min,
      maxBid: limits.max,
      closesAt: Date.now() + BIDDING_WINDOW_MS,
      // Some simulated drivers have already bid
      bidsLeft: MAX_BIDDERS - randInt(0, 7),
    };
  }

  function driveTrip(id: string, from: LatLng, to: LatLng, durationMs: number, onArrive: () => void) {
    clearInterval(tripIntervals.get(id));
    const path = routePath(from, to, 30);
    const start = Date.now();
    const iv = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const location = pointAlong(path, t);
      emitTrip(id, { location, liveEtaMin: t >= 1 ? 0 : Math.max(1, etaFrom(location, to)) });
      if (t >= 1) {
        clearInterval(iv);
        tripIntervals.delete(id);
        onArrive();
      }
    }, MOCK_TIMING.tick);
    tripIntervals.set(id, iv);
  }

  return {
    async startSignIn() {
      return delay({ demoCode: DEMO_CODE }, 600);
    },

    async verifySignIn({ code }) {
      if (code !== DEMO_CODE) throw new Error("That code didn't match");
      return delay({ token: null }, 300);
    },

    async getNearbyDrivers(center) {
      return delay(Array.from({ length: randInt(4, 7) }, () => fakeDriver(center, 1.8)), 200);
    },

    async getQuotes(pickup, dropoff) {
      const surge = Math.random() < 0.25 ? 1.3 : 1;
      return delay(
        TIER_ORDER.map((tier, i) => withTripPrice(quoteFare(tier, pickup, dropoff, { surge, etaMin: randInt(2, 5) + i * 2 }))),
        400,
      );
    },

    async requestRide({ riderName, pickup, dropoff, quote, mode }: RequestRideInput) {
      const bid = mode === 'bid';
      const ride: Ride = {
        id: uid('ride'),
        riderName,
        pickup,
        dropoff,
        quote,
        status: bid ? 'bidding' : 'searching',
        createdAt: Date.now(),
        ...(bid && { mode: 'bid' as const, bids: [], biddingClosesAt: Date.now() + BIDDING_WINDOW_MS }),
      };
      rides.set(ride.id, ride);
      if (bid) runBidding(ride.id);
      else runRide(ride.id);
      return delay(ride, 200);
    },

    async cancelRide(rideId) {
      rideTimers.get(rideId)?.forEach(clearTimeout);
      rideTimers.delete(rideId);
      emitRide(rideId, { status: 'cancelled' });
    },

    async acceptBid(rideId, bidId) {
      const all = bidding.get(rideId);
      const bid = all?.find((b) => b.id === bidId && b.status === 'pending');
      const ride = rides.get(rideId);
      if (!all || !bid || ride?.status !== 'bidding') throw new Error('This bid is no longer available');
      for (const b of all) b.status = b === bid ? 'accepted' : b.status === 'pending' ? 'lost' : b.status;
      // Stop the remaining simulated bids and the closing timer, then the chosen driver comes
      rideTimers.get(rideId)?.forEach(clearTimeout);
      rideTimers.delete(rideId);
      emitRide(rideId, { bids: [], quote: { ...ride.quote, fare: bid.fare } });
      assign(rideId, bid.driver);
      return delay(undefined, 300);
    },

    async declineBid(rideId, bidId) {
      const all = bidding.get(rideId);
      const bid = all?.find((b) => b.id === bidId);
      if (!all || !bid) return;
      if (bid.status === 'pending') bid.status = 'declined';
      emitRide(rideId, { bids: visibleBids(all) });
    },

    subscribeRide(rideId, cb): Unsubscribe {
      const set = rideListeners.get(rideId) ?? new Set();
      set.add(cb);
      rideListeners.set(rideId, set);
      const cur = rides.get(rideId);
      if (cur) cb(cur);
      return () => set.delete(cb);
    },

    subscribeRequests(getLocation, cb): Unsubscribe {
      let timer: ReturnType<typeof setTimeout>;
      let active = true;
      const schedule = (ms: number) => {
        timer = setTimeout(() => {
          if (!active) return;
          const here = getLocation();
          const pickup = fakePlace(here, 1.5);
          let dropoff = fakePlace(pickup.coords, 6);
          while (distanceKm(pickup.coords, dropoff.coords) < 1) dropoff = fakePlace(pickup.coords, 6);
          cb({
            id: uid('req'),
            riderName: pick(FIRST_NAMES),
            riderRating: Math.round((4.5 + Math.random() * 0.5) * 100) / 100,
            pickup,
            dropoff,
            quote: withTripPrice(quoteFare(pick(TIER_ORDER), pickup.coords, dropoff.coords, {
              etaMin: etaFrom(here, pickup.coords),
              surge: Math.random() < 0.25 ? 1.3 : 1,
            })),
            expiresAt: Date.now() + MOCK_TIMING.requestTtl,
          });
          schedule(randInt(MOCK_TIMING.requestMinGap, MOCK_TIMING.requestMaxGap));
        }, ms);
      };
      schedule(4000); // first request arrives quickly so the demo isn't idle
      return () => {
        active = false;
        clearTimeout(timer);
      };
    },

    async acceptRequest(request, driverLocation, earnings) {
      return delay(startTrip(request, driverLocation, earnings), 200);
    },

    subscribeTripsForBid(getLocation, cb): Unsubscribe {
      const open = new Map<string, TripForBid>();
      const emit = () => cb([...open.values()].filter((t) => t.closesAt > Date.now() || t.myBid?.status === 'accepted'));
      const add = () => {
        const t = newTripForBid(getLocation());
        open.set(t.id, t);
        emit();
      };
      for (let i = 0; i < 3; i++) add();
      const iv = setInterval(add, MOCK_TIMING.bidBoardGap);
      board = { trips: open, emit, here: getLocation };
      return () => {
        clearInterval(iv);
        if (board?.trips === open) board = null;
      };
    },

    // The simulated rider gets other bids too, and picks the lowest a few seconds after this driver bids
    async placeBid(tripId, fare) {
      const t = board?.trips.get(tripId);
      if (!board || !t || t.closesAt < Date.now()) throw new Error('This trip is no longer taking bids');
      if (t.myBid) throw new Error('You already bid on this trip');
      if (t.bidsLeft <= 0) throw new Error(`${MAX_BIDDERS} drivers have already bid on this trip`);
      const amount = clampBid(fare, { min: t.minBid, max: t.maxBid });
      const myBid: NonNullable<TripForBid['myBid']> = { id: uid('bid'), fare: amount, status: 'pending' };
      const current = board;
      current.trips.set(tripId, { ...t, myBid, bidsLeft: t.bidsLeft - 1 });
      current.emit();
      setTimeout(() => {
        const latest = current.trips.get(tripId);
        if (!latest?.myBid || latest.myBid.status !== 'pending') return;
        const others = [0, 1].map(() => clampBid(t.cardFare * (0.85 + Math.random() * 0.35), { min: t.minBid, max: t.maxBid }));
        const won = amount <= Math.min(...others);
        const request = { id: tripId, riderName: t.riderName, riderRating: t.riderRating, pickup: t.pickup, dropoff: t.dropoff, quote: { ...t.quote, fare: amount }, expiresAt: Date.now() };
        current.trips.set(tripId, {
          ...latest,
          myBid: { ...latest.myBid, status: won ? 'accepted' : 'lost', ...(won && { trip: startTrip(request, current.here(), amount) }) },
        });
        current.emit();
      }, MOCK_TIMING.riderChoice);
      return delay(undefined, 300);
    },

    async requestInstantPayout(amount, fee, destination) {
      const at = Date.now();
      return delay({ id: uid('payout'), amount, fee, net: Math.round((amount - fee) * 100) / 100, destination, at }, 800);
    },

    async purchaseUpgrade() {
      return delay(undefined, 600);
    },

    async applyForPlatinum() {
      return delay({ submittedAt: Date.now() }, 400);
    },

    // Stand-in for the admin's decision in the back office
    async getPlatinumReview(submittedAt) {
      return Date.now() - submittedAt >= PLATINUM_REVIEW_MS ? 'approved' : 'pending';
    },

    async updateDriverTrip(tripId, action: DriverTripAction) {
      const trip = trips.get(tripId);
      if (!trip) return;
      if (action === 'arrived') {
        clearInterval(tripIntervals.get(tripId));
        emitTrip(tripId, { stage: 'at_pickup', location: trip.request.pickup.coords, liveEtaMin: 0 });
      } else if (action === 'start') {
        emitTrip(tripId, { stage: 'in_trip', liveEtaMin: trip.request.quote.durationMin });
        driveTrip(tripId, trip.request.pickup.coords, trip.request.dropoff.coords, MOCK_TIMING.driverTrip, () => {});
      } else if (action === 'cancel') {
        clearInterval(tripIntervals.get(tripId));
        emitTrip(tripId, { stage: 'completed', liveEtaMin: 0, earnings: 0, completedAt: Date.now(), cancelledBy: 'driver' });
      } else if (action === 'complete') {
        clearInterval(tripIntervals.get(tripId));
        emitTrip(tripId, {
          stage: 'completed',
          location: trip.request.dropoff.coords,
          liveEtaMin: 0,
          completedAt: Date.now(),
        });
      }
    },

    subscribeDriverTrip(tripId, cb): Unsubscribe {
      const set = tripListeners.get(tripId) ?? new Set();
      set.add(cb);
      tripListeners.set(tripId, set);
      const cur = trips.get(tripId);
      if (cur) cb(cur);
      return () => set.delete(cb);
    },
  };
}
