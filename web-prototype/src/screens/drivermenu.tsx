import { useEffect, useRef } from 'react';

import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/ui';
import { PLANS } from '../lib/plans';
import { useApp, type Screen } from '../store';

function Row({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return <button className="dm-row" onClick={onClick}><Icon name={icon} size={22} />{label}</button>;
}

/** The slide-out menu behind the three-line button on the driver's home screen. */
export function DriverMenu({ onClose }: { onClose: () => void }) {
  const { name, photo, earn, month, currentPlan: plan, openScreen, setScreen, switchMode, showToast } = useApp();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = (s: Screen) => {
    onClose();
    openScreen(s, 'drive');
  };

  return (
    <>
      <button className="dm-scrim" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <nav className="dm" aria-label="Driver menu">
        <div className="dm-top">
          <Avatar name={name} photo={photo} size={76} />
          <b className="t-head">Hello, {name}</b>
          <button ref={firstRef} className="t-label link" onClick={() => open('profile')}>View profile</button>
          <div className="dm-stats num">
            <div><b>{earn.rating.toFixed(2)}</b><span>Rating</span></div>
            <div><b>{month.lifetimeTrips.toLocaleString()}</b><span>Trips</span></div>
            <div><b>100%</b><span>Fares kept</span></div>
          </div>
        </div>
        <div className="dm-group">
          <Row icon="tag" label="My rate card" onClick={() => open('rates')} />
          <Row icon="calc" label="Rate calculator" onClick={() => open('ratecalc')} />
<Row icon="flash" label="Instant payout" onClick={() => open('payout')} />
          <Row icon="chart" label="Earnings" onClick={() => open('earnings')} />
        </div>
        <div className="dm-group">
          <button className="dm-row" onClick={() => open('ratecard')}>
            <Icon name="card" size={22} />
            <span className="dm-text">My subscription<small>{PLANS[plan].name}</small></span>
          </button>
          <Row icon="shield" label="Documents" onClick={() => { onClose(); showToast('Documents', 'Document upload is coming soon.'); }} />
        </div>
        <div className="dm-group">
          <Row icon="flag" label="Safety" onClick={() => { onClose(); showToast('Safety', 'Emergency assistance and trip sharing are coming soon.'); }} />
          <Row icon="help" label="Help" onClick={() => { onClose(); showToast('Help', 'Support chat is coming soon.'); }} />
          <Row icon="person" label="Switch to Ride" onClick={() => { onClose(); switchMode('rider'); }} />
        </div>
        <button className="dm-row dm-out" onClick={() => { onClose(); setScreen('welcome'); }}>Sign out</button>
      </nav>
    </>
  );
}
