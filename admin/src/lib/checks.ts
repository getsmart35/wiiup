import type { Applicant, BackgroundCheck, CheckPartId, Db, Notice } from '../types';
import { DAY, uid } from './format';

export const CHECK_PARTS: { id: CheckPartId; label: string; finding: string }[] = [
  { id: 'identity', label: 'Identity and address history', finding: 'Address history does not match the application.' },
  { id: 'criminal', label: 'National and county criminal search', finding: 'County court returned a record that needs review.' },
  { id: 'offender', label: 'Sex offender registry', finding: 'Possible name match that needs review.' },
  { id: 'watchlist', label: 'Global watchlist', finding: 'Possible name match that needs review.' },
  { id: 'driving', label: 'Motor vehicle record', finding: 'Driving record shows a recent major violation.' },
];

export const CHECK_VALID_DAYS = 365;
export const RENEW_WINDOW_DAYS = 30;
/** Default gap between the pre-adverse and final notices. Have counsel confirm it for each market. */
export const ADVERSE_WAIT_DAYS = 7;

const CONSENT_SIGN_MS = 4000;
const PART_MS = 1500;

export type CheckState = BackgroundCheck['status'] | 'expired';
export function checkState(c: BackgroundCheck, now = Date.now()): CheckState {
  return c.status === 'clear' && c.expiresAt != null && c.expiresAt < now ? 'expired' : c.status;
}

export function latestCheck(checks: BackgroundCheck[], subjectId: string) {
  let best: BackgroundCheck | undefined;
  for (const c of checks) if (c.subjectId === subjectId && (!best || c.requestedAt > best.requestedAt)) best = c;
  return best;
}

export const expiresSoon = (c: BackgroundCheck, now = Date.now()) =>
  c.status === 'clear' && c.expiresAt != null && c.expiresAt >= now && c.expiresAt - now <= RENEW_WINDOW_DAYS * DAY;

export const waitEndsAt = (c: BackgroundCheck) => (c.noticeAt ?? 0) + ADVERSE_WAIT_DAYS * DAY;

/** An applicant reaches approval only when every document is verified and their latest check is clear. */
export function stageOf(a: Applicant, checks: BackgroundCheck[]): 'documents' | 'review' | 'background' | 'ready' {
  const docs = Object.values(a.docs).map((d) => d.status);
  if (docs.some((s) => s === 'missing' || s === 'rejected')) return 'documents';
  if (docs.some((s) => s === 'pending')) return 'review';
  const check = latestCheck(checks, a.id);
  return check && checkState(check) === 'clear' ? 'ready' : 'background';
}

export function createCheck(input: Pick<BackgroundCheck, 'subject' | 'subjectId' | 'name' | 'city'>, by: string, consentOnFile: boolean, now = Date.now()): BackgroundCheck {
  const pending = { result: 'pending' as const };
  return {
    id: uid('bg'), ...input, orderedBy: by, requestedAt: now,
    status: consentOnFile ? 'running' : 'consent_sent',
    ...(consentOnFile ? { consentAt: now, startedAt: now } : {}),
    parts: { identity: pending, criminal: pending, offender: pending, watchlist: pending, driving: pending },
    events: [{ at: now, by, text: consentOnFile ? 'Started renewal check using the consent on file' : 'Sent the disclosure and consent request' }],
  };
}

/** Simulated provider results, stable for a given check so re-renders can't change the outcome. */
function simulatedFinding(checkId: string, part: CheckPartId) {
  const hash = [...`${checkId}${part}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return hash % 100 < 6;
}

/** Stand-in for the provider's webhooks: moves consent and in-progress checks forward by elapsed time. */
export function advanceChecks(db: Db, now: number): Db {
  const notices: Notice[] = [];
  let changed = false;
  const checks = db.checks.map((c) => {
    if (c.status === 'consent_sent' && now - c.requestedAt >= CONSENT_SIGN_MS) {
      changed = true;
      return { ...c, status: 'running' as const, consentAt: now, startedAt: now, events: [...c.events, { at: now, by: c.name, text: 'Signed the disclosure and consent' }, { at: now, by: 'System', text: 'Started the check' }] };
    }
    if (c.status !== 'running' || c.startedAt == null) return c;
    const parts = { ...c.parts };
    CHECK_PARTS.forEach((p, i) => {
      if (parts[p.id].result === 'pending' && now - c.startedAt! >= (i + 1) * PART_MS) {
        changed = true;
        parts[p.id] = simulatedFinding(c.id, p.id) ? { result: 'consider', finding: p.finding } : { result: 'clear' };
      }
    });
    const results = Object.values(parts).map((p) => p.result);
    if (results.includes('pending')) return { ...c, parts };
    const needsReview = results.includes('consider');
    notices.push({
      id: uid('n'), at: now, read: false, module: 'checks', severity: needsReview ? 'warning' : 'info',
      title: needsReview ? 'Background check needs review' : 'Background check is clear',
      body: needsReview ? `${c.name}'s report has items for Compliance to review.` : `${c.name}'s report came back with nothing to review.`,
    });
    return {
      ...c, parts, status: needsReview ? ('review' as const) : ('clear' as const), completedAt: now,
      ...(needsReview ? {} : { expiresAt: now + CHECK_VALID_DAYS * DAY }),
      events: [...c.events, { at: now, by: 'System', text: needsReview ? 'Report completed with items to review' : 'Report completed with nothing to review' }],
    };
  });
  return changed ? { ...db, checks, notices: [...notices, ...db.notices].slice(0, 100) } : db;
}
