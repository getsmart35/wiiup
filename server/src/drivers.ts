import type { FareQuote, InstantPayout } from '@/api/types';
import { PAYOUT_DESTINATION, INSTANT_MINIMUM, instantFee, payoutQuote } from '@/lib/payouts';
import { billingPeriod, EARNINGS_LIMIT, isUpgradeOnly, limitReached, needsApproval, UPGRADE, type PlanId } from '@/lib/plans';
import { cents, fareFor, ratesInUse, type RateCards } from '@/lib/rates';
import { badRequest, conflict, notFound } from './http.ts';
import { newId, type DriverProfile, type PlatinumRequest, type Store } from './store.ts';

/** The driver's plan this billing period and their fares so far. Mirrors usePlanStatus in the app. */
export function planStatus(store: Store, profile: DriverProfile, now = Date.now()) {
  const period = billingPeriod(profile.subscribedAt, now);
  const plan = profile.upgrade?.periodStart === period.start ? profile.upgrade.plan : profile.plan;
  const earned = store.earnedSince(profile.userId, period.start);
  return {
    period,
    plan,
    basePlan: profile.plan,
    earned,
    limit: EARNINGS_LIMIT[plan] ?? null,
    atLimit: limitReached(plan, earned),
    upgradeOption: UPGRADE[plan] ?? null,
  };
}

/**
 * The one price for a trip with this driver: the rider pays it and the driver keeps all of it.
 * Suggested rates use the rider's quote as is; custom rates use the driver's own card.
 */
export function driverPrice(cards: RateCards, quote: FareQuote) {
  if (cards[quote.tier].useSuggested) return quote.fare;
  return fareFor(ratesInUse(cards, quote.tier), quote.distanceKm * 1000, quote.durationMin * 60, quote.surge > 1).fare;
}

export function isPlatinumApproved(store: Store, driverId: string) {
  return store.platinumRequests({ driverId, status: 'approved' }).length > 0;
}

/** Saves the driver's rate cards and chosen plan. Gold Plus is only bought as an upgrade; Platinum needs approval. */
export function saveSettings(store: Store, driverId: string, input: { cards: RateCards; plan: PlanId; subscribedAt?: number }) {
  const existing = store.driver(driverId);
  // The first time a driver connects, keep the subscription date their app started with (if it is believable)
  const firstSubscribed =
    input.subscribedAt && input.subscribedAt <= Date.now() && input.subscribedAt > Date.now() - 400 * 864e5 ? input.subscribedAt : Date.now();
  const profile = existing ?? store.ensureDriver(driverId, firstSubscribed);
  if (input.plan !== profile.plan) {
    if (isUpgradeOnly(input.plan)) throw badRequest('Gold Plus is only available as an upgrade after reaching the Gold limit');
    if (needsApproval(input.plan) && !isPlatinumApproved(store, driverId)) {
      throw conflict('needs_approval', 'Platinum needs a verified livery license and admin approval');
    }
  }
  const next: DriverProfile = { ...profile, cards: input.cards, plan: input.plan, upgrade: input.plan === profile.plan ? profile.upgrade : null };
  store.saveDriver(next);
  return next;
}

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

/** Earnings from completed trips that haven't been paid out yet. */
export function balance(store: Store, driverId: string) {
  return Math.max(0, cents(store.earnedSince(driverId, 0) - store.paidOutSince(driverId, 0)));
}

/** Sends an instant payout, at most once per idempotency key. Fees and limits come from the shared payout rules. */
export function instantPayout(store: Store, driverId: string, amount: number, key: string): InstantPayout {
  return store.tx(() => {
    const done = store.payoutByKey(driverId, key);
    if (done) return done;
    const profile = store.ensureDriver(driverId);
    const status = planStatus(store, profile);
    const quote = payoutQuote(balance(store, driverId), status.plan, store.paidOutSince(driverId, startOfToday()));
    amount = cents(amount);
    if (amount < INSTANT_MINIMUM) throw badRequest(`The minimum instant payout is $${INSTANT_MINIMUM.toFixed(2)}`);
    if (amount > quote.amount) throw conflict('over_limit', `You can cash out up to $${quote.amount.toFixed(2)} right now`);
    const fee = instantFee(amount);
    // No payment processor is connected yet: this records the payout but no money moves
    const payout: InstantPayout = { id: newId('pay'), amount, fee, net: cents(amount - fee), destination: PAYOUT_DESTINATION, at: Date.now() };
    store.addPayout(driverId, key, payout);
    return payout;
  });
}

/** Buys the upgrade offered at the driver's limit, for the rest of the billing period. Charged once per idempotency key. */
export function purchaseUpgrade(store: Store, driverId: string, plan: PlanId, price: number, key: string) {
  return store.tx(() => {
    const profile = store.ensureDriver(driverId);
    const done = store.chargeByKey(driverId, key);
    if (done) return { plan: done.plan, periodStart: profile.upgrade?.periodStart ?? planStatus(store, profile).period.start };
    const status = planStatus(store, profile);
    const option = status.upgradeOption;
    if (!status.atLimit || !option) throw conflict('not_at_limit', 'An upgrade is only available after reaching your plan limit');
    if (option.to !== plan || option.price !== price) throw conflict('price_changed', `The upgrade available is ${option.to} for $${option.price.toFixed(2)}`);
    // No payment processor is connected yet: this records the charge but no money moves
    store.addCharge(key, { id: newId('chg'), driverId, kind: 'upgrade', plan, amount: price, at: Date.now() });
    const upgrade = { plan, periodStart: status.period.start };
    store.saveDriver({ ...profile, upgrade });
    return upgrade;
  });
}

export function applyForPlatinum(store: Store, driverId: string, license: string): PlatinumRequest {
  store.ensureDriver(driverId);
  const pending = store.platinumRequests({ driverId, status: 'pending' })[0];
  if (pending) return pending;
  const req: PlatinumRequest = { id: newId('plt'), driverId, license, status: 'pending', submittedAt: Date.now(), decidedAt: null };
  store.addPlatinumRequest(req);
  return req;
}

export function platinumReview(store: Store, driverId: string, submittedAt?: number) {
  const list = store.platinumRequests({ driverId });
  const req = submittedAt ? list.find((r) => r.submittedAt === submittedAt) : list[0];
  if (!req) throw notFound('No Platinum application found');
  return req;
}
