import { useState } from 'react';

import { Avatar } from '../components/Avatar';
import { DriverCard, Icon, IconButton, Leg, ProgressBar, Sheet } from '../components/ui';
import { money, TIER_ORDER, TIERS } from '../lib/fare';
import { formatDistance, formatMinutes } from '../lib/geo';
import { PICKUP, PLACES } from '../lib/places';
import { DRIVER, useApp } from '../store';

export function Welcome() {
  const { setScreen } = useApp();
  return (
    <div className="welcome">
      <div className="blob" style={{ width: 420, height: 420, top: -120, right: -180 }} />
      <div className="blob" style={{ width: 260, height: 260, top: 160, left: -120 }} />
      <div className="logo-mark big">W</div>
      <h2 className="t-hero">
        Wii go
        <br />
        <em>where you go.</em>
      </h2>
      <p>Ride across town in minutes, or drive and earn on your own schedule. One app for both.</p>
      <button className="btn" onClick={() => setScreen('signin')}>
        Get started
      </button>
    </div>
  );
}

export function SignIn() {
  const { setScreen, setName, mode, showToast } = useApp();
  const [full, setFull] = useState('Maya Chen');
  const [code, setCode] = useState('1234');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code !== '1234') return showToast('Wrong code', 'The demo verification code is 1234.');
    setName(full.trim().split(' ')[0] || 'there');
    setScreen(mode === 'rider' ? 'home' : 'drive');
  };
  return (
    <form className="page" onSubmit={submit}>
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen('welcome')} />
      </div>
      <h2 className="t-title">Sign in</h2>
      <p className="t-body">Enter your name and phone number. We'll text you a code.</p>
      <div className="field">
        <label htmlFor="f-name">Name</label>
        <input id="f-name" value={full} onChange={(e) => setFull(e.target.value)} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="f-phone">Phone</label>
        <input id="f-phone" defaultValue="+1 (415) 555-0148" inputMode="tel" />
      </div>
      <div className="field">
        <label htmlFor="f-code">
          Verification code <span className="t-cap">· demo code is 1234</span>
        </label>
        <input id="f-code" className="code num" value={code} maxLength={4} inputMode="numeric" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div style={{ flex: 1 }} />
      <button className="btn" type="submit">
        Continue
      </button>
    </form>
  );
}

export function Home() {
  const { name, recents, chooseDest, setScreen, phase, showToast } = useApp();
  const suggestions = [...recents, ...PLACES.filter((p) => !recents.includes(p))].slice(0, 3);
  const inTrip = phase && phase !== 'done';
  return (
    <>
      <div className="topbar">
        <IconButton icon="account" size={24} label="Account" onClick={() => setScreen('profile')} />
        <button className="pill" onClick={() => showToast('Pickup point', `${PICKUP.address}, San Francisco (demo location).`)}>
          <Icon name="nav" size={14} fill style={{ color: 'var(--brand)' }} /> {PICKUP.address}
        </button>
      </div>
      <Sheet>
        {inTrip && (
          <button className="banner" onClick={() => setScreen('trip')}>
            <Icon name="car" size={18} />
            <span style={{ flex: 1 }}>Your ride is in progress</span>
            <Icon name="chev" size={18} />
          </button>
        )}
        <h2 className="t-title">Hey {name}, where to?</h2>
        <button className="search" onClick={() => setScreen('search')}>
          <Icon name="search" />
          <span className="t-head muted">Search destination</span>
        </button>
        {suggestions.map((p, i) => (
          <button key={p.id} className="sug" onClick={() => chooseDest(p)}>
            <span className="ic">
              <Icon name={i < recents.length ? 'clock' : 'pin'} size={18} />
            </span>
            <div>
              <div className="t-label">{p.name}</div>
              <div className="t-cap">{p.address}</div>
            </div>
          </button>
        ))}
      </Sheet>
    </>
  );
}

export function Search() {
  const { setScreen, chooseDest } = useApp();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = PLACES.filter((p) => !query || p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query));
  return (
    <div className="page" style={{ gap: 12 }}>
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen('home')} />
        <h2 className="t-head">Plan your ride</h2>
      </div>
      <div className="leg boxed">
        <div>
          <span className="t-cap">Pickup</span>
          <span className="t-label">Current location · {PICKUP.address}</span>
        </div>
        <div>
          <input id="q" className="bare" autoFocus placeholder="Where to?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Destination" />
        </div>
      </div>
      <span className="eyebrow">{query ? 'Results' : 'Popular nearby'}</span>
      <div className="stack">
        {list.map((p) => (
          <button key={p.id} className="sug" onClick={() => chooseDest(p)}>
            <span className="ic">
              <Icon name="pin" size={18} />
            </span>
            <div>
              <div className="t-label">{p.name}</div>
              <div className="t-cap">{p.address}</div>
            </div>
          </button>
        ))}
        {!list.length && <p className="t-body">No places match “{q}”. Try “mall” or “station”.</p>}
      </div>
    </div>
  );
}

export function Options() {
  const { dest, tripRoute, tier, setTier, confirmRide, setScreen, priceFor } = useApp();
  if (!dest) return null;
  const icons = { go: 'car', comfort: 'sport', xl: 'bus', platinum: 'star' } as const;
  return (
    <>
      <div className="topbar">
        <IconButton icon="back" label="Back" onClick={() => setScreen('search')} />
      </div>
      <Sheet>
        <div>
          <h2 className="t-title">Choose a ride</h2>
          <div className="t-cap num">
            {dest.name}
            {tripRoute ? ` · ${formatDistance(tripRoute.distance)} · about ${formatMinutes(tripRoute.duration)}` : ' · getting directions…'}
          </div>
        </div>
        <div role="radiogroup" aria-label="Ride type" className="stack" style={{ gap: 8 }}>
          {TIER_ORDER.map((t) => {
            const c = TIERS[t];
            return (
              <button key={t} className="tier" role="radio" aria-checked={t === tier} onClick={() => setTier(t)}>
                <span className="ic">
                  <Icon name={icons[t]} size={26} />
                </span>
                <div>
                  <div className="inline">
                    <span className="t-head">{c.label}</span>
                    <Icon name="person" size={12} fill style={{ color: 'var(--text2)' }} />
                    <span className="t-cap">{c.seats}</span>
                  </div>
                  <div className="t-cap num">
                    {c.eta} min away{tripRoute ? ` · ${formatMinutes(tripRoute.duration)} trip` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="t-head num">{tripRoute ? money(priceFor(t, tripRoute.distance, tripRoute.duration)) : '—'}</div>
                  {c.surge > 1 && <div className="t-cap danger">⚡ {c.surge}x busy</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="pay">
          <Icon name="card" size={18} /> Visa •••• 4242
        </div>
        <button className="btn" disabled={!tripRoute} onClick={confirmRide}>
          {tripRoute ? `Confirm ${TIERS[tier].label} · ${money(priceFor(tier, tripRoute.distance, tripRoute.duration))}` : 'Getting directions…'}
        </button>
      </Sheet>
    </>
  );
}

export function Trip() {
  const { phase, dest, tripRoute, tier, progress, cancelRide, setScreen, showToast, priceFor } = useApp();
  const [confirming, setConfirming] = useState(false);
  if (!dest || !phase) return null;
  const mins = progress ? formatMinutes(progress.remainingSec) : '';
  const copy = {
    matching: ['Finding your driver…', 'Matching you with a nearby WiiUp driver.'],
    found: ['Driver found!', `${DRIVER.name} is heading your way.`],
    enroute: [`Arriving in ${mins}`, `Meet at ${PICKUP.address}`],
    arrived: ['Your driver is here', `Look for the ${DRIVER.color} ${DRIVER.car}.`],
    ontrip: [`${mins} to destination`, `Heading to ${dest.name}`],
    done: ['You have arrived', 'Thanks for riding with WiiUp.'],
  }[phase];
  const fare = tripRoute ? priceFor(tier, tripRoute.distance, tripRoute.duration) : 0;
  return (
    <>
      <div className="topbar">
        <IconButton icon="back" label="Back to map" onClick={() => setScreen('home')} />
      </div>
      <Sheet>
        <div className="stack" style={{ gap: 4 }}>
          <div className="inline" style={{ gap: 10 }}>
            {phase === 'matching' && <span className="spin" />}
            <h2 className="t-title num">{copy[0]}</h2>
          </div>
          <p className="t-body">{copy[1]}</p>
          {progress && (phase === 'enroute' || phase === 'ontrip') && <ProgressBar value={progress.fraction} />}
          {progress && phase === 'ontrip' && progress.next && (
            <p className="t-cap">
              Next: {progress.next.instruction} in {formatDistance(progress.distanceToManeuver)}
            </p>
          )}
        </div>
        {phase !== 'matching' && (
          <>
            <DriverCard />
            <div className="acts">
              <button className="act" onClick={() => showToast('Calling driver', 'Calls are simulated in this demo.')}>
                <span><Icon name="phone" /></span>Call
              </button>
              <button className="act" onClick={() => showToast('Message driver', 'Chat is coming soon.')}>
                <span><Icon name="chat" /></span>Message
              </button>
              <button className="act" onClick={() => showToast('Trip shared', 'Trip sharing is simulated in this demo.')}>
                <span><Icon name="share" /></span>Share trip
              </button>
            </div>
          </>
        )}
        <Leg pickup={PICKUP.address} dropoff={dest.name} />
        <div className="pay spread">
          <span className="inline">
            <Icon name="card" size={18} /> {TIERS[tier].label}
          </span>
          <span className="num">{money(fare)}</span>
        </div>
        {phase === 'done' ? (
          <button className="btn" onClick={() => setScreen('rate')}>
            Rate your ride
          </button>
        ) : phase !== 'ontrip' ? (
          <button className="btn danger" onClick={() => setConfirming(true)}>
            Cancel ride
          </button>
        ) : null}
      </Sheet>
      {confirming && (
        <div className="scrim">
          <div className="dialog" role="dialog" aria-label="Cancel ride?">
            <h3 className="t-head">Cancel ride?</h3>
            <p className="t-body">Your driver is already on the way.</p>
            <div className="row2">
              <button className="btn sec" onClick={() => setConfirming(false)}>Keep ride</button>
              <button className="btn red" onClick={cancelRide}>Cancel ride</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Rate() {
  const { dest, tripRoute, tier, rating, setRating, tip, setTip, finishRide, priceFor } = useApp();
  if (!dest || !tripRoute) return null;
  const fare = priceFor(tier, tripRoute.distance, tripRoute.duration);
  return (
    <div className="page" style={{ gap: 18 }}>
      <div className="stack center" style={{ gap: 8, paddingTop: 12 }}>
        <Avatar name={DRIVER.name} size={72} />
        <h2 className="t-title" style={{ textAlign: 'center' }}>How was your ride with {DRIVER.name}?</h2>
        <span className="t-cap num">
          {TIERS[tier].label} · {formatDistance(tripRoute.distance)}
        </span>
      </div>
      <div className="stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={n === rating} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>
            <Icon name="star" size={40} fill />
          </button>
        ))}
      </div>
      <span className="t-head">Add a tip</span>
      <div className="chips">
        {[0, 1, 2, 5].map((t) => (
          <button key={t} className="chip num" aria-pressed={t === tip} onClick={() => setTip(t)}>
            {t ? `$${t}` : 'No tip'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="total">
        <div>
          <div className="t-label">Total</div>
          <div className="t-cap">Visa •••• 4242</div>
        </div>
        <span className="t-title num">{money(fare + tip)}</span>
      </div>
      <button className="btn" onClick={finishRide}>Done</button>
    </div>
  );
}

export function History() {
  const { trips, setScreen } = useApp();
  return (
    <div className="page">
      <div className="hdr">
        <IconButton icon="back" label="Back" onClick={() => setScreen('profile')} />
        <h2 className="t-title">Your trips</h2>
      </div>
      <div className="list">
        {trips.map((t, i) => (
          <div className="li" key={i}>
            <span className="ic-round"><Icon name="car" size={18} /></span>
            <div>
              <div className="t-label">{t.place}</div>
              <div className="t-cap">{t.date} · {t.tier}</div>
            </div>
            <span className="t-label num">{money(t.fare)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
