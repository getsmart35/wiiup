import { useMemo, useState } from 'react';

import { TIERS, TIER_ORDER } from '../../../web-prototype/src/lib/fare';
import { PLANS, PLAN_ORDER } from '../../../web-prototype/src/lib/plans';
import { BarList, Heatmap, LineChart, SERIES, StackedBars } from '../components/charts';
import { Badge, Card, Icon, Page, Select, Stat, type IconName } from '../components/ui';
import { atRiskCents, buckets, delta, heatmap, okFares, okSubs, perBucket, revenueByPlan, ridesByTier, summarize, fareNet } from '../lib/analytics';
import { checkState, expiresSoon, latestCheck, stageOf, waitEndsAt } from '../lib/checks';
import { ago, count, DAY, money, moneyShort, pct } from '../lib/format';
import { useAdmin } from '../store';
import type { ModuleId, Severity } from '../types';

export const SEVERITY: Record<Severity, { tone: 'bad' | 'warn' | 'info'; label: string; icon: IconName }> = {
  critical: { tone: 'bad', label: 'Critical', icon: 'alert' },
  warning: { tone: 'warn', label: 'Warning', icon: 'alert' },
  info: { tone: 'info', label: 'Info', icon: 'info' },
};

export function Overview() {
  const { db, can, go } = useAdmin();
  const now = Date.now();
  const period = useMemo(() => {
    const cur = summarize(db.txns, now - 30 * DAY, now);
    const prev = summarize(db.txns, now - 60 * DAY, now - 30 * DAY);
    const bs = buckets(30);
    const subs = okSubs(db.txns).map((t) => ({ at: t.at, item: t }));
    const rev = perBucket(subs, bs, (t) => t.amount);
    return { cur, prev, trend: bs.map((b, i) => ({ label: b.label, value: rev[i] })) };
    // now moves every render; recompute only when the data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.txns]);

  const queue: { module: ModuleId; label: string; n: number; icon: IconName }[] = [
    { module: 'onboarding', label: 'Driver applications to review', n: db.applicants.filter((a) => a.decision === 'pending' && stageOf(a, db.checks) !== 'documents').length, icon: 'clipboard' },
    { module: 'checks', label: 'Background checks needing action', n: [...db.applicants.filter((a) => a.decision === 'pending').map((a) => a.id), ...db.drivers.filter((d) => d.status === 'active').map((d) => d.id)].filter((id) => {
      const c = latestCheck(db.checks, id);
      return !!c && (checkState(c, now) === 'review' || checkState(c, now) === 'expired' || expiresSoon(c, now) || (c.status === 'pre_adverse' && waitEndsAt(c) <= now));
    }).length, icon: 'badge' },
    { module: 'onboarding', label: 'Platinum approvals', n: db.platinumRequests.filter((r) => r.status === 'pending').length, icon: 'shield' },
    { module: 'payments', label: 'Failed subscription charges', n: db.txns.filter((t) => t.kind === 'subscription' && t.status === 'failed' && t.at > now - 30 * DAY).length, icon: 'card' },
    { module: 'reviews', label: 'Flagged reviews', n: db.reviews.filter((r) => r.status === 'flagged').length, icon: 'star' },
    { module: 'chat', label: 'Unassigned chats', n: db.chats.filter((c) => c.status === 'open' && !c.assigneeId).length, icon: 'chat' },
    { module: 'tasks', label: 'Overdue tasks', n: db.tasks.filter((t) => t.status !== 'done' && t.due < now).length, icon: 'tasks' },
  ];
  const visibleQueue = queue.filter((q) => can(q.module));
  const notices = db.notices.filter((n) => can(n.module)).slice(0, 5);
  const seesMoney = can('payments');

  return (
    <Page title="Overview" subtitle="Last 30 days compared with the 30 days before.">
      <div className="stats">
        {seesMoney && <Stat label="WiiUp revenue" value={money(period.cur.revenue)} delta={delta(period.cur.revenue, period.prev.revenue)} hint="Driver subscriptions" />}
        {seesMoney && <Stat label="Fares processed" value={money(period.cur.volume)} delta={delta(period.cur.volume, period.prev.volume)} hint="Paid out to drivers, not revenue" />}
        <Stat label="Completed rides" value={count(period.cur.rides)} delta={delta(period.cur.rides, period.prev.rides)} />
        <Stat label="Active drivers" value={count(db.drivers.filter((d) => d.status === 'active').length)} hint={`${count(db.customers.filter((c) => c.status === 'active').length)} active customers`} />
      </div>
      <div className="grid-2-1">
        {seesMoney ? (
          <Card title="Daily subscription revenue" subtitle="Silver and Gold installments and Platinum prepayments.">
            <LineChart points={period.trend} format={(v) => moneyShort(v)} name="Revenue" />
          </Card>
        ) : (
          <Card title="What needs attention" subtitle="Live alerts across the modules you can open.">
            <NoticeList notices={notices} />
          </Card>
        )}
        <Card title="Action queue" subtitle="Open work across your modules.">
          <ul className="queue">
            {visibleQueue.map((q) => (
              <li key={q.label}>
                <button onClick={() => go(q.module)}>
                  <Icon name={q.icon} /><span>{q.label}</span>
                  <strong className={q.n ? 'hot' : ''}>{q.n}</strong><Icon name="chev" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {seesMoney && <Card title="Recent alerts"><NoticeList notices={notices} /></Card>}
    </Page>
  );
}

export function NoticeList({ notices }: { notices: { id: string; severity: Severity; title: string; body: string; at: number; module: ModuleId; read?: boolean }[] }) {
  const { go } = useAdmin();
  if (!notices.length) return <p className="muted">All clear. New alerts appear here as they happen.</p>;
  return (
    <ul className="notices">
      {notices.map((n) => (
        <li key={n.id} className={n.read === false ? 'unread' : ''}>
          <button onClick={() => go(n.module)}>
            <span className={`sev ${SEVERITY[n.severity].tone}`}><Icon name={SEVERITY[n.severity].icon} size={15} /></span>
            <span className="notice-text">
              <strong>{n.title}</strong>
              <span className="muted">{n.body}</span>
              <small className="muted">{SEVERITY[n.severity].label} · {ago(n.at)}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const RANGES = [{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }] as const;

export function Analytics() {
  const { db, can } = useAdmin();
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const days = Number(range);
  const seesMoney = can('payments');
  const a = useMemo(() => {
    const now = Date.now();
    const from = now - days * DAY;
    const bs = buckets(days);
    const fares = okFares(db.txns).map((t) => ({ at: t.at, item: t }));
    const subs = okSubs(db.txns).map((t) => ({ at: t.at, item: t }));
    const volume = perBucket(fares, bs, fareNet);
    const revenue = perBucket(subs, bs, (t) => t.amount);
    const cur = summarize(db.txns, from, now);
    const prev = summarize(db.txns, from - days * DAY, from);
    const tier = ridesByTier(db.txns, bs);
    const grid = heatmap(db.txns, from);
    const plan = revenueByPlan(db.txns, from);

    let peak = { d: 0, h: 0, v: 0 };
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
    const tierTotals = TIER_ORDER.map((t) => ({ t, n: tier[t].reduce((x, y) => x + y, 0) }));
    const topTier = [...tierTotals].sort((x, y) => y.n - x.n)[0];
    const topPlan = PLAN_ORDER.map((p) => ({ p, v: plan[p] })).sort((x, y) => y.v - x.v)[0];
    const rideDelta = delta(cur.rides, prev.rides);

    const insights: string[] = [];
    if (rideDelta != null) insights.push(`Rides are ${rideDelta >= 0 ? 'up' : 'down'} ${pct(Math.abs(rideDelta), 1)} from the prior ${days} days.`);
    if (peak.v) insights.push(`Busiest hour is ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][peak.d]} around ${peak.h % 12 || 12} ${peak.h < 12 ? 'AM' : 'PM'}. Schedule driver incentives ahead of it.`);
    if (cur.rides) insights.push(`${TIERS[topTier.t].label} is ${pct(topTier.n / cur.rides)} of rides.`);
    if (seesMoney && cur.revenue) insights.push(`${PLANS[topPlan.p].name} brings in ${pct(topPlan.v / cur.revenue)} of subscription revenue.`);
    if (seesMoney && atRiskCents(db.txns.filter((t) => t.at >= from))) insights.push(`${money(atRiskCents(db.txns.filter((t) => t.at >= from)))} of subscription charges failed and can be retried.`);

    return { bs, volume, revenue, cur, prev, tier, grid, plan, insights };
  }, [db, days, seesMoney]);

  return (
    <Page title="Analytics" subtitle="Trends for spotting what to change next.">
      <div className="filters">
        <Select label="Date range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      </div>
      <div className="stats">
        <Stat label="Completed rides" value={count(a.cur.rides)} delta={delta(a.cur.rides, a.prev.rides)} />
        {seesMoney && <Stat label="WiiUp revenue" value={money(a.cur.revenue)} delta={delta(a.cur.revenue, a.prev.revenue)} hint="Driver subscriptions" />}
        {seesMoney && <Stat label="Fares processed" value={money(a.cur.volume)} delta={delta(a.cur.volume, a.prev.volume)} hint="Paid out to drivers" />}
        {seesMoney && <Stat label="Refunds" value={money(a.cur.refunds)} delta={delta(a.cur.refunds, a.prev.refunds)} invert />}
      </div>
      <Card title="What the data suggests">
        <ul className="insights">{a.insights.map((t) => <li key={t}><Badge tone="good">Insight</Badge><span>{t}</span></li>)}</ul>
      </Card>
      <Card title="Rides by service" subtitle={days > 30 ? 'Per week' : 'Per day'}>
        <StackedBars unit="rides" labels={a.bs.map((b) => b.label)} series={TIER_ORDER.map((t) => ({ name: TIERS[t].label, color: SERIES[t], values: a.tier[t] }))} />
      </Card>
      {seesMoney && (
        <div className="grid-1-1">
          <Card title="Subscription revenue"><LineChart name="Revenue" points={a.bs.map((b, i) => ({ label: b.label, value: a.revenue[i] }))} format={moneyShort} /></Card>
          <Card title="Fares processed" subtitle="Drivers keep 100%, so this measures activity, not WiiUp income."><LineChart name="Fares" points={a.bs.map((b, i) => ({ label: b.label, value: a.volume[i] }))} format={moneyShort} /></Card>
        </div>
      )}
      <div className="grid-2-1">
        <Card title="When people ride" subtitle="Completed rides by weekday and hour."><Heatmap grid={a.grid} unit="rides" /></Card>
        {seesMoney && (
          <Card title="Revenue by plan">
            <BarList format={money} items={PLAN_ORDER.map((p) => ({ key: p, label: PLANS[p].name, value: a.plan[p] }))} />
          </Card>
        )}
      </div>
    </Page>
  );
}
