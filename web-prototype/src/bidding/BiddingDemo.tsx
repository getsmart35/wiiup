import { useEffect, useRef, useState } from 'react';

import { Avatar } from '../components/Avatar';
import { Icon, Leg } from '../components/ui';
import { BID_RANGE, BID_STEP, bidLimits, clampBid, MAX_BIDDERS, visibleBids } from '../lib/bids';
import { money, quoteFare, TIER_ORDER, TIERS, type Tier } from '../lib/fare';
import { cents, defaultCards, fareFor, RATE_FIELDS, suggestedRates, type RateCards, type RateField } from '../lib/rates';

/**
 * Trip bidding, both sides at once: the rider (left) asks for bids and accepts or declines up to three fares; the
 * driver (right) bids from their rate card. Everything runs in the page: other drivers and riders are simulated.
 */

type BidStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'lost';
type DemoBid = { id: string; name: string; rating: number; car: string; plate: string; etaMin: number; fare: number; placedAt: number; status: BidStatus; mine: boolean };
type BoardTrip = {
  id: string; riderName: string; riderRating: number; pickup: string; dropoff: string; tier: Tier; meters: number; seconds: number;
  standard: number; closesAt: number; myBid?: { fare: number; status: BidStatus }; mine?: boolean;
  /** Bids other (simulated) drivers already placed on a simulated rider's trip. */
  others?: number;
};
type RiderPhase = 'options' | 'bidding' | 'booked' | 'cancelled';

const ME = { name: 'Marcus', rating: 4.97, car: 'Toyota Camry', plate: 'WU 4821', etaMin: 4 };
// Chicago Theatre → Navy Pier
const AVA = { pickup: 'Chicago Theatre, 175 N State St', dropoff: 'Navy Pier, 600 E Grand Ave', meters: 3400, seconds: 660 };
/** Other drivers who bid on Ava's trip: when, and how far from the standard price. */
const RIVALS = [
  { at: 1500, x: 1.06, name: 'Luis', rating: 4.91, car: 'Honda Accord', plate: 'WU 1177', etaMin: 6 },
  { at: 3200, x: 0.96, name: 'Aisha', rating: 4.98, car: 'Tesla Model 3', plate: 'WU 3090', etaMin: 3 },
  { at: 6500, x: 1.14, name: 'Kenji', rating: 4.87, car: 'Hyundai Ioniq 5', plate: 'WU 5512', etaMin: 8 },
  { at: 11000, x: 0.92, name: 'Sofia', rating: 4.95, car: 'Kia Telluride', plate: 'WU 2264', etaMin: 7 },
  { at: 17000, x: 1.02, name: 'Dev', rating: 4.9, car: 'Toyota Sienna', plate: 'WU 6408', etaMin: 5 },
];
const WINDOW_MS = 3 * 60 * 1000;
const OTHER_TRIPS: Omit<BoardTrip, 'standard' | 'closesAt'>[] = [
  { id: 'jordan', riderName: 'Jordan', riderRating: 4.88, pickup: 'Union Station', dropoff: 'Wrigley Field', tier: 'comfort', meters: 9800, seconds: 1440, others: 4 },
  { id: 'priya', riderName: 'Priya', riderRating: 4.96, pickup: 'Millennium Park', dropoff: 'Museum of Science and Industry', tier: 'go', meters: 13200, seconds: 1320, others: MAX_BIDDERS },
];

let seq = 0;
const uid = () => `b${++seq}`;
const shortTier = (t: Tier) => TIERS[t].label.replace('WiiUp ', '');
const miles = (m: number) => (m / 1609.344).toFixed(1);
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function freshBoard(): BoardTrip[] {
  const now = Date.now();
  return OTHER_TRIPS.map((t, i) => ({ ...t, standard: quoteFare(t.tier, t.meters, t.seconds), closesAt: now + WINDOW_MS - i * 40000 }));
}

export function BiddingDemo() {
  const [run, setRun] = useState(0);
  return <Demo key={run} onReset={() => setRun((r) => r + 1)} />;
}

function Demo({ onReset }: { onReset: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ---------- shared market ----------
  const [phase, setPhase] = useState<RiderPhase>('options');
  const [tier, setTier] = useState<Tier>('go');
  const [bids, setBids] = useState<DemoBid[]>([]);
  const [closesAt, setClosesAt] = useState(0);
  const [booked, setBooked] = useState<DemoBid | null>(null);
  const [board, setBoard] = useState<BoardTrip[]>(freshBoard);
  const [cards, setCards] = useState<RateCards>(defaultCards);
  const [driverTrip, setDriverTrip] = useState<{ riderName: string; pickup: string; dropoff: string; fare: number } | null>(null);
  const [earned, setEarned] = useState(0);
  const [tab, setTab] = useState<'rates' | 'bids'>('bids');
  // Rival bids on Ava's trip stop when she chooses; simulated riders' choices run on their own
  const rivals = useRef<ReturnType<typeof setTimeout>[]>([]);
  const others = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => [...rivals.current, ...others.current].forEach(clearTimeout), []);
  const later = (list: typeof rivals, fn: () => void, ms: number) => list.current.push(setTimeout(fn, ms));

  const standard = (t: Tier) => quoteFare(t, AVA.meters, AVA.seconds);
  const cardFare = (t: BoardTrip) => (cards[t.tier].useSuggested ? t.standard : fareFor(cards[t.tier].custom, t.meters, t.seconds).fare);
  const setMyBid = (id: string, myBid: BoardTrip['myBid']) => setBoard((b) => b.map((t) => (t.id === id ? { ...t, myBid } : t)));

  // Rider asks for bids: the trip appears on the driver's board and other drivers start bidding
  const askForBids = () => {
    const quote = standard(tier);
    const closes = Date.now() + WINDOW_MS;
    setPhase('bidding');
    setClosesAt(closes);
    setBoard((b) => [{ id: 'ava', riderName: 'Ava', riderRating: 4.93, pickup: 'Chicago Theatre', dropoff: 'Navy Pier', tier, meters: AVA.meters, seconds: AVA.seconds, standard: quote, closesAt: closes, mine: true }, ...b]);
    setTab('bids');
    for (const r of RIVALS) {
      later(rivals, () => {
        setBids((all) => all.length >= MAX_BIDDERS ? all : [...all, { id: uid(), name: r.name, rating: r.rating, car: r.car, plate: r.plate, etaMin: r.etaMin, fare: clampBid(quote * r.x, bidLimits(quote)), placedAt: Date.now(), status: 'pending', mine: false }]);
      }, r.at);
    }
  };

  const bookStandard = () => {
    const rival = RIVALS[1];
    setBooked({ id: uid(), name: rival.name, rating: rival.rating, car: rival.car, plate: rival.plate, etaMin: rival.etaMin, fare: standard(tier), placedAt: Date.now(), status: 'accepted', mine: false });
    setPhase('booked');
  };

  const accept = (bid: DemoBid) => {
    rivals.current.forEach(clearTimeout);
    setBids((all) => all.map((b) => (b.id === bid.id ? { ...b, status: 'accepted' } : b.status === 'pending' ? { ...b, status: 'lost' } : b)));
    setBooked(bid);
    setPhase('booked');
    const mine = bids.find((b) => b.mine);
    if (mine) setMyBid('ava', { fare: mine.fare, status: bid.mine ? 'accepted' : 'lost' });
    if (bid.mine) setDriverTrip({ riderName: 'Ava', pickup: 'Chicago Theatre', dropoff: 'Navy Pier', fare: bid.fare });
  };

  const decline = (bid: DemoBid) => {
    setBids((all) => all.map((b) => (b.id === bid.id ? { ...b, status: 'declined' } : b)));
    if (bid.mine) setMyBid('ava', { fare: bid.fare, status: 'declined' });
  };

  const cancelRide = () => {
    rivals.current.forEach(clearTimeout);
    setPhase('cancelled');
    setBids((all) => all.map((b) => (b.status === 'pending' ? { ...b, status: 'lost' } : b)));
    setBoard((b) => b.map((t) => (t.id === 'ava' ? { ...t, closesAt: Date.now(), myBid: t.myBid && { ...t.myBid, status: 'lost' } } : t)));
  };

  // Driver bids. On Ava's trip the bid goes to the rider's phone; other riders are simulated
  const placeBid = (trip: BoardTrip, fare: number) => {
    setMyBid(trip.id, { fare, status: 'pending' });
    if (trip.mine) {
      setBids((all) => [...all, { id: uid(), ...ME, fare, placedAt: Date.now(), status: 'pending', mine: true }]);
      return;
    }
    later(others, () => {
      const card = cardFare(trip);
      const others = [0.92, 1.04].map((x) => clampBid(card * x, bidLimits(card)));
      const won = fare <= Math.min(...others);
      setMyBid(trip.id, { fare, status: won ? 'accepted' : 'lost' });
      if (won) setDriverTrip((cur) => cur ?? { riderName: trip.riderName, pickup: trip.pickup, dropoff: trip.dropoff, fare });
    }, 3500);
  };

  const finishTrip = () => {
    setEarned((e) => cents(e + (driverTrip?.fare ?? 0)));
    setDriverTrip(null);
  };

  const shown = visibleBids(bids);
  const avaOnBoard = board.find((t) => t.mine);

  return (
    <div className="bd-page">
      <header className="bd-head">
        <div className="logo">
          <div className="logo-mark">W</div>
          <span className="eyebrow">WiiUp prototype · Trip bidding</span>
        </div>
        <h1>Drivers set their fare. Riders pick one.</h1>
        <p>
          Tap <b>Get bids from drivers</b> on the rider&apos;s phone. Bid on Ava&apos;s trip from the driver&apos;s rate card on the right, then accept or
          decline fares on the left. Other drivers and riders are simulated.
        </p>
        <button className="btn sec slim bd-reset" onClick={onReset}>Start over</button>
      </header>

      <div className="bd-phones">
        <section aria-label="Rider phone">
          <span className="eyebrow bd-label">Rider · Ava</span>
          <div className="phone bd-phone">
            <div className="screen bd-rider">
              <div className="island" />
              <MiniMap booked={phase === 'booked'} />
              <div className="sheet bd-sheet">
                <div className="grab" />
                {phase === 'options' && (
                  <RiderOptions tier={tier} setTier={setTier} standard={standard} onConfirm={bookStandard} onBids={askForBids} />
                )}
                {phase === 'bidding' && (
                  <>
                    <div>
                      <h2 className="t-head">Drivers are bidding</h2>
                      <p className="t-cap num">
                        Standard {TIERS[tier].label} price {money(standard(tier))} · bids close in {clock(Math.max(0, closesAt - now))}
                      </p>
                    </div>
                    {shown.length === 0 ? (
                      <div className="bd-wait"><span className="spin" /> Waiting for drivers to bid…</div>
                    ) : (
                      <ul className="bd-bids" aria-live="polite">
                        {shown.map((b, i) => (
                          <BidCard key={b.id} bid={b} lowest={i === 0} standard={standard(tier)} onAccept={() => accept(b)} onDecline={() => decline(b)} />
                        ))}
                      </ul>
                    )}
                    <p className="t-cap">You&apos;ll see the three lowest bids. Decline one to see the next.</p>
                    <button className="btn danger" onClick={cancelRide}>Cancel request</button>
                  </>
                )}
                {phase === 'booked' && booked && (
                  <>
                    <h2 className="t-head">{booked.name} is on the way</h2>
                    <div className="drv">
                      <Avatar name={booked.name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{booked.name}</b>
                        <div className="t-cap inline"><Icon name="star" size={12} fill /> {booked.rating.toFixed(2)} · {booked.car} · {booked.etaMin} min</div>
                      </div>
                      <span className="plate">{booked.plate}</span>
                    </div>
                    <Leg pickup={AVA.pickup} dropoff={AVA.dropoff} />
                    <div className="total"><span className="t-label">You pay</span><b className="t-head num">{money(booked.fare)}</b></div>
                    <p className="t-cap">{booked.name} keeps 100% of this fare.</p>
                  </>
                )}
                {phase === 'cancelled' && (
                  <>
                    <h2 className="t-head">Request cancelled</h2>
                    <button className="btn" onClick={onReset}>Start over</button>
                  </>
                )}
              </div>
              <div className="home-ind" />
            </div>
          </div>
        </section>

        <section aria-label="Driver phone">
          <span className="eyebrow bd-label">Driver · Marcus</span>
          <div className="phone bd-phone">
            <div className="screen">
              <div className="island" />
              {driverTrip ? (
                <DriverTrip trip={driverTrip} onDone={finishTrip} />
              ) : (
                <div className="page">
                  <div className="spread">
                    <h2 className="t-title">My rate card</h2>
                    <span className="pill bd-pill num">Today {money(earned)}</span>
                  </div>
                  <div className="seg bd-seg" role="tablist" aria-label="Rate card">
                    <button role="tab" aria-pressed={tab === 'rates'} aria-selected={tab === 'rates'} onClick={() => setTab('rates')}>Rates</button>
                    <button role="tab" aria-pressed={tab === 'bids'} aria-selected={tab === 'bids'} onClick={() => setTab('bids')}>
                      Bid on trips {avaOnBoard && !avaOnBoard.myBid && <i className="bd-dot" aria-label="new trip" />}
                    </button>
                  </div>
                  {tab === 'rates' ? (
                    <RatesTab cards={cards} onSave={setCards} />
                  ) : (
                    <BidBoard
                      trips={board}
                      now={now}
                      cardFare={cardFare}
                      bidCount={(t) => (t.mine ? bids.length : (t.others ?? 0) + (t.myBid ? 1 : 0))}
                      onBid={placeBid}
                      onRates={() => setTab('rates')}
                    />
                  )}
                </div>
              )}
              <div className="home-ind" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- rider ----------

function RiderOptions({ tier, setTier, standard, onConfirm, onBids }: { tier: Tier; setTier: (t: Tier) => void; standard: (t: Tier) => number; onConfirm: () => void; onBids: () => void }) {
  return (
    <>
      <h2 className="t-head" style={{ textAlign: 'center' }}>Choose a ride</h2>
      <div className="stack" role="radiogroup" aria-label="Ride type">
        {TIER_ORDER.map((t) => (
          <button key={t} className="tier" role="radio" aria-checked={t === tier} onClick={() => setTier(t)}>
            <span className="ic"><Icon name={t === 'xl' ? 'bus' : t === 'platinum' ? 'sport' : 'car'} size={24} /></span>
            <div>
              <div className="t-label">{TIERS[t].label}</div>
              <div className="t-cap">{TIERS[t].seats} seats · {TIERS[t].eta} min away</div>
            </div>
            <b className="num">{money(standard(t))}</b>
          </button>
        ))}
      </div>
      <button className="btn" onClick={onConfirm}>Confirm {TIERS[tier].label} · {money(standard(tier))}</button>
      <button className="btn sec" onClick={onBids}><Icon name="tag" size={18} /> Get bids from drivers</button>
    </>
  );
}

function BidCard({ bid, lowest, standard, onAccept, onDecline }: { bid: DemoBid; lowest: boolean; standard: number; onAccept: () => void; onDecline: () => void }) {
  const diff = cents(bid.fare - standard);
  return (
    <li className={`bd-bid ${lowest ? 'low' : ''} ${bid.mine ? 'mine' : ''}`}>
      <div className="bd-bid-top">
        <Avatar name={bid.name} />
        <div style={{ minWidth: 0 }}>
          <div className="inline"><b>{bid.name}</b>{lowest && <span className="badge">Lowest</span>}</div>
          <div className="t-cap inline"><Icon name="star" size={12} fill /> {bid.rating.toFixed(2)} · {bid.car}</div>
          <div className="t-cap">{bid.etaMin} min away</div>
        </div>
        <div className="bd-fare">
          <b className="num">{money(bid.fare)}</b>
          <span className={`t-cap num ${diff < 0 ? 'bd-under' : ''}`}>{diff === 0 ? 'Standard' : `${money(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'}`}</span>
        </div>
      </div>
      <div className="row2">
        <button className="btn sec slim" onClick={onDecline} aria-label={`Decline ${bid.name}'s bid of ${money(bid.fare)}`}>Decline</button>
        <button className="btn slim" onClick={onAccept} aria-label={`Accept ${bid.name}'s bid of ${money(bid.fare)}`}>Accept</button>
      </div>
    </li>
  );
}

/** A simple drawn map of the Loop and Streeterville (Chicago Theatre → Navy Pier). */
function MiniMap({ booked }: { booked: boolean }) {
  return (
    <svg className="bd-map" viewBox="0 0 390 340" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="390" height="340" className="bd-land" />
      <path d="M300 0 L390 0 L390 340 L322 340 L318 210 L330 120 Z" className="bd-lake" />
      <path d="M0 150 C80 146 150 156 220 150 L318 150" className="bd-river" />
      {[40, 90, 140, 190, 240, 290].map((x) => <path key={`v${x}`} d={`M${x} 0 V340`} className="bd-street" />)}
      {[40, 100, 200, 250, 300].map((y) => <path key={`h${y}`} d={`M0 ${y} H312`} className="bd-street" />)}
      <path d="M140 210 V180 H230 V120 H318" className="bd-route" />
      <circle cx="140" cy="210" r="9" className="bd-pin-a" />
      <rect x="310" y="112" width="16" height="16" rx="3" className="bd-pin-b" />
      {booked && <circle cx="100" cy="250" r="8" className="bd-car" />}
      <text x="150" y="226" className="bd-maptext">Chicago Theatre</text>
      <text x="256" y="108" className="bd-maptext">Navy Pier</text>
    </svg>
  );
}

// ---------- driver ----------

function RatesTab({ cards, onSave }: { cards: RateCards; onSave: (c: RateCards) => void }) {
  const [tier, setTier] = useState<Tier>('go');
  const [drafts, setDrafts] = useState(cards);
  const draft = drafts[tier];
  const suggested = suggestedRates(tier);
  const changed = JSON.stringify(drafts) !== JSON.stringify(cards);
  const nudge = (id: RateField, step: number, min: number, max: number) =>
    setDrafts((d) => ({ ...d, [tier]: { ...d[tier], custom: { ...d[tier].custom, [id]: Math.min(max, Math.max(min, cents(d[tier].custom[id] + step))) } } }));
  return (
    <>
      <div className="rc-tabs" role="tablist" aria-label="Ride type">
        {TIER_ORDER.map((t) => <button key={t} role="tab" aria-selected={t === tier} onClick={() => setTier(t)}>{shortTier(t)}</button>)}
      </div>
      <section aria-label={`${TIERS[tier].label} rates`}>
        <div className="rc-row rc-head"><span className="eyebrow">Suggested</span><span className="eyebrow">Custom</span><span /></div>
        {RATE_FIELDS.map((f) => {
          const value = draft.custom[f.id];
          return (
            <div className="rc-row" key={f.id}>
              <div><div className="t-cap">{f.label}</div><b className="num">{money(suggested[f.id])}</b></div>
              <b className={`num ${draft.useSuggested ? 'rc-off' : ''}`}>{money(draft.useSuggested ? suggested[f.id] : value)}</b>
              <div className="stepper">
                <button aria-label={`Lower ${f.label.toLowerCase()}`} disabled={draft.useSuggested || value <= f.min} onClick={() => nudge(f.id, -f.step, f.min, f.max)}>−</button>
                <button aria-label={`Raise ${f.label.toLowerCase()}`} disabled={draft.useSuggested || value >= f.max} onClick={() => nudge(f.id, f.step, f.min, f.max)}>+</button>
              </div>
            </div>
          );
        })}
      </section>
      <button className="rc-toggle" role="switch" aria-checked={draft.useSuggested} onClick={() => setDrafts((d) => ({ ...d, [tier]: { ...d[tier], useSuggested: !d[tier].useSuggested } }))}>
        <span className="t-label">Use suggested rate card</span>
        <span className={`sw ${draft.useSuggested ? 'on' : ''}`} />
      </button>
      <p className="t-cap">Your rate card sets where each bid starts. Turn off suggested rates to use your own.</p>
      <button className="btn" disabled={!changed} onClick={() => onSave(drafts)}>Submit</button>
    </>
  );
}

function BidBoard({ trips, now, cardFare, bidCount, onBid, onRates }: {
  trips: BoardTrip[];
  now: number;
  cardFare: (t: BoardTrip) => number;
  bidCount: (t: BoardTrip) => number;
  onBid: (t: BoardTrip, fare: number) => void;
  onRates: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const visible = trips.filter((t) => t.closesAt > now || t.myBid);
  return (
    <>
      <div className="limit-card">
        <b>Set your own fare</b>
        <span className="t-cap">
          Each bid starts at your rate card price. Bid {Math.round(BID_RANGE.min * 100)}%–{Math.round(BID_RANGE.max * 100)}% of it in {money(BID_STEP)} steps. Up to {MAX_BIDDERS} drivers can bid on a trip, and riders see the three lowest. You keep 100%.
        </span>
        <button className="rc-link t-label link" onClick={onRates}>Change my rates <Icon name="chev" size={14} /></button>
      </div>
      {visible.length === 0 && <p className="t-cap" style={{ textAlign: 'center' }}>No trips are taking bids nearby.</p>}
      {visible.map((t) => {
        const card = cardFare(t);
        const limits = bidLimits(card);
        const fare = clampBid(drafts[t.id] ?? card, limits);
        const diff = cents(fare - card);
        const count = Math.min(MAX_BIDDERS, bidCount(t));
        const full = count >= MAX_BIDDERS;
        return (
          <article key={t.id} className={`card stack bd-trip ${t.mine && !t.myBid ? 'new' : ''}`} aria-label={`${t.riderName}'s trip`}>
            <div className="spread">
              <span className="inline t-label">{TIERS[t.tier].label}{t.mine && !t.myBid && <span className="badge">New</span>}</span>
              <span className="t-cap num">{miles(t.meters)} mi · {Math.round(t.seconds / 60)} min</span>
            </div>
            <Leg pickup={t.pickup} dropoff={t.dropoff} />
            <div className="spread t-cap">
              <span className="inline"><Icon name="person" size={14} /> {t.riderName} · {t.riderRating.toFixed(2)}★</span>
              {!t.myBid && <span className={`num ${full ? 'bd-full' : ''}`}>{full ? 'Bidding full' : `${count} of ${MAX_BIDDERS} bids · ${clock(Math.max(0, t.closesAt - now))}`}</span>}
            </div>
            {t.myBid ? (
              <MyBidStatus trip={t} />
            ) : (
              <>
                <div className="bd-bidrow">
                  <div>
                    <div className="t-cap num">Your bid · rate card {money(card)}</div>
                    <b className="bd-big num">{money(fare)}</b>
                    <div className={`t-cap num ${diff !== 0 ? 'bd-under' : ''}`}>{diff === 0 ? 'Your rate card price' : `${money(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your rate card`}</div>
                  </div>
                  <div className="stepper">
                    <button aria-label="Lower bid" disabled={fare <= limits.min} onClick={() => setDrafts((d) => ({ ...d, [t.id]: clampBid(fare - BID_STEP, limits) }))}>−</button>
                    <button aria-label="Raise bid" disabled={fare >= limits.max} onClick={() => setDrafts((d) => ({ ...d, [t.id]: clampBid(fare + BID_STEP, limits) }))}>+</button>
                  </div>
                </div>
                <button className="btn slim" disabled={t.closesAt <= now || full} onClick={() => onBid(t, fare)}>
                  {full ? `${MAX_BIDDERS} drivers have bid` : `Bid ${money(fare)}`}
                </button>
              </>
            )}
          </article>
        );
      })}
    </>
  );
}

function MyBidStatus({ trip }: { trip: BoardTrip }) {
  const { fare, status } = trip.myBid!;
  const text = {
    pending: `Bid of ${money(fare)} sent. Waiting for ${trip.riderName} to choose.`,
    accepted: `${trip.riderName} accepted your ${money(fare)} bid.`,
    lost: `${trip.riderName} chose another driver.`,
    declined: `${trip.riderName} declined your bid.`,
    expired: 'Your bid expired.',
  }[status];
  return (
    <p className={`bd-status ${status}`} role="status">
      {status === 'pending' ? <span className="spin" /> : <Icon name={status === 'accepted' ? 'check' : 'clock'} size={16} />}
      {text}
    </p>
  );
}

function DriverTrip({ trip, onDone }: { trip: { riderName: string; pickup: string; dropoff: string; fare: number }; onDone: () => void }) {
  return (
    <div className="page">
      <div className="keep-hero">
        <Icon name="check" size={28} />
        <div>
          <b className="t-head">Bid accepted</b>
          <div className="t-cap">{trip.riderName} chose your fare. You keep all of it.</div>
        </div>
      </div>
      <div className="payout-hero">
        <span className="t-cap">You earn</span>
        <span className="keep-big num">{money(trip.fare)}</span>
      </div>
      <h2 className="t-head">Picking up {trip.riderName}</h2>
      <Leg pickup={trip.pickup} dropoff={trip.dropoff} />
      <div className="drv">
        <Avatar name={trip.riderName} />
        <div style={{ flex: 1 }}><b>{trip.riderName}</b><div className="t-cap">Confirm the rider&apos;s name before starting.</div></div>
      </div>
      <button className="btn" onClick={onDone}>Complete trip (demo)</button>
    </div>
  );
}
