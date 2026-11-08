import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { DriverTrip, Ride, RideTier } from '@/api/types';
import { billingPeriod } from '@/lib/plans';
import type { Live } from './live.ts';
import { newId, type Clock, type RideRecord, type Store, type TripRecord } from './store.ts';

/**
 * Driver phones as backup storage for trips (docs/FAILOVER.md).
 *
 * After every trip change the server seals the trip and stores it on the driver's phone under a write-once key
 * `trip/<driverId>/<tripId>/<version>`, then deletes the previous version. Finished trips shrink to a small
 * tombstone, kept for the billing period so earnings limits survive a failover. When a phone connects, the server
 * lists the phone's keys, restores anything newer than what it has, and brings the phone up to date.
 */

// ---------- version clocks ----------

export const bump = (c: Clock | undefined, region: string): Clock => ({ ...c, [region]: (c?.[region] ?? 0) + 1 });
export const merge = (a: Clock, b: Clock): Clock =>
  Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, Math.max(a[k] ?? 0, b[k] ?? 0)]));

export function compare(a: Clock, b: Clock): 'equal' | 'after' | 'before' | 'concurrent' {
  let after = false;
  let before = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] ?? 0) > (b[k] ?? 0)) after = true;
    if ((a[k] ?? 0) < (b[k] ?? 0)) before = true;
  }
  return after && before ? 'concurrent' : after ? 'after' : before ? 'before' : 'equal';
}

const tag = (c: Clock) =>
  Object.keys(c)
    .sort()
    .map((k) => `${k}${c[k]}`)
    .join('.');

export const vaultKey = (driverId: string, tripId: string, version: Clock) => `trip/${driverId}/${tripId}/${tag(version)}`;

export function parseKey(key: string): { driverId: string; tripId: string; version: Clock } | null {
  const m = /^trip\/([\w-]+)\/([\w-]+)\/([A-Za-z]+\d+(?:\.[A-Za-z]+\d+)*)$/.exec(key);
  if (!m) return null;
  const version = Object.fromEntries(m[3].split('.').map((p) => [p.replace(/\d+$/, ''), Number(p.replace(/^[A-Za-z]+/, ''))]));
  return { driverId: m[1], tripId: m[2], version };
}

// ---------- sealing ----------

/**
 * AES-256-GCM with the server's keys. The phone can't read a blob or change it. The driver and trip are bound
 * in as associated data, so a blob can't be replayed under another driver or trip.
 */
export class Sealer {
  constructor(private keys: { id: string; key: Buffer }[]) {
    if (!keys.length) throw new Error('At least one backup key is required');
  }

  seal(payload: object, aad: string) {
    const { id, key } = this.keys[0];
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return ['v1', id, iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  /** The payload, or null if the blob was altered, sealed for another driver or trip, or uses an unknown key. */
  open(blob: string, aad: string): unknown {
    const [v, id, iv, body, authTag] = blob.split('.');
    const key = this.keys.find((k) => k.id === id)?.key;
    if (v !== 'v1' || !key || !iv || !body || !authTag) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
        .setAAD(Buffer.from(aad))
        .setAuthTag(Buffer.from(authTag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
    } catch {
      return null;
    }
  }
}

// ---------- what goes on the phone ----------

/** A trip in progress, with the ride it serves so the rider's side can be rebuilt too. */
export type ActiveBlob = {
  kind: 'active';
  version: Clock;
  trip: DriverTrip;
  rideId: string | null;
  ride: { ride: Ride; riderId: string } | null;
};
/** A finished trip, kept small. */
export type DoneBlob = {
  kind: 'done';
  version: Clock;
  tripId: string;
  rideId: string | null;
  tier: RideTier;
  earnings: number;
  completedAt: number;
  cancelledBy?: 'rider' | 'driver';
};
export type Blob = ActiveBlob | DoneBlob;

/** What Backup needs from dispatch. */
export type DispatchHooks = {
  ride(rideId: string): RideRecord | null;
  /** Puts a restored trip (and its ride) back into service. */
  adopt(rec: TripRecord, ride: RideRecord | null): void;
  /** Applies a tombstone to a trip this server still thinks is open. */
  close(tripId: string, blob: DoneBlob): void;
  isActive(tripId: string): boolean;
  activeTrips(): TripRecord[];
};

/** Higher wins when two regions changed the same trip independently. A cancel beats anything but completion. */
function rank(stage: DriverTrip['stage'], cancelled: boolean) {
  if (stage === 'completed') return cancelled ? 3.5 : 4;
  return { to_pickup: 1, at_pickup: 2, in_trip: 3 }[stage];
}

const ASK_TIMEOUT = 10000;

export class Backup {
  private sealer: Sealer;
  private asks = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private recovering = new Map<string, Promise<void>>();
  private checked = new Set<string>();
  /**
   * Instant payouts stop after this server restores anything from a phone, until an admin confirms the payment
   * ledger is current. A payout is never rebuilt from a phone, so a missed one could otherwise be paid twice.
   */
  payoutsPaused = false;

  constructor(
    private store: Store,
    private live: Live,
    keys: { id: string; key: Buffer }[],
    private region: string,
    private dispatch: DispatchHooks,
  ) {
    this.sealer = new Sealer(keys);
  }

  // ---------- writing backups ----------

  /** Called after every saved trip change. Phones that are offline catch up when they reconnect. */
  tripSaved(rec: TripRecord, previous: Clock | undefined) {
    if (!rec.version || !this.live.isConnected(rec.driverId)) return;
    const key = vaultKey(rec.driverId, rec.trip.id, rec.version);
    this.send(rec.driverId, { op: 'set', key, blob: this.seal(rec) });
    // Two steps, so a failure in between leaves two versions rather than none
    if (previous) this.send(rec.driverId, { op: 'delete', key: vaultKey(rec.driverId, rec.trip.id, previous) });
  }

  private seal(rec: TripRecord) {
    const { trip, rideId, version } = rec;
    const blob: Blob =
      trip.stage === 'completed'
        ? { kind: 'done', version: version!, tripId: trip.id, rideId, tier: trip.request?.quote.tier ?? 'go', earnings: trip.earnings, completedAt: trip.completedAt ?? Date.now(), ...(trip.cancelledBy && { cancelledBy: trip.cancelledBy }) }
        : { kind: 'active', version: version!, trip, rideId, ride: rideId ? this.rideForPhone(rideId) : null };
    return this.sealer.seal(blob, `${rec.driverId}|${trip.id}`);
  }

  /** Only what the driver can already see about the rider goes on their phone. */
  private rideForPhone(rideId: string) {
    const rec = this.dispatch.ride(rideId);
    return rec ? { ride: rec.ride, riderId: rec.riderId } : null;
  }

  // ---------- recovery ----------

  /** Has this server checked the driver's phone since it started? */
  hasChecked(driverId: string) {
    return this.checked.has(driverId);
  }

  /** Resolves once any recovery running for this driver has finished. */
  ready(driverId: string) {
    return this.recovering.get(driverId) ?? Promise.resolve();
  }

  /** A phone connected: restore anything it holds that this server is missing, then bring the phone up to date. */
  phoneConnected(driverId: string) {
    // Every app is asked, since a driver's profile may not have reached this region yet; riders hold no backups
    if (this.recovering.has(driverId)) return;
    const run = this.recover(driverId)
      .catch((e) => console.error('Phone recovery failed', driverId, e))
      .finally(() => {
        this.recovering.delete(driverId);
        this.checked.add(driverId);
      });
    this.recovering.set(driverId, run);
  }

  private async recover(driverId: string) {
    const keys = await this.ask<string[]>(driverId, { op: 'list' });
    if (!Array.isArray(keys)) return;
    const mine = keys.map((k) => ({ key: k, parsed: typeof k === 'string' ? parseKey(k) : null })).filter((k) => k.parsed?.driverId === driverId);

    const byTrip = new Map<string, { key: string; version: Clock }[]>();
    for (const { key, parsed } of mine) byTrip.set(parsed!.tripId, [...(byTrip.get(parsed!.tripId) ?? []), { key, version: parsed!.version }]);

    for (const [tripId, versions] of byTrip) {
      // The newest versions on the phone: any that no other version on the phone supersedes
      const newest = versions.filter((a) => !versions.some((b) => compare(b.version, a.version) === 'after'));
      for (const cand of newest) {
        const server = this.store.trip(tripId);
        const rel = server ? compare(cand.version, server.version ?? {}) : 'after';
        if (rel !== 'after' && rel !== 'concurrent') continue;
        const sealed = await this.ask<string | null>(driverId, { op: 'get', key: cand.key }).catch(() => null);
        const blob = typeof sealed === 'string' ? (this.sealer.open(sealed, `${driverId}|${tripId}`) as Blob | null) : null;
        if (!blob || compare(blob.version, cand.version) !== 'equal') {
          this.store.addFailoverEvent({ driverId, tripId, kind: 'rejected', detail: sealed ? 'The backup failed its integrity check' : 'The phone did not return the backup' });
          continue;
        }
        if (rel === 'after') this.restore(driverId, tripId, blob, server, blob.version);
        else this.resolveConflict(driverId, tripId, blob, server!);
      }
    }
    await this.syncPhone(driverId, keys);
  }

  private restore(driverId: string, tripId: string, blob: Blob, server: TripRecord | null, version: Clock) {
    this.payoutsPaused = true;
    this.store.ensureDriver(driverId);
    if (blob.kind === 'active') {
      const rec: TripRecord = { trip: blob.trip, driverId, rideId: blob.rideId, version };
      this.store.saveTrip(rec);
      let ride = blob.rideId ? this.store.ride(blob.rideId) : null;
      if (blob.ride && blob.rideId) {
        // The rider's ride follows the trip's stage
        const status = ({ to_pickup: 'arriving', at_pickup: 'arrived', in_trip: 'in_trip' } as const)[blob.trip.stage as 'to_pickup'];
        ride = { ride: { ...blob.ride.ride, status: status ?? blob.ride.ride.status }, riderId: blob.ride.riderId, driverId };
        this.store.saveRide(ride);
      }
      this.dispatch.adopt(rec, ride);
      this.store.addFailoverEvent({ driverId, tripId, kind: 'restored', detail: `Trip in progress (${blob.trip.stage.replace('_', ' ')}) restored from the driver's phone` });
      return;
    }
    if (this.dispatch.isActive(tripId)) {
      // The phone knows the trip ended: never dispatch it again
      this.dispatch.close(tripId, { ...blob, version });
    } else {
      const trip = { ...(server?.trip ?? { id: tripId, liveEtaMin: 0, acceptedAt: blob.completedAt }), stage: 'completed', earnings: blob.earnings, completedAt: blob.completedAt, ...(blob.cancelledBy && { cancelledBy: blob.cancelledBy }) } as DriverTrip;
      this.store.saveTrip({ trip, driverId, rideId: blob.rideId, version });
      const ride = blob.rideId ? this.store.ride(blob.rideId) : null;
      if (ride && ride.ride.status !== 'completed' && ride.ride.status !== 'cancelled' && blob.cancelledBy !== 'driver') {
        this.store.saveRide({ ...ride, ride: { ...ride.ride, status: blob.cancelledBy ? 'cancelled' : 'completed', completedAt: blob.completedAt, liveEtaMin: 0 } });
      }
    }
    this.store.addFailoverEvent({ driverId, tripId, kind: 'restored', detail: `Finished trip restored from the driver's phone ($${blob.earnings.toFixed(2)})` });
  }

  /** Both regions changed the trip. The later stage wins, and the trip is flagged for an admin to review. */
  private resolveConflict(driverId: string, tripId: string, blob: Blob, server: TripRecord) {
    const version = bump(merge(blob.version, server.version ?? {}), this.region);
    const phoneRank = blob.kind === 'done' ? rank('completed', !!blob.cancelledBy) : rank(blob.trip.stage, false);
    const serverRank = rank(server.trip.stage, !!server.trip.cancelledBy);
    const phoneWins = phoneRank > serverRank;
    if (phoneWins) this.restore(driverId, tripId, blob, server, version);
    else this.store.saveTrip({ ...server, version });
    this.store.addFailoverEvent({
      driverId,
      tripId,
      kind: 'conflict',
      detail: `Two regions changed this trip. Kept the ${phoneWins ? "phone's" : "server's"} version; please review the fare.`,
    });
  }

  /** Sends the phone the latest version of each trip it should hold and removes everything else. */
  private async syncPhone(driverId: string, phoneKeys: string[]) {
    const profile = this.store.driver(driverId);
    if (!profile) return;
    const since = billingPeriod(profile.subscribedAt).start;
    const wanted = new Map<string, TripRecord>();
    for (const rec of this.store.driverTrips(driverId, since)) {
      if (!rec.version) {
        // Trips from before backups existed get their first version now
        rec.version = bump(undefined, this.region);
        this.store.saveTrip(rec);
      }
      wanted.set(vaultKey(driverId, rec.trip.id, rec.version), rec);
    }
    const have = new Set(phoneKeys);
    for (const [key, rec] of wanted) if (!have.has(key)) this.send(driverId, { op: 'set', key, blob: this.seal(rec) });
    // Keys of another driver who used this phone are left alone
    for (const key of phoneKeys) {
      const parsed = parseKey(key);
      if (!wanted.has(key) && (!parsed || parsed.driverId === driverId)) this.send(driverId, { op: 'delete', key });
    }
  }

  // ---------- admin audit ----------

  /** For each connected driver with a trip in progress, does their phone hold the latest version? */
  async audit() {
    const trips = this.dispatch.activeTrips().filter((t) => this.live.isConnected(t.driverId) && t.version);
    const results = await Promise.all(
      trips.map(async (t) => {
        const keys = await this.ask<string[]>(t.driverId, { op: 'list' }).catch(() => null);
        return { tripId: t.trip.id, driverId: t.driverId, covered: Array.isArray(keys) && keys.includes(vaultKey(t.driverId, t.trip.id, t.version!)) };
      }),
    );
    const covered = results.filter((r) => r.covered).length;
    return { activeTrips: results.length, covered, coverage: results.length ? covered / results.length : 1, trips: results };
  }

  // ---------- phone channel ----------

  /** A reply from a phone to `list` or `get`. */
  reply(reqId: unknown, value: unknown) {
    if (typeof reqId !== 'string') return;
    this.asks.get(reqId)?.resolve(value);
  }

  stop() {
    for (const { timer } of this.asks.values()) clearTimeout(timer);
    this.asks.clear();
  }

  private ask<T>(driverId: string, msg: { op: 'list' } | { op: 'get'; key: string }) {
    const reqId = newId('vq');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => (this.asks.delete(reqId), reject(new Error('The phone did not answer'))), ASK_TIMEOUT);
      this.asks.set(reqId, {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          this.asks.delete(reqId);
          resolve(value as T);
        },
      });
      this.send(driverId, { ...msg, reqId }, ASK_TIMEOUT);
    });
  }

  private send(driverId: string, msg: object, ttlMs?: number) {
    this.live.toUser(driverId, { type: 'vault', ...msg }, { reliable: true, ttlMs });
  }
}
