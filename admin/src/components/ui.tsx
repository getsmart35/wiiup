import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { MODULE_LABEL } from '../lib/access';
import { useAdmin } from '../store';
import type { ModuleId } from '../types';

const PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v1.5M17 19v1.5"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  gift: '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M5 13v8h14v-8M12 9v12M12 9S10.5 3 7.5 4.5 9 9 12 9zM12 9s1.5-6 4.5-4.5S15 9 12 9z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  tasks: '<path d="m4 6 2 2 3-3M4 13l2 2 3-3M4 20l2 2 3-3M13 7h8M13 14h8M13 21h8"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  alert: '<path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.5a3.4 3.4 0 0 1 6.4 0M15 10h3M15 14h3"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, fill = false, style }: { name: IconName; size?: number; fill?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}><i />{children}</span>;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials}</span>;
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="pagewrap">
      <header className="pagehead">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="row wrap">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, flush }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`card${flush ? ' flush' : ''}`}>
      {(title || actions) && (
        <div className="cardhead">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, delta, invert }: { label: string; value: string; hint?: string; delta?: number | null; invert?: boolean }) {
  const good = delta != null && (invert ? delta <= 0 : delta >= 0);
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta != null && <span className={`stat-delta ${good ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}% vs prior period</span>}
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Btn({ children, kind = 'ghost', icon, small, ...p }: { kind?: 'primary' | 'ghost' | 'danger'; icon?: IconName; small?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // The hosted preview's sandbox blocks file downloads, so export buttons are left out of that build
  if (icon === 'download' && import.meta.env.VITE_HOSTED_PREVIEW) return null;
  return (
    <button type="button" className={`btn ${kind}${small ? ' small' : ''}`} {...p}>
      {icon && <Icon name={icon} size={small ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="searchbox">
      <Icon name="search" size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; label: string; disabled?: boolean }) {
  return (
    <select className="select" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}{t.count != null && <span className="tabcount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return <div className="empty"><strong>{title}</strong>{body && <p>{body}</p>}</div>;
}

/** Native <dialog>: focus trap, Esc to close and the top layer come from the browser. */
export function Dialog({ title, onClose, children, kind = 'modal', footer }: { title: string; onClose: () => void; children: ReactNode; kind?: 'modal' | 'drawer'; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={kind} onClose={onClose} onMouseDown={(e) => e.target === ref.current && onClose()} aria-label={title}>
      <div className="dialog-inner">
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmHost() {
  const { confirmReq, confirm } = useAdmin();
  const [reason, setReason] = useState('');
  if (!confirmReq) return null;
  const close = () => {
    confirm(null);
    setReason('');
  };
  const blocked = !!confirmReq.reasonLabel && !reason.trim();
  return (
    <Dialog title={confirmReq.title} onClose={close} footer={
      <>
        <Btn onClick={close}>Cancel</Btn>
        <Btn kind={confirmReq.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => { confirmReq.onOk(reason.trim()); close(); }}>{confirmReq.okLabel}</Btn>
      </>
    }>
      <p className="muted">{confirmReq.body}</p>
      {confirmReq.reasonLabel && (
        <Field label={confirmReq.reasonLabel}>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
    </Dialog>
  );
}

export function ReadOnlyNote({ module }: { module: ModuleId }) {
  const { accessTo } = useAdmin();
  if (accessTo(module) !== 'view') return null;
  return <div className="note"><Icon name="lock" size={16} /><span>You have view-only access to {MODULE_LABEL[module]}. Ask an Owner if you need to make changes.</span></div>;
}

export function Note({ icon = 'info', children, tone }: { icon?: IconName; children: ReactNode; tone?: 'warn' }) {
  return <div className={`note ${tone ?? ''}`}><Icon name={icon} size={16} /><span>{children}</span></div>;
}

export type Column<T> = { key: string; head: string; cell: (r: T) => ReactNode; sort?: (r: T) => string | number; align?: 'right'; };

export function Table<T>({ columns, rows, rowKey, onRow, pageSize = 12, empty, label, defaultSort }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; pageSize?: number; empty?: string; label: string;
  defaultSort?: { key: string; dir: 1 | -1 };
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    // columns are recreated each render; the sort key and rows decide the order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);
  if (!rows.length) return <Empty title={empty ?? 'Nothing here yet'} />;
  return (
    <>
      <div className="tablewrap" tabIndex={0} role="region" aria-label={label}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? (
                    <button onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}>
                      {c.head}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </button>
                  ) : c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={rowKey(r)} className={onRow ? 'clickable' : undefined} onClick={onRow ? () => onRow(r) : undefined}
                tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRow(r); } : undefined}>
                {columns.map((c) => <td key={c.key} className={c.align}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span className="muted">{current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length.toLocaleString()}</span>
          <div className="row">
            <Btn small disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Btn>
            <Btn small disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Btn>
          </div>
        </div>
      )}
    </>
  );
}

export function Person({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="person">
      <Avatar name={name} />
      <span className="person-text"><strong>{name}</strong>{sub && <small>{sub}</small>}</span>
    </span>
  );
}

export function Stars({ value }: { value: number }) {
  return <span className="stars" aria-label={`${value} out of 5`}><Icon name="star" size={13} fill /> {value.toFixed(value % 1 ? 2 : 0)}</span>;
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
