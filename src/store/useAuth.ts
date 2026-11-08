import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from './storage';

export type Role = 'rider' | 'driver';
/** `token` is the server session; it is absent when the app runs on the mock. */
export type User = { name: string; phone: string; token?: string };

type AuthState = {
  user: User | null;
  role: Role;
  hydrated: boolean;
  signIn: (user: User) => void;
  signOut: () => void;
  setRole: (role: Role) => void;
  setName: (name: string) => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: 'rider',
      hydrated: false,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null, role: 'rider' }),
      setRole: (role) => set({ role }),
      setName: (name) => set((s) => (s.user ? { user: { ...s.user, name } } : s)),
    }),
    {
      name: 'wiiup-auth',
      storage: persistStorage,
      partialize: ({ user, role }) => ({ user, role }),
      onRehydrateStorage: () => () => useAuth.setState({ hydrated: true }),
    },
  ),
);
