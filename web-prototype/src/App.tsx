import { useEffect, useState } from 'react';

import { MapCanvas, type CameraMode } from './components/MapCanvas';
import { ROUTING_PROVIDER } from './lib/directions';
import type { LngLat } from './lib/geo';
import type { NavRoute } from './lib/navigation';
import { IDLE_CARS, PICKUP } from './lib/places';
import { Drive, DriveTrip, Earnings } from './screens/driver';
import { Profile } from './screens/profile';
import { RateCard } from './screens/ratecard';
import { InstantPayout } from './screens/payout';
import { RateCalculator, RateCards } from './screens/rates';
import { History, Home, Options, Rate, Search, SignIn, Trip, Welcome } from './screens/rider';
import { useApp, type Screen } from './store';

const SCREENS: Record<Screen, () => React.ReactNode> = {
  welcome: Welcome, signin: SignIn, home: Home, search: Search, options: Options, trip: Trip, rate: Rate,
  profile: Profile, history: History, drive: Drive, drivetrip: DriveTrip, earnings: Earnings, ratecard: RateCard, rates: RateCards, ratecalc: RateCalculator, payout: InstantPayout,
};
const SHEET: Partial<Record<Screen, number>> = { home: 330, options: 470, trip: 470, drive: 320, drivetrip: 320 };

type ThemePref = 'system' | 'light' | 'dark';
function useTheme() {
  const [pref, setPref] = useState<ThemePref>('system');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (pref === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', pref);
  }, [pref]);
  return { pref, setPref, dark: pref === 'dark' || (pref === 'system' && systemDark) };
}

export function App() {
  const app = useApp();
  const theme = useTheme();
  const { mode, screen, phase, dest, tripRoute, active, progress, offer, stage, stageReady, driverPos, overview, toast } = app;
  const Current = SCREENS[screen];

  // What the map shows for the current screen
  let route: NavRoute | null = null;
  let car: { pos: LngLat; bearing: number } | null = progress ? { pos: progress.position, bearing: progress.bearing } : null;
  let pickup: LngLat | null = null;
  let dropoff: LngLat | null = null;
  let me: LngLat | null = null;
  let idle: LngLat[] = [];
  let camera: CameraMode = 'home';
  let center: LngLat = PICKUP.coords;
  let top = 110;

  if (mode === 'rider') {
    if (screen === 'home' || !SHEET[screen]) {
      me = PICKUP.coords;
      idle = IDLE_CARS;
      car = null;
    } else if (screen === 'options') {
      route = tripRoute;
      pickup = PICKUP.coords;
      dropoff = dest?.coords ?? null;
      camera = 'overview';
    } else if (screen === 'trip') {
      route = active ?? tripRoute;
      pickup = PICKUP.coords;
      dropoff = dest?.coords ?? null;
      if (!car && phase === 'arrived') car = { pos: PICKUP.coords, bearing: 0 };
      if (!car && phase === 'done' && dest) car = { pos: dest.coords, bearing: 0 };
      if (phase === 'matching' || phase === 'found') me = PICKUP.coords;
      camera = 'overview';
    }
  } else {
    center = driverPos;
    car ??= { pos: driverPos, bearing: 0 };
    if (screen === 'drive' && offer) {
      route = offer.route;
      pickup = PICKUP.coords;
      dropoff = offer.place.coords;
      camera = 'overview';
    } else if (screen === 'drivetrip' && offer) {
      route = active ?? (stage === 'topickup' ? null : offer.route);
      pickup = stage === 'topickup' ? PICKUP.coords : null;
      dropoff = offer.place.coords;
      const following = !!active && !overview && !stageReady;
      camera = following ? 'follow' : 'overview';
      top = following ? 170 : 150;
    }
  }

  return (
    <div className="wrap">
      <section className="rail" aria-label="About this prototype">
        <div className="logo">
          <div className="logo-mark">W</div>
          <span className="eyebrow">Web prototype · React + MapLibre</span>
        </div>
        <h1>WiiUp, one app for riding and driving</h1>
        <p>
          Real streets from MapLibre GL, real driving routes from the {ROUTING_PROVIDER}, and turn-by-turn guidance with
          voice prompts in Drive mode. Trips are simulated and play back about 25× faster than real time.
        </p>
        <div className="ctl">
          <span className="eyebrow">Mode</span>
          <div className="seg" role="group" aria-label="App mode">
            <button aria-pressed={mode === 'rider'} onClick={() => app.switchMode('rider')}>Ride</button>
            <button aria-pressed={mode === 'driver'} onClick={() => app.switchMode('driver')}>Drive</button>
          </div>
        </div>
        <div className="ctl">
          <span className="eyebrow">Theme</span>
          <div className="seg" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} aria-pressed={theme.pref === t} onClick={() => theme.setPref(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <ul className="notes">
          <li><i className="dot" /><span><b>Rider:</b> Where to? → pick a place → the fare comes from the real route distance and time → confirm → watch the driver come to you, then the trip.</span></li>
          <li><i className="dot" /><span><b>Driver:</b> Account → Drive → Go online → Accept. The map switches to a heading-up navigation view with maneuver banners and spoken prompts.</span></li>
          <li><i className="dot" /><span><b>Routing:</b> {ROUTING_PROVIDER}{ROUTING_PROVIDER.startsWith('OSRM') ? '. Add VITE_MAPBOX_TOKEN to .env to switch to Mapbox.' : ' (driving-traffic profile).'}</span></li>
        </ul>
      </section>

      <div className="phone">
        <div className="screen" style={{ '--sheet': `${SHEET[screen] ?? 0}px` } as React.CSSProperties}>
          <div className="island" />
          <MapCanvas
            dark={theme.dark}
            center={center}
            route={route}
            progress={route === active ? progress : null}
            car={car}
            pickup={pickup}
            dropoff={dropoff}
            me={me}
            idleCars={idle}
            camera={camera}
            padding={{ top, bottom: SHEET[screen] ?? 330 }}
          />
          <div className={`layer ${SHEET[screen] ? '' : 'opaque'}`} key={screen}>
            <Current />
          </div>
          {toast && (
            <div className="toast" role="status">
              <b>{toast.title}</b>
              <span>{toast.body}</span>
            </div>
          )}
          <div className="home-ind" />
        </div>
      </div>
    </div>
  );
}
