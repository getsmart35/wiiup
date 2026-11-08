import { useCallback, useEffect, useState } from 'react';

import { Avatar } from '../components/Avatar';
import { EtaRow, Icon, IconButton, Leg, NavBanner, ProgressBar, Sheet } from '../components/ui';
import { money, TIERS } from '../lib/fare';
import { formatDistance, formatMinutes } from '../lib/geo';
import { PICKUP } from '../lib/places';
import { EARNINGS_LIMIT, planCost, PLANS, UPGRADE } from '../lib/plans';
import { DriverMenu } from './drivermenu';
import { useApp } from '../store';

/** Shown once a driver reaches their tier's limit. They can't accept rides again until they upgrade or the period resets. */
export function LimitCard() {
  const { currentPlan, atLimit, period, buyUpgrade } = useApp();
  const [step, setStep] = useState<'idle' | 'confirm' | 'paying'>('idle');
  const option = UPGRADE[currentPlan];
  const limit = EARNINGS_LIMIT[currentPlan];
  if (!atLimit || !option || limit == null) return null;
  const pay = async () => {
    setStep('paying');
    await buyUpgrade();
    setStep('idle');
  };
  return (
    <section className="limit-card" aria-live="polite">
      <b className="t-head">You've reached your {PLANS[currentPlan].name} limit</b>
      <p className="t-cap">You earned {money(limit)} this period, so you can't accept rides until you upgrade or your plan resets on {new Date(period.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</p>
      {step === 'confirm' ? (
        <div className="row2">
          <button className="btn sec" onClick={() => setStep('idle')}>Cancel</button>
          <button className="btn" onClick={pay}>Pay {money(option.price)}</button>
        </div>
      ) : (
        <button className="btn" disabled={step === 'paying'} onClick={() => setStep('confirm')}>{step === 'paying' ? 'Paying…' : `Upgrade to ${PLANS[option.to].name} · ${money(option.price)}`}</button>
      )}
    </section>
  );
}

export function Drive() {
  const { online, offer, offerLeft, earn, toggleOnline, declineOffer, acceptOffer, setScreen, openScreen, balance, atLimit } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const C = 2 * Math.PI * 24;
  // A ride request has a 15-second window, so it takes over from the menu
  useEffect(() => {
    if (offer) setMenuOpen(false);
  }, [offer]);
  return (
    <>
      <div className="topbar">
        <IconButton icon="menu" size={24} label="Menu" onClick={() => setMenuOpen(true)} />
        <button className="pill num" aria-label="Earnings" onClick={() => setScreen('earnings')}>
          {money(earn.today)} <Icon name="chart" size={16} />
        </button>
      </div>
      {menuOpen && <DriverMenu onClose={closeMenu} />}
      <Sheet>
        {offer ? (
          <>
            <div className="offer-top">
              <svg className="ring" viewBox="0 0 56 56" aria-label={`${offerLeft} seconds to accept`}>
                <circle cx="28" cy="28" r="24" stroke="var(--surface)" />
                <circle cx="28" cy="28" r="24" stroke="var(--brand)" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - offerLeft / 15)} transform="rotate(-90 28 28)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
                <text x="28" y="33" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text)">{Math.max(0, offerLeft)}</text>
              </svg>
              <div style={{ flex: 1 }}>
                <div className="t-cap">New request · {TIERS[offer.tier].label}{offer.busy ? ' · Busy time' : ''}</div>
                <div className="inline" style={{ gap: 8 }}>
                  <span className="t-title num">{money(offer.earn)}</span>
                  <span className="badge">You keep 100%</span>
                </div>
                <div className="t-cap num">
                  3 min to pickup · {formatDistance(offer.route.distance)} · {formatMinutes(offer.route.duration)} trip
                </div>
              </div>
            </div>
            <div className="inline" style={{ gap: 10 }}>
              <Avatar name={offer.rider} size={36} />
              <span className="t-label">{offer.rider} · ★ 4.88</span>
            </div>
            <Leg pickup={PICKUP.address} dropoff={offer.place.name} />
            <div className="row2">
              <button className="btn sec" onClick={declineOffer}>Decline</button>
              <button className="btn" onClick={acceptOffer}>Accept</button>
            </div>
          </>
        ) : (
          <>
            <div className={`status-pill ${online ? 'on' : ''}`}>
              <i />
              {online ? "You're online" : "You're offline"}
            </div>
            <div className="inline" style={{ gap: 10 }}>
              {online && <span className="spin" />}
              <p className="t-body">{online ? 'Looking for ride requests near you…' : 'Go online to start receiving ride requests.'}</p>
            </div>
            <button className="payout-row" onClick={() => openScreen('payout', 'drive')}>
              <Icon name="flash" size={20} />
              <span className="payout-text"><span className="t-label">Instant payout</span><span className="t-cap num">{money(balance)} available</span></span>
              <Icon name="chev" size={18} />
            </button>
            <div className="stats">
              <div className="stat"><span className="t-cap">Today</span><b>{money(earn.today)}</b></div>
              <div className="stat"><span className="t-cap">Trips</span><b>{earn.trips}</b></div>
              <div className="stat"><span className="t-cap">Rating</span><b>{earn.rating.toFixed(2)}</b></div>
            </div>
            {atLimit ? <LimitCard /> : (
              <button className={`btn ${online ? 'sec' : ''}`} onClick={toggleOnline}>
                {online ? 'Go offline' : 'Go online'}
              </button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}

export function DriveTrip() {
  const { offer, stage, stageReady, progress, active, routing, voiceOn, setVoiceOn, overview, setOverview, advanceStage, showToast } = useApp();
  if (!offer || !stage) return null;
  const navigating = !!(active && progress && !stageReady);
  const after = active && progress ? active.steps[progress.stepIndex + 2] ?? null : null;
  const title =
    stage === 'topickup' ? (stageReady ? `You're at the pickup` : `Picking up ${offer.rider}`)
    : stage === 'waiting' ? `Waiting for ${offer.rider}`
    : stageReady ? `You've arrived at ${offer.place.name}` : `Drop off at ${offer.place.name}`;
  const button = stage === 'topickup' ? "I've arrived" : stage === 'waiting' ? 'Start trip' : 'Complete trip';
  return (
    <>
      {navigating && <NavBanner progress={progress!} after={after} />}
      {navigating && (
        <div className="navtools">
          <IconButton icon={voiceOn ? 'sound' : 'mute'} label={voiceOn ? 'Mute voice guidance' : 'Unmute voice guidance'} onClick={() => setVoiceOn(!voiceOn)} />
          <IconButton icon={overview ? 'nav' : 'route'} label={overview ? 'Resume navigation' : 'Route overview'} onClick={() => setOverview(!overview)} />
        </div>
      )}
      <Sheet>
        {navigating ? (
          <>
            <EtaRow progress={progress!} />
            <ProgressBar value={progress!.fraction} />
          </>
        ) : (
          <div>
            <h2 className="t-title">{routing ? 'Getting directions…' : title}</h2>
            {stage === 'waiting' && <p className="t-body">Let them know you're outside.</p>}
          </div>
        )}
        <div className="drv">
          <Avatar name={offer.rider} />
          <div style={{ flex: 1 }}>
            <div className="t-head">{offer.rider}</div>
            <div className="t-cap">{TIERS[offer.tier].label} · ★ 4.88 · {stage === 'ontrip' ? offer.place.name : PICKUP.address}</div>
          </div>
          <IconButton icon="phone" size={18} label="Call rider" onClick={() => showToast('Calling rider', 'Calls are simulated in this demo.')} />
        </div>
        <div className="pay spread">
          <span>Trip earnings</span>
          <span className="num">{money(offer.earn)}</span>
        </div>
        <button className={`btn ${stage === 'ontrip' && stageReady ? 'ok' : ''}`} disabled={!stageReady} onClick={advanceStage}>
          {button}
        </button>
      </Sheet>
    </>
  );
}

export function Earnings() {
  const { earn, setScreen, month, currentPlan: plan } = useApp();
  const fee = planCost(plan, month.fares);
  const max = Math.max(...earn.week);
  const days = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Today'];
  const sum = earn.week.reduce((a, b) => a + b, 0);
  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen('drive')} />
        <h2 className="t-title">Earnings</h2>
      </div>
      <div>
        <span className="eyebrow">Today</span>
        <div className="t-hero num">{money(earn.today)}</div>
        <span className="t-cap num">{earn.trips} trips · {earn.rating.toFixed(2)} rating</span>
      </div>
      <div className="card">
        <div className="spread">
          <span className="t-label">Last 7 days</span>
          <span className="t-label num">{money(sum)}</span>
        </div>
        <div className="bars" role="img" aria-label="Daily earnings for the last 7 days">
          {earn.week.map((v, i) => (
            <div key={i} className={`bar ${i === 6 ? 'today' : ''}`}>
              <i style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
              <span>{days[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <button className="plan-card" onClick={() => setScreen('ratecard')}>
        <div className="spread">
          <span className="eyebrow">This month · you keep 100%</span>
          <span className="t-label link">Rate card <Icon name="chev" size={14} /></span>
        </div>
        <div className="month-grid num">
          <span className="t-cap">Fares</span><span>{money(month.fares)}</span>
          <span className="t-cap">Tips</span><span>{money(month.tips)}</span>
          <span className="t-cap">{PLANS[plan].name}</span><span>−{money(fee)}</span>
          <b>Take-home</b><b>{money(month.fares + month.tips - fee)}</b>
        </div>
      </button>
      <span className="t-head">Recent trips</span>
      <div className="list">
        {earn.recent.map((r, i) => (
          <div className="li" key={i}>
            <Icon name="car" size={18} />
            <div>
              <div className="t-label">{r.to}</div>
              <div className="t-cap">{r.t}</div>
            </div>
            <span className="t-label num">+{money(r.amt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
