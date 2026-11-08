import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from './storage';

/**
 * Trip backups the server keeps on this phone for failover (docs/FAILOVER.md). The blobs are sealed by the
 * server, so the app can't read or change them; it only stores them and hands them back when asked.
 */
type Entry = { blob: string; at: number };

const useTripVault = create<{ entries: Record<string, Entry> }>()(
  persist(() => ({ entries: {} }), { name: 'wiiup-trip-vault', storage: persistStorage }),
);

/** The server keeps one billing period of finished trips, which stays well under this. */
const MAX_CHARS = 256 * 1024;

export const tripVault = {
  async keys() {
    // Don't answer the server before saved backups have loaded
    if (!useTripVault.persist.hasHydrated()) await useTripVault.persist.rehydrate();
    return Object.keys(useTripVault.getState().entries);
  },

  get: (key: string) => useTripVault.getState().entries[key]?.blob ?? null,

  /** Keys are write-once: a late or repeated message can't overwrite a newer backup. */
  set(key: string, blob: string) {
    const { entries } = useTripVault.getState();
    if (entries[key]) return;
    const next = { ...entries, [key]: { blob, at: Date.now() } };
    // Over the limit, the oldest backups go first
    let size = Object.values(next).reduce((n, e) => n + e.blob.length, 0);
    for (const [k, e] of Object.entries(next).sort((a, b) => a[1].at - b[1].at)) {
      if (size <= MAX_CHARS) break;
      if (k === key) continue;
      delete next[k];
      size -= e.blob.length;
    }
    useTripVault.setState({ entries: next });
  },

  delete(key: string) {
    const { [key]: _gone, ...rest } = useTripVault.getState().entries;
    useTripVault.setState({ entries: rest });
  },
};
