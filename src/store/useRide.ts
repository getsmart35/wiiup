import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { FareQuote, Place, Ride, RideTier } from '@/api/types';
import { persistStorage } from './storage';

type RideState = {
  pickup: Place | null;
  dropoff: Place | null;
  tier: RideTier;
  quotes: FareQuote[];
  activeRide: Ride | null;
  history: Ride[];
  recents: Place[];
  setPickup: (p: Place) => void;
  setDropoff: (p: Place | null) => void;
  setTier: (t: RideTier) => void;
  setQuotes: (q: FareQuote[]) => void;
  setActiveRide: (r: Ride | null) => void;
  finishRide: (r: Ride) => void;
  resetBooking: () => void;
};

export const useRide = create<RideState>()(
  persist(
    (set) => ({
      pickup: null,
      dropoff: null,
      tier: 'go',
      quotes: [],
      activeRide: null,
      history: [],
      recents: [],
      setPickup: (pickup) => set({ pickup }),
      setDropoff: (dropoff) =>
        set((s) => ({
          dropoff,
          recents: dropoff
            ? [dropoff, ...s.recents.filter((p) => p.id !== dropoff.id)].slice(0, 5)
            : s.recents,
        })),
      setTier: (tier) => set({ tier }),
      setQuotes: (quotes) => set({ quotes }),
      setActiveRide: (activeRide) => set({ activeRide }),
      finishRide: (ride) =>
        set((s) => ({
          activeRide: null,
          history: [ride, ...s.history.filter((r) => r.id !== ride.id)],
        })),
      resetBooking: () => set({ dropoff: null, quotes: [], activeRide: null, tier: 'go' }),
    }),
    {
      name: 'wiiup-ride',
      storage: persistStorage,
      partialize: ({ history, recents }) => ({ history, recents }),
    },
  ),
);
