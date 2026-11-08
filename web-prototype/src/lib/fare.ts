export type Tier = 'go' | 'comfort' | 'xl' | 'platinum';

/** Same pricing as src/lib/fare.ts in the Expo app. */
export const TIERS: Record<Tier, { label: string; seats: number; base: number; perKm: number; perMin: number; min: number; eta: number; surge: number }> = {
  go: { label: 'WiiUp Go', seats: 4, base: 2.5, perKm: 1.1, perMin: 0.3, min: 7, eta: 3, surge: 1 },
  comfort: { label: 'WiiUp Comfort', seats: 4, base: 3.5, perKm: 1.55, perMin: 0.4, min: 10, eta: 5, surge: 1 },
  xl: { label: 'WiiUp XL', seats: 6, base: 4.5, perKm: 2.0, perMin: 0.5, min: 13, eta: 7, surge: 1.2 },
  // Platinum prices are placeholders until WiiUp sets them
  platinum: { label: 'WiiUp Platinum', seats: 4, base: 6, perKm: 2.6, perMin: 0.65, min: 18, eta: 8, surge: 1 },
};
export const TIER_ORDER: Tier[] = ['go', 'comfort', 'xl', 'platinum'];

export function quoteFare(tier: Tier, meters: number, seconds: number): number {
  const c = TIERS[tier];
  const raw = (c.base + (c.perKm * meters) / 1000 + (c.perMin * seconds) / 60) * c.surge;
  return Math.round(Math.max(c.min, raw) * 100) / 100;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
