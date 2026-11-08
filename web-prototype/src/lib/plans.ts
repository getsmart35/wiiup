/**
 * Driver economics: drivers keep 100% of fares and tips and pay WiiUp a subscription instead of a commission.
 *
 * Silver and Gold follow the period's fares and are charged in ~$50 installments as fares pass each level.
 * Reaching a tier's earnings limit stops ride offers until the driver upgrades for the rest of the billing period:
 * Silver to Gold, Gold to Gold Plus. Platinum is prepaid, for licensed livery drivers an admin has approved.
 * Periods run from the day of the month the driver subscribed, not the calendar month.
 * Also used by admin/ and copied to ../../../src/lib/plans.ts for the Expo app: keep the copies identical.
 */
export type PlanId = 'silver' | 'gold' | 'gold_plus' | 'platinum';
type LadderPlan = 'silver' | 'gold';

const LADDER: Record<LadderPlan, { first: number; step: number; cap: number; capAt: number }> = {
  // Levels are set so the full fee is reached by the tier's earnings limit: $225 apart for Silver, $350 for Gold
  silver: { first: 50, step: 50, cap: 350, capAt: 1350 },
  gold: { first: 50, step: 50, cap: 450, capAt: 2800 },
};
export const EARNINGS_LIMIT: Partial<Record<PlanId, number>> = { silver: 1500, gold: 3000 };
export const UPGRADE: Partial<Record<PlanId, { to: PlanId; price: number }>> = {
  silver: { to: 'gold', price: 450 },
  gold: { to: 'gold_plus', price: 700 },
};
export const GOLD_PLUS_PRICE = 700;
export const PLATINUM_PRICE = 900;

export const PLATINUM_PERKS = [
  'Higher Instant Payout limits',
  '$150 car mess reimbursement',
  'A dedicated Platinum support team',
  'Platinum Earnings Guarantees (terms and limits to be set before launch)',
  'VIP access to all WiiUp virtual and in-person events',
  'A guaranteed seat on the WiiUp Driver Advisory Council',
];

function levels(plan: LadderPlan) {
  const s = LADDER[plan];
  const steps = Math.round((s.cap - s.first) / s.step);
  return Array.from({ length: steps + 1 }, (_, k) => ({
    at: (k * s.capAt) / steps,
    fee: Math.round((s.first + k * s.step) * 100) / 100,
    installment: k === 0 ? s.first : s.step,
  }));
}
export const LEVELS: Record<LadderPlan, ReturnType<typeof levels>> = { silver: levels('silver'), gold: levels('gold') };

export const isLadderPlan = (plan: PlanId): plan is LadderPlan => plan in LADDER;
/** Gold Plus is only bought as an upgrade after reaching Gold's limit. */
export const isUpgradeOnly = (plan: PlanId) => plan === 'gold_plus';
/** Platinum needs a verified livery license and admin approval. Every other plan is open to all drivers. */
export const needsApproval = (plan: PlanId) => plan === 'platinum';

/** A ladder plan's fee for a period's fares: how many installments are due, the total, and the next level. */
export function ladderFee(plan: LadderPlan, fares: number) {
  const list = LEVELS[plan];
  const passed = fares <= 0 ? 0 : list.filter((l, k) => k === 0 || fares > l.at).length;
  return {
    installments: passed,
    fee: passed ? list[passed - 1].fee : 0,
    next: list[passed] ?? null,
    capped: passed === list.length,
  };
}

export const PLANS: Record<PlanId, { name: string; price: string; blurb: string }> = {
  silver: { name: 'Silver', price: '$350.00 / month, in installments', blurb: 'For part-time drivers earning up to $1,500 a month.' },
  gold: { name: 'Gold', price: '$450.00 / month, in installments', blurb: 'For full-time drivers earning up to $3,000 a month.' },
  gold_plus: { name: 'Gold Plus', price: '$700.00, until your next billing date', blurb: 'For Gold drivers who reach $3,000. Unlimited earnings until your next billing date.' },
  platinum: { name: 'Platinum', price: '$900.00 / month, prepaid', blurb: 'For licensed livery drivers, after verification and admin approval. Unlimited earnings.' },
};
export const PLAN_ORDER: PlanId[] = ['silver', 'gold', 'gold_plus', 'platinum'];

export function planCost(plan: PlanId, fares: number): number {
  if (isLadderPlan(plan)) return ladderFee(plan, fares).fee;
  return plan === 'gold_plus' ? GOLD_PLUS_PRICE : PLATINUM_PRICE;
}

export function compareMonth(fares: number, tips: number) {
  return PLAN_ORDER.map((id) => {
    const cost = planCost(id, fares);
    const limit = EARNINGS_LIMIT[id];
    return { id, cost, takeHome: fares + tips - cost, share: fares > 0 ? cost / fares : 0, overLimit: limit != null && fares > limit };
  });
}

/** True once a driver has earned their tier's limit for the period: no more offers until they upgrade. */
export function limitReached(plan: PlanId, fares: number) {
  const limit = EARNINGS_LIMIT[plan];
  return limit != null && fares >= limit;
}

function monthly(anchor: Date, year: number, month: number) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchor.getDate(), last), anchor.getHours(), anchor.getMinutes(), anchor.getSeconds()).getTime();
}

/** The billing period containing `now`, repeating from the date the driver subscribed. */
export function billingPeriod(subscribedAt: number, now = Date.now()) {
  const anchor = new Date(subscribedAt);
  const d = new Date(now);
  let year = d.getFullYear();
  let month = d.getMonth();
  if (monthly(anchor, year, month) > now) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  return { start: monthly(anchor, year, month), end: monthly(anchor, month === 11 ? year + 1 : year, (month + 1) % 12) };
}
