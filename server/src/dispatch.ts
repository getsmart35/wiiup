import type { Driver, DriverTrip, FareQuote, LatLng, Place, Ride, RideRequest } from '@/api/types';
import { TIER_ORDER, quoteFare } from '@/lib/fare';
import { distanceKm, durationMin, jitter, pointAlong, roadDistanceKm, routePath } from '@/lib/geo';
import { bump, type DispatchHooks, type DoneBlob } from './backup.ts';
import type { Config } from './config.ts';
import { driverPrice, planStatus } from './drivers.ts';
import { badRequest, conflict, notFound } from './http.ts';
import type { Live } from './live.ts';
import { newId, type Clock, type RideRecord, type Store, type TripRecord } from './store.ts';

export { fakeDriver, fakePlace, FIRST_NAMES };

export type TripAction = 'arrived' | 'start' | 'complete' | 'cancel';

type Timer = ReturnType<typeof setTimeout>;
type Offer = { id: string; driverId: string; rideId: string | null; request: RideRequest; timer: Timer };
type LiveRide = {
  rec: RideRecord;
  /** The quote the rider confirmed. If a driver cancels, the ride searches again at this price. */
  confirmed: FareQuote;
  timers: Timer[];
  /** Drivers already offered this ride. */
  tried: Set<string>;
  searchStartedAt: number;
};
type LiveTrip = { rec: TripRecord; anim?: ReturnType<typeof setInterval> };
type IssuedQuote = { riderId: string; quote: FareQuote; pickup: LatLng; dropoff: LatLng; expiresAt: number };

const QUOTE_TTL = 10 * 60 * 1000;
const NEARBY_KM = 5;

const FIRST_NAMES = ['Maya', 'Jordan', 'Luis', 'Aisha', 'Kenji', 'Priya', 'Marcus', 'Sofia', 'Dev', 'Elena'];
const CARS = [
  ['Toyota Camry', 'Silver'],
  ['Honda Accord', 'Black'],
  ['Tesla Model 3', 'White'],
  ['Hyundai Ioniq 5', 'Gray'],
  ['Kia Telluride', 'Blue'],
  ['Toyota Sienna', 'White'],
];
const STREETS = ['State St', 'Michigan Ave', 'Clark St', 'Halsted St', 'Milwaukee Ave', 'Wacker Dr', 'Damen Ave', 'Ashland Ave'];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const etaFrom = (from: LatLng, to: LatLng) => durationMin(roadDistanceKm(from, to));
/** Delivered for sure, and only the newest state per ride or trip is kept for redelivery. */
const latest = (topic: string) => ({ reliable: true, collapseKey: topic });
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Rider';

function fakeDriver(near: LatLng, radiusKm: number): Driver {
  const [car, color] = pick(CARS);
  const letter = () => String.fromCharCode(65 + randInt(0, 25));
  return {
    id: newId('sim'),
    name: pick(FIRST_NAMES),
    rating: Math.round((4.6 + Math.random() * 0.4) * 100) / 100,
    car,
    color,
    plate: `${randInt(1, 9)}${letter()}${letter()}${randInt(100, 999)}`,
    location: jitter(near, radiusKm),
  };
}

function fakePlace(near: LatLng, radiusKm: number): Place {
  return { id: newId('plc'), name: `${randInt(100, 2999)} ${pick(STREETS)}`, address: 'Nearby', coords: jitter(near, radiusKm) };
}

/**
 * Matching and the ride/trip state machine. Rides go to the nearest free real driver whose price is no more than
 * the rider's quote; each offer lasts `offerTtl` and then moves to the next driver. With simulation on, a simulated
 * driver takes rides no real driver accepts, and online drivers also get simulated ride requests.
 */
export class Dispatch implements DispatchHooks {
  /** Called after each saved trip change, with the version it replaced (phone backups). */
  onTripSaved?: (rec: TripRecord, previous: Clock | undefined) => void;
  private rides = new Map<string, LiveRide>();
  private trips = new Map<string, LiveTrip>();
  private online = new Map<string, { location: LatLng; simTimer?: Timer }>();
  private offers = new Map<string, Offer>();
  private quotes = new Map<string, IssuedQuote>();

  constructor(
    private store: Store,
    private live: Live,
    private config: Config,
  ) {}

  private get t() {
    return this.config.timing;
  }

  // ---------- rider ----------

  nearbyDrivers(center: LatLng): Driver[] {
    const real = [...this.online]
      .filter(([id, d]) => !this.activeTrip(id) && distanceKm(center, d.location) <= NEARBY_KM)
      .map(([id, d]) => this.driverView(id, d.location));
    if (!this.config.sim) return real;
    return [...real, ...Array.from({ length: Math.max(0, randInt(4, 7) - real.length) }, () => fakeDriver(center, 1.8))];
  }

  getQuotes(riderId: string, pickup: LatLng, dropoff: LatLng): FareQuote[] {
    const now = Date.now();
    for (const [id, q] of this.quotes) if (q.expiresAt < now) this.quotes.delete(id);
    // Busy pricing: more riders searching nearby than free drivers
    const near = (p: LatLng) => distanceKm(p, pickup) <= NEARBY_KM;
    const demand = [...this.rides.values()].filter((r) => r.rec.ride.status === 'searching' && near(r.rec.ride.pickup.coords)).length;
    const free = [...this.online].filter(([id, d]) => !this.activeTrip(id) && near(d.location));
    const surge = demand >= 3 && demand > free.length ? 1.3 : 1;
    const nearest = free.length ? Math.min(...free.map(([, d]) => etaFrom(d.location, pickup))) : null;
    return TIER_ORDER.map((tier, i) => {
      const quote: FareQuote = { ...quoteFare(tier, pickup, dropoff, { surge, etaMin: (nearest ?? randInt(2, 5)) + i * 2 }), id: newId('qte') };
      this.quotes.set(quote.id!, { riderId, quote, pickup, dropoff, expiresAt: now + QUOTE_TTL });
      return quote;
    });
  }

  /** Set by the bidding module, which takes rides whose riders asked for bids. */
  bidding?: { open(rec: RideRecord): void; has(rideId: string): boolean; cancel(rideId: string): void };

  requestRide(riderId: string, riderName: string, pickup: Place, dropoff: Place, quoteId: string, mode: 'match' | 'bid' = 'match'): Ride {
    const issued = this.quotes.get(quoteId);
    if (!issued || issued.riderId !== riderId || issued.expiresAt < Date.now()) {
      throw conflict('quote_expired', 'Prices have changed. Check the new prices and try again.');
    }
    if (distanceKm(issued.pickup, pickup.coords) > 0.05 || distanceKm(issued.dropoff, dropoff.coords) > 0.05) {
      throw badRequest('The pickup or drop-off is different from the one that was priced');
    }
    this.quotes.delete(quoteId);
    const ride: Ride = { id: newId('ride'), riderName: firstName(riderName), pickup, dropoff, quote: issued.quote, status: 'searching', createdAt: Date.now() };
    const rec: RideRecord = { ride, riderId, driverId: null };
    if (mode === 'bid' && this.bidding) {
      rec.ride = { ...ride, status: 'bidding', mode: 'bid', bids: [], biddingClosesAt: Date.now() + this.t.biddingWindow };
      this.store.saveRide(rec);
      this.bidding.open(rec);
      return rec.ride;
    }
    this.store.saveRide(rec);
    this.rides.set(ride.id, { rec, confirmed: issued.quote, timers: [], tried: new Set(), searchStartedAt: Date.now() });
    this.offerNext(ride.id);
    return ride;
  }

  cancelRide(riderId: string, rideId: string) {
    const lr = this.rides.get(rideId);
    const rec = lr?.rec ?? this.store.ride(rideId);
    if (!rec || rec.riderId !== riderId) throw notFound('Ride not found');
    if (rec.ride.status === 'cancelled') return;
    if (rec.ride.status === 'completed') throw conflict('completed', 'This ride has already finished');
    if (this.bidding?.has(rideId) && rec.ride.status === 'bidding') return this.bidding.cancel(rideId);
    this.withdrawOffers(rideId);
    const lt = [...this.trips.values()].find((x) => x.rec.rideId === rideId);
    if (lt) {
      this.stopAnim(lt);
      this.emitTrip(lt.rec.trip.id, { stage: 'completed', completedAt: Date.now(), earnings: 0, liveEtaMin: 0, cancelledBy: 'rider' });
    }
    this.emitRide(rideId, { status: 'cancelled', liveEtaMin: 0 });
  }

  // ---------- driver ----------

  goOnline(driverId: string, location: LatLng) {
    this.store.ensureDriver(driverId);
    const cur = this.online.get(driverId);
    if (cur) {
      cur.location = location;
      return;
    }
    this.online.set(driverId, { location });
    if (this.config.sim) this.scheduleSimRequest(driverId, this.t.firstRequest);
  }

  goOffline(driverId: string) {
    const cur = this.online.get(driverId);
    if (!cur) return;
    clearTimeout(cur.simTimer);
    this.online.delete(driverId);
    // Offers this driver can no longer see move on to the next driver
    for (const offer of [...this.offers.values()].filter((o) => o.driverId === driverId)) this.expireOffer(offer);
  }

  driverLocation(driverId: string, location: LatLng) {
    const cur = this.online.get(driverId);
    if (cur) cur.location = location;
    // With simulation on, trips are driven by the simulator; otherwise by the driver's phone
    if (this.config.sim) return;
    const lt = this.activeTrip(driverId);
    if (!lt) return;
    const { trip } = lt.rec;
    const target = trip.stage === 'to_pickup' ? trip.request.pickup.coords : trip.stage === 'in_trip' ? trip.request.dropoff.coords : null;
    this.emitTrip(trip.id, { location, liveEtaMin: target ? etaFrom(location, target) : 0 }, false);
  }

  acceptRequest(driverId: string, offerId: string, location: LatLng): DriverTrip {
    const offer = this.offers.get(offerId);
    if (!offer || offer.driverId !== driverId || offer.request.expiresAt < Date.now()) {
      throw conflict('offer_gone', 'This ride is no longer available');
    }
    if (this.activeTrip(driverId)) throw conflict('busy', 'You already have a trip in progress');
    const profile = this.store.ensureDriver(driverId);
    if (planStatus(this.store, profile).atLimit) throw conflict('limit_reached', 'You have reached your plan limit. Upgrade to keep accepting rides.');
    const lr = offer.rideId ? this.rides.get(offer.rideId) : undefined;
    if (offer.rideId && lr?.rec.ride.status !== 'searching') throw conflict('offer_gone', 'This ride is no longer available');

    clearTimeout(offer.timer);
    this.offers.delete(offer.id);
    return this.startTrip(driverId, location, offer.request, offer.rideId);
  }

  /** Starts a real driver's trip and assigns them the ride (if it has one) at the request's fare. */
  startTrip(driverId: string, location: LatLng, request: RideRequest, rideId: string | null): DriverTrip {
    const lr = rideId ? this.rides.get(rideId) : undefined;
    const trip: DriverTrip = {
      id: newId('trip'),
      request,
      stage: 'to_pickup',
      location,
      liveEtaMin: etaFrom(location, request.pickup.coords),
      earnings: request.quote.fare,
      acceptedAt: Date.now(),
    };
    const rec: TripRecord = { trip, driverId, rideId };
    const lt: LiveTrip = { rec };
    this.trips.set(trip.id, lt);

    if (lr) {
      this.clearTimers(lr);
      lr.rec.driverId = driverId;
      // The rider pays the driver's price, which is never more than the quote they confirmed
      this.emitRide(lr.rec.ride.id, {
        status: 'driver_assigned',
        driver: this.driverView(driverId, location),
        quote: { ...lr.rec.ride.quote, fare: request.quote.fare },
        liveEtaMin: trip.liveEtaMin,
      });
      this.later(lr, this.t.assignedPause, () => {
        if (lr.rec.ride.status === 'driver_assigned') this.emitRide(lr.rec.ride.id, { status: 'arriving' });
      });
    }
    // Saved after the ride is assigned, so the phone's first backup already holds the driver and price
    this.persistTrip(rec);
    if (this.config.sim) this.animateTrip(lt, location, request.pickup.coords, this.t.driverToPickup);
    return trip;
  }

  updateTrip(driverId: string, tripId: string, action: TripAction) {
    const lt = this.trips.get(tripId);
    if (!lt || lt.rec.driverId !== driverId) throw notFound('Trip not found');
    const { trip, rideId } = lt.rec;
    const { pickup, dropoff, quote } = trip.request;

    if (action === 'cancel') {
      if (trip.stage === 'completed') throw conflict('wrong_stage', 'This trip has already finished');
      this.stopAnim(lt);
      this.emitTrip(tripId, { stage: 'completed', completedAt: Date.now(), earnings: 0, liveEtaMin: 0, cancelledBy: 'driver' });
      const lr = rideId ? this.rides.get(rideId) : undefined;
      if (lr) {
        // Find the rider another driver, at the price they confirmed
        lr.rec.driverId = null;
        lr.tried.add(driverId);
        lr.searchStartedAt = Date.now();
        this.emitRide(lr.rec.ride.id, { status: 'searching', driver: undefined, liveEtaMin: undefined, quote: lr.confirmed });
        this.offerNext(lr.rec.ride.id);
      }
      return;
    }

    const from = { arrived: 'to_pickup', start: 'at_pickup', complete: 'in_trip' }[action];
    if (trip.stage !== from) throw conflict('wrong_stage', `Can't ${action} a trip that is ${trip.stage.replace('_', ' ')}`);
    const sim = this.config.sim;
    if (action === 'arrived') {
      this.stopAnim(lt);
      this.emitTrip(tripId, { stage: 'at_pickup', liveEtaMin: 0, ...(sim && { location: pickup.coords }) });
      if (rideId) this.emitRide(rideId, { status: 'arrived', liveEtaMin: 0 });
    } else if (action === 'start') {
      this.emitTrip(tripId, { stage: 'in_trip', liveEtaMin: quote.durationMin });
      if (rideId) this.emitRide(rideId, { status: 'in_trip', liveEtaMin: quote.durationMin });
      if (sim) this.animateTrip(lt, pickup.coords, dropoff.coords, this.t.driverTrip);
    } else {
      this.stopAnim(lt);
      const completedAt = Date.now();
      this.emitTrip(tripId, { stage: 'completed', completedAt, liveEtaMin: 0, ...(sim && { location: dropoff.coords }) });
      if (rideId) this.emitRide(rideId, { status: 'completed', completedAt, liveEtaMin: 0 });
    }
  }

  /** Saves a trip change under a new version from this region, and backs it up to the driver's phone. */
  private persistTrip(rec: TripRecord) {
    const previous = rec.version;
    rec.version = bump(previous, this.config.region);
    this.store.saveTrip(rec);
    this.onTripSaved?.(rec, previous);
  }

  // ---------- bidding ----------

  /** Busy drivers can't bid or be chosen. */
  isBusy(driverId: string) {
    return !!this.activeTrip(driverId);
  }

  /** What riders see about a driver. */
  driverCard(driverId: string, location: LatLng) {
    return this.driverView(driverId, location);
  }

  /** The rider accepted a bid: the ride is assigned at the bid's fare, to a real or simulated driver. */
  takeBid(rec: RideRecord, winner: { driverId: string | null; driver: Driver; fare: number; location: LatLng }) {
    const quote = { ...rec.ride.quote, fare: winner.fare };
    rec.ride = { ...rec.ride, quote, bids: [], status: 'searching' };
    const lr: LiveRide = { rec, confirmed: quote, timers: [], tried: new Set(), searchStartedAt: Date.now() };
    this.rides.set(rec.ride.id, lr);
    if (!winner.driverId) {
      this.simDriveRide(lr, winner.driver);
      return null;
    }
    const { pickup, dropoff, riderName } = rec.ride;
    const request: RideRequest = { id: newId('ofr'), riderName, riderRating: 5, pickup, dropoff, quote: { ...quote, etaMin: etaFrom(winner.location, pickup.coords) }, expiresAt: Date.now() };
    return this.startTrip(winner.driverId, winner.location, request, rec.ride.id);
  }

  // ---------- recovery from phones ----------

  ride(rideId: string) {
    return this.rides.get(rideId)?.rec ?? this.store.ride(rideId);
  }

  isActive(tripId: string) {
    return this.trips.has(tripId);
  }

  activeTrips() {
    return [...this.trips.values()].map((t) => t.rec);
  }

  adopt(rec: TripRecord, ride: RideRecord | null) {
    const existing = this.trips.get(rec.trip.id);
    if (existing) this.stopAnim(existing);
    if (rec.trip.stage !== 'completed') this.trips.set(rec.trip.id, { rec });
    if (ride && ride.ride.status !== 'completed' && ride.ride.status !== 'cancelled') {
      const cur = this.rides.get(ride.ride.id);
      if (cur) this.clearTimers(cur);
      this.rides.set(ride.ride.id, { rec: ride, confirmed: ride.ride.quote, timers: [], tried: new Set(), searchStartedAt: ride.ride.createdAt });
      this.live.publish(`ride:${ride.ride.id}`, { type: 'ride', ride: ride.ride }, latest(`ride:${ride.ride.id}`));
    }
    this.live.publish(`trip:${rec.trip.id}`, { type: 'trip', trip: rec.trip }, latest(`trip:${rec.trip.id}`));
  }

  close(tripId: string, blob: DoneBlob) {
    const lt = this.trips.get(tripId);
    if (!lt) return;
    this.stopAnim(lt);
    lt.rec.version = blob.version;
    lt.rec.trip = { ...lt.rec.trip, stage: 'completed', completedAt: blob.completedAt, earnings: blob.earnings, liveEtaMin: 0, ...(blob.cancelledBy && { cancelledBy: blob.cancelledBy }) };
    this.store.saveTrip(lt.rec);
    this.live.publish(`trip:${tripId}`, { type: 'trip', trip: lt.rec.trip }, latest(`trip:${tripId}`));
    this.trips.delete(tripId);
    const rideId = lt.rec.rideId;
    if (rideId && this.rides.has(rideId) && blob.cancelledBy !== 'driver') {
      this.emitRide(rideId, { status: blob.cancelledBy ? 'cancelled' : 'completed', completedAt: blob.completedAt, liveEtaMin: 0 });
    }
  }

  // ---------- live channel ----------

  canFollow(userId: string, topic: string) {
    const [kind, id] = topic.split(':');
    if (kind === 'ride') {
      const rec = this.rides.get(id)?.rec ?? this.store.ride(id);
      return !!rec && (rec.riderId === userId || rec.driverId === userId);
    }
    if (kind === 'trip') {
      const rec = this.trips.get(id)?.rec ?? this.store.trip(id);
      return rec?.driverId === userId;
    }
    return false;
  }

  snapshot(topic: string) {
    const [kind, id] = topic.split(':');
    if (kind === 'ride') {
      const ride = (this.rides.get(id)?.rec ?? this.store.ride(id))?.ride;
      return ride ? { type: 'ride', ride } : null;
    }
    const trip = (this.trips.get(id)?.rec ?? this.store.trip(id))?.trip;
    return trip ? { type: 'trip', trip } : null;
  }

  // ---------- lifecycle ----------

  /**
   * After a restart: trips with a real driver carry on, because the driver moves them forward.
   * Rides that were searching or had a simulated driver can't resume, so they are cancelled.
   */
  recover() {
    for (const rec of this.store.openTrips()) this.trips.set(rec.trip.id, { rec });
    for (const rec of this.store.openRides()) {
      if (rec.driverId && [...this.trips.values()].some((t) => t.rec.rideId === rec.ride.id)) {
        this.rides.set(rec.ride.id, { rec, confirmed: rec.ride.quote, timers: [], tried: new Set(), searchStartedAt: rec.ride.createdAt });
      } else {
        rec.ride = { ...rec.ride, status: 'cancelled', liveEtaMin: 0 };
        this.store.saveRide(rec);
      }
    }
  }

  stop() {
    for (const lr of this.rides.values()) this.clearTimers(lr);
    for (const lt of this.trips.values()) this.stopAnim(lt);
    for (const o of this.offers.values()) clearTimeout(o.timer);
    for (const d of this.online.values()) clearTimeout(d.simTimer);
  }

  // ---------- matching ----------

  private offerNext(rideId: string) {
    const lr = this.rides.get(rideId);
    if (!lr || lr.rec.ride.status !== 'searching') return;
    const { ride } = lr.rec;
    const best = [...this.online]
      .filter(([id]) => id !== lr.rec.riderId && !lr.tried.has(id) && !this.activeTrip(id) && !this.hasOffer(id))
      .map(([id, d]) => ({ id, location: d.location, km: distanceKm(d.location, ride.pickup.coords), profile: this.store.driver(id) }))
      .filter((c) => c.km <= this.config.dispatchRadiusKm && c.profile && !planStatus(this.store, c.profile).atLimit)
      .map((c) => ({ ...c, price: driverPrice(c.profile!.cards, ride.quote) }))
      .filter((c) => c.price <= ride.quote.fare + 1e-9)
      .sort((a, b) => a.km - b.km)[0];

    if (best) {
      lr.tried.add(best.id);
      // Rider ratings aren't collected yet, so every rider shows 5.00
      this.makeOffer(best.id, best.location, rideId, { riderName: ride.riderName, riderRating: 5, pickup: ride.pickup, dropoff: ride.dropoff, quote: ride.quote }, best.price);
      return;
    }
    if (this.config.sim) {
      this.later(lr, this.t.matching, () => this.simDriveRide(lr));
    } else if (Date.now() - lr.searchStartedAt >= this.t.searchTimeout) {
      this.emitRide(rideId, { status: 'cancelled', liveEtaMin: 0 });
    } else {
      this.later(lr, this.t.rescan, () => this.offerNext(rideId));
    }
  }

  private makeOffer(
    driverId: string,
    location: LatLng,
    rideId: string | null,
    base: Omit<RideRequest, 'id' | 'expiresAt'>,
    price: number,
  ) {
    const request: RideRequest = {
      ...base,
      id: newId('ofr'),
      quote: { ...base.quote, fare: price, etaMin: etaFrom(location, base.pickup.coords) },
      expiresAt: Date.now() + this.t.offerTtl,
    };
    const offer: Offer = { id: request.id, driverId, rideId, request, timer: setTimeout(() => this.expireOffer(offer), this.t.offerTtl) };
    this.offers.set(offer.id, offer);
    // An offer is only worth delivering while the driver can still accept it
    this.live.toUser(driverId, { type: 'request', request }, { reliable: true, ttlMs: this.t.offerTtl });
  }

  private expireOffer(offer: Offer) {
    clearTimeout(offer.timer);
    if (!this.offers.delete(offer.id)) return;
    this.live.toUser(offer.driverId, { type: 'request_gone', id: offer.id }, { reliable: true, ttlMs: 30000 });
    if (offer.rideId) this.offerNext(offer.rideId);
  }

  private withdrawOffers(rideId: string) {
    for (const o of [...this.offers.values()].filter((x) => x.rideId === rideId)) {
      clearTimeout(o.timer);
      this.offers.delete(o.id);
      this.live.toUser(o.driverId, { type: 'request_gone', id: o.id }, { reliable: true, ttlMs: 30000 });
    }
  }

  private hasOffer(driverId: string) {
    return [...this.offers.values()].some((o) => o.driverId === driverId);
  }

  private activeTrip(driverId: string) {
    return [...this.trips.values()].find((t) => t.rec.driverId === driverId && t.rec.trip.stage !== 'completed');
  }

  private driverView(driverId: string, location: LatLng): Driver {
    const user = this.store.user(driverId);
    const profile = this.store.driver(driverId);
    const v = profile?.vehicle;
    return {
      id: driverId,
      name: firstName(user?.name ?? 'Driver'),
      rating: profile?.rating ?? 5,
      car: v?.car ?? 'Vehicle details pending',
      color: v?.color ?? '',
      plate: v?.plate ?? '—',
      location,
    };
  }

  // ---------- state changes ----------

  /** Updates a ride and tells everyone following it. `persist` is false for location-only ticks. */
  private emitRide(id: string, patch: Partial<Ride>, persist = true) {
    const lr = this.rides.get(id);
    if (!lr) return;
    lr.rec.ride = { ...lr.rec.ride, ...patch };
    if (persist) this.store.saveRide(lr.rec);
    // Status changes must arrive; position-only ticks can be dropped on a slow connection
    this.live.publish(`ride:${id}`, { type: 'ride', ride: lr.rec.ride }, persist ? latest(`ride:${id}`) : {});
    if (lr.rec.ride.status === 'completed' || lr.rec.ride.status === 'cancelled') {
      this.clearTimers(lr);
      this.withdrawOffers(id);
      this.rides.delete(id);
    }
  }

  private emitTrip(id: string, patch: Partial<DriverTrip>, persist = true) {
    const lt = this.trips.get(id);
    if (!lt) return;
    lt.rec.trip = { ...lt.rec.trip, ...patch };
    const { trip, rideId } = lt.rec;
    if (persist) this.persistTrip(lt.rec);
    this.live.publish(`trip:${id}`, { type: 'trip', trip }, persist ? latest(`trip:${id}`) : {});
    // The rider sees the driver's car move
    const ride = rideId ? this.rides.get(rideId)?.rec.ride : undefined;
    if (ride?.driver && patch.location) this.emitRide(ride.id, { driver: { ...ride.driver, location: trip.location }, liveEtaMin: trip.liveEtaMin }, false);
    if (trip.stage === 'completed') {
      this.stopAnim(lt);
      this.trips.delete(id);
    }
  }

  private later(lr: LiveRide, ms: number, fn: () => void) {
    lr.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(lr: LiveRide) {
    lr.timers.forEach(clearTimeout);
    lr.timers = [];
  }

  private stopAnim(lt: LiveTrip) {
    clearInterval(lt.anim);
    lt.anim = undefined;
  }

  // ---------- simulation ----------

  /** Moves a real driver's trip along a route (simulation only, so demos work without driving anywhere). */
  private animateTrip(lt: LiveTrip, from: LatLng, to: LatLng, durationMs: number) {
    this.stopAnim(lt);
    const path = routePath(from, to, 30);
    const start = Date.now();
    lt.anim = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const location = pointAlong(path, t);
      this.emitTrip(lt.rec.trip.id, { location, liveEtaMin: t >= 1 ? 0 : Math.max(1, etaFrom(location, to)) }, false);
      if (t >= 1) this.stopAnim(lt);
    }, this.t.tick);
  }

  /** A simulated driver takes the ride and drives it from pickup to drop-off, like the app's mock. */
  private simDriveRide(lr: LiveRide, driver = fakeDriver(lr.rec.ride.pickup.coords, 1.5)) {
    const id = lr.rec.ride.id;
    if (lr.rec.ride.status !== 'searching') return;
    this.emitRide(id, { status: 'driver_assigned', driver, liveEtaMin: etaFrom(driver.location, lr.rec.ride.pickup.coords) });

    const move = (path: LatLng[], durationMs: number, done: () => void) => {
      const start = Date.now();
      const step = () => {
        const ride = lr.rec.ride;
        if (!ride.driver || ride.status === 'cancelled') return;
        const t = Math.min(1, (Date.now() - start) / durationMs);
        const location = pointAlong(path, t);
        this.emitRide(id, { driver: { ...ride.driver, location }, liveEtaMin: t >= 1 ? 0 : Math.max(1, etaFrom(location, path[path.length - 1])) }, false);
        if (t >= 1) done();
        else this.later(lr, this.t.tick, step);
      };
      step();
    };

    this.later(lr, this.t.assignedPause, () => {
      this.emitRide(id, { status: 'arriving' });
      move(routePath(driver.location, lr.rec.ride.pickup.coords, 30), this.t.arrival, () => {
        this.emitRide(id, { status: 'arrived', liveEtaMin: 0 });
        this.later(lr, this.t.arrivedPause, () => {
          const r = lr.rec.ride;
          this.emitRide(id, { status: 'in_trip', liveEtaMin: r.quote.durationMin });
          move(routePath(r.pickup.coords, r.dropoff.coords, 40), this.t.trip, () => {
            this.emitRide(id, { status: 'completed', completedAt: Date.now(), liveEtaMin: 0 });
          });
        });
      });
    });
  }

  /** Sends an online driver a simulated ride request every so often, priced from their own rate card. */
  private scheduleSimRequest(driverId: string, ms: number) {
    const d = this.online.get(driverId);
    if (!d) return;
    d.simTimer = setTimeout(() => {
      const cur = this.online.get(driverId);
      if (!cur) return;
      const profile = this.store.driver(driverId);
      if (profile && !this.activeTrip(driverId) && !this.hasOffer(driverId) && !planStatus(this.store, profile).atLimit) {
        const pickup = fakePlace(cur.location, 1.5);
        let dropoff = fakePlace(pickup.coords, 6);
        while (distanceKm(pickup.coords, dropoff.coords) < 1) dropoff = fakePlace(pickup.coords, 6);
        const quote = quoteFare(pick(TIER_ORDER), pickup.coords, dropoff.coords, { surge: Math.random() < 0.25 ? 1.3 : 1 });
        const riderRating = Math.round((4.5 + Math.random() * 0.5) * 100) / 100;
        this.makeOffer(driverId, cur.location, null, { riderName: pick(FIRST_NAMES), riderRating, pickup, dropoff, quote }, driverPrice(profile.cards, quote));
      }
      this.scheduleSimRequest(driverId, randInt(this.t.requestMinGap, this.t.requestMaxGap));
    }, ms);
  }
}
