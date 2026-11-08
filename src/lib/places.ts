import * as Location from 'expo-location';

import type { LatLng, Place } from '@/api/types';

/** Seeded destinations placed relative to the user so search works anywhere, even offline. */
const POPULAR: { name: string; address: string; dLat: number; dLng: number }[] = [
  { name: 'International Airport', address: 'Terminal 2 · Departures', dLat: -0.15, dLng: 0.03 },
  { name: 'Central Station', address: 'Main concourse', dLat: 0.012, dLng: 0.018 },
  { name: 'City Hall', address: 'Civic Center', dLat: 0.004, dLng: -0.006 },
  { name: 'Riverside Mall', address: 'North entrance', dLat: -0.022, dLng: 0.031 },
  { name: 'University Campus', address: 'Student Union', dLat: 0.035, dLng: -0.02 },
  { name: 'Waterfront Park', address: 'Pier 3', dLat: 0.028, dLng: 0.04 },
  { name: 'General Hospital', address: 'Main entrance', dLat: -0.01, dLng: -0.025 },
  { name: 'Stadium', address: 'Gate A', dLat: -0.03, dLng: -0.012 },
];

export function popularPlaces(near: LatLng): Place[] {
  return POPULAR.map((p, i) => ({
    id: `popular_${i}`,
    name: p.name,
    address: p.address,
    coords: { latitude: near.latitude + p.dLat, longitude: near.longitude + p.dLng },
  }));
}

export async function searchPlaces(query: string, near: LatLng): Promise<Place[]> {
  const q = query.trim().toLowerCase();
  if (!q) return popularPlaces(near);

  const local = popularPlaces(near).filter(
    (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
  );

  let geocoded: Place[] = [];
  if (q.length >= 3) {
    try {
      const results = await Location.geocodeAsync(query);
      geocoded = await Promise.all(
        results.slice(0, 5).map(async (r, i) => {
          const coords = { latitude: r.latitude, longitude: r.longitude };
          let address = `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`;
          try {
            const [rev] = await Location.reverseGeocodeAsync(coords);
            if (rev) address = [rev.street, rev.city, rev.region].filter(Boolean).join(', ') || address;
          } catch {}
          return { id: `geo_${i}_${r.latitude}_${r.longitude}`, name: query.trim(), address, coords };
        }),
      );
    } catch {
      // Geocoding can fail offline or when rate-limited; fall back to local matches.
    }
  }
  return [...local, ...geocoded];
}

export async function describeLocation(coords: LatLng): Promise<Place> {
  let address = 'Current location';
  try {
    const [rev] = await Location.reverseGeocodeAsync(coords);
    if (rev) address = [rev.name ?? rev.street, rev.city].filter(Boolean).join(', ') || address;
  } catch {}
  return { id: 'current', name: 'Current location', address, coords };
}
