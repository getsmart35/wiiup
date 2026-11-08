import { useState } from 'react';

import { IconButton } from '../components/ui';
import { money } from '../lib/fare';
import { INSTANT_FEE_RATE, INSTANT_MINIMUM, PAYOUT_DESTINATION, payoutQuote } from '../lib/payouts';
import { useApp } from '../store';

export function InstantPayout() {
  const { setScreen, returnTo, balance, payouts, cashOut, currentPlan } = useApp();
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [today] = useState(() => new Date().toDateString());
  const paidToday = payouts.filter((p) => new Date(p.at).toDateString() === today).reduce((sum, p) => sum + p.amount, 0);
  const quote = payoutQuote(balance, currentPlan, paidToday);

  const send = async () => {
    setStep('sending');
    await cashOut(quote.amount, quote.net);
    setStep('idle');
  };

  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen(returnTo)} />
        <h2 className="t-title">Instant payout</h2>
      </div>
      <section className="payout-hero">
        <span className="t-cap">Available now</span>
        <span className="rc-big num">{money(balance)}</span>
        <span className="t-cap">Fares and tips not yet paid out. You keep 100%.</span>
      </section>
      <section className="card stack">
        <ul className="rc-lines num">
          <li><span>Send to</span><span>{PAYOUT_DESTINATION}</span></li>
          <li><span>Cash out</span><span>{money(quote.amount)}</span></li>
          <li><span>Transaction fee ({(INSTANT_FEE_RATE * 100).toFixed(1)}%, $0.50 minimum)</span><span>-{money(quote.fee)}</span></li>
          <li className="sum"><span>You receive</span><span>{money(quote.net)}</span></li>
        </ul>
        <p className="t-cap">Daily limit {money(quote.limit)}{currentPlan === 'platinum' ? ' with Platinum' : ''}. {money(paidToday)} used today.</p>
        {quote.limited && <p className="t-cap">The rest of your balance stays here until you can cash it out.</p>}
      </section>
      {step === 'idle' && <button className="btn" disabled={!quote.ok} onClick={() => setStep('confirm')}>{quote.ok ? `Cash out ${money(quote.net)}` : 'Nothing to cash out yet'}</button>}
      {step === 'confirm' && (
        <div className="row2">
          <button className="btn sec" onClick={() => setStep('idle')}>Cancel</button>
          <button className="btn" onClick={send}>Confirm {money(quote.net)}</button>
        </div>
      )}
      {step === 'sending' && <button className="btn" disabled>Sending…</button>}
      {!quote.ok && <p className="t-cap">Complete a trip to add to your balance. The minimum is {money(INSTANT_MINIMUM)}.</p>}

      <span className="eyebrow">Recent payouts</span>
      {payouts.length ? (
        <ul className="rc-lines num">
          {payouts.map((p) => <li key={p.id}><span>{new Date(p.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>{money(p.net)}</span></li>)}
        </ul>
      ) : <p className="t-cap">Your payouts will show up here.</p>}
    </div>
  );
}
