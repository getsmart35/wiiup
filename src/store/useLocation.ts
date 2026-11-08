import * as Location from 'expo-location';
import { create } from 'zustand';

import type { LatLng } from '@/api/types';
import { DEFAULT_LOCATION } from '@/lib/geo';

type LocationState = {
  coords: LatLng;
  status: 'unknown' | 'granted' | 'denied';
  refresh: () => Promise<LatLng>;
};

export const useLocation = create<LocationState>()((set, get) => ({
  coords: DEFAULT_LOCATION,
  status: 'unknown',
  refresh: async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        set({ status: 'denied' });
        return get().coords;
      }
      const pos =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      set({ coords, status: 'granted' });
      return coords;
    } catch {
      set({ status: 'denied' });
      return get().coords;
    }
  },
}));
