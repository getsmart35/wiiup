import { TIER_ORDER, TIERS, type Tier } from './fare';

/**
 * Driver rate cards: each ride type has WiiUp's suggested rates or the driver's own, and the driver keeps 100% of the fare.
 * Rates are dollars. Distance is per mile for drivers, while the shared fare table in fare.ts is per kilometer.
 */
export type Rates = { minimum: number; base: number; perMin: number; perMile: number; surge: number };
export type RateField = keyof Rates;
export type TierCard = { useSuggested: boolean; custom: Rates };
export type RateCards = Record<Tier, TierCard>;

const METERS_PER_MILE = 1609.344;
export const cents = (n: number) => Math.round(n * 100) / 100;

/** Listed in the order drivers see them. The limits are placeholders until WiiUp and local rules set real ones. */
export const RATE_FIELDS: { id: RateField; label: string; step: number; min: number; max: number }[] = [
  { id: 'minimum', label: 'Minimum fare', step: 0.1, min: 1, max: 100 },
  { id: 'base', label: 'Base fare', step: 0.1, min: 0, max: 20 },
  { id: 'perMin', label: 'Per minute', step: 0.01, min: 0, max: 3 },
  { id: 'perMile', label: 'Per mile', step: 0.05, min: 0, max: 10 },
  { id: 'surge', label: 'Surge', step: 0.25, min: 0, max: 25 },
];

/** WiiUp's standard pricing for a ride type. Surge is a flat extra per trip at busy times, off unless a driver sets one. */
export function suggestedRates(tier: Tier): Rates {
  const t = TIERS[tier];
  return { minimum: t.min, base: cents(t.base * t.surge), perMin: cents(t.perMin * t.surge), perMile: cents((t.perKm * METERS_PER_MILE * t.surge) / 1000), surge: 0 };
}

export const defaultCards = () => Object.fromEntries(TIER_ORDER.map((t) => [t, { useSuggested: true, custom: suggestedRates(t) }])) as RateCards;

export const ratesInUse = (cards: RateCards, tier: Tier) => (cards[tier].useSuggested ? suggestedRates(tier) : cards[tier].custom);

export function fareFor(rates: Rates, meters: number, seconds: number, busy = false) {
  const distance = cents((rates.perMile * meters) / METERS_PER_MILE);
  const time = cents((rates.perMin * seconds) / 60);
  const subtotal = cents(rates.base + distance + time);
  const surge = busy ? rates.surge : 0;
  return { base: rates.base, distance, time, subtotal, surge, fare: cents(Math.max(rates.minimum, subtotal) + surge), minimumApplied: subtotal < rates.minimum };
}

export const tripFare = (rates: Rates, miles: number, minutes: number, busy = false) => fareFor(rates, miles * METERS_PER_MILE, minutes * 60, busy);
