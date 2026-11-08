import { createHash } from 'node:crypto';

import { BID_TTL_MS, BIDDING_WINDOW_MS } from '@/lib/bids';
import { DEFAULT_PUSH, type PushTiming } from './live.ts';

// Billing periods and "today" for payout limits follow Chicago time, wherever the server runs
process.env.TZ ??= 'America/Chicago';

/** Simulation and dispatch timings (ms). The simulated parts match MOCK_TIMING in the app's mock. */
export const DEFAULT_TIMING = {
  tick: 500,
  /** How long an offer stays open for a driver. */
  offerTtl: 15000,
  /** How long a ride searches for a real driver before it is cancelled (simulation off). */
  searchTimeout: 60000,
  /** How often a searching ride looks again when no driver is free. */
  rescan: 3000,
  // Simulated drivers and riders
  matching: 3000,
  assignedPause: 1500,
  arrival: 10000,
  arrivedPause: 3000,
  trip: 15000,
  driverToPickup: 8000,
  driverTrip: 12000,
  firstRequest: 4000,
  requestMinGap: 15000,
  requestMaxGap: 30000,
  // Bidding (the window and bid lifetime come from src/lib/bids.ts)
  biddingWindow: BIDDING_WINDOW_MS,
  bidTtl: BID_TTL_MS,
  /** When simulated drivers bid on a rider's trip. */
  simBids: [1500, 3000, 4500, 7000, 10000],
  /** How long a simulated rider takes to choose after a driver bids. */
  simRiderChoice: 5000,
  /** A new simulated trip appears on each driver's bid board this often. */
  bidBoardGap: 20000,
  /** How long a decided trip stays on the board of a driver who bid on it. */
  boardKeepDecided: 30000,
};
export type Timing = typeof DEFAULT_TIMING;

export type Config = {
  port: number;
  /** SQLite file, or ':memory:'. */
  dbPath: string;
  /** Simulated drivers and riders fill in when there aren't real ones, so the app can be demoed on one phone. */
  sim: boolean;
  /** Sign-in code accepted for every phone while there is no SMS provider. Null disables sign-in. */
  demoCode: string | null;
  /** Bearer token for /v1/admin routes. Null disables them. */
  adminToken: string | null;
  /** Approves Platinum applications automatically after this many ms (demo only). Null waits for an admin. */
  platinumAutoApproveMs: number | null;
  /** How far away a driver can be offered a ride. */
  dispatchRadiusKm: number;
  timing: Timing;
  /** Push channel: heartbeats, ack timeouts, redelivery and resume windows. */
  push: PushTiming;
  /** This server's region name, used in trip version clocks (letters only, e.g. A or B). */
  region: string;
  /**
   * Keys that seal the trip backups kept on driver phones, newest first. Every region needs the same keys.
   * Null turns phone backups off.
   */
  backupKeys: { id: string; key: Buffer }[] | null;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const sim = env.WIIUP_SIM ? env.WIIUP_SIM === '1' : !production;
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.WIIUP_DB ?? 'data/wiiup.db',
    sim,
    demoCode: env.WIIUP_DEMO_CODE ?? (production ? null : '1234'),
    adminToken: env.WIIUP_ADMIN_TOKEN || null,
    platinumAutoApproveMs: env.WIIUP_PLATINUM_AUTO_APPROVE_MS ? Number(env.WIIUP_PLATINUM_AUTO_APPROVE_MS) : sim ? 5000 : null,
    dispatchRadiusKm: 8,
    timing: DEFAULT_TIMING,
    push: DEFAULT_PUSH,
    region: region(env.WIIUP_REGION ?? 'A'),
    backupKeys: env.WIIUP_BACKUP_KEYS ? backupKeys(env.WIIUP_BACKUP_KEYS) : production ? null : [DEV_BACKUP_KEY],
  };
}

/** Shared by every server in development only, so two local "regions" can read each other's backups. */
const DEV_BACKUP_KEY = { id: 'dev', key: createHash('sha256').update('wiiup-development-backup-key').digest() };

function region(name: string) {
  if (!/^[A-Za-z]{1,8}$/.test(name)) throw new Error('WIIUP_REGION must be 1-8 letters');
  return name;
}

/** `id:base64key,id:base64key`, each key 32 bytes. The first one seals new backups. */
function backupKeys(spec: string) {
  return spec.split(',').map((part) => {
    const [id, b64] = part.trim().split(':');
    const key = Buffer.from(b64 ?? '', 'base64');
    if (!/^\w{1,16}$/.test(id) || key.length !== 32) throw new Error('WIIUP_BACKUP_KEYS must look like id:<32 bytes in base64>,…');
    return { id, key };
  });
}
