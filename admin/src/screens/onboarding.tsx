import { useState } from 'react';

import { PLANS } from '../../../web-prototype/src/lib/plans';
import { Badge, Btn, Card, Dialog, Icon, KV, Note, Page, Person, ReadOnlyNote, Stat, Table, Tabs, type Tone } from '../components/ui';
import { ago, count, date, DAY, maskEmail, maskPhone, shortDate, uid } from '../lib/format';
import { CheckBadge, CheckPanel } from './checks';
import { latestCheck, stageOf } from '../lib/checks';
import { addNotice, useAdmin } from '../store';
import type { Applicant, DocStatus, DocType, Driver, PlatinumRequest } from '../types';

export const DOCS: { id: DocType; label: string; expires: boolean }[] = [
  { id: 'license', label: "Driver's license", expires: true },
  { id: 'registration', label: 'Vehicle registration', expires: true },
  { id: 'insurance', label: 'Proof of insurance', expires: true },
  { id: 'inspection', label: 'Vehicle inspection', expires: true },
  { id: 'photo', label: 'Profile photo', expires: false },
];

export type Stage = 'documents' | 'review' | 'background' | 'ready';
export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'documents', label: 'Waiting on applicant', hint: 'Documents missing or sent back' },
  { id: 'review', label: 'Document review', hint: 'Documents to check' },
  { id: 'background', label: 'Background check', hint: 'Order or review the check' },
  { id: 'ready', label: 'Ready to approve', hint: 'Everything has passed' },
];

const DOC_TONE: Record<DocStatus, { tone: Tone; label: string }> = {
  missing: { tone: 'neutral', label: 'Not uploaded' }, pending: { tone: 'warn', label: 'Needs review' },
  verified: { tone: 'good', label: 'Verified' }, rejected: { tone: 'bad', label: 'Sent back' },
};
export function Onboarding() {
  const { db } = useAdmin();
  const [view, setView] = useState<'board' | 'decided' | 'platinum'>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const pending = db.applicants.filter((a) => a.decision === 'pending');
  const decided = db.applicants.filter((a) => a.decision !== 'pending');
  const approved30 = decided.filter((a) => a.decision === 'approved' && (a.decidedAt ?? 0) > Date.now() - 30 * DAY).length;
  const oldest = pending.reduce((m, a) => Math.min(m, a.submittedAt), Date.now());
  const open = db.applicants.find((a) => a.id === openId);

  return (
    <Page title="Driver onboarding" subtitle="Move applicants from documents to background check to approval.">
      <ReadOnlyNote module="onboarding" />
      <div className="stats">
        <Stat label="In the pipeline" value={count(pending.length)} />
        <Stat label="Ready to approve" value={count(pending.filter((a) => stageOf(a, db.checks) === 'ready').length)} />
        <Stat label="Oldest application" value={pending.length ? ago(oldest).replace(' ago', '') : 'None'} hint="Waiting time" />
        <Stat label="Approved in 30 days" value={count(approved30)} />
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ value: 'board', label: 'Pipeline', count: pending.length }, { value: 'decided', label: 'Decided', count: decided.length }, { value: 'platinum', label: 'Platinum approvals', count: db.platinumRequests.filter((r) => r.status === 'pending').length }]} />
      {view === 'platinum' ? <PlatinumApprovals /> : view === 'board' ? (
        <div className="board">
          {STAGES.map((s) => {
            const list = pending.filter((a) => stageOf(a, db.checks) === s.id).sort((a, b) => a.submittedAt - b.submittedAt);
            return (
              <section key={s.id} className="column" aria-label={s.label}>
                <header><strong>{s.label}</strong><span className="tabcount">{list.length}</span><small>{s.hint}</small></header>
                {list.map((a) => {
                  const done = DOCS.filter((d) => a.docs[d.id].status === 'verified').length;
                  return (
                    <button key={a.id} className="appcard" onClick={() => setOpenId(a.id)}>
                      <Person name={a.name} sub={`${a.city} · ${ago(a.submittedAt)}`} />
                      <div className="doc-dots" aria-label={`${done} of ${DOCS.length} documents verified`}>
                        {DOCS.map((d) => <i key={d.id} className={a.docs[d.id].status} />)}
                        <small>{done}/{DOCS.length} docs</small>
                      </div>
                      {s.id === 'background' && <CheckBadge check={latestCheck(db.checks, a.id)} />}
                    </button>
                  );
                })}
                {!list.length && <p className="muted column-empty">No one here</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <Card flush>
          <Table label="Decided applications" rows={decided} rowKey={(a) => a.id} onRow={(a) => setOpenId(a.id)} empty="No decisions yet" columns={[
            { key: 'name', head: 'Applicant', sort: (a) => a.name, cell: (a) => <Person name={a.name} sub={a.city} /> },
            { key: 'decision', head: 'Decision', sort: (a) => a.decision, cell: (a) => <Badge tone={a.decision === 'approved' ? 'good' : 'bad'}>{a.decision === 'approved' ? 'Approved' : 'Rejected'}</Badge> },
            { key: 'note', head: 'Note', cell: (a) => a.decisionNote ?? '—' },
            { key: 'at', head: 'Decided', sort: (a) => a.decidedAt ?? 0, cell: (a) => (a.decidedAt ? shortDate(a.decidedAt) : '—') },
          ]} />
        </Card>
      )}
      {open && <ApplicantDrawer a={open} onClose={() => setOpenId(null)} />}
    </Page>
  );
}

/** Platinum is only for licensed livery drivers: an admin verifies the license before a driver can choose it. */
function PlatinumApprovals() {
  const { db, can, act, confirm, me } = useAdmin();
  const manage = can('onboarding', 'manage');
  const decide = (r: PlatinumRequest, status: 'approved' | 'rejected', note: string, who: string) =>
    act('onboarding', `${status === 'approved' ? 'Approved' : 'Declined'} Platinum for ${r.name}${note ? `: ${note}` : ''}`, (d) => addNotice({
      ...d, platinumRequests: d.platinumRequests.map((x) => (x.id === r.id ? { ...x, status, note, decidedBy: who, decidedAt: Date.now() } : x)),
    }, { severity: 'info', title: `Platinum ${status === 'approved' ? 'approved' : 'declined'}`, body: `${r.name}'s livery license was ${status === 'approved' ? 'verified' : 'not approved'}.`, module: 'onboarding' }));
  const who = me?.name ?? 'Unknown';
  return (
    <Card flush title="Platinum approvals" subtitle="Verify the livery license with the licensing authority before approving. Other plans don't need this.">
      <Table label="Platinum approvals" rows={[...db.platinumRequests].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.submittedAt - a.submittedAt)} rowKey={(r) => r.id} empty="No Platinum applications yet" columns={[
        { key: 'name', head: 'Driver', sort: (r) => r.name, cell: (r) => <Person name={r.name} sub={r.city} /> },
        { key: 'license', head: 'Livery license', sort: (r) => r.license, cell: (r) => (manage ? r.license : `••••${r.license.slice(-3)}`) },
        { key: 'at', head: 'Applied', sort: (r) => r.submittedAt, cell: (r) => ago(r.submittedAt) },
        { key: 'status', head: 'Status', sort: (r) => r.status, cell: (r) => <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}>{r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Declined' : 'Needs review'}</Badge> },
        { key: 'act', head: '', align: 'right', cell: (r) => r.status === 'pending' ? (
          <div className="row end nowrap">
            <Btn small disabled={!manage} onClick={() => confirm({ title: `Decline ${r.name}?`, body: 'They stay on their current plan and can apply again.', okLabel: 'Decline', danger: true, reasonLabel: 'Reason', onOk: (note) => decide(r, 'rejected', note, who) })}>Decline</Btn>
            <Btn small kind="primary" disabled={!manage} onClick={() => confirm({ title: `Approve ${r.name} for Platinum?`, body: `Confirm livery license ${r.license} is valid. They can then choose Platinum at $900 a month, prepaid.`, okLabel: 'Approve', onOk: () => decide(r, 'approved', 'License verified.', who) })}>Approve</Btn>
          </div>
        ) : (r.decidedBy ? <small className="muted">{r.decidedBy}</small> : null) },
      ]} />
    </Card>
  );
}

function ApplicantDrawer({ a, onClose }: { a: Applicant; onClose: () => void }) {
  const { db, act, can, confirm } = useAdmin();
  const manage = can('onboarding', 'manage');
  const stage = stageOf(a, db.checks);
  const check = latestCheck(db.checks, a.id);
  const inNoticePeriod = check?.status === 'pre_adverse';
  const decided = a.decision !== 'pending';
  const update = (d: { applicants: Applicant[] }, patch: Partial<Applicant>) => d.applicants.map((x) => (x.id === a.id ? { ...x, ...patch } : x));

  const setDoc = (doc: DocType, status: DocStatus, note?: string) =>
    act('onboarding', `${status === 'verified' ? 'Verified' : 'Sent back'} ${DOCS.find((d) => d.id === doc)!.label.toLowerCase()} for ${a.name}`, (d) => ({
      ...d, applicants: update(d, { docs: { ...a.docs, [doc]: { ...a.docs[doc], status, note } } }),
    }));

  const approve = () => {
    const driver: Driver = {
      id: uid('d'), name: a.name, email: a.email, phone: a.phone, city: a.city, status: 'active', joinedAt: Date.now(), rating: 5,
      card: '0000', plan: a.plan, car: a.car, plate: a.plate, points: 0, wallet: 0, paidThrough: Date.now(),
    };
    confirm({
      title: `Approve ${a.name}?`, body: `They become an active driver on ${PLANS[a.plan].name} and can go online right away.`, okLabel: 'Approve driver',
      onOk: () => {
        act('onboarding', `Approved driver ${a.name}`, (d) => addNotice({ ...d, checks: d.checks.map((c) => (c.subjectId === a.id ? { ...c, subject: 'driver', subjectId: driver.id } : c)), drivers: [driver, ...d.drivers], applicants: update(d, { decision: 'approved', decidedAt: Date.now(), decisionNote: 'All checks passed.' }) }, {
          severity: 'info', title: 'New driver approved', body: `${a.name} can now go online.`, module: 'drivers',
        }));
        onClose();
      },
    });
  };

  const reject = () => confirm({
    title: `Reject ${a.name}?`, body: check?.status === 'review'
      ? 'If this is because of the background check, use Start adverse action instead, so they get the required notices first.'
      : 'The applicant will be told their application was not approved.',
    okLabel: 'Reject application', danger: true, reasonLabel: 'Reason (kept in the audit trail)',
    onOk: (reason) => {
      act('onboarding', `Rejected driver application from ${a.name}: ${reason}`, (d) => ({ ...d, applicants: update(d, { decision: 'rejected', decisionNote: reason, decidedAt: Date.now() }) }));
      onClose();
    },
  });

  return (
    <Dialog kind="drawer" title={a.name} onClose={onClose} footer={!decided ? (
      <>
        <Btn kind="danger" disabled={!manage || inNoticePeriod} title={inNoticePeriod ? 'The adverse action process must finish first' : undefined} onClick={reject}>Reject</Btn>
        <Btn kind="primary" disabled={!manage || stage !== 'ready'} onClick={approve} title={stage === 'ready' ? undefined : 'All documents and the background check must pass first'}>Approve driver</Btn>
      </>
    ) : undefined}>
      <KV items={[
        ['Email', manage ? a.email : maskEmail(a.email)], ['Phone', manage ? a.phone : maskPhone(a.phone)], ['City', a.city],
        ['Vehicle', `${a.car}, ${a.plate}`], ['Chosen plan', PLANS[a.plan].name], ['Applied', date(a.submittedAt)],
      ]} />
      {decided && <Note>{a.decision === 'approved' ? 'Approved' : 'Rejected'}{a.decidedAt ? ` on ${date(a.decidedAt)}` : ''}. {a.decisionNote}</Note>}

      <h3>Documents</h3>
      <ul className="doclist">
        {DOCS.map((doc) => {
          const v = a.docs[doc.id];
          const expired = v.expires != null && v.expires < Date.now();
          return (
            <li key={doc.id}>
              <div className="doc-main">
                <strong>{doc.label}</strong>
                <small className={expired ? 'danger-text' : 'muted'}>
                  {v.expires ? `${expired ? 'Expired' : 'Expires'} ${date(v.expires)}` : doc.expires ? 'No date on file' : 'No expiry'}
                </small>
                {v.note && <small className="danger-text">{v.note}</small>}
              </div>
              <Badge tone={DOC_TONE[v.status].tone}>{DOC_TONE[v.status].label}</Badge>
              {!decided && v.status !== 'missing' && (
                <div className="row">
                  {v.status !== 'verified' && <Btn small disabled={!manage || expired} title={expired ? 'An expired document cannot be verified' : undefined} onClick={() => setDoc(doc.id, 'verified')}>Verify</Btn>}
                  {v.status !== 'rejected' && (
                    <Btn small disabled={!manage} onClick={() => confirm({
                      title: `Send back ${doc.label.toLowerCase()}?`, body: 'The applicant will be asked to upload it again.', okLabel: 'Send back', reasonLabel: 'What needs fixing?',
                      onOk: (reason) => setDoc(doc.id, 'rejected', reason),
                    })}>Send back</Btn>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small"><Icon name="info" size={13} /> Document images will appear here once file storage is connected.</p>

      <h3>Background check</h3>
      {can('checks') ? (
        <CheckPanel subject="applicant" subjectId={a.id} name={a.name} city={a.city} blockedReason={check || stage === 'background' ? undefined : 'Verify all documents first. The consent request can be sent after that.'} />
      ) : (
        <>
          <div className="checkrow"><CheckBadge check={check} /></div>
          <p className="muted small">Compliance handles reports. You can approve once this shows Clear.</p>
        </>
      )}
    </Dialog>
  );
}
