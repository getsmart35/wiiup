import { EditableAvatar } from '../components/Avatar';
import { Icon, IconButton, type IconName } from '../components/ui';
import { money } from '../lib/fare';
import { isLadderPlan, ladderFee, LEVELS, PLANS } from '../lib/plans';
import { MY_CAR, useApp } from '../store';

function Row({ icon, label, sub, onClick }: { icon: IconName; label: string; sub?: string; onClick: () => void }) {
  return (
    <button className="li" onClick={onClick}>
      <Icon name={icon} />
      <div>
        <div className="t-label">{label}</div>
        {sub && <div className="t-cap">{sub}</div>}
      </div>
      <Icon name="chev" size={18} />
    </button>
  );
}

export function Profile() {
  const app = useApp();
  const { mode, setScreen, openScreen, switchMode, showToast, name, photo, setPhoto, trips, currentPlan: plan, month } = app;
  const driver = mode === 'driver';
  const ladder = isLadderPlan(plan) ? ladderFee(plan, month.fares) : null;

  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen(driver ? 'drive' : 'home')} />
      </div>

      <section className="profile-hero">
        <EditableAvatar
          name={name}
          photo={photo}
          onChange={(v) => {
            setPhoto(v);
            showToast('Profile photo updated', driver ? 'Riders see this photo when you accept their request.' : 'Drivers see this photo at pickup.');
          }}
        />
        <div className="stack center" style={{ gap: 4 }}>
          <h2 className="t-title">{name}</h2>
          <span className={`role ${driver ? 'driver' : ''}`}>{driver ? `Driver · ${PLANS[plan].name}` : 'Rider'}</span>
        </div>
        <div className="hero-stats num">
          {driver ? (
            <>
              <div><b>4.96</b><span>Rating</span></div>
              <div><b>{month.lifetimeTrips.toLocaleString()}</b><span>Trips</span></div>
              <div><b>100%</b><span>Fares kept</span></div>
            </>
          ) : (
            <>
              <div><b>4.95</b><span>Rating</span></div>
              <div><b>{trips.length + 38}</b><span>Trips</span></div>
              <div><b>2025</b><span>Member since</span></div>
            </>
          )}
        </div>
        {!photo && (
          <p className="t-cap" style={{ textAlign: 'center' }}>
            {driver ? 'Add a clear photo of your face. Riders use it to find you at pickup.' : 'Add a photo so your driver can spot you at pickup.'}
          </p>
        )}
      </section>

      {driver && (
        <>
          <button className="plan-card" onClick={() => openScreen('ratecard', 'profile')}>
            <div className="spread">
              <span className="eyebrow">Your plan</span>
              <span className="t-label link">Compare plans <Icon name="chev" size={14} /></span>
            </div>
            <div className="t-head">{PLANS[plan].name}</div>
            {ladder && isLadderPlan(plan) ? (
              <>
                <div className="t-cap num">
                  {money(ladder.fee)} paid this month in {ladder.installments} installments ·{' '}
                  {ladder.next ? `next $50 when fares pass ${money(ladder.next.at)}` : 'capped, nothing more due'}
                </div>
                <div className="track"><div className="fill" style={{ width: `${(ladder.installments / LEVELS[plan].length) * 100}%` }} /></div>
              </>
            ) : (
              <div className="t-cap">{PLANS[plan].price}</div>
            )}
            <div className="t-cap">You keep 100% of every fare and tip.</div>
          </button>
          <div className="list">
            <div className="li">
              <Icon name="car" />
              <div>
                <div className="t-label">{MY_CAR.color} {MY_CAR.car}</div>
                <div className="t-cap">{MY_CAR.since}</div>
              </div>
              <span className="plate">{MY_CAR.plate}</span>
            </div>
            <Row icon="tag" label="My rate card" sub="Set your rates for each ride type" onClick={() => openScreen('rates', 'profile')} />
            <Row icon="calc" label="Rate calculator" sub="See what a trip and a month pay" onClick={() => openScreen('ratecalc', 'profile')} />
            <Row icon="flash" label="Instant payout" sub="Cash out your balance now" onClick={() => openScreen('payout', 'profile')} />
            <Row icon="chart" label="Earnings" sub={`${money(month.fares)} in fares this month`} onClick={() => setScreen('earnings')} />
            <Row icon="shield" label="Documents" sub="License, insurance and inspection are up to date" onClick={() => showToast('Documents', 'Document upload is coming soon.')} />
          </div>
        </>
      )}

      {!driver && (
        <div className="list">
          <Row icon="pin" label="Saved places" sub="Home · Work" onClick={() => showToast('Saved places', 'Saved places are coming soon.')} />
          <Row icon="clock" label="Your trips" sub={`${trips.length} recent rides`} onClick={() => setScreen('history')} />
          <Row icon="card" label="Payment" sub="Visa •••• 4242" onClick={() => showToast('Payment', 'Payments are simulated in this MVP.')} />
        </div>
      )}

      <span className="eyebrow">Mode</span>
      <div className="list">
        <button className="li" onClick={() => switchMode(driver ? 'rider' : 'driver')}>
          <Icon name="steer" />
          <div>
            <div className="t-label">Drive</div>
            <div className="t-cap">{driver ? 'You are in Drive mode' : 'Switch to accept ride requests'}</div>
          </div>
          <span className={`sw ${driver ? 'on' : ''}`} />
        </button>
      </div>

      <div className="list">
        <Row icon="shield" label="Safety" onClick={() => showToast('Safety', 'Emergency assistance and trip sharing are coming soon.')} />
        <Row icon="help" label="Help" onClick={() => showToast('Help', 'Support chat is coming soon.')} />
      </div>
      <button className="btn danger" onClick={() => setScreen('welcome')}>Sign out</button>
      <span className="t-cap" style={{ textAlign: 'center' }}>WiiUp web prototype · MapLibre + Directions</span>
    </div>
  );
}
