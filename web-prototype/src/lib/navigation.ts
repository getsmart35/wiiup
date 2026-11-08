import type { Route, RouteStep } from './directions';
import { cumulative, pointAt, type LngLat } from './geo';

/**
 * Web stand-in for the Mapbox Navigation SDK's route progress: given meters traveled along a
 * Directions route, report the position, the upcoming maneuver, distance to it, time left and
 * which voice prompts are due. The native SDKs (iOS/Android) do this from GPS; here a
 * simulator feeds it.
 */
export type NavRoute = Route & { cum: number[]; length: number; stepStarts: number[]; prompts: { at: number; text: string }[] };

export type NavProgress = {
  position: LngLat;
  bearing: number;
  segment: number;
  traveled: number;
  remaining: number;
  remainingSec: number;
  fraction: number;
  stepIndex: number;
  next: RouteStep | null;
  distanceToManeuver: number;
  arrived: boolean;
};

export function prepareRoute(route: Route): NavRoute {
  const cum = cumulative(route.coords);
  const length = cum[cum.length - 1] || route.distance;
  const total = route.steps.reduce((s, x) => s + x.distance, 0);
  const scale = total ? length / total : 1;
  const stepStarts: number[] = [];
  let acc = 0;
  for (const s of route.steps) {
    stepStarts.push(acc);
    acc += s.distance * scale;
  }
  const prompts = route.steps
    .flatMap((s, i) => s.voice.map((v) => ({ at: stepStarts[i] + (s.distance - v.distanceAlong) * scale, text: v.text })))
    .sort((a, b) => a.at - b.at);
  return { ...route, cum, length, stepStarts, prompts };
}

export function progressAt(r: NavRoute, traveled: number): NavProgress {
  const d = Math.max(0, Math.min(traveled, r.length));
  const p = pointAt(r.coords, r.cum, d);
  let stepIndex = 0;
  while (stepIndex < r.stepStarts.length - 1 && r.stepStarts[stepIndex + 1] <= d) stepIndex++;
  const next = r.steps[stepIndex + 1] ?? null;
  const nextAt = next ? r.stepStarts[stepIndex + 1] : r.length;
  const fraction = r.length ? d / r.length : 1;
  return {
    position: p.pos,
    bearing: p.bearing,
    segment: p.index,
    traveled: d,
    remaining: r.length - d,
    remainingSec: r.duration * (1 - fraction),
    fraction,
    stepIndex,
    next,
    distanceToManeuver: Math.max(0, nextAt - d),
    arrived: d >= r.length - 1,
  };
}

/** The part of the line already driven, for the grey "traveled" overlay. */
export function traveledLine(r: NavRoute, p: NavProgress): LngLat[] {
  return [...r.coords.slice(0, p.segment + 1), p.position];
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}
