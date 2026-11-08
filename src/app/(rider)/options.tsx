import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { PinMarker } from '@/components/MapMarkers';
import { RideTierCard } from '@/components/RideTierCard';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { routePath } from '@/lib/geo';
import { useAuth } from '@/store/useAuth';
import { useRide } from '@/store/useRide';
import { Spacing, useTheme } from '@/theme';

export default function RideOptions() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const user = useAuth((s) => s.user);
  const { pickup, dropoff, tier, quotes, setTier, setQuotes, setActiveRide } = useRide();
  const [requesting, setRequesting] = useState<'match' | 'bid' | null>(null);

  const path = useMemo(
    () => (pickup && dropoff ? routePath(pickup.coords, dropoff.coords, 40) : []),
    [pickup, dropoff],
  );

  useEffect(() => {
    if (!pickup || !dropoff) return;
    setQuotes([]);
    api.getQuotes(pickup.coords, dropoff.coords).then(setQuotes);
  }, [pickup, dropoff, setQuotes]);

  const fit = () =>
    map.current?.fitToCoordinates(path, {
      edgePadding: { top: insets.top + 80, right: 60, bottom: 460, left: 60 },
      animated: true,
    });

  if (!pickup || !dropoff) return <Redirect href="/" />;

  const selected = quotes.find((q) => q.tier === tier);

  const confirm = async (mode: 'match' | 'bid') => {
    if (!selected) return;
    setRequesting(mode);
    try {
      const ride = await api.requestRide({ riderName: user?.name ?? 'Rider', pickup, dropoff, quote: selected, mode });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setActiveRide(ride);
      router.replace('/trip');
    } catch {
      Alert.alert('Could not request ride', 'Please try again.');
    } finally {
      setRequesting(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} onMapReady={fit} showsCompass={false}>
        <Polyline coordinates={path} strokeColor={colors.brand} strokeWidth={5} />
        <PinMarker coordinate={pickup.coords} kind="pickup" title="Pickup" />
        <PinMarker coordinate={dropoff.coords} kind="dropoff" title={dropoff.name} />
      </MapView>

      <View style={[styles.back, { top: insets.top + Spacing.sm }]}>
        <IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />
      </View>

      <Sheet>
        <Text variant="heading" style={{ textAlign: 'center' }}>
          Choose a ride
        </Text>
        {quotes.length === 0 ? (
          <ActivityIndicator style={{ paddingVertical: 60 }} color={colors.brand} />
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {quotes.map((q) => (
              <RideTierCard key={q.tier} quote={q} selected={q.tier === tier} onPress={() => setTier(q.tier)} />
            ))}
          </View>
        )}
        <View style={styles.payment}>
          <Ionicons name="card" size={20} color={colors.text} />
          <Text variant="label" style={{ flex: 1 }}>
            Visa •••• 4242
          </Text>
          <Text variant="caption" tone="secondary">
            {selected ? `${selected.distanceKm} km` : ''}
          </Text>
        </View>
        <Button
          title={selected ? `Confirm ${selected.label} · ${formatMoney(selected.fare)}` : 'Confirm'}
          onPress={() => confirm('match')}
          loading={requesting === 'match'}
          disabled={!selected || requesting !== null}
        />
        <Button
          title="Get bids from drivers"
          variant="secondary"
          onPress={() => confirm('bid')}
          loading={requesting === 'bid'}
          disabled={!selected || requesting !== null}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: Spacing.lg },
  payment: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
});
