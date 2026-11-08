import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { DriverTrip, InstantPayout, Ride } from '@/api/types';
import type { PlanId } from '@/lib/plans';
import { defaultCards, type RateCards } from '@/lib/rates';

export type User = { id: string; name: string; phone: string; createdAt: number };
export type Vehicle = { car: string; color: string; plate: string };
export type Upgrade = { plan: PlanId; periodStart: number };
export type DriverProfile = {
  userId: string;
  plan: PlanId;
  /** Billing periods repeat from this date each month. */
  subscribedAt: number;
  cards: RateCards;
  upgrade: Upgrade | null;
  vehicle: Vehicle | null;
  rating: number;
};
export type PlatinumStatus = 'pending' | 'approved' | 'rejected';
export type PlatinumRequest = {
  id: string;
  driverId: string;
  license: string;
  status: PlatinumStatus;
  submittedAt: number;
  decidedAt: number | null;
};
export type Charge = { id: string; driverId: string; kind: 'upgrade'; plan: PlanId; amount: number; at: number };

/** A ride as stored: the app's Ride plus who it belongs to. */
export type RideRecord = { ride: Ride; riderId: string; driverId: string | null };
/** Vector clock: one counter per region, bumped by the region that changed the trip. */
export type Clock = Record<string, number>;
/** A driver trip as stored. `rideId` is null for simulated riders. */
export type TripRecord = { trip: DriverTrip; driverId: string; rideId: string | null; version?: Clock };
export type FailoverEvent = { id: string; driverId: string; tripId: string; kind: 'restored' | 'conflict' | 'rejected'; detail: string; at: number };

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS drivers (
  user_id TEXT PRIMARY KEY REFERENCES users(id), plan TEXT NOT NULL, subscribed_at INTEGER NOT NULL,
  cards TEXT NOT NULL, upgrade TEXT, vehicle TEXT, rating REAL NOT NULL DEFAULT 5);
CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY, rider_id TEXT NOT NULL, driver_id TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS rides_rider ON rides(rider_id, created_at);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, ride_id TEXT, stage TEXT NOT NULL,
  earnings REAL NOT NULL, completed_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trips_driver ON trips(driver_id, completed_at);
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, idem_key TEXT NOT NULL, amount REAL NOT NULL, fee REAL NOT NULL,
  net REAL NOT NULL, destination TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(driver_id, idem_key));
CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, idem_key TEXT NOT NULL, kind TEXT NOT NULL, plan TEXT NOT NULL,
  amount REAL NOT NULL, at INTEGER NOT NULL, UNIQUE(driver_id, idem_key));
CREATE TABLE IF NOT EXISTS failover_events (
  id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, trip_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS platinum_requests (
  id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, license TEXT NOT NULL, status TEXT NOT NULL,
  submitted_at INTEGER NOT NULL, decided_at INTEGER);
`;

type Row = Record<string, unknown>;
const json = <T,>(v: unknown) => (v == null ? null : (JSON.parse(String(v)) as T));

/** All persistent data. SQLite calls are synchronous, so each method is atomic within this process. */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    const tripColumns = this.db.prepare('PRAGMA table_info(trips)').all() as Row[];
    if (!tripColumns.some((c) => c.name === 'version')) this.db.exec('ALTER TABLE trips ADD COLUMN version TEXT');
  }

  close() {
    this.db.close();
  }

  // ---------- users and sessions ----------

  upsertUser(phone: string, name: string): User {
    const existing = this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as Row | undefined;
    if (existing) {
      this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id as string);
      return { ...toUser(existing), name };
    }
    const user: User = { id: newId('usr'), phone, name, createdAt: Date.now() };
    this.db.prepare('INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)').run(user.id, phone, name, user.createdAt);
    return user;
  }

  user(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return row ? toUser(row) : null;
  }

  createSession(userId: string, token: string) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(hashToken(token), userId, Date.now());
  }

  sessionUser(token: string): string | null {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(hashToken(token)) as Row | undefined;
    return (row?.user_id as string) ?? null;
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  // ---------- drivers ----------

  driver(userId: string): DriverProfile | null {
    const row = this.db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(userId) as Row | undefined;
    if (!row) return null;
    return {
      userId,
      plan: row.plan as PlanId,
      subscribedAt: row.subscribed_at as number,
      cards: json<RateCards>(row.cards)!,
      upgrade: json<Upgrade>(row.upgrade),
      vehicle: json<Vehicle>(row.vehicle),
      rating: row.rating as number,
    };
  }

  /** The driver's profile, created on Silver with suggested rates the first time they drive. */
  ensureDriver(userId: string, subscribedAt = Date.now()): DriverProfile {
    const existing = this.driver(userId);
    if (existing) return existing;
    const profile: DriverProfile = { userId, plan: 'silver', subscribedAt, cards: defaultCards(), upgrade: null, vehicle: null, rating: 5 };
    this.saveDriver(profile);
    return profile;
  }

  saveDriver(p: DriverProfile) {
    this.db
      .prepare(
        `INSERT INTO drivers (user_id, plan, subscribed_at, cards, upgrade, vehicle, rating) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, subscribed_at = excluded.subscribed_at,
           cards = excluded.cards, upgrade = excluded.upgrade, vehicle = excluded.vehicle, rating = excluded.rating`,
      )
      .run(p.userId, p.plan, p.subscribedAt, JSON.stringify(p.cards), p.upgrade && JSON.stringify(p.upgrade), p.vehicle && JSON.stringify(p.vehicle), p.rating);
  }

  // ---------- rides and trips ----------

  saveRide(r: RideRecord) {
    this.db
      .prepare(
        `INSERT INTO rides (id, rider_id, driver_id, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET driver_id = excluded.driver_id, status = excluded.status, data = excluded.data`,
      )
      .run(r.ride.id, r.riderId, r.driverId, r.ride.status, r.ride.createdAt, JSON.stringify(r.ride));
  }

  ride(id: string): RideRecord | null {
    const row = this.db.prepare('SELECT * FROM rides WHERE id = ?').get(id) as Row | undefined;
    return row ? { ride: json<Ride>(row.data)!, riderId: row.rider_id as string, driverId: (row.driver_id as string) ?? null } : null;
  }

  /** Rides that were in progress, for recovery after a restart. */
  openRides(): RideRecord[] {
    const rows = this.db.prepare("SELECT * FROM rides WHERE status NOT IN ('completed', 'cancelled')").all() as Row[];
    return rows.map((row) => ({ ride: json<Ride>(row.data)!, riderId: row.rider_id as string, driverId: (row.driver_id as string) ?? null }));
  }

  saveTrip(t: TripRecord) {
    this.db
      .prepare(
        `INSERT INTO trips (id, driver_id, ride_id, stage, earnings, completed_at, data, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, earnings = excluded.earnings,
           completed_at = excluded.completed_at, data = excluded.data, version = excluded.version`,
      )
      .run(t.trip.id, t.driverId, t.rideId, t.trip.stage, t.trip.earnings, t.trip.completedAt ?? null, JSON.stringify(t.trip), t.version ? JSON.stringify(t.version) : null);
  }

  trip(id: string): TripRecord | null {
    const row = this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Row | undefined;
    return row ? toTrip(row) : null;
  }

  openTrips(): TripRecord[] {
    return (this.db.prepare("SELECT * FROM trips WHERE stage != 'completed'").all() as Row[]).map(toTrip);
  }

  /** The driver's open trips and the trips they finished since `since`: what their phone should hold. */
  driverTrips(driverId: string, since: number): TripRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM trips WHERE driver_id = ? AND (stage != 'completed' OR completed_at >= ?)")
      .all(driverId, since) as Row[];
    return rows.map(toTrip);
  }

  // ---------- failover ----------

  addFailoverEvent(e: Omit<FailoverEvent, 'id' | 'at'>) {
    this.db
      .prepare('INSERT INTO failover_events (id, driver_id, trip_id, kind, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId('fo'), e.driverId, e.tripId, e.kind, e.detail, Date.now());
  }

  failoverEvents(limit = 200): FailoverEvent[] {
    return (this.db.prepare('SELECT * FROM failover_events ORDER BY at DESC LIMIT ?').all(limit) as Row[]).map((row) => ({
      id: row.id as string,
      driverId: row.driver_id as string,
      tripId: row.trip_id as string,
      kind: row.kind as FailoverEvent['kind'],
      detail: row.detail as string,
      at: row.at as number,
    }));
  }

  /** Fares from trips the driver completed since `since`. */
  earnedSince(driverId: string, since: number): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(earnings), 0) AS total FROM trips WHERE driver_id = ? AND stage = 'completed' AND completed_at >= ?")
      .get(driverId, since) as Row;
    return cents(row.total as number);
  }

  // ---------- money ----------

  paidOutSince(driverId: string, since: number): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE driver_id = ? AND at >= ?').get(driverId, since) as Row;
    return cents(row.total as number);
  }

  payoutByKey(driverId: string, key: string): InstantPayout | null {
    const row = this.db.prepare('SELECT * FROM payouts WHERE driver_id = ? AND idem_key = ?').get(driverId, key) as Row | undefined;
    return row ? toPayout(row) : null;
  }

  addPayout(driverId: string, key: string, p: InstantPayout) {
    this.db
      .prepare('INSERT INTO payouts (id, driver_id, idem_key, amount, fee, net, destination, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, driverId, key, p.amount, p.fee, p.net, p.destination, p.at);
  }

  chargeByKey(driverId: string, key: string): Charge | null {
    const row = this.db.prepare('SELECT * FROM charges WHERE driver_id = ? AND idem_key = ?').get(driverId, key) as Row | undefined;
    return row
      ? { id: row.id as string, driverId, kind: 'upgrade', plan: row.plan as PlanId, amount: row.amount as number, at: row.at as number }
      : null;
  }

  addCharge(key: string, c: Charge) {
    this.db
      .prepare('INSERT INTO charges (id, driver_id, idem_key, kind, plan, amount, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, c.driverId, key, c.kind, c.plan, c.amount, c.at);
  }

  /** Runs `fn` in one transaction. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- Platinum ----------

  addPlatinumRequest(r: PlatinumRequest) {
    this.db
      .prepare('INSERT INTO platinum_requests (id, driver_id, license, status, submitted_at, decided_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.driverId, r.license, r.status, r.submittedAt, r.decidedAt);
  }

  platinumRequests(where: { driverId?: string; status?: PlatinumStatus; id?: string } = {}): PlatinumRequest[] {
    const clauses: string[] = [];
    const args: string[] = [];
    if (where.driverId) (clauses.push('driver_id = ?'), args.push(where.driverId));
    if (where.status) (clauses.push('status = ?'), args.push(where.status));
    if (where.id) (clauses.push('id = ?'), args.push(where.id));
    const sql = `SELECT * FROM platinum_requests ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY submitted_at DESC`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((row) => ({
      id: row.id as string,
      driverId: row.driver_id as string,
      license: row.license as string,
      status: row.status as PlatinumStatus,
      submittedAt: row.submitted_at as number,
      decidedAt: (row.decided_at as number) ?? null,
    }));
  }

  decidePlatinum(id: string, status: Exclude<PlatinumStatus, 'pending'>) {
    this.db.prepare("UPDATE platinum_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(status, Date.now(), id);
  }
}

const cents = (n: number) => Math.round(n * 100) / 100;

const toTrip = (row: Row): TripRecord => ({
  trip: json<DriverTrip>(row.data)!,
  driverId: row.driver_id as string,
  rideId: (row.ride_id as string) ?? null,
  version: json<Clock>(row.version) ?? undefined,
});

const toUser = (row: Row): User => ({ id: row.id as string, phone: row.phone as string, name: row.name as string, createdAt: row.created_at as number });

const toPayout = (row: Row): InstantPayout => ({
  id: row.id as string,
  amount: row.amount as number,
  fee: row.fee as number,
  net: row.net as number,
  destination: row.destination as string,
  at: row.at as number,
});
