import { useState } from 'react';

import { Icon, IconButton } from '../components/ui';
import { money } from '../lib/fare';
import { compareMonth, EARNINGS_LIMIT, isLadderPlan, isUpgradeOnly, ladderFee, LEVELS, needsApproval, PLANS, PLATINUM_PERKS, type PlanId } from '../lib/plans';
import { LimitCard } from './driver';
import { useApp } from '../store';

const PRESETS = [
  { label: 'Part-time', fares: 1200 },
  { label: 'Full-time', fares: 2800 },
];
const whole = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function RateCard() {
  const { setScreen, returnTo, currentPlan: plan, setPlan, month, showToast, livery, applyForPlatinum } = useApp();
  const [license, setLicense] = useState('');
  const [fares, setFares] = useState(Math.round(month.fares));
  const [tips, setTips] = useState(Math.round(month.tips));

  const rows = compareMonth(fares, tips);
  const canChoose = (id: PlanId) => !isUpgradeOnly(id) && (!needsApproval(id) || livery.status === 'approved');
  const best = rows.filter((r) => !r.overLimit && (canChoose(r.id) || isUpgradeOnly(r.id))).reduce((a, b) => (b.cost < a.cost ? b : a));
  const ladderPlan = isLadderPlan(plan) ? plan : 'silver';
  const levels = LEVELS[ladderPlan];
  const ladder = ladderFee(ladderPlan, fares);
  const levelPct = ladder.next && ladder.installments > 0 ? (fares - levels[ladder.installments - 1].at) / (ladder.next.at - levels[ladder.installments - 1].at) : ladder.capped ? 1 : 0;

  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen(returnTo)} />
        <h2 className="t-title">Subscription plans</h2>
      </div>
      <LimitCard />

      <section className="keep-hero">
        <div className="keep-big">100%</div>
        <div>
          <div className="t-head">of every fare and tip is yours</div>
          <p className="t-cap">WiiUp charges drivers a subscription instead of taking a commission on each ride.</p>
        </div>
      </section>

      <section className="card stack">
        <div className="spread">
          <label className="t-label" htmlFor="calc-fares">Fares in a month</label>
          <span className="t-title num">{whole(fares)}</span>
        </div>
        <input id="calc-fares" type="range" min={0} max={8000} step={50} value={fares} onChange={(e) => setFares(+e.target.value)} />
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip sm" aria-pressed={fares === p.fares} onClick={() => setFares(p.fares)}>
              {p.label} · {whole(p.fares)}
            </button>
          ))}
          <button className="chip sm" aria-pressed={fares === Math.round(month.fares)} onClick={() => { setFares(Math.round(month.fares)); setTips(Math.round(month.tips)); }}>
            My month
          </button>
        </div>
        <div className="row2 calc-inputs">
          <div className="field">
            <label htmlFor="calc-tips">Tips</label>
            <input id="calc-tips" className="num" inputMode="numeric" value={tips} onChange={(e) => setTips(+e.target.value.replace(/\D/g, '') || 0)} />
          </div>
        </div>
      </section>

      <span className="eyebrow">Your month on each plan</span>
      <div className="stack" style={{ gap: 8 }}>
        {rows.map((r) => {
          const p = PLANS[r.id];
          const current = r.id === plan;
          return (
            <div key={r.id} className={`plan-row ${current ? 'current' : ''}`}>
              <div className="spread" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="t-head">{p.name}</span>
                    {r.id === best.id && <span className="badge">Lowest cost</span>}
                    {current && <span className="badge dark">Current</span>}
                  </div>
                  <div className="t-cap">{p.price}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div className="t-head num">{money(r.cost)}</div>
                  <div className="t-cap num">{fares > 0 ? `${(r.share * 100).toFixed(1)}% of fares` : '—'}</div>
                </div>
              </div>
              <div className="spread take">
                <span className="t-cap">You take home</span>
                <span className="t-label num">{money(r.takeHome)}</span>
              </div>
              <p className="t-cap">{p.blurb}</p>
              {r.overLimit && <p className="err">These fares are over this plan's limit.</p>}
              {r.id === 'platinum' && (
                <div className="perks">
                  <span className="t-label">Platinum includes:</span>
                  <ul>{PLATINUM_PERKS.map((perk) => <li key={perk} className="t-cap">{perk}</li>)}</ul>
                </div>
              )}
              {!current && isUpgradeOnly(r.id) && <p className="t-cap">Offered when you reach Gold's limit.</p>}
              {!current && needsApproval(r.id) && livery.status === 'pending' && <p className="t-label">License under review. An admin will approve or decline it.</p>}
              {!current && needsApproval(r.id) && (livery.status === 'none' || livery.status === 'rejected') && (
                <div className="field">
                  <label htmlFor="livery-license">Livery license number</label>
                  <input id="livery-license" value={license} onChange={(e) => setLicense(e.target.value)} />
                  <button className="btn sec slim" disabled={license.trim().length < 4} onClick={() => applyForPlatinum(license.trim())}>Apply for Platinum</button>
                </div>
              )}
              {!current && canChoose(r.id) && (
                <button className="btn sec slim" onClick={() => { setPlan(r.id); showToast('Plan updated', `You're on ${p.name} from your next billing period.`); }}>
                  Switch to {p.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section className="card stack">
        <div className="t-head">How {PLANS[ladderPlan].name} works</div>
        <p className="t-cap">
          Your fee follows the fares you earn each billing period and is charged in installments as you pass each level, not all upfront. Reaching {whole(EARNINGS_LIMIT[ladderPlan] ?? 0)} stops new ride offers until you upgrade or your plan resets.
        </p>
        <ol className="ladder num" aria-label={`${PLANS[ladderPlan].name} installment levels`}>
          {levels.map((l, k) => {
            const state = k < ladder.installments ? 'paid' : k === ladder.installments ? 'next' : '';
            return (
              <li key={k} className={state}>
                <span className="mark">{state === 'paid' ? <Icon name="check" size={12} /> : k + 1}</span>
                <span className="lv">{k === 0 ? 'First fare' : `Fares pass ${money(l.at)}`}</span>
                <span className="t-cap">+{money(l.installment)}</span>
                <b>{money(l.fee)}</b>
              </li>
            );
          })}
        </ol>
        {!ladder.capped && ladder.next && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="track"><div className="fill" style={{ width: `${Math.min(1, levelPct) * 100}%` }} /></div>
            <span className="t-cap num">
              {ladder.installments === 0 ? 'Nothing is due until your first fare.' : `${money(ladder.next.at - fares)} more in fares until the next ${money(ladder.next.installment)} installment.`}
            </span>
          </div>
        )}
        {ladder.capped && <span className="t-cap">You've paid the full {PLANS[ladderPlan].name} fee. Nothing more is due until your limit of {whole(EARNINGS_LIMIT[ladderPlan] ?? 0)}.</span>}
      </section>

      <p className="t-cap fine">
        Platinum is charged once at the start of the month. Silver and Gold installments are charged as your fares pass each level. Your plan resets each month on the date you subscribed. In this demo, Platinum approval is simulated and takes a few seconds. Fees exclude taxes.
      </p>
    </div>
  );
}
