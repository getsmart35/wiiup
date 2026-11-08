import type { FareQuote, LatLng, RideTier } from '@/api/types';
import { durationMin, roadDistanceKm } from './geo';

type TierConfig = { label: string; seats: number; base: number; perKm: number; perMin: number; min: number };

export const TIERS: Record<RideTier, TierConfig> = {
  go: { label: 'WiiUp Go', seats: 4, base: 2.5, perKm: 1.1, perMin: 0.3, min: 7 },
  comfort: { label: 'WiiUp Comfort', seats: 4, base: 3.5, perKm: 1.55, perMin: 0.4, min: 10 },
  xl: { label: 'WiiUp XL', seats: 6, base: 4.5, perKm: 2.0, perMin: 0.5, min: 13 },
  // Platinum prices are placeholders until WiiUp sets them
  platinum: { label: 'WiiUp Platinum', seats: 4, base: 6, perKm: 2.6, perMin: 0.65, min: 18 },
};

export const TIER_ORDER: RideTier[] = ['go', 'comfort', 'xl', 'platinum'];

export function quoteFare(
  tier: RideTier,
  from: LatLng,
  to: LatLng,
  opts: { surge?: number; etaMin?: number } = {},
): FareQuote {
  const cfg = TIERS[tier];
  const km = roadDistanceKm(from, to);
  const mins = durationMin(km);
  const surge = opts.surge ?? 1;
  const raw = (cfg.base + cfg.perKm * km + cfg.perMin * mins) * surge;
  return {
    tier,
    label: cfg.label,
    seats: cfg.seats,
    fare: Math.round(Math.max(cfg.min, raw) * 100) / 100,
    surge,
    etaMin: opts.etaMin ?? 4,
    distanceKm: Math.round(km * 10) / 10,
    durationMin: mins,
  };
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
