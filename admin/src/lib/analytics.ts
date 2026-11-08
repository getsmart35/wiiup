import type { PlanId } from '../../../web-prototype/src/lib/plans';
import type { Tier } from '../../../web-prototype/src/lib/fare';
import type { Customer, Db, Level, Txn } from '../types';
import { DAY, shortDate, startOfMonth } from './format';

/** What a fare is worth to the driver after refunds. Drivers keep 100%, so this is not WiiUp revenue. */
export const fareNet = (t: Txn) => t.amount + (t.tip ?? 0) - (t.refunded ?? 0);
export const okFares = (txns: Txn[]) => txns.filter((t) => t.kind === 'fare' && t.status === 'succeeded');
export const okSubs = (txns: Txn[]) => txns.filter((t) => t.kind === 'subscription' && t.status === 'succeeded');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function summarize(txns: Txn[], from: number, to: number) {
  const slice = txns.filter((t) => t.at >= from && t.at < to);
  const fares = okFares(slice);
  return {
    rides: fares.length,
    volume: sum(fares.map(fareNet)),
    revenue: sum(okSubs(slice).map((t) => t.amount)),
    refunds: sum(slice.filter((t) => t.kind === 'refund').map((t) => t.amount)),
    bonuses: sum(slice.filter((t) => t.kind === 'bonus').map((t) => t.amount)),
    failed: slice.filter((t) => t.status === 'failed').length,
  };
}

export const delta = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

export type Bucket = { label: string; from: number; to: number };

/** Days for short ranges, weeks for long ones, always ending at today. */
export function buckets(rangeDays: number, now = Date.now()): Bucket[] {
  const size = rangeDays > 30 ? 7 : 1;
  const n = Math.ceil(rangeDays / size);
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const to = end.getTime() - (n - 1 - i) * size * DAY;
    const from = to - size * DAY;
    return { label: shortDate(from), from, to };
  });
}

export function perBucket<T>(items: { at: number; item: T }[], bs: Bucket[], value: (x: T) => number) {
  const out = bs.map(() => 0);
  const start = bs[0]?.from ?? 0;
  const size = bs.length ? bs[0].to - bs[0].from : 1;
  items.forEach(({ at, item }) => {
    const k = Math.floor((at - start) / size);
    if (k >= 0 && k < out.length) out[k] += value(item);
  });
  return out;
}

export function ridesByTier(txns: Txn[], bs: Bucket[]) {
  const fares = okFares(txns);
  const of = (tier: Tier) => perBucket(fares.filter((f) => f.tier === tier).map((f) => ({ at: f.at, item: f })), bs, () => 1);
  return { go: of('go'), comfort: of('comfort'), xl: of('xl'), platinum: of('platinum') };
}

/** Rides per weekday (Mon first) and hour. */
export function heatmap(txns: Txn[], from: number) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  okFares(txns).forEach((t) => {
    if (t.at < from) return;
    const d = new Date(t.at);
    grid[(d.getDay() + 6) % 7][d.getHours()] += 1;
  });
  return grid;
}

export function revenueByPlan(txns: Txn[], from: number) {
  const out: Record<PlanId, number> = { silver: 0, gold: 0, gold_plus: 0, platinum: 0 };
  okSubs(txns).forEach((t) => {
    if (t.at >= from && t.plan) out[t.plan] += t.amount;
  });
  return out;
}

export function levelOf(levels: Level[], lifetimePoints: number) {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  return sorted.filter((l) => l.minPoints <= lifetimePoints).pop() ?? sorted[0];
}

export function customerStats(txns: Txn[]) {
  const map = new Map<string, { rides: number; spend: number; last: number }>();
  okFares(txns).forEach((t) => {
    if (!t.customerId) return;
    const s = map.get(t.customerId) ?? { rides: 0, spend: 0, last: 0 };
    s.rides += 1;
    s.spend += fareNet(t);
    s.last = Math.max(s.last, t.at);
    map.set(t.customerId, s);
  });
  return map;
}

/** This month's fares and fee per driver, using the same rules the driver app shows. */
export function driverMonth(db: Db) {
  const from = startOfMonth();
  const map = new Map<string, { fares: number; tips: number; rides: number }>();
  okFares(db.txns).forEach((t) => {
    if (!t.driverId || t.at < from) return;
    const s = map.get(t.driverId) ?? { fares: 0, tips: 0, rides: 0 };
    s.fares += t.amount - (t.refunded ?? 0);
    s.tips += t.tip ?? 0;
    s.rides += 1;
    map.set(t.driverId, s);
  });
  return map;
}

/** Fares and tips earned since the driver's last payout, after refunds. */
export function payoutDue(db: Db) {
  const paid = new Map(db.drivers.map((d) => [d.id, d.paidThrough]));
  const due = new Map<string, number>();
  okFares(db.txns).forEach((t) => {
    if (t.driverId && t.at > (paid.get(t.driverId) ?? 0)) due.set(t.driverId, (due.get(t.driverId) ?? 0) + fareNet(t));
  });
  // A refund on a fare that was already paid out comes off the next payout instead
  const fareAt = new Map(db.txns.filter((t) => t.kind === 'fare').map((t) => [t.id, t.at]));
  db.txns.forEach((t) => {
    if (t.kind !== 'refund' || !t.driverId || !t.refundOf) return;
    const since = paid.get(t.driverId) ?? 0;
    if (t.at > since && (fareAt.get(t.refundOf) ?? 0) <= since) due.set(t.driverId, (due.get(t.driverId) ?? 0) - t.amount);
  });
  return due;
}

export function repeatRate(customers: Customer[], stats: ReturnType<typeof customerStats>) {
  const riders = customers.filter((c) => (stats.get(c.id)?.rides ?? 0) > 0);
  return riders.length ? riders.filter((c) => (stats.get(c.id)?.rides ?? 0) >= 2).length / riders.length : 0;
}

export const atRiskCents = (txns: Txn[]) => sum(txns.filter((t) => t.kind === 'subscription' && t.status === 'failed').map((t) => t.amount));
