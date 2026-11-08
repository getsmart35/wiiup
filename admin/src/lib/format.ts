export const DAY = 86_400_000;
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const money = (cents: number) =>
  (cents < 0 ? '-$' : '$') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const moneyShort = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const s = d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)}k` : d.toFixed(0);
  return `${cents < 0 ? '-' : ''}$${s}`;
};

export const count = (n: number) => n.toLocaleString('en-US');
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const toCents = (dollars: number) => Math.round(dollars * 100);

export const date = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const shortDate = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const dateTime = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const startOfMonth = (t = Date.now()) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

export const maskEmail = (v: string) => {
  const [user, host] = v.split('@');
  return `${user.slice(0, 1)}•••@${host}`;
};
export const maskPhone = (v: string) => `•••-•••-${v.slice(-4)}`;
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Leading = + - @ are neutralised so an exported name can't run as a formula in a spreadsheet. */
function csvCell(v: string | number) {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
