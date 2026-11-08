import { useState } from 'react';

import { Icon, IconButton } from '../components/ui';
import { money, TIER_ORDER, TIERS, type Tier } from '../lib/fare';
import { limitReached, PLANS, planCost } from '../lib/plans';
import { cents, RATE_FIELDS, ratesInUse, suggestedRates, tripFare, type RateField, type RateCards as Cards } from '../lib/rates';
import { useApp } from '../store';

const TRIPS = [
  { label: 'Short', miles: 3, minutes: 12 },
  { label: 'Typical', miles: 8, minutes: 22 },
  { label: 'Airport', miles: 18, minutes: 35 },
];
const shortName = (t: Tier) => TIERS[t].label.replace('WiiUp ', '');

function TierTabs({ tier, onChange }: { tier: Tier; onChange: (t: Tier) => void }) {
  return (
    <div className="rc-tabs" role="tablist" aria-label="Ride type">
      {TIER_ORDER.map((t) => (
        <button key={t} role="tab" aria-selected={t === tier} onClick={() => onChange(t)}>{shortName(t)}</button>
      ))}
    </div>
  );
}

export function RateCards() {
  const { setScreen, openScreen, returnTo, rateCards, saveRateCard, showToast } = useApp();
  const [tier, setTier] = useState<Tier>('go');
  const [drafts, setDrafts] = useState<Cards>(rateCards);
  const draft = drafts[tier];
  const saved = rateCards[tier];
  const suggested = suggestedRates(tier);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  const nudge = (id: RateField, step: number, min: number, max: number) =>
    setDrafts((d) => ({ ...d, [tier]: { ...d[tier], custom: { ...d[tier].custom, [id]: Math.min(max, Math.max(min, cents(d[tier].custom[id] + step))) } } }));
  const setUseSuggested = (useSuggested: boolean) => setDrafts((d) => ({ ...d, [tier]: { ...d[tier], useSuggested } }));

  const submit = () => {
    saveRateCard(tier, draft);
    showToast('Rate card updated', `Your ${TIERS[tier].label} rates apply to your next ride offer.`);
  };

  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen(returnTo)} />
        <h2 className="t-title">My rate card</h2>
      </div>
      <TierTabs tier={tier} onChange={setTier} />
      <p className="rc-status" aria-live="polite">
        <i className={saved.useSuggested ? '' : 'custom'} />
        {TIERS[tier].label} is using {saved.useSuggested ? 'suggested' : 'your custom'} rates. You keep 100%.
      </p>

      <section aria-label={`${TIERS[tier].label} rates`}>
        <div className="rc-row rc-head">
          <span className="eyebrow">Suggested</span>
          <span className="eyebrow">Custom</span>
          <span />
        </div>
        {RATE_FIELDS.map((f) => {
          const value = draft.custom[f.id];
          return (
            <div className="rc-row" key={f.id}>
              <div>
                <div className="t-cap">{f.label}</div>
                <b className="num">{money(suggested[f.id])}</b>
              </div>
              <b className={`num ${draft.useSuggested ? 'rc-off' : ''}`} data-field={f.id}>{money(draft.useSuggested ? suggested[f.id] : value)}</b>
              <div className="stepper">
                <button aria-label={`Lower ${f.label.toLowerCase()}`} disabled={draft.useSuggested || value <= f.min} onClick={() => nudge(f.id, -f.step, f.min, f.max)}>−</button>
                <button aria-label={`Raise ${f.label.toLowerCase()}`} disabled={draft.useSuggested || value >= f.max} onClick={() => nudge(f.id, f.step, f.min, f.max)}>+</button>
              </div>
            </div>
          );
        })}
      </section>

      <button className="rc-toggle" role="switch" aria-checked={draft.useSuggested} onClick={() => setUseSuggested(!draft.useSuggested)}>
        <span className="t-label">Use suggested rate card</span>
        <span className={`sw ${draft.useSuggested ? 'on' : ''}`} />
      </button>
      {draft.useSuggested && <p className="t-cap">Turn this off to set your own rates with the − and + buttons.</p>}
      <p className="t-cap">Surge is a flat amount added to each trip at busy times. A trip never costs less than your minimum fare.</p>

      <button className="btn" disabled={!changed} onClick={submit}>Submit</button>
      <button className="rc-link t-label link" onClick={() => openScreen('ratecalc', 'rates')}>See what this pays in the calculator <Icon name="chev" size={14} /></button>
    </div>
  );
}

export function RateCalculator() {
  const { setScreen, openScreen, rateReturn, rateCards, currentPlan: plan, month } = useApp();
  const [tier, setTier] = useState<Tier>('go');
  const [miles, setMiles] = useState(8);
  const [minutes, setMinutes] = useState(22);
  const [busy, setBusy] = useState(false);
  const [perDay, setPerDay] = useState(12);
  const [days, setDays] = useState(month.days);

  const rates = ratesInUse(rateCards, tier);
  const result = tripFare(rates, miles, minutes, busy);
  const suggestedFare = tripFare(suggestedRates(tier), miles, minutes, busy).fare;
  const diff = cents(result.fare - suggestedFare);
  const monthFares = cents(result.fare * perDay * days);
  const fee = planCost(plan, monthFares);

  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen(rateReturn)} />
        <h2 className="t-title">Rate calculator</h2>
      </div>
      <TierTabs tier={tier} onChange={setTier} />
      <section className="card stack">
        <div className="chips" role="group" aria-label="Example trips">
          {TRIPS.map((t) => (
            <button key={t.label} className="chip sm" aria-pressed={miles === t.miles && minutes === t.minutes} onClick={() => { setMiles(t.miles); setMinutes(t.minutes); }}>{t.label}</button>
          ))}
        </div>
        <div className="spread"><label className="t-label" htmlFor="rc-miles">Distance</label><span className="t-label num">{miles} mi</span></div>
        <input id="rc-miles" type="range" min={1} max={50} value={miles} onChange={(e) => setMiles(+e.target.value)} />
        <div className="spread"><label className="t-label" htmlFor="rc-mins">Time</label><span className="t-label num">{minutes} min</span></div>
        <input id="rc-mins" type="range" min={1} max={120} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
        <button className="rc-toggle" role="switch" aria-checked={busy} onClick={() => setBusy(!busy)}>
          <span className="t-label">Busy time (adds surge)</span>
          <span className={`sw ${busy ? 'on' : ''}`} />
        </button>

        <div className="rc-result" aria-live="polite">
          <span className="t-cap">{rateCards[tier].useSuggested ? 'Suggested rates' : 'Your custom rates'} · you earn</span>
          <span className="rc-big num">{money(result.fare)}</span>
          <span className="t-cap num">{diff === 0 ? 'Same as suggested rates' : `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than suggested (${money(suggestedFare)})`}</span>
        </div>
        <ul className="rc-lines num">
          <li><span>Base fare</span><span>{money(result.base)}</span></li>
          <li><span>{miles} mi × {money(rates.perMile)}</span><span>{money(result.distance)}</span></li>
          <li><span>{minutes} min × {money(rates.perMin)}</span><span>{money(result.time)}</span></li>
          {result.minimumApplied && <li><span>Raised to your minimum fare</span><span>{money(rates.minimum)}</span></li>}
          {busy && <li><span>Surge</span><span>{money(result.surge)}</span></li>}
          <li className="sum"><span>Fare</span><span>{money(result.fare)}</span></li>
        </ul>
        <button className="rc-link t-label link" onClick={() => openScreen('rates', 'ratecalc')}>Change my rates <Icon name="chev" size={14} /></button>
      </section>

      <span className="eyebrow">If every trip were like this</span>
      <section className="card stack">
        <div className="spread"><label className="t-label" htmlFor="rc-perday">Trips a day</label><span className="t-label num">{perDay}</span></div>
        <input id="rc-perday" type="range" min={1} max={30} value={perDay} onChange={(e) => setPerDay(+e.target.value)} />
        <div className="spread"><label className="t-label" htmlFor="rc-days">Days a month</label><span className="t-label num">{days}</span></div>
        <input id="rc-days" type="range" min={1} max={31} value={days} onChange={(e) => setDays(+e.target.value)} />
        <ul className="rc-lines num">
          <li><span>Fares in a month</span><span>{money(monthFares)}</span></li>
          <li><span>{PLANS[plan].name} fee</span><span>-{money(fee)}</span></li>
          <li className="sum"><span>You take home, before tips and costs</span><span>{money(monthFares - fee)}</span></li>
        </ul>
        {limitReached(plan, monthFares) && <p className="err">These fares reach your {PLANS[plan].name} limit, so you'd need to upgrade to keep accepting rides.</p>}
      </section>
      <p className="t-cap fine">Estimates only. Gas, insurance, taxes and vehicle costs aren't included.</p>
    </div>
  );
}
