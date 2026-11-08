import { useEffect, useRef, useState, type ReactNode } from 'react';

/* Charts follow the WiiUp palette: series tokens in styles.css, validated for light and dark and for colour-blind
   separation. Thin marks, one axis, 2px gaps, hover and focus tooltips, and a table view for every chart. */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; color?: string }[] } | null;
function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), width - 170);
  return (
    <div className="tip" style={{ left, top: Math.max(0, tip.y - 12) }} role="status">
      <div className="tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="tip-row">
          {r.color && <i style={{ background: r.color }} />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="tableview">
      <summary>View as table</summary>
      <div className="tablewrap" tabIndex={0} role="region" aria-label="Chart data">
        <table>
          <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'right' : undefined}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'right' : undefined}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 12, bottom: 26, left: 48 };
const everyNth = (n: number, width: number) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 72))));

function Grid({ w, h, max, format }: { w: number; h: number; max: number; format: (v: number) => string }) {
  const plotH = h - PAD.top - PAD.bottom;
  return (
    <g>
      {[0, 0.5, 1].map((f) => {
        const y = PAD.top + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} className={f === 0 ? 'axis' : 'gridline'} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="ticklabel">{format(max * f)}</text>
          </g>
        );
      })}
    </g>
  );
}

export function LineChart({ points, format, name, height = 220 }: { points: { label: string; value: number }[]; format: (v: number) => string; name: string; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH * (1 - v / max);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const nth = everyNth(points.length, width);
  const last = points.length - 1;
  const pointerAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const k = Math.round(((clientX - box.left - PAD.left) / plotW) * last);
    setHover(Math.min(last, Math.max(0, k)));
  };
  const h = hover != null ? points[hover] : null;
  return (
    <div>
      <div className="chart" ref={ref} tabIndex={0} role="img" aria-label={`${name}, latest ${format(points[last]?.value ?? 0)}. Use arrow keys for values.`}
        onPointerMove={(e) => pointerAt(e.clientX)} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
        onFocus={() => setHover(last)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((k) => Math.max(0, (k ?? last) - 1));
          if (e.key === 'ArrowRight') setHover((k) => Math.min(last, (k ?? last) + 1));
        }}>
        <svg width={width} height={height} aria-hidden="true">
          <Grid w={width} h={height} max={max} format={format} />
          {points.map((p, i) => (i % nth === 0 ? <text key={p.label + i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : x(i) > width - 28 ? 'end' : 'middle'} className="ticklabel">{p.label}</text> : null))}
          <path d={d} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} className="crosshair" />}
          {points.length > 0 && <circle cx={x(hover ?? last)} cy={y(points[hover ?? last].value)} r={4} fill="var(--s1)" stroke="var(--raised)" strokeWidth={2} />}
        </svg>
        <Tooltip width={width} tip={h && hover != null ? { x: x(hover), y: y(h.value), title: h.label, rows: [{ label: name, value: format(h.value), color: 'var(--s1)' }] } : null} />
      </div>
      <TableView head={['Period', name]} rows={points.map((p) => [p.label, format(p.value)])} />
    </div>
  );
}

export function StackedBars({ labels, series, height = 240, unit }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number; unit: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = niceMax(Math.max(...totals, 0));
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, labels.length);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const nth = everyNth(labels.length, width);
  return (
    <div>
      <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
      <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
        <svg width={width} height={height} role="img" aria-label={`${unit} by ${series.map((s) => s.name).join(', ')}`}>
          <Grid w={width} h={height} max={max} format={(v) => String(Math.round(v))} />
          {labels.map((label, i) => {
            const bx = PAD.left + slot * i + (slot - barW) / 2;
            let base = PAD.top + plotH;
            const stack = series.filter((s) => s.values[i] > 0);
            const tipFor = (): Tip => ({ x: bx + barW / 2, y: PAD.top + plotH * (1 - totals[i] / max), title: `${label} · ${totals[i]} ${unit}`, rows: series.map((s) => ({ label: s.name, value: String(s.values[i]), color: s.color })) });
            return (
              <g key={label + i} onPointerEnter={() => setTip(tipFor())} tabIndex={0} onFocus={() => setTip(tipFor())} onBlur={() => setTip(null)} className="barhit" aria-label={`${label}: ${totals[i]} ${unit}`}>
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {stack.map((s, k) => {
                  const segH = (s.values[i] / max) * plotH;
                  const top = k === stack.length - 1;
                  base -= segH;
                  const inner = Math.max(1, segH - (top ? 0 : 2));
                  const yy = base + (top ? 0 : 2);
                  const rx = top && barW >= 8 ? 3 : 0;
                  return <path key={s.name} fill={s.color} d={`M${bx} ${yy + inner}V${yy + rx}Q${bx} ${yy} ${bx + rx} ${yy}H${bx + barW - rx}Q${bx + barW} ${yy} ${bx + barW} ${yy + rx}V${yy + inner}Z`} />;
                })}
                {i % nth === 0 && <text x={bx + barW / 2} y={height - 8} textAnchor={bx + barW / 2 > width - 28 ? 'end' : 'middle'} className="ticklabel">{label}</text>}
              </g>
            );
          })}
        </svg>
        <Tooltip width={width} tip={tip} />
      </div>
      <TableView head={['Period', ...series.map((s) => s.name), 'Total']} rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i]), totals[i]])} />
    </div>
  );
}

/** Horizontal bars with the value always printed, so no tooltip or table view is needed. */
export function BarList({ items, format, color = 'var(--s1)' }: { items: { label: ReactNode; value: number; key: string; color?: string }[]; format: (v: number) => string; color?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.key}>
          <div className="barlist-top"><span>{i.label}</span><strong>{format(i.value)}</strong></div>
          <div className="barlist-track"><div style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color }} /></div>
        </li>
      ))}
    </ul>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

export function Heatmap({ grid, unit }: { grid: number[][]; unit: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(...grid.flat(), 1);
  const left = 36;
  const cellW = (width - left) / 24;
  const cellH = 22;
  const shade = (v: number) => (v === 0 ? 0 : 12 + Math.ceil((v / max) * 5) * 17);
  return (
    <div>
      <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
        <svg width={width} height={cellH * 7 + 22} role="img" aria-label={`${unit} by weekday and hour`}>
          {grid.map((row, d) => (
            <g key={d}>
              <text x={0} y={d * cellH + 15} className="ticklabel">{DAYS[d]}</text>
              {row.map((v, h) => (
                <rect key={h} x={left + h * cellW + 1} y={d * cellH + 1} width={Math.max(1, cellW - 2)} height={cellH - 2} rx={2}
                  fill={v === 0 ? 'var(--surface)' : `color-mix(in srgb, var(--s1) ${shade(v)}%, var(--raised))`}
                  onPointerEnter={() => setTip({ x: left + h * cellW, y: d * cellH, title: `${DAYS[d]} ${hourLabel(h)}`, rows: [{ label: unit, value: String(v) }] })} />
              ))}
            </g>
          ))}
          {[0, 6, 12, 18].map((h) => <text key={h} x={left + h * cellW + 1} y={cellH * 7 + 16} className="ticklabel">{hourLabel(h)}</text>)}
        </svg>
        <Tooltip width={width} tip={tip} />
      </div>
      <div className="scale"><span>Fewer</span>{[1, 2, 3, 4, 5].map((k) => <i key={k} style={{ background: `color-mix(in srgb, var(--s1) ${12 + k * 17}%, var(--raised))` }} />)}<span>More</span></div>
      <TableView head={['Day', ...Array.from({ length: 24 }, (_, h) => hourLabel(h))]} rows={grid.map((row, d) => [DAYS[d], ...row])} />
    </div>
  );
}

export const SERIES = { go: 'var(--s1)', comfort: 'var(--s2)', xl: 'var(--s3)', platinum: 'var(--s4)' };
