import { useMemo, useState } from 'react';

import { TIERS } from '../../../web-prototype/src/lib/fare';
import { PLANS, PLAN_ORDER, planCost, type PlanId } from '../../../web-prototype/src/lib/plans';
import { Badge, Btn, Card, Dialog, Field, KV, Note, Page, Person, ReadOnlyNote, SearchBox, Select, Stat, Table, Tabs, type Column, type Tone } from '../components/ui';
import { atRiskCents, driverMonth, fareNet, payoutDue, summarize } from '../lib/analytics';
import { dateTime, DAY, downloadCsv, money, startOfMonth, toCents, uid } from '../lib/format';
import { addNotice, useAdmin } from '../store';
import type { Driver, Txn, TxnKind } from '../types';

const KIND: Record<TxnKind, string> = { fare: 'Ride fare', subscription: 'Subscription', refund: 'Refund', bonus: 'Wallet bonus', payout: 'Driver payout' };

function statusOf(t: Txn): { tone: Tone; label: string } {
  if (t.status === 'failed') return { tone: 'bad', label: 'Failed' };
  if (t.refunded && t.refunded >= t.amount + (t.tip ?? 0)) return { tone: 'neutral', label: 'Refunded' };
  if (t.refunded) return { tone: 'warn', label: 'Partly refunded' };
  return { tone: 'good', label: 'Succeeded' };
}

export function Payments() {
  const { db } = useAdmin();
  const [tab, setTab] = useState<'transactions' | 'subscriptions' | 'payouts'>('transactions');
  const now = Date.now();
  const s = useMemo(() => summarize(db.txns, startOfMonth(), now + 1), [db.txns, now]);
  const due = useMemo(() => payoutDue(db), [db]);
  const owed = [...due.values()].filter((v) => v > 0);
  const dueTotal = owed.reduce((a, b) => a + b, 0);
  const atRisk = atRiskCents(db.txns.filter((t) => t.at > now - 30 * DAY));

  return (
    <Page title="Payments" subtitle="Fares pass through to drivers. WiiUp earns from driver subscriptions.">
      <ReadOnlyNote module="payments" />
      <div className="stats">
        <Stat label="Revenue this month" value={money(s.revenue)} hint="Driver subscriptions" />
        <Stat label="Fares this month" value={money(s.volume)} hint="Owed to drivers, plus tips" />
        <Stat label="Payouts due" value={money(dueTotal)} hint={`${owed.length} drivers`} />
        <Stat label="Failed charges" value={money(atRisk)} hint="Subscriptions, last 30 days" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'transactions', label: 'Transactions' }, { value: 'subscriptions', label: 'Subscriptions' }, { value: 'payouts', label: 'Driver payouts' }]} />
      {tab === 'transactions' && <Transactions />}
      {tab === 'subscriptions' && <Subscriptions />}
      {tab === 'payouts' && <Payouts due={due} />}
    </Page>
  );
}

function Transactions() {
  const { db, can, act, confirm } = useAdmin();
  const manage = can('payments', 'manage');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | TxnKind>('all');
  const [state, setState] = useState<'all' | 'succeeded' | 'failed'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const customers = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers]);
  const drivers = useMemo(() => new Map(db.drivers.map((d) => [d.id, d])), [db.drivers]);
  const partyOf = (t: Txn) => (t.customerId ? customers.get(t.customerId)?.name : undefined) ?? (t.driverId ? drivers.get(t.driverId)?.name : undefined) ?? '—';
  const total = (t: Txn) => t.amount + (t.tip ?? 0);

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return db.txns.filter((t) => (kind === 'all' || t.kind === kind) && (state === 'all' || t.status === state) && (!text || `${t.id} ${partyOf(t)}`.toLowerCase().includes(text)));
    // partyOf reads the maps below; they change with the same data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.txns, kind, state, q, customers, drivers]);

  const columns: Column<Txn>[] = [
    { key: 'at', head: 'Date', sort: (t) => t.at, cell: (t) => dateTime(t.at) },
    { key: 'kind', head: 'Type', sort: (t) => t.kind, cell: (t) => KIND[t.kind] },
    { key: 'party', head: 'Person', sort: partyOf, cell: partyOf },
    { key: 'note', head: 'Details', cell: (t) => <span className="muted">{t.note ?? (t.tier ? TIERS[t.tier].label : '—')}</span> },
    { key: 'status', head: 'Status', sort: (t) => statusOf(t).label, cell: (t) => <Badge tone={statusOf(t).tone}>{statusOf(t).label}</Badge> },
    { key: 'amount', head: 'Amount', align: 'right', sort: total, cell: (t) => money(total(t)) },
  ];

  const open = db.txns.find((t) => t.id === openId);
  const retry = (t: Txn) => confirm({
    title: 'Retry this charge?', body: `${money(t.amount)} will be charged to ${partyOf(t)}'s card on file.`, okLabel: 'Retry charge',
    onOk: () => act('payments', `Retried failed ${KIND[t.kind].toLowerCase()} of ${money(t.amount)} for ${partyOf(t)}`, (d) => ({ ...d, txns: d.txns.map((x) => (x.id === t.id ? { ...x, status: 'succeeded', at: Date.now() } : x)) })),
  });

  return (
    <Card flush>
      <div className="filters pad">
        <SearchBox value={q} onChange={setQ} placeholder="Search person or transaction ID" />
        <Select label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All types' }, ...(Object.keys(KIND) as TxnKind[]).map((k) => ({ value: k, label: KIND[k] }))]} />
        <Select label="Status" value={state} onChange={setState} options={[{ value: 'all', label: 'All statuses' }, { value: 'succeeded', label: 'Succeeded' }, { value: 'failed', label: 'Failed' }]} />
        <Btn icon="download" onClick={() => downloadCsv('wiiup-transactions.csv', [
          ['ID', 'Date', 'Type', 'Person', 'Status', 'Fare or amount', 'Tip', 'Refunded'],
          ...rows.map((t) => [t.id, new Date(t.at).toISOString(), KIND[t.kind], partyOf(t), statusOf(t).label, (t.amount / 100).toFixed(2), ((t.tip ?? 0) / 100).toFixed(2), ((t.refunded ?? 0) / 100).toFixed(2)]),
        ])}>Export CSV</Btn>
      </div>
      <Table label="Transactions" columns={columns} rows={rows} rowKey={(t) => t.id} onRow={(t) => setOpenId(t.id)} empty="No transactions match these filters" pageSize={15} defaultSort={{ key: 'at', dir: -1 }} />
      {open && <TxnDrawer t={open} party={partyOf(open)} manage={manage} onClose={() => setOpenId(null)} onRetry={() => retry(open)} />}
    </Card>
  );
}

function TxnDrawer({ t, party, manage, onClose, onRetry }: { t: Txn; party: string; manage: boolean; onClose: () => void; onRetry: () => void }) {
  const { act } = useAdmin();
  const left = t.amount + (t.tip ?? 0) - (t.refunded ?? 0);
  const canRefund = t.kind === 'fare' && t.status === 'succeeded' && left > 0;
  const [amount, setAmount] = useState((left / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const cents = toCents(Number(amount));
  const amountError = !Number.isFinite(cents) || cents <= 0 ? 'Enter an amount above $0' : cents > left ? `You can refund up to ${money(left)}` : '';

  const refund = () => {
    if (amountError || !reason.trim()) return;
    const id = uid('tx');
    const ok = act('payments', `Refunded ${money(cents)} on ${t.id} to ${party}: ${reason.trim()}`, (d) => addNotice({
      ...d,
      txns: [{ id, kind: 'refund', at: Date.now(), amount: cents, status: 'succeeded', customerId: t.customerId, driverId: t.driverId, refundOf: t.id, note: reason.trim() }, ...d.txns.map((x) => (x.id === t.id ? { ...x, refunded: (x.refunded ?? 0) + cents } : x))],
    }, { severity: 'info', title: 'Refund issued', body: `${money(cents)} refunded to ${party}.`, module: 'payments' }));
    if (ok) {
      setReason('');
      onClose();
    }
  };

  return (
    <Dialog kind="drawer" title={KIND[t.kind]} onClose={onClose} footer={t.status === 'failed' ? <Btn kind="primary" disabled={!manage} onClick={onRetry}>Retry charge</Btn> : undefined}>
      <div className="row"><strong className="bigmoney">{money(t.amount + (t.tip ?? 0))}</strong><Badge tone={statusOf(t).tone}>{statusOf(t).label}</Badge></div>
      <KV items={[
        ['Transaction', t.id], ['Date', dateTime(t.at)], ['Person', party],
        ...(t.tip ? [['Fare', money(t.amount)], ['Tip', money(t.tip)]] as [string, string][] : []),
        ...(t.plan ? [['Plan', PLANS[t.plan].name]] as [string, string][] : []),
        ...(t.refunded ? [['Refunded', money(t.refunded)], ['Driver net', money(fareNet(t))]] as [string, string][] : []),
        ...(t.note ? [['Note', t.note]] as [string, string][] : []),
      ]} />
      {canRefund && (
        <>
          <h3>Issue a refund</h3>
          <Note tone="warn">Drivers keep 100% of fares, so a refund here lowers what this driver is owed in their next payout.</Note>
          <Field label="Amount (USD)" error={amount && amountError ? amountError : ''}>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!manage} />
          </Field>
          <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!manage} /></Field>
          <Btn kind="danger" disabled={!manage || !!amountError || !reason.trim()} onClick={refund}>Refund {amountError ? '' : money(cents)}</Btn>
        </>
      )}
    </Dialog>
  );
}

function Subscriptions() {
  const { db } = useAdmin();
  const [plan, setPlan] = useState<'all' | PlanId>('all');
  const month = useMemo(() => driverMonth(db), [db]);
  const from = startOfMonth();
  const collected = useMemo(() => {
    const out = new Map<string, number>();
    const failed = new Set<string>();
    db.txns.forEach((t) => {
      if (t.kind !== 'subscription' || !t.driverId || t.at < from) return;
      if (t.status === 'succeeded') out.set(t.driverId, (out.get(t.driverId) ?? 0) + t.amount);
      else failed.add(t.driverId);
    });
    return { out, failed };
  }, [db.txns, from]);
  const feeOf = (d: Driver) => { const m = month.get(d.id); return toCents(planCost(d.plan, (m?.fares ?? 0) / 100)); };
  const rows = db.drivers.filter((d) => plan === 'all' || d.plan === plan);
  return (
    <>
      <div className="stats">
        {PLAN_ORDER.map((p) => {
          const on = db.drivers.filter((d) => d.plan === p && d.status === 'active');
          return <Stat key={p} label={PLANS[p].name} value={`${on.length} drivers`} hint={PLANS[p].price} />;
        })}
      </div>
      <Card flush>
        <div className="filters pad">
          <Select label="Plan" value={plan} onChange={setPlan} options={[{ value: 'all', label: 'All plans' }, ...PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].name }))]} />
        </div>
        <Table label="Subscriptions" rows={rows} rowKey={(d) => d.id} defaultSort={{ key: 'fee', dir: -1 }} columns={[
          { key: 'name', head: 'Driver', sort: (d) => d.name, cell: (d) => <Person name={d.name} sub={d.city} /> },
          { key: 'plan', head: 'Plan', sort: (d) => d.plan, cell: (d) => PLANS[d.plan].name },
          { key: 'fares', head: 'Fares this month', align: 'right', sort: (d) => month.get(d.id)?.fares ?? 0, cell: (d) => money(month.get(d.id)?.fares ?? 0) },
          { key: 'fee', head: 'Fee this month', align: 'right', sort: feeOf, cell: (d) => money(feeOf(d)) },
          { key: 'paid', head: 'Collected', align: 'right', sort: (d) => collected.out.get(d.id) ?? 0, cell: (d) => money(collected.out.get(d.id) ?? 0) },
          { key: 'state', head: 'Billing', cell: (d) => (collected.failed.has(d.id) ? <Badge tone="bad">Charge failed</Badge> : <Badge tone="good">Current</Badge>) },
        ]} />
      </Card>
    </>
  );
}

function Payouts({ due }: { due: Map<string, number> }) {
  const { db, can, act, confirm } = useAdmin();
  const manage = can('payments', 'manage');
  const rows = db.drivers.filter((d) => (due.get(d.id) ?? 0) > 0);
  const recent = db.txns.filter((t) => t.kind === 'payout').slice(0, 8);
  const payOne = (d: Driver) => {
    const amount = due.get(d.id) ?? 0;
    confirm({
      title: `Pay ${d.name} ${money(amount)}?`, body: 'This covers all fares and tips since their last payout, after refunds. Their subscription is billed separately.', okLabel: 'Send payout',
      onOk: () => {
        const at = Date.now();
        const id = uid('tx');
        act('payments', `Paid out ${money(amount)} to ${d.name}`, (x) => ({
          ...x,
          txns: [{ id, kind: 'payout', at, amount, status: 'succeeded', driverId: d.id, note: 'Fares and tips' }, ...x.txns],
          drivers: x.drivers.map((y) => (y.id === d.id ? { ...y, paidThrough: at } : y)),
        }));
      },
    });
  };
  return (
    <>
      <Card flush title="Payouts due" subtitle="Fares and tips since each driver's last payout, after refunds.">
        <Table label="Payouts due" rows={rows} rowKey={(d) => d.id} empty="All drivers are paid up" defaultSort={{ key: 'due', dir: -1 }} columns={[
          { key: 'name', head: 'Driver', sort: (d) => d.name, cell: (d) => <Person name={d.name} sub={d.city} /> },
          { key: 'since', head: 'Since', sort: (d) => d.paidThrough, cell: (d) => dateTime(d.paidThrough) },
          { key: 'due', head: 'Amount due', align: 'right', sort: (d) => due.get(d.id) ?? 0, cell: (d) => money(due.get(d.id) ?? 0) },
          { key: 'act', head: '', align: 'right', cell: (d) => <Btn small disabled={!manage} onClick={() => payOne(d)}>Pay out</Btn> },
        ]} />
      </Card>
      {recent.length > 0 && (
        <Card title="Recent payouts">
          <ul className="plainlist">
            {recent.map((t) => <li key={t.id}><span>{db.drivers.find((d) => d.id === t.driverId)?.name ?? 'Driver'} · {dateTime(t.at)}</span><strong>{money(t.amount)}</strong></li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
