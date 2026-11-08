import { useMemo, useState } from 'react';

import { EARNINGS_LIMIT, isLadderPlan, isUpgradeOnly, ladderFee, needsApproval, PLANS, PLAN_ORDER, planCost, type PlanId } from '../../../web-prototype/src/lib/plans';
import { BarList, LineChart } from '../components/charts';
import { Avatar, Badge, Btn, Card, Dialog, Empty, Field, KV, Note, Page, Person, ReadOnlyNote, SearchBox, Select, Stars, Stat, Table, type Column } from '../components/ui';
import { CheckPanel } from './checks';
import { buckets, customerStats, driverMonth, fareNet, levelOf, okFares, perBucket, repeatRate } from '../lib/analytics';
import { ago, count, date, dateTime, DAY, downloadCsv, isEmail, maskEmail, maskPhone, money, moneyShort, pct, uid } from '../lib/format';
import { useAdmin } from '../store';
import type { City, Customer, Driver } from '../types';

const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }] as const;
const statusBadge = (s: 'active' | 'suspended') => <Badge tone={s === 'active' ? 'good' : 'bad'}>{s === 'active' ? 'Active' : 'Suspended'}</Badge>;

/* ---------- customers ---------- */

export function Customers() {
  const { db, can } = useAdmin();
  const manage = can('customers', 'manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [level, setLevel] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);

  const stats = useMemo(() => customerStats(db.txns), [db.txns]);
  const rows = db.customers.filter((c) => {
    const lv = levelOf(db.levels, c.lifetimePoints);
    const text = `${c.name} ${manage ? c.email : ''}`.toLowerCase();
    return text.includes(q.trim().toLowerCase()) && (status === 'all' || c.status === status) && (level === 'all' || lv.id === level);
  });
  const now = Date.now();
  const newCount = db.customers.filter((c) => c.joinedAt > now - 30 * DAY).length;
  const totalRides = [...stats.values()].reduce((a, s) => a + s.rides, 0);
  const sortedLevels = [...db.levels].sort((a, b) => a.minPoints - b.minPoints);

  const columns: Column<Customer>[] = [
    { key: 'name', head: 'Customer', sort: (c) => c.name, cell: (c) => <Person name={c.name} sub={manage ? c.email : maskEmail(c.email)} /> },
    { key: 'status', head: 'Status', sort: (c) => c.status, cell: (c) => statusBadge(c.status) },
    { key: 'level', head: 'Level', sort: (c) => c.lifetimePoints, cell: (c) => levelOf(db.levels, c.lifetimePoints).name },
    { key: 'rides', head: 'Rides', align: 'right', sort: (c) => stats.get(c.id)?.rides ?? 0, cell: (c) => count(stats.get(c.id)?.rides ?? 0) },
    { key: 'spend', head: 'Spend', align: 'right', sort: (c) => stats.get(c.id)?.spend ?? 0, cell: (c) => money(stats.get(c.id)?.spend ?? 0) },
    { key: 'points', head: 'Points', align: 'right', sort: (c) => c.points, cell: (c) => count(c.points) },
    { key: 'last', head: 'Last ride', sort: (c) => stats.get(c.id)?.last ?? 0, cell: (c) => { const l = stats.get(c.id)?.last; return l ? ago(l) : 'None yet'; } },
  ];

  const exportCsv = () => downloadCsv('wiiup-customers.csv', [
    ['Name', 'Email', 'City', 'Status', 'Level', 'Rides', 'Spend', 'Points'],
    ...rows.map((c) => [c.name, manage ? c.email : maskEmail(c.email), c.city, c.status, levelOf(db.levels, c.lifetimePoints).name, stats.get(c.id)?.rides ?? 0, ((stats.get(c.id)?.spend ?? 0) / 100).toFixed(2), c.points]),
  ]);
  const open = db.customers.find((c) => c.id === openId);

  return (
    <Page title="Customers" subtitle="Manage rider accounts and see how they ride." actions={
      <>
        <Btn icon="download" onClick={exportCsv}>Export CSV</Btn>
        <Btn kind="primary" icon="plus" disabled={!manage} onClick={() => setEditing('new')}>Add customer</Btn>
      </>
    }>
      <ReadOnlyNote module="customers" />
      <div className="stats">
        <Stat label="Total customers" value={count(db.customers.length)} hint={`${count(db.customers.filter((c) => c.status === 'suspended').length)} suspended`} />
        <Stat label="New in 30 days" value={count(newCount)} />
        <Stat label="Repeat riders" value={pct(repeatRate(db.customers, stats))} hint="Took 2 or more rides" />
        <Stat label="Rides per customer" value={(totalRides / Math.max(1, db.customers.length)).toFixed(1)} hint="Over the last 90 days" />
      </div>
      <div className="grid-2-1">
        <Card flush>
          <div className="filters pad">
            <SearchBox value={q} onChange={setQ} placeholder={manage ? 'Search name or email' : 'Search name'} />
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((o) => ({ ...o }))} />
            <Select label="Level" value={level} onChange={setLevel} options={[{ value: 'all', label: 'All levels' }, ...sortedLevels.map((l) => ({ value: l.id, label: l.name }))]} />
          </div>
          <Table label="Customers" columns={columns} rows={rows} rowKey={(c) => c.id} onRow={(c) => setOpenId(c.id)} empty="No customers match these filters" defaultSort={{ key: 'spend', dir: -1 }} />
        </Card>
        <Card title="Customers by level">
          <BarList format={count} items={sortedLevels.map((l) => ({ key: l.id, label: `${l.name} (${count(l.minPoints)}+ pts)`, value: db.customers.filter((c) => levelOf(db.levels, c.lifetimePoints).id === l.id).length }))} />
        </Card>
      </div>
      {open && <CustomerDrawer c={open} stats={stats} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)} />}
      {editing && <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function CustomerDrawer({ c, stats, onClose, onEdit }: { c: Customer; stats: ReturnType<typeof customerStats>; onClose: () => void; onEdit: () => void }) {
  const { db, can, act, confirm } = useAdmin();
  const manage = can('customers', 'manage');
  const sortedLevels = [...db.levels].sort((a, b) => a.minPoints - b.minPoints);
  const fares = okFares(db.txns).filter((t) => t.customerId === c.id);
  const s = stats.get(c.id) ?? { rides: 0, spend: 0, last: 0 };
  const lv = levelOf(db.levels, c.lifetimePoints);
  const nextLevel = sortedLevels.find((l) => l.minPoints > c.lifetimePoints);
  const bs = buckets(90);
  const spend = perBucket(fares.map((t) => ({ at: t.at, item: t })), bs, fareNet);
  const toggle = () => {
    const next = c.status === 'active' ? 'suspended' : 'active';
    const apply = () => act('customers', `${next === 'suspended' ? 'Suspended' : 'Reactivated'} customer ${c.name}`, (d) => ({ ...d, customers: d.customers.map((x) => (x.id === c.id ? { ...x, status: next } : x)) }));
    if (next === 'suspended') confirm({ title: `Suspend ${c.name}?`, body: 'They will not be able to request rides until reactivated.', okLabel: 'Suspend customer', danger: true, onOk: apply });
    else apply();
  };
  return (
    <Dialog kind="drawer" title={c.name} onClose={onClose} footer={
      <>
        <Btn disabled={!manage} onClick={onEdit}>Edit details</Btn>
        <Btn kind={c.status === 'active' ? 'danger' : 'primary'} disabled={!manage} onClick={toggle}>{c.status === 'active' ? 'Suspend' : 'Reactivate'}</Btn>
      </>
    }>
      <div className="row"><Avatar name={c.name} size={48} />{statusBadge(c.status)}<Badge tone="info">{lv.name}</Badge></div>
      <div className="minis">
        <Stat label="Rides" value={count(s.rides)} />
        <Stat label="Spend" value={moneyShort(s.spend)} />
        <Stat label="Avg fare" value={s.rides ? money(s.spend / s.rides) : '$0.00'} />
      </div>
      <KV items={[
        ['Email', manage ? c.email : maskEmail(c.email)], ['Phone', manage ? c.phone : maskPhone(c.phone)], ['City', c.city], ['Joined', date(c.joinedAt)],
        ['Rider rating', <Stars key="r" value={c.rating} />], ['Card', `•••• ${c.card}`], ['Wallet', money(c.wallet)],
        ['Points', `${count(c.points)} (${count(c.lifetimePoints)} lifetime)`],
        ['Next level', nextLevel ? `${nextLevel.name} in ${count(nextLevel.minPoints - c.lifetimePoints)} pts` : 'Top level reached'],
      ]} />
      <h3>Weekly spend, last 90 days</h3>
      {s.rides ? <LineChart height={160} name="Spend" format={moneyShort} points={bs.map((b, i) => ({ label: b.label, value: spend[i] }))} /> : <Empty title="No rides yet" />}
      <h3>Recent rides</h3>
      <ul className="plainlist">
        {fares.slice(0, 5).map((t) => <li key={t.id}><span>{dateTime(t.at)}</span><strong>{money(fareNet(t))}</strong></li>)}
      </ul>
    </Dialog>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { db, act } = useAdmin();
  const [f, setF] = useState({ name: customer?.name ?? '', email: customer?.email ?? '', phone: customer?.phone ?? '', city: customer?.city ?? ('San Francisco' as City) });
  const [tried, setTried] = useState(false);
  const email = f.email.trim().toLowerCase();
  const errors = {
    name: f.name.trim() ? '' : 'Enter a name',
    email: !isEmail(email) ? 'Enter a valid email' : db.customers.some((c) => c.email.toLowerCase() === email && c.id !== customer?.id) ? 'Another customer already uses this email' : '',
    phone: f.phone.replace(/\D/g, '').length >= 10 ? '' : 'Enter a 10-digit phone number',
  };
  const save = () => {
    setTried(true);
    if (errors.name || errors.email || errors.phone) return;
    const values = { name: f.name.trim(), email, phone: f.phone.trim(), city: f.city };
    if (customer) act('customers', `Updated customer ${values.name}`, (d) => ({ ...d, customers: d.customers.map((c) => (c.id === customer.id ? { ...c, ...values } : c)) }));
    else {
      const created: Customer = { id: uid('c'), ...values, status: 'active', joinedAt: Date.now(), rating: 5, card: '0000', points: 0, lifetimePoints: 0, wallet: 0 };
      act('customers', `Added customer ${values.name}`, (d) => ({ ...d, customers: [created, ...d.customers] }));
    }
    onClose();
  };
  return (
    <Dialog title={customer ? 'Edit customer' : 'Add customer'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>{customer ? 'Save changes' : 'Add customer'}</Btn></>}>
      <Field label="Full name" error={tried ? errors.name : ''}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Email" error={tried ? errors.email : ''}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone" error={tried ? errors.phone : ''}><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="City"><Select label="City" value={f.city} onChange={(city) => setF({ ...f, city })} options={[{ value: 'San Francisco', label: 'San Francisco' }, { value: 'Chicago', label: 'Chicago' }]} /></Field>
    </Dialog>
  );
}

/* ---------- drivers ---------- */

export function Drivers() {
  const { db, can, act, confirm, go } = useAdmin();
  const manage = can('drivers', 'manage');
  const seesMoney = can('payments');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [plan, setPlan] = useState<'all' | PlanId>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const month = useMemo(() => driverMonth(db), [db]);
  const fee = (d: Driver) => { const m = month.get(d.id); return Math.round(planCost(d.plan, (m?.fares ?? 0) / 100) * 100); };

  const rows = db.drivers.filter((d) => `${d.name} ${d.plate}`.toLowerCase().includes(q.trim().toLowerCase()) && (status === 'all' || d.status === status) && (plan === 'all' || d.plan === plan));
  const columns: Column<Driver>[] = [
    { key: 'name', head: 'Driver', sort: (d) => d.name, cell: (d) => <Person name={d.name} sub={`${d.car} · ${d.plate}`} /> },
    { key: 'status', head: 'Status', sort: (d) => d.status, cell: (d) => statusBadge(d.status) },
    { key: 'city', head: 'City', sort: (d) => d.city, cell: (d) => d.city },
    { key: 'plan', head: 'Plan', sort: (d) => d.plan, cell: (d) => PLANS[d.plan].name },
    { key: 'rating', head: 'Rating', align: 'right', sort: (d) => d.rating, cell: (d) => <Stars value={d.rating} /> },
    { key: 'rides', head: 'Rides this month', align: 'right', sort: (d) => month.get(d.id)?.rides ?? 0, cell: (d) => count(month.get(d.id)?.rides ?? 0) },
    ...(seesMoney ? [{ key: 'fares', head: 'Fares this month', align: 'right' as const, sort: (d: Driver) => month.get(d.id)?.fares ?? 0, cell: (d: Driver) => money(month.get(d.id)?.fares ?? 0) }] : []),
  ];
  const open = db.drivers.find((d) => d.id === openId);
  const toggle = (d: Driver) => {
    const next = d.status === 'active' ? 'suspended' : 'active';
    const apply = () => act('drivers', `${next === 'suspended' ? 'Suspended' : 'Reactivated'} driver ${d.name}`, (x) => ({ ...x, drivers: x.drivers.map((y) => (y.id === d.id ? { ...y, status: next } : y)) }));
    if (next === 'suspended') confirm({ title: `Suspend ${d.name}?`, body: 'They will go offline and stop receiving ride requests.', okLabel: 'Suspend driver', danger: true, onOk: apply });
    else apply();
  };
  const changePlan = (d: Driver, p: PlanId) => act('drivers', `Moved ${d.name} to ${PLANS[p].name}`, (x) => ({ ...x, drivers: x.drivers.map((y) => (y.id === d.id ? { ...y, plan: p } : y)) }));

  return (
    <Page title="Drivers" subtitle="Everyone approved to drive on WiiUp." actions={can('onboarding') && <Btn icon="clipboard" onClick={() => go('onboarding')}>Review applications</Btn>}>
      <ReadOnlyNote module="drivers" />
      <Card flush>
        <div className="filters pad">
          <SearchBox value={q} onChange={setQ} placeholder="Search name or plate" />
          <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((o) => ({ ...o }))} />
          <Select label="Plan" value={plan} onChange={setPlan} options={[{ value: 'all', label: 'All plans' }, ...PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].name }))]} />
        </div>
        <Table label="Drivers" columns={columns} rows={rows} rowKey={(d) => d.id} onRow={(d) => setOpenId(d.id)} empty="No drivers match these filters" defaultSort={{ key: 'rides', dir: -1 }} />
      </Card>
      {open && (() => {
        const m = month.get(open.id);
        const fx = isLadderPlan(open.plan) ? ladderFee(open.plan, (m?.fares ?? 0) / 100) : null;
        const platinumOk = db.platinumRequests.some((r) => r.driverId === open.id && r.status === 'approved');
        const planLocked = (p: PlanId) => isUpgradeOnly(p) || (needsApproval(p) && !platinumOk);
        const planNote = (p: PlanId) => (isUpgradeOnly(p) ? ' (upgrade only)' : needsApproval(p) && !platinumOk ? ' (needs approval)' : '');
        return (
          <Dialog kind="drawer" title={open.name} onClose={() => setOpenId(null)} footer={<Btn kind={open.status === 'active' ? 'danger' : 'primary'} disabled={!manage} onClick={() => toggle(open)}>{open.status === 'active' ? 'Suspend' : 'Reactivate'}</Btn>}>
            <div className="row"><Avatar name={open.name} size={48} />{statusBadge(open.status)}<Stars value={open.rating} /></div>
            <div className="minis">
              <Stat label="Rides this month" value={count(m?.rides ?? 0)} />
              {seesMoney && <Stat label="Fares" value={moneyShort(m?.fares ?? 0)} />}
              {seesMoney && <Stat label="Plan fee" value={money(fee(open))} />}
            </div>
            <KV items={[
              ['Email', manage ? open.email : maskEmail(open.email)], ['Phone', manage ? open.phone : maskPhone(open.phone)], ['City', open.city],
              ['Vehicle', `${open.car}, ${open.plate}`], ['Driving since', date(open.joinedAt)], ['Points', count(open.points)], ['Wallet', money(open.wallet)],
            ]} />
            <Field label="Subscription plan" hint={PLANS[open.plan].blurb}>
              <Select label="Plan" value={open.plan} disabled={!manage} onChange={(p) => changePlan(open, p)}
                options={PLAN_ORDER.map((p) => ({ value: p, label: `${PLANS[p].name}${planNote(p)}`, disabled: planLocked(p) }))} />
            </Field>
            {fx && seesMoney && (
              <Note>{fx.capped ? `Full fee paid. Earnings limit is ${money((EARNINGS_LIMIT[open.plan] ?? 0) * 100)}.` : `${fx.installments} installments so far. Next ${money((fx.next?.installment ?? 0) * 100)} is due when fares pass ${money((fx.next?.at ?? 0) * 100)}.`}</Note>
            )}
            {can('checks') && (
              <>
                <h3>Background check</h3>
                <CheckPanel subject="driver" subjectId={open.id} name={open.name} city={open.city} />
              </>
            )}
          </Dialog>
        );
      })()}
    </Page>
  );
}
