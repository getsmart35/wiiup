import { useMemo, useState } from 'react';

import { Badge, Btn, Card, Dialog, Icon, KV, Note, Page, Person, ReadOnlyNote, SearchBox, Stat, Table, Tabs, type Tone } from '../components/ui';
import { ADVERSE_WAIT_DAYS, CHECK_PARTS, CHECK_VALID_DAYS, checkState, createCheck, expiresSoon, latestCheck, stageOf, waitEndsAt, type CheckState } from '../lib/checks';
import { count, date, dateTime, DAY, shortDate } from '../lib/format';
import { addNotice, useAdmin } from '../store';
import type { BackgroundCheck, CheckPartResult, City, Db } from '../types';

export const CHECK_BADGE: Record<CheckState, { tone: Tone; label: string }> = {
  consent_sent: { tone: 'info', label: 'Waiting for consent' }, running: { tone: 'info', label: 'In progress' },
  clear: { tone: 'good', label: 'Clear' }, review: { tone: 'warn', label: 'Needs review' },
  pre_adverse: { tone: 'warn', label: 'Pre-adverse notice sent' }, adverse_final: { tone: 'bad', label: 'Final notice sent' },
  expired: { tone: 'bad', label: 'Expired' },
};
const PART_BADGE: Record<CheckPartResult, { tone: Tone; label: string }> = {
  pending: { tone: 'neutral', label: 'Pending' }, clear: { tone: 'good', label: 'Clear' }, consider: { tone: 'warn', label: 'Review' },
};

export function CheckBadge({ check }: { check: BackgroundCheck | undefined }) {
  if (!check) return <Badge>Not started</Badge>;
  const b = CHECK_BADGE[checkState(check)];
  return <Badge tone={b.tone}>{b.label}</Badge>;
}

function nextStep(c: BackgroundCheck | undefined) {
  if (!c) return 'Send consent request';
  const now = Date.now();
  switch (checkState(c, now)) {
    case 'consent_sent': return 'Waiting for signature';
    case 'running': return 'Provider is working';
    case 'review': return 'Review the report';
    case 'pre_adverse': return waitEndsAt(c) <= now ? 'Send final notice' : `Waiting until ${shortDate(waitEndsAt(c))}`;
    case 'expired': return 'Renew now';
    case 'adverse_final': return 'Closed';
    default: return expiresSoon(c, now) ? `Renew by ${shortDate(c.expiresAt!)}` : `Valid until ${shortDate(c.expiresAt ?? now)}`;
  }
}

const needsAction = (c: BackgroundCheck | undefined) => {
  if (!c) return true;
  const state = checkState(c);
  return state === 'review' || state === 'expired' || expiresSoon(c) || (state === 'pre_adverse' && waitEndsAt(c) <= Date.now());
};

type Subject = Pick<BackgroundCheck, 'subject' | 'subjectId' | 'name'> & { city: City };
type Row = Subject & { key: string; check: BackgroundCheck | undefined };

/** The current subjects: applicants still in the pipeline who have reached this step, and active drivers. */
function currentRows(db: Db): Row[] {
  const applicants = db.applicants
    .filter((a) => a.decision === 'pending' && (stageOf(a, db.checks) === 'background' || stageOf(a, db.checks) === 'ready' || latestCheck(db.checks, a.id)))
    .map((a): Row => ({ key: a.id, subject: 'applicant', subjectId: a.id, name: a.name, city: a.city, check: latestCheck(db.checks, a.id) }));
  const drivers = db.drivers
    .filter((d) => d.status === 'active' || latestCheck(db.checks, d.id)?.status === 'pre_adverse')
    .map((d): Row => ({ key: d.id, subject: 'driver', subjectId: d.id, name: d.name, city: d.city, check: latestCheck(db.checks, d.id) }));
  return [...applicants, ...drivers];
}

export function BackgroundChecks() {
  const { db } = useAdmin();
  const [tab, setTab] = useState<'action' | 'progress' | 'all'>('action');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Subject | null>(null);
  const rows = useMemo(() => currentRows(db), [db]);
  const now = Date.now();
  const action = rows.filter((r) => needsAction(r.check));
  const progress = rows.filter((r) => r.check?.status === 'consent_sent' || r.check?.status === 'running');
  const history = useMemo(() => db.checks.map((c): Row => ({ key: c.id, subject: c.subject, subjectId: c.subjectId, name: c.name, city: c.city, check: c })), [db.checks]);
  const shown = (tab === 'action' ? action : tab === 'progress' ? progress : history).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const current = rows.map((r) => r.check).filter((c): c is BackgroundCheck => !!c);
  const renewals = current.filter((c) => checkState(c, now) === 'expired' || expiresSoon(c, now)).length;

  return (
    <Page title="Background checks" subtitle="Consent, reports, review and renewals for applicants and drivers.">
      <ReadOnlyNote module="checks" />
      <Note>Results here are simulated. Connect a provider such as Checkr before relying on this for real decisions.</Note>
      <div className="stats">
        <Stat label="Needs action" value={count(action.length)} />
        <Stat label="In progress" value={count(progress.length)} />
        <Stat label="In waiting period" value={count(current.filter((c) => c.status === 'pre_adverse').length)} hint="After a pre-adverse notice" />
        <Stat label="Renewals due" value={count(renewals)} hint="Expired or within 30 days" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'action', label: 'Needs action', count: action.length }, { value: 'progress', label: 'In progress', count: progress.length }, { value: 'all', label: 'All checks', count: db.checks.length }]} />
      <Card flush>
        <div className="filters pad"><SearchBox value={q} onChange={setQ} placeholder="Search by name" /></div>
        <Table label="Background checks" rows={shown} rowKey={(r) => r.key} onRow={(r) => setOpen(r)} empty={tab === 'action' ? 'Nothing needs action right now' : tab === 'progress' ? 'No checks are in progress' : 'No checks match'} columns={[
          { key: 'name', head: 'Person', sort: (r) => r.name, cell: (r) => <Person name={r.name} sub={`${r.subject === 'driver' ? 'Driver' : 'Applicant'} · ${r.city}`} /> },
          { key: 'status', head: 'Status', sort: (r) => (r.check ? CHECK_BADGE[checkState(r.check)].label : ''), cell: (r) => <CheckBadge check={r.check} /> },
          { key: 'parts', head: 'Report', cell: (r) => <PartDots check={r.check} /> },
          { key: 'ordered', head: 'Requested', sort: (r) => r.check?.requestedAt ?? 0, cell: (r) => (r.check ? date(r.check.requestedAt) : '—') },
          { key: 'next', head: 'Next step', cell: (r) => nextStep(r.check) },
        ]} />
      </Card>
      {open && (
        <Dialog kind="drawer" title={open.name} onClose={() => setOpen(null)}>
          <CheckPanel subject={open.subject} subjectId={open.subjectId} name={open.name} city={open.city} />
        </Dialog>
      )}
    </Page>
  );
}

function PartDots({ check }: { check: BackgroundCheck | undefined }) {
  if (!check) return <span className="muted">—</span>;
  const done = CHECK_PARTS.filter((p) => check.parts[p.id].result !== 'pending').length;
  return (
    <span className="doc-dots" aria-label={`${done} of ${CHECK_PARTS.length} searches finished`}>
      {CHECK_PARTS.map((p) => <i key={p.id} className={{ pending: 'missing', clear: 'verified', consider: 'pending' }[check.parts[p.id].result]} />)}
    </span>
  );
}

/** The whole check workflow for one person. Used here, in the onboarding drawer and in the driver drawer. */
export function CheckPanel({ subject, subjectId, name, city, blockedReason }: Subject & { blockedReason?: string }) {
  const { db, can, act, confirm, me } = useAdmin();
  const manage = can('checks', 'manage');
  const check = latestCheck(db.checks, subjectId);
  const state = check && checkState(check);
  const myName = me?.name ?? 'Unknown';
  const now = Date.now();

  const update = (d: Db, id: string, patch: Partial<BackgroundCheck>, event: string): BackgroundCheck[] =>
    d.checks.map((c) => (c.id === id ? { ...c, ...patch, events: [...c.events, { at: Date.now(), by: myName, text: event }] } : c));

  const start = () => {
    // Drivers gave consent for recurring checks when they were first checked
    const consentOnFile = !!check?.consentAt && subject === 'driver';
    const created = createCheck({ subject, subjectId, name, city }, myName, consentOnFile);
    act('checks', `${consentOnFile ? 'Started renewal check' : 'Requested background check consent'} for ${name}`, (d) => ({ ...d, checks: [created, ...d.checks] }));
  };

  const clearAfterReview = (c: BackgroundCheck) => confirm({
    title: `Clear ${name}'s report?`, body: 'Record why these items do not disqualify this person. They can continue once this is saved.', okLabel: 'Mark as clear', reasonLabel: 'Review notes',
    onOk: (notes) => act('checks', `Cleared ${name}'s background check after review`, (d) => ({ ...d, checks: update(d, c.id, { status: 'clear', expiresAt: Date.now() + CHECK_VALID_DAYS * DAY }, `Cleared after review: ${notes}`) })),
  });

  const startAdverse = (c: BackgroundCheck) => confirm({
    title: 'Send pre-adverse notice?', body: `${name} gets a copy of the report and a summary of their rights, then has ${ADVERSE_WAIT_DAYS} days to respond before any final decision. No decision is made at this step.`, okLabel: 'Send notice', danger: true,
    reasonLabel: 'Assessment: why these items may disqualify this person',
    onOk: (notes) => act('checks', `Sent pre-adverse notice to ${name}`, (d) => ({ ...d, checks: update(d, c.id, { status: 'pre_adverse', noticeAt: Date.now() }, `Sent pre-adverse notice: ${notes}`) })),
  });

  const recordDispute = (c: BackgroundCheck) => confirm({
    title: 'Record a response from this person?', body: 'This pauses the process and returns the report to review, so you can weigh what they sent.', okLabel: 'Return to review', reasonLabel: 'What did they say or send?',
    onOk: (notes) => act('checks', `Recorded a response from ${name} on their background check`, (d) => ({ ...d, checks: update(d, c.id, { status: 'review', noticeAt: undefined }, `Response received: ${notes}`) })),
  });

  const sendFinal = (c: BackgroundCheck) => confirm({
    title: 'Send final notice?', body: subject === 'applicant'
      ? `${name}'s application is rejected and they get the final notice with the provider's details and their right to dispute.`
      : `${name} is suspended and gets the final notice with the provider's details and their right to dispute.`,
    okLabel: 'Send final notice', danger: true,
    onOk: () => {
      const at = Date.now();
      act('checks', `Sent final adverse action notice to ${name}`, (d) => addNotice({
        ...d,
        checks: update(d, c.id, { status: 'adverse_final' }, 'Sent final adverse action notice'),
        applicants: d.applicants.map((a) => (a.id === subjectId ? { ...a, decision: 'rejected', decisionNote: 'Background check: final notice sent.', decidedAt: at } : a)),
        drivers: d.drivers.map((x) => (x.id === subjectId ? { ...x, status: 'suspended' } : x)),
      }, { severity: 'info', title: 'Final notice sent', body: `The adverse action process for ${name} is complete.`, module: 'checks' }));
    },
  });

  if (!check || !state) {
    return (
      <div className="stack">
        <div className="checkrow"><CheckBadge check={undefined} /></div>
        <p className="muted">{blockedReason ?? `${name} gets a separate disclosure to read and sign. The check runs once they sign.`}</p>
        <div><Btn kind="primary" icon="send" disabled={!manage || !!blockedReason} onClick={start}>Send consent request</Btn></div>
      </div>
    );
  }

  const waitOver = state === 'pre_adverse' && waitEndsAt(check) <= now;
  const findings = CHECK_PARTS.filter((p) => check.parts[p.id].result === 'consider').length;

  return (
    <div className="stack">
      <div className="checkrow"><CheckBadge check={check} /><span className="muted">{nextStep(check)}</span></div>
      <KV items={[
        ['Requested', date(check.requestedAt)], ['Consent', check.consentAt ? `Signed ${date(check.consentAt)}` : 'Not signed yet'],
        ['Completed', check.completedAt ? date(check.completedAt) : '—'], ['Valid until', check.expiresAt ? date(check.expiresAt) : '—'],
      ]} />

      <h3>Report</h3>
      <ul className="doclist">
        {CHECK_PARTS.map((p) => {
          const part = check.parts[p.id];
          return (
            <li key={p.id}>
              <div className="doc-main"><strong>{p.label}</strong>{part.finding && <small className="muted">{part.finding}</small>}</div>
              <Badge tone={PART_BADGE[part.result].tone}>{PART_BADGE[part.result].label}</Badge>
            </li>
          );
        })}
      </ul>

      {state === 'review' && (
        <>
          <Note tone="warn">{findings === 1 ? 'One item needs' : `${findings} items need`} a person's review. Consider how serious and how recent each one is, and how it relates to driving. Fair chance laws can add steps in cities including Chicago and San Francisco.</Note>
          <div className="row wrap">
            <Btn kind="primary" disabled={!manage} onClick={() => clearAfterReview(check)}>Mark as clear</Btn>
            <Btn kind="danger" disabled={!manage} onClick={() => startAdverse(check)}>Start adverse action</Btn>
          </div>
        </>
      )}
      {state === 'pre_adverse' && (
        <>
          <Note icon="log">{waitOver ? `The ${ADVERSE_WAIT_DAYS}-day waiting period ended ${shortDate(waitEndsAt(check))}.` : `The final notice unlocks on ${date(waitEndsAt(check))}. Have counsel confirm this waiting period.`}</Note>
          <div className="row wrap">
            <Btn disabled={!manage} onClick={() => recordDispute(check)}>Record a response</Btn>
            <Btn kind="danger" disabled={!manage || !waitOver} title={waitOver ? undefined : `Available on ${date(waitEndsAt(check))}`} onClick={() => sendFinal(check)}>Send final notice</Btn>
          </div>
        </>
      )}
      {subject === 'driver' && (state === 'clear' || state === 'expired') && (
        <div><Btn kind={state === 'expired' ? 'primary' : 'ghost'} disabled={!manage} onClick={start}>Run renewal check</Btn></div>
      )}

      <h3>History</h3>
      <ul className="timeline">
        {[...check.events].reverse().map((e, i) => (
          <li key={i}><Icon name="log" size={13} /><span><strong>{e.text}</strong><small className="muted">{e.by} · {dateTime(e.at)}</small></span></li>
        ))}
      </ul>
    </div>
  );
}
