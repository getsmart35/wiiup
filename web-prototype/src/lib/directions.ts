import { haversine, type LngLat } from './geo';

export type RouteStep = {
  distance: number;
  duration: number;
  name: string;
  type: string;
  modifier?: string;
  location: LngLat;
  instruction: string;
  /** Spoken prompts, positioned by meters remaining before the end of this step (Mapbox convention). */
  voice: { distanceAlong: number; text: string }[];
};

export type Route = {
  coords: LngLat[];
  distance: number;
  duration: number;
  steps: RouteStep[];
  provider: 'mapbox' | 'osrm' | 'straight';
};

export const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN || undefined;
export const ROUTING_PROVIDER = MAPBOX_TOKEN ? 'Mapbox Directions API' : 'OSRM demo router';

type ApiStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: LngLat; instruction?: string };
  voiceInstructions?: { distanceAlongGeometry: number; announcement: string }[];
};
type ApiRoute = { distance: number; duration: number; geometry: { coordinates: LngLat[] }; legs: { steps: ApiStep[] }[] };

/** Driving route with turn-by-turn steps. Mapbox when a token is set, otherwise OSRM; same response shape. */
export async function getRoute(from: LngLat, to: LngLat, signal?: AbortSignal): Promise<Route> {
  const pair = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url = MAPBOX_TOKEN
    ? `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${pair}?geometries=geojson&overview=full&steps=true&voice_instructions=true&banner_instructions=true&voice_units=metric&language=en&access_token=${MAPBOX_TOKEN}`
    : `https://router.project-osrm.org/route/v1/driving/${pair}?geometries=geojson&overview=full&steps=true`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Directions request failed (${res.status})`);
    const body = (await res.json()) as { routes?: ApiRoute[] };
    const r = body.routes?.[0];
    if (!r) throw new Error('No route found');
    const steps = r.legs.flatMap((l) => l.steps).map(toStep);
    if (!MAPBOX_TOKEN) addSyntheticVoice(steps);
    return { coords: r.geometry.coordinates, distance: r.distance, duration: r.duration, steps, provider: MAPBOX_TOKEN ? 'mapbox' : 'osrm' };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    console.warn('Directions unavailable, using a straight line:', e);
    return straightLine(from, to);
  }
}

function toStep(s: ApiStep): RouteStep {
  const { type, modifier, location } = s.maneuver;
  return {
    distance: s.distance,
    duration: s.duration,
    name: s.name,
    type,
    modifier,
    location,
    instruction: s.maneuver.instruction || composeInstruction(type, modifier, s.name),
    voice: (s.voiceInstructions ?? []).map((v) => ({ distanceAlong: v.distanceAlongGeometry, text: v.announcement })),
  };
}

/** OSRM has no instruction text or voice prompts; build the same kind Mapbox returns. */
export function composeInstruction(type: string, modifier: string | undefined, name: string): string {
  const onto = name ? ` onto ${name}` : '';
  const turn = (m?: string) =>
    m === 'uturn' ? 'Make a U-turn' : m === 'straight' ? 'Continue straight' : m?.startsWith('slight') ? `Bear ${m.split(' ')[1]}` : m?.startsWith('sharp') ? `Make a sharp ${m.split(' ')[1]}` : `Turn ${m ?? 'ahead'}`;
  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Head out';
    case 'arrive':
      return 'You have arrived at your destination';
    case 'merge':
      return `Merge${onto}`;
    case 'on ramp':
      return `Take the ramp${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'roundabout':
    case 'rotary':
      return `At the roundabout, take the exit${onto}`;
    case 'new name':
    case 'continue':
      return `Continue${onto}`;
    default:
      return `${turn(modifier)}${onto}`;
  }
}

function addSyntheticVoice(steps: RouteStep[]) {
  for (let i = 0; i < steps.length - 1; i++) {
    const next = steps[i + 1].instruction;
    if (steps[i].distance > 300) steps[i].voice.push({ distanceAlong: 200, text: `In 200 meters, ${lower(next)}` });
    steps[i].voice.push({ distanceAlong: Math.min(40, steps[i].distance), text: next });
  }
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function straightLine(from: LngLat, to: LngLat): Route {
  const distance = haversine(from, to) * 1.3;
  const duration = distance / 8;
  return {
    coords: [from, to],
    distance,
    duration,
    provider: 'straight',
    steps: [
      { distance, duration, name: '', type: 'depart', location: from, instruction: 'Head toward the destination', voice: [] },
      { distance: 0, duration: 0, name: '', type: 'arrive', location: to, instruction: 'You have arrived at your destination', voice: [] },
    ],
  };
}
