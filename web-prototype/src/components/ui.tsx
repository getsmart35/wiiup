import type { ReactNode } from 'react';

import type { RouteStep } from '../lib/directions';
import { Avatar } from './Avatar';
import { clockAfter, formatDistance, formatMinutes } from '../lib/geo';
import type { NavProgress } from '../lib/navigation';
import { DRIVER } from '../store';

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  account: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5a6.5 6.5 0 0 1 11 0"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v1.5M17 19v1.5"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  sport: '<path d="M3 16v-3l3-4h8l4 4h3v3zM6 16v2M18 16v2"/><circle cx="7" cy="16" r="1.6"/><circle cx="17" cy="16" r="1.6"/>',
  bus: '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M7 17v3M17 17v3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  steer: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10h6M14.5 10h6M12 14.5V21"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
  nav: '<path d="M12 3 19 20 12 16 5 20z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, fill = false, style }: { name: IconName; size?: number; fill?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={fill ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="grab" />
      {children}
    </div>
  );
}

export function IconButton({ icon, label, onClick, size = 20 }: { icon: IconName; label: string; onClick: () => void; size?: number }) {
  return (
    <button className="icb" aria-label={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function DriverCard() {
  return (
    <div className="drv">
      <Avatar name={DRIVER.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-head">{DRIVER.name}</div>
        <div className="t-cap inline">
          <Icon name="star" size={13} fill style={{ color: 'var(--warning)' }} />
          {DRIVER.rating.toFixed(2)} · {DRIVER.color} {DRIVER.car}
        </div>
      </div>
      <span className="plate">{DRIVER.plate}</span>
    </div>
  );
}

export function Leg({ pickup, dropoff }: { pickup: string; dropoff: string }) {
  return (
    <div className="leg">
      <div>
        <span className="t-cap">Pickup</span>
        <span className="t-label">{pickup}</span>
      </div>
      <div>
        <span className="t-cap">Drop-off</span>
        <span className="t-label">{dropoff}</span>
      </div>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="track" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="fill" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

const ANGLES: Record<string, number> = {
  straight: 0, 'slight right': 40, right: 90, 'sharp right': 135, uturn: 180, 'slight left': -40, left: -90, 'sharp left': -135,
};

export function ManeuverIcon({ step, size = 40 }: { step: RouteStep | null; size?: number }) {
  if (!step || step.type === 'arrive') return <Icon name="flag" size={size} />;
  const angle = step.type === 'depart' ? 0 : ANGLES[step.modifier ?? 'straight'] ?? 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {angle === 180 ? (
        <path d="M8 20V10a4 4 0 0 1 8 0v4M12.5 11l3.5 3.5 3.5-3.5" />
      ) : (
        <g transform={`rotate(${angle} 12 12)`}>
          <path d="M12 21V5M6.5 10.5 12 5l5.5 5.5" />
        </g>
      )}
    </svg>
  );
}

/** Turn-by-turn banner: next maneuver, distance to it, and the one after. */
export function NavBanner({ progress, after }: { progress: NavProgress; after: RouteStep | null }) {
  const next = progress.next;
  return (
    <div className="navbanner" aria-live="polite">
      <div className="nav-main">
        <span className="nav-icon">
          <ManeuverIcon step={next} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="nav-dist num">{formatDistance(progress.distanceToManeuver)}</div>
          <div className="nav-text">{next?.instruction ?? 'Continue to the destination'}</div>
        </div>
      </div>
      {after && after.type !== 'arrive' && (
        <div className="nav-then">
          Then <ManeuverIcon step={after} size={16} /> {after.name || after.instruction}
        </div>
      )}
    </div>
  );
}

export function EtaRow({ progress }: { progress: NavProgress }) {
  return (
    <div className="eta-row num">
      <span className="eta-big">{formatMinutes(progress.remainingSec)}</span>
      <span className="t-cap">
        {formatDistance(progress.remaining)} · arrive {clockAfter(progress.remainingSec)}
      </span>
    </div>
  );
}
