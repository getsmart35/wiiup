import type { LatLng } from '@/api/types';

/** Used when location permission is denied or unavailable (San Francisco). */
export const DEFAULT_LOCATION: LatLng = { latitude: 37.7749, longitude: -122.4194 };

/** Average city driving speed used for duration estimates. */
export const AVG_SPEED_KMH = 28;

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line distance padded to approximate street routing. */
export function roadDistanceKm(a: LatLng, b: LatLng): number {
  return distanceKm(a, b) * 1.3;
}

export function durationMin(km: number): number {
  return Math.max(1, Math.round((km / AVG_SPEED_KMH) * 60));
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** A gently curved path between two points, so routes don't look ruler-straight. */
export function routePath(a: LatLng, b: LatLng, steps = 24): LatLng[] {
  const dLat = b.latitude - a.latitude;
  const dLng = b.longitude - a.longitude;
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bend = Math.sin(Math.PI * t) * 0.12;
    pts.push({
      latitude: a.latitude + dLat * t - dLng * bend,
      longitude: a.longitude + dLng * t + dLat * bend,
    });
  }
  return pts;
}

/** Point at fraction t (0..1) along a polyline. */
export function pointAlong(path: LatLng[], t: number): LatLng {
  if (path.length === 0) return DEFAULT_LOCATION;
  const clamped = Math.min(1, Math.max(0, t));
  const f = clamped * (path.length - 1);
  const i = Math.floor(f);
  if (i >= path.length - 1) return path[path.length - 1];
  return lerp(path[i], path[i + 1], f - i);
}

/** Random point within `radiusKm` of `center`. */
export function jitter(center: LatLng, radiusKm: number): LatLng {
  const r = (radiusKm / 111) * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  return {
    latitude: center.latitude + r * Math.cos(theta),
    longitude:
      center.longitude + (r * Math.sin(theta)) / Math.cos(toRad(center.latitude)),
  };
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.cos(toRad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
