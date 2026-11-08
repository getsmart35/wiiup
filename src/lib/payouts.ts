import type { PlanId } from './plans';

/** Instant payout rules. The fee and limits are placeholders until WiiUp sets them with its payment processor. */
export const INSTANT_FEE_RATE = 0.015;
export const INSTANT_FEE_MINIMUM = 0.5;
export const INSTANT_MINIMUM = 1;
export const PAYOUT_DESTINATION = 'Debit card •••• 4242';

const DAILY_LIMIT = 500;
const PLATINUM_DAILY_LIMIT = 2000;

export const dailyPayoutLimit = (plan: PlanId) => (plan === 'platinum' ? PLATINUM_DAILY_LIMIT : DAILY_LIMIT);

export function instantFee(amount: number) {
  return amount > 0 ? Math.max(INSTANT_FEE_MINIMUM, Math.round(amount * INSTANT_FEE_RATE * 100) / 100) : 0;
}

/** What can be cashed out right now, the fee on it, and what reaches the driver. */
export function payoutQuote(balance: number, plan: PlanId, paidToday: number) {
  const limit = dailyPayoutLimit(plan);
  const amount = Math.max(0, Math.round(Math.min(balance, limit - paidToday) * 100) / 100);
  const fee = instantFee(amount);
  const net = Math.max(0, Math.round((amount - fee) * 100) / 100);
  return { limit, amount, fee, net, limited: amount < balance, ok: amount >= INSTANT_MINIMUM && net > 0 };
}
