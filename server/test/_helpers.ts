import { createHttpService, type HttpDeps } from '@/api/http';
import type { Place, RideRequest } from '@/api/types';
import { defaultCards, type RateCards } from '@/lib/rates';
import { createApp } from '../src/app.ts';
import { DEFAULT_TIMING, loadConfig, type Config } from '../src/config.ts';
import { DEFAULT_PUSH } from '../src/live.ts';

// Chicago Theatre → Navy Pier
export const THEATRE: Place = { id: 'p1', name: 'Chicago Theatre', address: '175 N State St', coords: { latitude: 41.8854, longitude: -87.6274 } };
export const PIER: Place = { id: 'p2', name: 'Navy Pier', address: '600 E Grand Ave', coords: { latitude: 41.8917, longitude: -87.6086 } };

export const FAST = { ...DEFAULT_TIMING, tick: 20, offerTtl: 400, searchTimeout: 600, rescan: 100, matching: 50, assignedPause: 30, arrival: 150, arrivedPause: 30, trip: 150, driverToPickup: 150, driverTrip: 150, firstRequest: 50, requestMinGap: 100, requestMaxGap: 150, simBids: [50, 100, 150, 200], simRiderChoice: 100, bidTtl: 3000, biddingWindow: 4000, bidBoardGap: 100000, boardKeepDecided: 1000 };

export const FAST_PUSH = { ...DEFAULT_PUSH, heartbeatMs: 100, ackTimeoutMs: 150, sessionIdleMs: 5000, reconnectJitterMs: 50 };

export type Server = Awaited<ReturnType<typeof start>>;

export async function start(overrides: Partial<Config> = {}) {
  const config: Config = { ...loadConfig({}), dbPath: ':memory:', adminToken: 'admin-secret-token', platinumAutoApproveMs: null, push: FAST_PUSH, ...overrides, timing: FAST };
  const app = createApp(config);
  const port = await app.listen(0);
  return { app, url: `http://localhost:${port}` };
}

/** A signed-in app client, built exactly as the Expo app builds it. */
export async function client(url: string, name: string, phone: string, cards: RateCards = defaultCards()) {
  const session = { token: undefined as string | undefined, cards, plan: 'silver' as const, signedOut: false };
  const vault = memoryVault();
  const deps: HttpDeps = {
    getToken: () => session.token,
    onUnauthorized: () => (session.signedOut = true),
    getDriverSettings: () => ({ cards: session.cards, plan: session.plan, subscribedAt: Date.now() - 864e5 }),
    getLocation: () => THEATRE.coords,
    vault,
  };
  const api = createHttpService(url, deps);
  const { demoCode } = await api.startSignIn(phone);
  session.token = (await api.verifySignIn({ name, phone, code: demoCode! })).token!;
  return { api, session, vault };
}

/** The phone's backup store, in memory. Write-once like the app's. */
export function memoryVault() {
  const m = new Map<string, string>();
  return {
    map: m,
    keys: () => [...m.keys()],
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, b: string) => void (m.has(k) || m.set(k, b)),
    delete: (k: string) => void m.delete(k),
  };
}

export const until = <T,>(label: string, check: () => T | undefined, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const v = check();
      if (v !== undefined && v !== false) (clearInterval(iv), resolve(v));
      else if (Date.now() - started > ms) (clearInterval(iv), reject(new Error(`Timed out waiting for ${label}`)));
    }, 10);
  });

export async function admin(url: string, method: string, path: string, body?: unknown) {
  const res = await fetch(url + path, { method, headers: { Authorization: 'Bearer admin-secret-token', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

/** Completes `count` simulated-rider trips for a driver and returns their total earnings. */
export async function driveSimTrips(api: Awaited<ReturnType<typeof client>>['api'], count: number) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    let offer: RideRequest | undefined;
    const stop = api.subscribeRequests(() => THEATRE.coords, (r) => (offer = r));
    await until('a simulated request', () => offer);
    // Accept before going offline, as the app does: going offline withdraws open offers
    const trip = await api.acceptRequest(offer!, THEATRE.coords, offer!.quote.fare);
    stop();
    for (const action of ['arrived', 'start', 'complete'] as const) await api.updateDriverTrip(trip.id, action);
    total += trip.earnings;
  }
  return Math.round(total * 100) / 100;
}

