import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';

import { Btn, ConfirmHost, Dialog, Empty, Icon, Select, Tabs, type IconName } from './components/ui';
import { MODULE_LABEL } from './lib/access';
import { Customers, Drivers } from './screens/people';
import { Loyalty, LiveChat, Push, Reviews } from './screens/engagement';
import { Onboarding } from './screens/onboarding';
import { BackgroundChecks } from './screens/checks';
import { Analytics, NoticeList, Overview } from './screens/overview';
import { Payments } from './screens/payments';
import { Platform } from './screens/platform';
import { AccessControl, Activity, Employees, Tasks } from './screens/team';
import { useAdmin } from './store';
import type { ModuleId, Severity } from './types';

/** The module registry: adding a screen to the dashboard, the menu and access control is one entry here. */
const MODULES: Record<ModuleId, { icon: IconName; screen: ComponentType }> = {
  overview: { icon: 'grid', screen: Overview }, analytics: { icon: 'chart', screen: Analytics },
  customers: { icon: 'person', screen: Customers }, drivers: { icon: 'car', screen: Drivers }, onboarding: { icon: 'clipboard', screen: Onboarding }, checks: { icon: 'badge', screen: BackgroundChecks },
  payments: { icon: 'card', screen: Payments },
  loyalty: { icon: 'gift', screen: Loyalty }, reviews: { icon: 'star', screen: Reviews }, chat: { icon: 'chat', screen: LiveChat }, push: { icon: 'send', screen: Push },
  employees: { icon: 'team', screen: Employees }, access: { icon: 'shield', screen: AccessControl }, tasks: { icon: 'tasks', screen: Tasks }, activity: { icon: 'log', screen: Activity },
  platform: { icon: 'plug', screen: Platform },
};
const NAV: { label: string; items: ModuleId[] }[] = [
  { label: 'Business', items: ['overview', 'analytics', 'payments'] },
  { label: 'People', items: ['customers', 'drivers', 'onboarding', 'checks'] },
  { label: 'Engagement', items: ['loyalty', 'reviews', 'chat', 'push'] },
  { label: 'Team', items: ['employees', 'access', 'tasks', 'activity'] },
  { label: 'System', items: ['platform'] },
];
const ORDER = NAV.flatMap((g) => g.items);
const THEME_KEY = 'wiiup.admin.theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // fall through to the system setting
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // the theme still applies for this session
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export function App() {
  const { db, me, route, go, can, setSession, unread, toasts, dismissToast } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const { theme, toggle } = useTheme();
  const allowed = ORDER.filter((m) => can(m));
  const valid = route in MODULES && can(route);

  // Unknown links and modules this person can't open land on the first one they can.
  useEffect(() => {
    if (!valid && allowed.length) go(allowed[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, allowed.length]);
  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  const Screen = valid ? MODULES[route].screen : null;
  const switchable = db.employees.filter((e) => e.status === 'active');

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <nav className={`side${menuOpen ? ' open' : ''}`} aria-label="Main">
        <div className="brand"><span className="logo-mark">W</span><span><strong>WiiUp</strong><small>Admin</small></span></div>
        {NAV.map((g) => {
          const items = g.items.filter((m) => can(m));
          if (!items.length) return null;
          return (
            <div key={g.label} className="navgroup">
              <span className="navlabel">{g.label}</span>
              {items.map((m) => (
                <a key={m} href={`#/${m}`} aria-current={route === m ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(m); }}>
                  <Icon name={MODULES[m].icon} size={17} />{MODULE_LABEL[m]}
                </a>
              ))}
            </div>
          );
        })}
      </nav>
      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      <div className="main">
        <header className="top">
          <button className="iconbtn menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          <span className="demo-chip" title="Sample data stored in this browser. There is no server or sign-in yet.">Demo data</span>
          <div className="top-right">
            <label className="viewas">
              <span>Viewing as</span>
              <Select label="Viewing as" value={me?.id ?? ''} onChange={setSession} options={switchable.map((e) => ({ value: e.id, label: `${e.name} · ${db.roles.find((r) => r.id === e.roleId)?.name ?? 'No role'}` }))} />
            </label>
            <button className="iconbtn" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggle}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <button className="iconbtn bell" aria-label={`Notifications, ${unread} unread`} onClick={() => setBell(true)}>
              <Icon name="bell" />{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </div>
        </header>
        <main id="main">
          {Screen ? <ScreenBoundary key={route}><Screen /></ScreenBoundary> : !allowed.length && <Empty title="You don't have access to any modules" body="Ask an Owner to give you a role." />}
        </main>
      </div>
      {bell && <NotificationCenter onClose={() => setBell(false)} />}
      <ConfirmHost />
      <div className="toasts" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.severity}`} role={t.severity === 'critical' || t.severity === 'error' ? 'alert' : 'status'}>
            <Icon name={t.severity === 'info' ? 'info' : 'alert'} />
            <div><strong>{t.title}</strong>{t.body && <p>{t.body}</p>}{t.module && <button className="linkbtn" onClick={() => { go(t.module!); dismissToast(t.id); }}>Open {MODULE_LABEL[t.module]}</button>}</div>
            <button className="iconbtn" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="close" size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One failing module shows an error in place; the menu and every other module keep working. */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Empty title="This page hit a problem" body="Other modules still work. Reload to try this one again." />;
  }
}

function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { db, can, system, unread } = useAdmin();
  const [filter, setFilter] = useState<'all' | Severity>('all');
  const mine = db.notices.filter((n) => can(n.module));
  const list = mine.filter((n) => filter === 'all' || n.severity === filter);
  const markAll = () => {
    const ids = new Set(mine.map((n) => n.id));
    system((d) => ({ ...d, notices: d.notices.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)) }));
  };
  return (
    <Dialog kind="drawer" title="Notifications" onClose={onClose} footer={<Btn disabled={!unread} onClick={markAll}>Mark all as read</Btn>}>
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'All' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warnings' }, { value: 'info', label: 'Info' }]} />
      <div onClick={(e) => { if ((e.target as HTMLElement).closest('button')) onClose(); }}>
        <NoticeList notices={list} />
      </div>
    </Dialog>
  );
}
