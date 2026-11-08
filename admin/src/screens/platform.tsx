import { Badge, Btn, Card, Note, Page, ReadOnlyNote, Switch } from '../components/ui';
import { useAdmin } from '../store';
import type { Features } from '../types';

const FEATURES: { key: keyof Features; label: string; body: string }[] = [
  { key: 'loyalty', label: 'Loyalty points', body: 'Levels, points and wallet bonuses in the rider and driver apps.' },
  { key: 'driverReviews', label: 'Reviews of drivers', body: 'Riders rate drivers after each trip.' },
  { key: 'customerReviews', label: 'Reviews of customers', body: 'Drivers rate riders after each trip.' },
  { key: 'liveChat', label: 'Live chat', body: 'Riders and drivers can message support in the app.' },
  { key: 'push', label: 'Push notifications', body: 'Staff can send campaigns to phones.' },
];

export function Platform() {
  const { db, can, act, confirm, resetDemo } = useAdmin();
  const manage = can('platform', 'manage');
  return (
    <Page title="Platform" subtitle="Turn features on and connect outside services.">
      <ReadOnlyNote module="platform" />
      <Card title="Features">
        <ul className="rules">
          {FEATURES.map((f) => (
            <li key={f.key}>
              <div><strong>{f.label}</strong><p className="muted">{f.body}</p></div>
              <Switch label={f.label} checked={db.features[f.key]} disabled={!manage} onChange={(on) => act('platform', `${on ? 'Turned on' : 'Turned off'} ${f.label.toLowerCase()}`, (d) => ({ ...d, features: { ...d.features, [f.key]: on } }))} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Integrations" subtitle="Connection status only for now. API keys belong in server settings, never in this page.">
        <ul className="integrations">
          {db.integrations.map((i) => (
            <li key={i.id}>
              <div>
                <strong>{i.name}</strong> <Badge>{i.category}</Badge>
                <p className="muted">{i.description}</p>
              </div>
              <div className="row end">
                <Badge tone={i.connected ? 'good' : 'neutral'}>{i.connected ? 'Connected' : 'Not connected'}</Badge>
                <Btn small disabled={!manage} onClick={() => act('platform', `${i.connected ? 'Disconnected' : 'Connected'} ${i.name}`, (d) => ({ ...d, integrations: d.integrations.map((x) => (x.id === i.id ? { ...x, connected: !x.connected } : x)) }))}>{i.connected ? 'Disconnect' : 'Connect'}</Btn>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Demo environment">
        <Note>All data here is sample data stored in this browser. Alerts and chats are simulated.</Note>
        <ul className="rules">
          <li>
            <div><strong>Simulated live events</strong><p className="muted">Creates a new alert about every 15 seconds.</p></div>
            <Switch label="Simulated live events" checked={db.live} disabled={!manage} onChange={(live) => act('platform', `${live ? 'Started' : 'Paused'} simulated live events`, (d) => ({ ...d, live }))} />
          </li>
          <li>
            <div><strong>Reset sample data</strong><p className="muted">Discards every change made in this browser.</p></div>
            <Btn kind="danger" small disabled={!manage} onClick={() => confirm({ title: 'Reset sample data?', body: "All changes, including the activity log, are replaced with fresh sample data. This can't be undone.", okLabel: 'Reset data', danger: true, onOk: resetDemo })}>Reset</Btn>
          </li>
        </ul>
      </Card>
    </Page>
  );
}
