import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { effectiveAccess, RANK } from './lib/access';
import { advanceChecks } from './lib/checks';
import { uid } from './lib/format';
import { createSeed } from './lib/seed';
import { nextEvent } from './lib/sim';
import type { Access, Db, Employee, ModuleId, Notice, Severity } from './types';

const DB_KEY = 'wiiup.admin.db.v5';
const SESSION_KEY = 'wiiup.admin.session';

export type ConfirmRequest = {
  title: string; body: string; okLabel: string; danger?: boolean;
  /** When set, the dialog requires a written reason and passes it to onOk. */
  reasonLabel?: string;
  onOk: (reason: string) => void;
};
export type Toast = { id: string; severity: Severity | 'error'; title: string; body?: string; module?: ModuleId };

const routeFromHash = () => (location.hash.replace(/^#\/?/, '') || 'overview') as ModuleId;

function loadDb(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    // storage unavailable or corrupt: start from the seed
  }
  return createSeed();
}

function readSession() {
  try {
    return localStorage.getItem(SESSION_KEY) ?? 'e_owner';
  } catch {
    return 'e_owner';
  }
}

export function addNotice(db: Db, n: { severity: Severity; title: string; body: string; module: ModuleId }): Db {
  const notice: Notice = { id: uid('n'), at: Date.now(), read: false, ...n };
  return { ...db, notices: [notice, ...db.notices].slice(0, 100) };
}

function useAdminState() {
  const [db, setDb] = useState<Db>(loadDb);
  const [sessionId, setSessionIdState] = useState(readSession);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [route, setRoute] = useState<ModuleId>(() => routeFromHash());

  const me: Employee | undefined = db.employees.find((e) => e.id === sessionId);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
      } catch {
        // storage full or blocked: changes still apply for this session
      }
    }, 300);
    return () => clearTimeout(t);
  }, [db]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((m: ModuleId) => {
    setRoute(m);
    location.hash = `/${m}`;
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uid('toast');
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.severity === 'critical' ? 9000 : 4000);
  }, []);
  const dismissToast = (id: string) => setToasts((all) => all.filter((x) => x.id !== id));

  const accessTo = (m: ModuleId): Access => effectiveAccess(me, db.roles, m);
  const can = (m: ModuleId, level: Access = 'view') => RANK[accessTo(m)] >= RANK[level];

  /**
   * Every staff change goes through here: permission check, then the change, then an audit entry.
   * In production this is the API boundary, and the same check must run on the server.
   */
  const act = (module: ModuleId, summary: string, change: (d: Db) => Db, need: Access = 'manage'): boolean => {
    if (!can(module, need)) {
      toast({ severity: 'error', title: "You don't have access to do that", body: `It needs ${need} access to this module.` });
      return false;
    }
    const entry = { id: uid('au'), at: Date.now(), actor: me?.name ?? 'Unknown', module, summary };
    setDb((d) => {
      const next = change(d);
      return { ...next, audit: [entry, ...next.audit].slice(0, 1000) };
    });
    return true;
  };

  /** System-driven updates (webhooks in production), which don't belong to a staff member. */
  const system = useCallback((change: (d: Db) => Db) => setDb(change), []);

  const setSession = (id: string) => {
    setSessionIdState(id);
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      // the switch still applies for this session
    }
  };

  const resetDemo = () => {
    setSession('e_owner');
    setDb(createSeed());
    go('overview');
  };

  // Simulated background check provider. Provider webhooks replace this in production.
  const checksMoving = db.checks.some((c) => c.status === 'consent_sent' || c.status === 'running');
  useEffect(() => {
    if (!checksMoving) return;
    const iv = setInterval(() => {
      const now = Date.now();
      setDb((d) => advanceChecks(d, now));
    }, 1000);
    return () => clearInterval(iv);
  }, [checksMoving]);

  // Simulated event stream. A WebSocket subscription replaces this interval in production.
  const latest = useRef({ db, sessionId });
  latest.current = { db, sessionId };
  useEffect(() => {
    if (!db.live) return;
    const iv = setInterval(() => {
      const { db: current, sessionId: sid } = latest.current;
      const ev = nextEvent(current);
      setDb(ev.apply);
      const viewer = current.employees.find((e) => e.id === sid);
      if (ev.notice.severity === 'critical' && effectiveAccess(viewer, current.roles, ev.notice.module) !== 'none')
        toast({ severity: 'critical', title: ev.notice.title, body: ev.notice.body, module: ev.notice.module });
    }, 15000);
    return () => clearInterval(iv);
  }, [db.live, toast]);

  const unread = useMemo(() => db.notices.filter((n) => !n.read && effectiveAccess(me, db.roles, n.module) !== 'none').length, [db.notices, db.roles, me]);

  return {
    db, me, route, go, accessTo, can, act, system, setSession, resetDemo, toast, toasts, dismissToast, unread,
    confirm: setConfirmReq, confirmReq,
  };
}

export type Admin = ReturnType<typeof useAdminState>;
const Ctx = createContext<Admin | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useAdminState()}>{children}</Ctx.Provider>;
}

export function useAdmin(): Admin {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin must be used inside AdminProvider');
  return v;
}
