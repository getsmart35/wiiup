import type { LngLat } from './geo';

export type Place = { id: string; name: string; address: string; coords: LngLat };

/** Demo city: San Francisco. Names follow the Expo app's seeded places. */
export const PICKUP: Place = { id: 'current', name: 'Current location', address: '600 Market St', coords: [-122.4011, 37.7892] };
export const DRIVER_START: LngLat = [-122.4066, 37.7952];
export const DRIVER_HOME: LngLat = [-122.4148, 37.7868];

export const PLACES: Place[] = [
  { id: 'air', name: 'International Airport', address: 'Terminal 2 · Departures', coords: [-122.3839, 37.6164] },
  { id: 'cen', name: 'Central Station', address: '4th & King · Main concourse', coords: [-122.3949, 37.7766] },
  { id: 'hall', name: 'City Hall', address: 'Civic Center', coords: [-122.4182, 37.7793] },
  { id: 'mall', name: 'Riverside Mall', address: 'North entrance', coords: [-122.4072, 37.7841] },
  { id: 'uni', name: 'University Campus', address: 'Student Union', coords: [-122.4797, 37.7224] },
  { id: 'park', name: 'Waterfront Park', address: 'Pier 3', coords: [-122.3986, 37.7987] },
  { id: 'hosp', name: 'General Hospital', address: 'Main entrance', coords: [-122.4048, 37.7555] },
  { id: 'stad', name: 'Stadium', address: 'Gate A', coords: [-122.3893, 37.7786] },
];

export const IDLE_CARS: LngLat[] = [
  [-122.4042, 37.7911],
  [-122.3978, 37.7872],
  [-122.4061, 37.7859],
  [-122.3965, 37.7925],
  [-122.4092, 37.7898],
];
