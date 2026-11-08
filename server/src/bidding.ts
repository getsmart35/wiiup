import type { Bid, BidStatus, DriverTrip, FareQuote, LatLng, Place, TripForBid } from '@/api/types';
import { BID_STEP, bidLimits, clampBid, MAX_BIDDERS, visibleBids } from '@/lib/bids';
import { quoteFare, TIER_ORDER } from '@/lib/fare';
import { distanceKm, durationMin, roadDistanceKm } from '@/lib/geo';
import { cents } from '@/lib/rates';
import type { Config } from './config.ts';
import { fakeDriver, fakePlace, FIRST_NAMES, type Dispatch } from './dispatch.ts';
import { driverPrice, planStatus } from './drivers.ts';
import { badRequest, conflict, notFound } from './http.ts';
import type { Live } from './live.ts';
import { newId, type RideRecord, type Store } from './store.ts';

type Timer = ReturnType<typeof setTimeout>;
/** A bid as kept on the server: `driverId` is null for simulated drivers. */
type BidRec = Bid & { driverId: string | null; location: LatLng; trip?: DriverTrip };
type OpenRide = { rec: RideRecord; bids: BidRec[]; timers: Timer[]; closed: boolean };
type MyBid = NonNullable<TripForBid['myBid']>;
/** A simulated rider's trip on driver bid boards (simulation only). */
type SimTrip = {
  id: string;
  riderName: string;
  riderRating: number;
  pickup: Place;
  dropoff: Place;
  quote: FareQuote;
  closesAt: number;
  bids: Map<string, MyBid>;
  /** Bids already placed by simulated drivers. */
  others: number;
};

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const etaFrom = (from: LatLng, to: LatLng) => durationMin(roadDistanceKm(from, to));
const latest = (topic: string) => ({ reliable: true, collapseKey: topic });
/** What a rider sees of a bid. */
const publicBid = ({ driverId: _d, location: _l, trip: _t, ...bid }: BidRec): Bid => bid;

/**
 * Trip bidding (rules in src/lib/bids.ts). A rider who asks for bids gets a ride in `bidding` status. Drivers with
 * their bid board open see it priced from their own rate card and bid within their limits. The rider sees the three
 * lowest open bids, accepts one (dispatch then assigns that driver at that fare) or declines them one by one.
 */
export class Bidding {
  private rides = new Map<string, OpenRide>();
  private sim = new Map<string, SimTrip>();
  private board = new Map<string, { location: LatLng; simTimer?: ReturnType<typeof setInterval> }>();
  private timers = new Set<Timer>();

  constructor(
    private store: Store,
    private live: Live,
    private config: Config,
    private dispatch: Dispatch,
  ) {}

  private get t() {
    return this.config.timing;
  }

  private later(fn: () => void, ms: number, list?: Timer[]) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    list?.push(timer);
  }

  has(rideId: string) {
    return this.rides.has(rideId);
  }

  // ---------- rider ----------

  open(rec: RideRecord) {
    const or: OpenRide = { rec, bids: [], timers: [], closed: false };
    this.rides.set(rec.ride.id, or);
    this.later(() => {
      if (!or.closed) this.close(or, 'cancelled');
    }, this.t.biddingWindow, or.timers);
    if (this.config.sim) {
      for (const at of this.t.simBids) this.later(() => this.simBid(or), at, or.timers);
    }
    this.refreshBoards();
  }

  cancel(rideId: string) {
    const or = this.rides.get(rideId);
    if (or && !or.closed) this.close(or, 'cancelled');
  }

  accept(riderId: string, rideId: string, bidId: string) {
    const or = this.openFor(riderId, rideId);
    const bid = or.bids.find((b) => b.id === bidId);
    if (!bid || bid.status !== 'pending' || bid.expiresAt < Date.now()) throw conflict('bid_gone', 'This bid is no longer available');
    if (bid.driverId) {
      const profile = this.store.ensureDriver(bid.driverId);
      if (this.dispatch.isBusy(bid.driverId) || planStatus(this.store, profile).atLimit) {
        bid.status = 'expired';
        this.emit(or);
        this.refreshBoard(bid.driverId);
        throw conflict('driver_unavailable', 'That driver just took another trip. Choose another bid.');
      }
    }
    for (const b of or.bids) if (b !== bid && b.status === 'pending') b.status = 'lost';
    bid.status = 'accepted';
    or.closed = true;
    or.timers.forEach(clearTimeout);
    or.rec.ride = { ...or.rec.ride, bids: [] };
    bid.trip = this.dispatch.takeBid(or.rec, { driverId: bid.driverId, driver: bid.driver, fare: bid.fare, location: bid.location }) ?? undefined;
    this.forget(or);
  }

  decline(riderId: string, rideId: string, bidId: string) {
    const or = this.openFor(riderId, rideId);
    const bid = or.bids.find((b) => b.id === bidId);
    if (!bid) throw notFound('Bid not found');
    if (bid.status !== 'pending') return;
    bid.status = 'declined';
    this.emit(or);
    if (bid.driverId) this.refreshBoard(bid.driverId);
  }

  private openFor(riderId: string, rideId: string) {
    const or = this.rides.get(rideId);
    if (!or || or.rec.riderId !== riderId) throw notFound('Ride not found');
    if (or.closed) throw conflict('bidding_closed', 'This trip is no longer taking bids');
    return or;
  }

  /** Stops bidding: the ride is cancelled (nobody chosen in time, or the rider cancelled). */
  private close(or: OpenRide, status: 'cancelled') {
    or.closed = true;
    or.timers.forEach(clearTimeout);
    for (const b of or.bids) if (b.status === 'pending') b.status = 'lost';
    or.rec.ride = { ...or.rec.ride, status, bids: [], liveEtaMin: 0 };
    this.store.saveRide(or.rec);
    this.live.publish(`ride:${or.rec.ride.id}`, { type: 'ride', ride: or.rec.ride }, latest(`ride:${or.rec.ride.id}`));
    this.forget(or);
  }

  /** Drivers who bid still see the outcome for a while; then the ride leaves the bidding module. */
  private forget(or: OpenRide) {
    this.refreshBoards();
    this.later(() => {
      this.rides.delete(or.rec.ride.id);
      this.refreshBoards();
    }, this.t.boardKeepDecided);
  }

  /** Sends the rider the three lowest open bids. */
  private emit(or: OpenRide) {
    or.rec.ride = { ...or.rec.ride, bids: visibleBids(or.bids).map(publicBid) };
    this.store.saveRide(or.rec);
    this.live.publish(`ride:${or.rec.ride.id}`, { type: 'ride', ride: or.rec.ride }, latest(`ride:${or.rec.ride.id}`));
  }

  private addBid(or: OpenRide, bid: BidRec) {
    or.bids.push(bid);
    this.emit(or);
    this.later(() => {
      if (bid.status !== 'pending') return;
      bid.status = 'expired';
      this.emit(or);
      if (bid.driverId) this.refreshBoard(bid.driverId);
    }, this.t.bidTtl, or.timers);
  }

  private simBid(or: OpenRide) {
    if (or.closed || or.bids.length >= MAX_BIDDERS) return;
    const { pickup, quote } = or.rec.ride;
    const driver = fakeDriver(pickup.coords, 2);
    const now = Date.now();
    this.addBid(or, {
      id: newId('bid'),
      rideId: or.rec.ride.id,
      driver,
      fare: clampBid(quote.fare * (0.85 + Math.random() * 0.4), bidLimits(quote.fare)),
      etaMin: etaFrom(driver.location, pickup.coords),
      placedAt: now,
      expiresAt: now + this.t.bidTtl,
      status: 'pending',
      driverId: null,
      location: driver.location,
    });
  }

  // ---------- driver ----------

  /** The driver opened their bid board. */
  join(driverId: string, location: LatLng) {
    this.store.ensureDriver(driverId);
    const cur = this.board.get(driverId);
    if (cur) cur.location = location;
    else {
      const entry: { location: LatLng; simTimer?: ReturnType<typeof setInterval> } = { location };
      this.board.set(driverId, entry);
      if (this.config.sim) {
        for (let i = 0; i < 3; i++) this.addSimTrip(location);
        entry.simTimer = setInterval(() => (this.addSimTrip(entry.location), this.refreshBoard(driverId)), this.t.bidBoardGap);
      }
    }
    this.refreshBoard(driverId);
  }

  leave(driverId: string) {
    clearInterval(this.board.get(driverId)?.simTimer);
    this.board.delete(driverId);
  }

  moved(driverId: string, location: LatLng) {
    const cur = this.board.get(driverId);
    if (cur) cur.location = location;
  }

  place(driverId: string, tripId: string, fare: number) {
    const spot = this.board.get(driverId);
    if (!spot) throw conflict('board_closed', 'Open Bid on trips to place a bid');
    if (this.dispatch.isBusy(driverId)) throw conflict('busy', 'Finish your current trip to bid again');
    const profile = this.store.ensureDriver(driverId);
    if (planStatus(this.store, profile).atLimit) throw conflict('limit_reached', 'You have reached your plan limit. Upgrade to keep bidding.');

    const simTrip = this.sim.get(tripId);
    const or = this.rides.get(tripId);
    const quote = simTrip?.quote ?? or?.rec.ride.quote;
    if (!quote || or?.closed || (simTrip && simTrip.closesAt < Date.now())) throw conflict('bidding_closed', 'This trip is no longer taking bids');
    if (or?.rec.riderId === driverId) throw badRequest("You can't bid on your own trip");
    if (simTrip?.bids.has(driverId) || or?.bids.some((b) => b.driverId === driverId)) throw conflict('already_bid', 'You already bid on this trip');
    // Every bid counts toward the limit, including ones the rider declined or that expired
    if ((simTrip ? simTrip.others + simTrip.bids.size : or!.bids.length) >= MAX_BIDDERS) {
      throw conflict('bids_full', `${MAX_BIDDERS} drivers have already bid on this trip`);
    }

    const limits = bidLimits(driverPrice(profile.cards, quote));
    const amount = cents(fare);
    if (amount < limits.min || amount > limits.max || Math.abs(amount / BID_STEP - Math.round(amount / BID_STEP)) > 1e-6) {
      throw badRequest(`Bid between $${limits.min.toFixed(2)} and $${limits.max.toFixed(2)}, in $${BID_STEP.toFixed(2)} steps`);
    }

    if (simTrip) return this.placeOnSim(driverId, simTrip, amount, spot.location);
    const now = Date.now();
    this.addBid(or!, {
      id: newId('bid'),
      rideId: tripId,
      driver: this.dispatch.driverCard(driverId, spot.location),
      fare: amount,
      etaMin: etaFrom(spot.location, or!.rec.ride.pickup.coords),
      placedAt: now,
      expiresAt: now + this.t.bidTtl,
      status: 'pending',
      driverId,
      location: spot.location,
    });
    this.refreshBoard(driverId);
  }

  /** A simulated rider weighs this bid against two others and picks the lowest. */
  private placeOnSim(driverId: string, trip: SimTrip, fare: number, location: LatLng) {
    const bid: MyBid = { id: newId('bid'), fare, status: 'pending' };
    trip.bids.set(driverId, bid);
    this.refreshBoard(driverId);
    this.later(() => {
      if (bid.status !== 'pending') return;
      const card = trip.quote.fare;
      const others = [0, 1].map(() => clampBid(card * (0.85 + Math.random() * 0.35), bidLimits(card)));
      const profile = this.store.driver(driverId);
      const free = profile && !this.dispatch.isBusy(driverId) && !planStatus(this.store, profile).atLimit;
      if (free && fare <= Math.min(...others)) {
        const { id, riderName, riderRating, pickup, dropoff, quote } = trip;
        bid.trip = this.dispatch.startTrip(driverId, location, { id, riderName, riderRating, pickup, dropoff, quote: { ...quote, fare }, expiresAt: Date.now() }, null);
        bid.status = 'accepted';
      } else bid.status = 'lost';
      this.refreshBoard(driverId);
    }, this.t.simRiderChoice);
  }

  private addSimTrip(near: LatLng) {
    const pickup = fakePlace(near, 1.5);
    let dropoff = fakePlace(pickup.coords, 6);
    while (distanceKm(pickup.coords, dropoff.coords) < 1) dropoff = fakePlace(pickup.coords, 6);
    const trip: SimTrip = {
      id: newId('ride'),
      riderName: pick(FIRST_NAMES),
      riderRating: Math.round((4.5 + Math.random() * 0.5) * 100) / 100,
      pickup,
      dropoff,
      quote: quoteFare(pick(TIER_ORDER), pickup.coords, dropoff.coords),
      closesAt: Date.now() + this.t.biddingWindow,
      bids: new Map(),
      others: Math.floor(Math.random() * 8),
    };
    this.sim.set(trip.id, trip);
    this.later(() => {
      this.sim.delete(trip.id);
      this.refreshBoards();
    }, this.t.biddingWindow + this.t.boardKeepDecided);
  }

  /** The trips on one driver's board, each priced from their rate card. */
  boardFor(driverId: string): TripForBid[] {
    const spot = this.board.get(driverId);
    const profile = this.store.driver(driverId);
    if (!spot || !profile) return [];
    const near = (p: Place) => distanceKm(p.coords, spot.location) <= this.config.dispatchRadiusKm;
    const priced = (base: Omit<TripForBid, 'cardFare' | 'minBid' | 'maxBid' | 'myBid' | 'bidsLeft'>, bids: number, myBid?: MyBid): TripForBid => {
      const cardFare = driverPrice(profile.cards, base.quote);
      const { min, max } = bidLimits(cardFare);
      const bidsLeft = Math.max(0, MAX_BIDDERS - bids);
      return { ...base, quote: { ...base.quote, etaMin: etaFrom(spot.location, base.pickup.coords) }, cardFare, minBid: min, maxBid: max, bidsLeft, ...(myBid && { myBid }) };
    };
    const list: TripForBid[] = [];
    for (const or of this.rides.values()) {
      const { ride, riderId } = or.rec;
      const mine = or.bids.find((b) => b.driverId === driverId);
      if (riderId === driverId || !near(ride.pickup) || (or.closed && !mine)) continue;
      const base = { id: ride.id, riderName: ride.riderName, riderRating: 5, pickup: ride.pickup, dropoff: ride.dropoff, quote: ride.quote, closesAt: ride.biddingClosesAt ?? 0 };
      list.push(priced(base, or.bids.length, mine && { id: mine.id, fare: mine.fare, status: mine.status as BidStatus, ...(mine.trip && { trip: mine.trip }) }));
    }
    for (const trip of this.sim.values()) {
      const mine = trip.bids.get(driverId);
      if (!near(trip.pickup) || (trip.closesAt < Date.now() && !mine)) continue;
      const { bids, others, ...base } = trip;
      list.push(priced(base, others + bids.size, mine));
    }
    return list.sort((a, b) => a.closesAt - b.closesAt);
  }

  private refreshBoard(driverId: string) {
    if (this.board.has(driverId)) this.live.toUser(driverId, { type: 'bid_board', trips: this.boardFor(driverId) }, latest('bid_board'));
  }

  private refreshBoards() {
    for (const driverId of this.board.keys()) this.refreshBoard(driverId);
  }

  stop() {
    this.timers.forEach(clearTimeout);
    for (const b of this.board.values()) clearInterval(b.simTimer);
  }
}
