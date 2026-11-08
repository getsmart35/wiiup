import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { FareQuote, RideTier } from '@/api/types';
import { billingPeriod, EARNINGS_LIMIT, limitReached, UPGRADE, type PlanId } from '@/lib/plans';
import { defaultCards, fareFor, ratesInUse, type RateCards, type TierCard } from '@/lib/rates';
import { useDriver } from './useDriver';
import { persistStorage } from './storage';

export type LiveryReview = { status: 'none' | 'pending' | 'approved' | 'rejected'; license?: string; submittedAt?: number };

type RateCardState = {
  cards: RateCards;
  plan: PlanId;
  /** Billing periods repeat from this date each month. */
  subscribedAt: number;
  /** An upgrade bought after reaching a limit. It lasts until the period it was bought in ends. */
  upgrade: { plan: PlanId; periodStart: number } | null;
  livery: LiveryReview;
  saveCard: (tier: RideTier, card: TierCard) => void;
  setPlan: (plan: PlanId) => void;
  buyUpgrade: (plan: PlanId, periodStart: number) => void;
  setLivery: (livery: LiveryReview) => void;
};

export const useRateCards = create<RateCardState>()(
  persist(
    (set) => ({
      cards: defaultCards(),
      plan: 'silver',
      subscribedAt: Date.now(),
      upgrade: null,
      livery: { status: 'none' },
      saveCard: (tier, card) => set((s) => ({ cards: { ...s.cards, [tier]: card } })),
      setPlan: (plan) => set({ plan, upgrade: null }),
      buyUpgrade: (plan, periodStart) => set({ upgrade: { plan, periodStart } }),
      setLivery: (livery) => set({ livery }),
    }),
    {
      name: 'wiiup-rate-cards',
      storage: persistStorage,
      // Ride types added after a driver last saved start from the suggested rates, and retired plans move to Silver
      merge: (saved, current) => {
        const s = saved as (Partial<Omit<RateCardState, 'plan'>> & { plan?: string }) | undefined;
        const plan = (s?.plan === 'flex' || s?.plan === 'daily' || !s?.plan ? 'silver' : s.plan) as PlanId;
        return { ...current, ...s, plan, cards: { ...defaultCards(), ...s?.cards } };
      },
    },
  ),
);

/** The driver's plan this period, their fares so far, and whether they have to upgrade to keep accepting rides. */
export function usePlanStatus() {
  const { plan, subscribedAt, upgrade } = useRateCards();
  const completed = useDriver((s) => s.completed);
  return useMemo(() => {
    const period = billingPeriod(subscribedAt);
    const current = upgrade?.periodStart === period.start ? upgrade.plan : plan;
    const earned = completed.filter((t) => (t.completedAt ?? 0) >= period.start).reduce((sum, t) => sum + t.earnings, 0);
    return {
      period, plan: current, basePlan: plan, earned, upgraded: current !== plan,
      limit: EARNINGS_LIMIT[current] ?? null, atLimit: limitReached(current, earned), upgradeOption: UPGRADE[current] ?? null,
    };
  }, [plan, subscribedAt, upgrade, completed]);
}

/**
 * The one price for a trip: what the rider pays and what the driver earns, because the driver keeps all of it.
 * Suggested rates use the quote as is; custom rates use the driver's card. A real backend prices from the assigned driver's card.
 */
export function tripPrice(quote: FareQuote) {
  const { cards } = useRateCards.getState();
  if (cards[quote.tier].useSuggested) return quote.fare;
  return fareFor(ratesInUse(cards, quote.tier), quote.distanceKm * 1000, quote.durationMin * 60, quote.surge > 1).fare;
}

export const withTripPrice = (quote: FareQuote): FareQuote => ({ ...quote, fare: tripPrice(quote) });
