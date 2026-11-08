import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { DriverTrip, InstantPayout, LatLng } from '@/api/types';
import { persistStorage } from './storage';

type DriverState = {
  online: boolean;
  activeTrip: DriverTrip | null;
  /** Where the driver ended their last trip; null means use device location. */
  position: LatLng | null;
  completed: DriverTrip[];
  payouts: InstantPayout[];
  addPayout: (p: InstantPayout) => void;
  setOnline: (online: boolean) => void;
  setActiveTrip: (t: DriverTrip | null) => void;
  finishTrip: (t: DriverTrip) => void;
};

/** Earnings from completed trips that haven't been paid out yet. */
export function availableBalance(completed: DriverTrip[], payouts: InstantPayout[]) {
  const earned = completed.reduce((sum, t) => sum + t.earnings, 0);
  const paid = payouts.reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, Math.round((earned - paid) * 100) / 100);
}

export const useDriver = create<DriverState>()(
  persist(
    (set) => ({
      online: false,
      activeTrip: null,
      position: null,
      completed: [],
      payouts: [],
      addPayout: (p) => set((s) => ({ payouts: [p, ...s.payouts] })),
      setOnline: (online) => set(online ? { online } : { online, position: null }),
      setActiveTrip: (activeTrip) => set({ activeTrip }),
      finishTrip: (trip) =>
        set((s) => ({
          activeTrip: null,
          position: trip.request.dropoff.coords,
          completed: [trip, ...s.completed.filter((t) => t.id !== trip.id)],
        })),
    }),
    {
      name: 'wiiup-driver',
      storage: persistStorage,
      partialize: ({ completed, payouts }) => ({ completed, payouts }),
    },
  ),
);
