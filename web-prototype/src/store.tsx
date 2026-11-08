import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { getRoute } from './lib/directions';
import { quoteFare, TIER_ORDER, TIERS, type Tier } from './lib/fare';
import type { LngLat } from './lib/geo';
import { prepareRoute, speak, type NavProgress, type NavRoute } from './lib/navigation';
import { PAYOUT_DESTINATION } from './lib/payouts';
import { billingPeriod, isLadderPlan, ladderFee, limitReached, PLANS, UPGRADE, type PlanId } from './lib/plans';
import { defaultCards, fareFor, ratesInUse, type RateCards, type TierCard } from './lib/rates';
import { DRIVER_HOME, DRIVER_START, PICKUP, PLACES, type Place } from './lib/places';
import { useRouteSim } from './lib/useRouteSim';

export type Screen =
  | 'welcome' | 'signin' | 'home' | 'search' | 'options' | 'trip' | 'rate' | 'profile' | 'history'
  | 'drive' | 'drivetrip' | 'earnings' | 'ratecard' | 'rates' | 'ratecalc' | 'payout';
export type Phase = 'matching' | 'found' | 'enroute' | 'arrived' | 'ontrip' | 'done';
export type DriveStage = 'topickup' | 'waiting' | 'ontrip';
export type Offer = { place: Place; rider: string; tier: Tier; earn: number; busy: boolean; route: NavRoute };
export type Trip = { place: string; date: string; fare: number; tier: string };

export const DRIVER = { name: 'Marcus', rating: 4.92, car: 'Toyota Camry', color: 'Silver', plate: '7KQX482' };
/** The signed-in user's own vehicle when driving. */
export const MY_CAR = { car: 'Toyota Prius', color: 'Black', plate: '8WUP219', since: 'Driving since 2024' };
const PHOTO_KEY = 'wiiup.photo';
const RATES_KEY = 'wiiup.ratecards';

function loadRateCards(): RateCards {
  try {
    const saved = JSON.parse(localStorage.getItem(RATES_KEY) ?? 'null') as RateCards | null;
    // Ride types added after a driver last saved start from the suggested rates
    if (saved) return { ...defaultCards(), ...saved };
  } catch {
    // storage unavailable or corrupt: start from the suggested rates
  }
  return defaultCards();
}
const RIDERS = ['Jordan', 'Priya', 'Alex', 'Sam', 'Leila'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function useAppState() {
  // The hosted preview opens straight on the driver's rate card
  const preview = !!import.meta.env.VITE_HOSTED_PREVIEW;
  const [mode, setMode] = useState<'rider' | 'driver'>(preview ? 'driver' : 'rider');
  const [screen, setScreen] = useState<Screen>(preview ? 'rates' : 'welcome');
  const [name, setName] = useState('Maya');
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [routing, setRouting] = useState(false);
  const [overview, setOverview] = useState(false);
  const [photo, setPhotoState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PHOTO_KEY);
    } catch {
      return null;
    }
  });
  const setPhoto = (v: string | null) => {
    setPhotoState(v);
    try {
      if (v) localStorage.setItem(PHOTO_KEY, v);
      else localStorage.removeItem(PHOTO_KEY);
    } catch {
      // storage unavailable: the photo still shows for this session
    }
  };

  // rider
  const [dest, setDest] = useState<Place | null>(null);
  const [tripRoute, setTripRoute] = useState<NavRoute | null>(null);
  const [tier, setTier] = useState<Tier>('go');
  const [phase, setPhase] = useState<Phase | null>(null);
  const [rating, setRating] = useState(5);
  const [tip, setTip] = useState(2);
  const [recents, setRecents] = useState<Place[]>([PLACES[1], PLACES[3]]);
  const [trips, setTrips] = useState<Trip[]>([
    { place: 'Central Station', date: 'Yesterday · 6:12 PM', fare: 11.62, tier: 'WiiUp Go' },
    { place: 'Riverside Mall', date: 'Mon · 1:40 PM', fare: 9.84, tier: 'WiiUp Go' },
    { place: 'International Airport', date: 'Oct 28 · 5:05 AM', fare: 58.19, tier: 'WiiUp XL' },
  ]);

  // driver
  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerLeft, setOfferLeft] = useState(15);
  const [stage, setStage] = useState<DriveStage | null>(null);
  const [stageReady, setStageReady] = useState(false);
  const [driverPos, setDriverPos] = useState<LngLat>(DRIVER_HOME);
  const [plan, setPlanState] = useState<PlanId>('silver');
  const [upgrade, setUpgrade] = useState<PlanId | null>(null);
  const [livery, setLivery] = useState<{ status: 'none' | 'pending' | 'approved' | 'rejected'; license?: string }>({ status: 'none' });
  // Sample driver: subscribed 12 days ago, close to Silver's limit. month.fares is this billing period's fares.
  const [subscribedAt] = useState(() => Date.now() - 12 * 86_400_000);
  const [month, setMonth] = useState({ fares: 1420.3, tips: 236.5, days: 14, lifetimeTrips: 1284 });
  const [earn, setEarn] = useState({
    today: 42.6,
    trips: 3,
    rating: 4.96,
    week: [61.2, 88.4, 34.9, 102.5, 77.1, 124.3, 42.6],
    recent: [
      { to: 'Central Station', t: '2:14 PM', amt: 15.5 },
      { to: 'City Hall', t: '1:02 PM', amt: 11.4 },
      { to: 'Riverside Mall', t: '11:48 AM', amt: 15.7 },
    ],
  });

  const [rateCards, setRateCards] = useState<RateCards>(loadRateCards);
  const rateCardsRef = useRef(rateCards);
  useEffect(() => {
    rateCardsRef.current = rateCards;
    try {
      localStorage.setItem(RATES_KEY, JSON.stringify(rateCards));
    } catch {
      // storage unavailable: rates still apply for this session
    }
  }, [rateCards]);
  // Sample starting balance: today's earnings, not yet paid out
  const [balance, setBalance] = useState(42.6);
  const [payouts, setPayouts] = useState<{ id: string; amount: number; net: number; at: number }[]>([]);
  const cashOut = async (amount: number, net: number) => {
    await wait(800);
    setPayouts((p) => [{ id: String(Date.now()), amount, net, at: Date.now() }, ...p]);
    setBalance((b) => Math.round((b - amount) * 100) / 100);
    showToast('Payout sent', `$${net.toFixed(2)} is on its way to your ${PAYOUT_DESTINATION}.`);
  };
  const setPlan = (p: PlanId) => {
    setPlanState(p);
    setUpgrade(null);
  };
  const currentPlan = upgrade ?? plan;
  const period = billingPeriod(subscribedAt);
  const atLimit = limitReached(currentPlan, month.fares);
  const buyUpgrade = async () => {
    const option = UPGRADE[currentPlan];
    if (!option) return;
    await wait(600);
    setUpgrade(option.to);
    showToast('Upgrade complete', `You're on ${PLANS[option.to].name} until your next billing date. You can accept rides again.`);
  };
  // Stand-in for the admin's decision in the back office
  const applyForPlatinum = (license: string) => {
    setLivery({ status: 'pending', license });
    setTimeout(() => {
      setLivery({ status: 'approved', license });
      showToast('Platinum approved', 'Your livery license was verified. You can now switch to Platinum.');
    }, 5000);
  };
  const saveRateCard = (tier: Tier, card: TierCard) => setRateCards((c) => ({ ...c, [tier]: card }));

  /**
   * The one price for a trip: what the rider pays and what the driver earns, because the driver keeps all of it.
   * The simulated driver prices from this device's rate cards, so a change shows up on both sides. A real backend uses the assigned driver's card.
   */
  const priceFor = (tier: Tier, meters: number, seconds: number, busy = false) =>
    rateCardsRef.current[tier].useSuggested ? quoteFare(tier, meters, seconds) : fareFor(ratesInUse(rateCardsRef.current, tier), meters, seconds, busy).fare;

  // Where Back goes from screens that can be reached from both the driver menu and the profile
  const [returnTo, setReturnTo] = useState<Screen>('drive');
  const [rateReturn, setRateReturn] = useState<Screen>('drive');
  const openScreen = (next: Screen, from: Screen) => {
    if (next === 'ratecalc') setRateReturn(from);
    else if (from === 'drive' || from === 'profile') setReturnTo(from);
    setScreen(next);
  };

  // the route the simulated car is currently driving
  const [active, setActive] = useState<NavRoute | null>(null);
  const flow = useRef(0); // bumps whenever a pending async flow should be abandoned

  const showToast = useCallback((title: string, body: string) => {
    setToast({ title, body });
    setTimeout(() => setToast((t) => (t?.title === title ? null : t)), 2600);
  }, []);

  const route = async (from: LngLat, to: LngLat) => {
    setRouting(true);
    try {
      return prepareRoute(await getRoute(from, to));
    } finally {
      setRouting(false);
    }
  };

  /* ---------- rider ---------- */
  const chooseDest = async (place: Place) => {
    const id = ++flow.current;
    setDest(place);
    setTripRoute(null);
    setScreen('options');
    const r = await route(PICKUP.coords, place.coords);
    if (flow.current === id) setTripRoute(r);
  };

  const confirmRide = async () => {
    const id = ++flow.current;
    setPhase('matching');
    setScreen('trip');
    const [r] = await Promise.all([route(DRIVER_START, PICKUP.coords), wait(2600)]);
    if (flow.current !== id) return;
    setPhase('found');
    await wait(1400);
    if (flow.current !== id) return;
    setPhase('enroute');
    setActive(r);
  };

  const cancelRide = () => {
    flow.current++;
    setActive(null);
    setPhase(null);
    setScreen('home');
    showToast('Ride cancelled', 'No fee was charged.');
  };

  const finishRide = () => {
    if (!dest || !tripRoute) return;
    const fare = priceFor(tier, tripRoute.distance, tripRoute.duration) + tip;
    setTrips((t) => [{ place: dest.name, date: 'Today · just now', fare, tier: TIERS[tier].label }, ...t]);
    setRecents((r) => (r.some((p) => p.id === dest.id) ? r : [dest, ...r].slice(0, 2)));
    setPhase(null);
    setRating(5);
    setTip(2);
    setScreen('home');
    showToast('Thanks for riding', `$${fare.toFixed(2)} charged to Visa •••• 4242.`);
  };

  /* ---------- driver ---------- */
  const scheduleOffer = async () => {
    const id = ++flow.current;
    await wait(3000);
    if (flow.current !== id) return;
    const place = pick(PLACES.slice(1));
    const t = pick<Tier>(TIER_ORDER);
    const r = await route(PICKUP.coords, place.coords);
    if (flow.current !== id) return;
    setOfferLeft(15);
    const busy = Math.random() < 0.25; // simulated demand: about one offer in four is at a busy time
    setOffer({ place, rider: pick(RIDERS), tier: t, busy, earn: priceFor(t, r.distance, r.duration, busy), route: r });
  };

  const toggleOnline = () => {
    const next = !online;
    if (next && atLimit) return showToast(`${PLANS[currentPlan].name} limit reached`, 'Upgrade to keep accepting rides.');
    setOnline(next);
    if (next) scheduleOffer();
    else {
      flow.current++;
      setOffer(null);
    }
  };

  const declineOffer = () => {
    setOffer(null);
    scheduleOffer();
  };

  const acceptOffer = async () => {
    const id = ++flow.current;
    setStage('topickup');
    setStageReady(false);
    setOverview(false);
    setScreen('drivetrip');
    const r = await route(driverPos, PICKUP.coords);
    if (flow.current !== id) return;
    if (voiceOn) speak(`Picking up ${offer?.rider ?? 'your rider'}. ${r.steps[0]?.instruction ?? ''}`);
    setActive(r);
  };

  const advanceStage = () => {
    if (!offer) return;
    if (stage === 'topickup') {
      setStage('waiting');
      setStageReady(true);
    } else if (stage === 'waiting') {
      setStage('ontrip');
      setStageReady(false);
      if (voiceOn) speak(`Starting trip to ${offer.place.name}. ${offer.route.steps[0]?.instruction ?? ''}`);
      setActive(offer.route);
    } else {
      setEarn((e) => {
        const today = Math.round((e.today + offer.earn) * 100) / 100;
        return { ...e, today, trips: e.trips + 1, week: [...e.week.slice(0, 6), today], recent: [{ to: offer.place.name, t: 'Just now', amt: offer.earn }, ...e.recent] };
      });
      setBalance((b) => Math.round((b + offer.earn) * 100) / 100);
      const before = isLadderPlan(currentPlan) ? ladderFee(currentPlan, month.fares) : null;
      const after = isLadderPlan(currentPlan) ? ladderFee(currentPlan, month.fares + offer.earn) : null;
      const reachedLimit = limitReached(currentPlan, month.fares + offer.earn);
      setMonth((m) => ({ ...m, fares: Math.round((m.fares + offer.earn) * 100) / 100, lifetimeTrips: m.lifetimeTrips + 1 }));
      if (before && after && after.installments > before.installments)
        showToast('Trip complete · you keep 100%', `+$${offer.earn.toFixed(2)}. Fares passed $${before.next!.at.toLocaleString()}, so a $${before.next!.installment.toFixed(2)} ${PLANS[currentPlan].name} installment is due.`);
      else showToast('Trip complete · you keep 100%', `+$${offer.earn.toFixed(2)} added to today's earnings.`);
      setOffer(null);
      setStage(null);
      setScreen('drive');
      if (reachedLimit) {
        setOnline(false);
        showToast(`${PLANS[currentPlan].name} limit reached`, 'Upgrade to keep accepting rides.');
      } else scheduleOffer();
    }
  };

  // 15-second accept window for an incoming request
  useEffect(() => {
    if (!offer || stage) return;
    setOfferLeft(15);
    const iv = setInterval(() => setOfferLeft((n) => n - 1), 1000);
    return () => clearInterval(iv);
  }, [offer, stage]);
  useEffect(() => {
    if (offer && !stage && offerLeft <= 0) {
      setOffer(null);
      showToast('Request expired', 'Looking for the next ride near you.');
      scheduleOffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerLeft]);

  /* ---------- simulation ---------- */
  const onArrive = () => {
    setActive(null);
    if (mode === 'rider') {
      if (phase === 'enroute') {
        setPhase('arrived');
        const id = flow.current;
        wait(2600).then(() => {
          if (flow.current !== id) return;
          setPhase('ontrip');
          setActive(tripRoute);
        });
      } else if (phase === 'ontrip') setPhase('done');
    } else if (offer) {
      setDriverPos(stage === 'topickup' ? PICKUP.coords : offer.place.coords);
      setStageReady(true);
    }
  };
  const progress: NavProgress | null = useRouteSim(active, { voice: voiceOn && mode === 'driver', onArrive });

  const switchMode = (m: 'rider' | 'driver') => {
    if (phase && phase !== 'done') return showToast('Trip in progress', `Finish your current trip before switching to ${m === 'rider' ? 'Ride' : 'Drive'} mode.`);
    if (stage) return showToast('Trip in progress', 'Complete your current trip before switching to Ride mode.');
    flow.current++;
    setActive(null);
    setOffer(null);
    setOnline(false);
    setMode(m);
    setScreen(screen === 'welcome' || screen === 'signin' ? screen : m === 'rider' ? 'home' : 'drive');
  };

  return {
    mode, screen, setScreen, name, setName, toast, showToast, voiceOn, setVoiceOn, routing, overview, setOverview,
    dest, tripRoute, tier, setTier, phase, rating, setRating, tip, setTip, recents, trips,
    chooseDest, confirmRide, cancelRide, finishRide,
    online, offer, offerLeft, stage, stageReady, driverPos, earn, toggleOnline, declineOffer, acceptOffer, advanceStage,
    active, progress, switchMode, photo, setPhoto, plan, setPlan, month,
    rateCards, saveRateCard, returnTo, rateReturn, openScreen, balance, payouts, cashOut, priceFor,
    currentPlan, upgraded: !!upgrade, period, atLimit, buyUpgrade, livery, applyForPlatinum,
  };
}

export type App = ReturnType<typeof useAppState>;
const Ctx = createContext<App | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useAppState()}>{children}</Ctx.Provider>;
}

export function useApp(): App {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
