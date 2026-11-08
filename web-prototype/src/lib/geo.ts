export type LngLat = [number, number];

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b in degrees (0 = north). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Running distance (m) at each vertex of a line. */
export function cumulative(coords: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  return out;
}

/** Position, heading and segment index at `d` meters along the line. */
export function pointAt(coords: LngLat[], cum: number[], d: number): { pos: LngLat; bearing: number; index: number } {
  if (coords.length < 2) return { pos: coords[0], bearing: 0, index: 0 };
  const dist = Math.max(0, Math.min(d, cum[cum.length - 1]));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const a = coords[lo];
  const b = coords[hi];
  const seg = cum[hi] - cum[lo];
  const f = seg ? (dist - cum[lo]) / seg : 0;
  return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearing(a, b), index: lo };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatMinutes(sec: number): string {
  return `${Math.max(1, Math.round(sec / 60))} min`;
}

export function clockAfter(sec: number): string {
  return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
