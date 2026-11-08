import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import type { Driver, Place } from '@/api/types';
import { IconButton } from '@/components/IconButton';
import { CarMarker } from '@/components/MapMarkers';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { describeLocation, popularPlaces } from '@/lib/places';
import { useAuth } from '@/store/useAuth';
import { useLocation } from '@/store/useLocation';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, useTheme } from '@/theme';

const DELTA = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

export default function RiderHome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const user = useAuth((s) => s.user);
  const coords = useLocation((s) => s.coords);
  const locStatus = useLocation((s) => s.status);
  const { recents, activeRide, setPickup, setDropoff } = useRide();
  const [drivers, setDrivers] = useState<Driver[]>([]);

  useEffect(() => {
    describeLocation(coords).then(setPickup);
    api.getNearbyDrivers(coords).then(setDrivers);
    map.current?.animateToRegion({ ...coords, ...DELTA }, 400);
  }, [coords, setPickup]);

  const recenter = async () => {
    const c = await useLocation.getState().refresh();
    map.current?.animateToRegion({ ...c, ...DELTA }, 400);
  };

  const choose = (place: Place) => {
    setDropoff(place);
    router.push('/options');
  };

  const suggestions = (recents.length ? recents : popularPlaces(coords)).slice(0, 3);
  const firstName = user?.name.split(' ')[0] ?? '';
  const rideInProgress = activeRide && activeRide.status !== 'completed' && activeRide.status !== 'cancelled';

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...coords, ...DELTA }}
        showsUserLocation={locStatus === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}>
        {drivers.map((d) => (
          <CarMarker key={d.id} id={d.id} coordinate={d.location} />
        ))}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]}>
        <IconButton icon="person-circle-outline" label="Account" onPress={() => router.push('/profile')} />
        <IconButton icon="locate" label="Center on my location" onPress={recenter} />
      </View>

      <Sheet>
        {rideInProgress && (
          <Pressable
            onPress={() => router.push('/trip')}
            style={[styles.banner, { backgroundColor: colors.brand }]}>
            <Ionicons name="car" size={18} color="#fff" />
            <Text variant="label" tone="inverse" style={{ flex: 1 }}>
              Your ride is in progress
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}
        <Text variant="title">{firstName ? `Hey ${firstName}, where to?` : 'Where to?'}</Text>
        {locStatus === 'denied' && (
          <Text variant="caption" tone="secondary">
            Location is off. Using a default pickup point. You can enable location in Settings.
          </Text>
        )}
        <Pressable
          accessibilityRole="search"
          onPress={() => router.push('/search')}
          style={[styles.search, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={20} color={colors.text} />
          <Text variant="heading" tone="secondary">
            Search destination
          </Text>
        </Pressable>
        {suggestions.map((p) => (
          <Pressable key={p.id} onPress={() => choose(p)} style={styles.suggestion}>
            <View style={[styles.suggestionIcon, { backgroundColor: colors.surface }]}>
              <Ionicons name={recents.length ? 'time-outline' : 'location-outline'} size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" numberOfLines={1}>{p.name}</Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>{p.address}</Text>
            </View>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, height: 56, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  suggestionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
