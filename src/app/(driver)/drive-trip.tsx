import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import type { DriverTripStage } from '@/api/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { CarMarker, PinMarker } from '@/components/MapMarkers';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { TripStatus } from '@/components/TripStatus';
import { formatMoney } from '@/lib/fare';
import { routePath } from '@/lib/geo';
import { useDriver } from '@/store/useDriver';
import { Spacing, useTheme } from '@/theme';

const STAGES: DriverTripStage[] = ['to_pickup', 'at_pickup', 'in_trip', 'completed'];

export default function DriverTrip() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const trip = useDriver((s) => s.activeTrip);
  const setActiveTrip = useDriver((s) => s.setActiveTrip);
  const finishTrip = useDriver((s) => s.finishTrip);
  const tripId = trip?.id;

  useEffect(() => {
    if (!tripId) return;
    return api.subscribeDriverTrip(tripId, (t) => {
      if (useDriver.getState().activeTrip?.id === t.id) setActiveTrip(t);
    });
  }, [tripId, setActiveTrip]);

  const req = trip?.request;
  const tripPath = useMemo(() => (req ? routePath(req.pickup.coords, req.dropoff.coords, 30) : []), [req]);

  const stage = trip?.stage;
  useEffect(() => {
    if (!trip) return;
    const pts = stage === 'in_trip' ? tripPath : [trip.location, trip.request.pickup.coords];
    const t = setTimeout(
      () =>
        map.current?.fitToCoordinates(pts, {
          edgePadding: { top: insets.top + 90, right: 70, bottom: 360, left: 70 },
          animated: true,
        }),
      300,
    );
    return () => clearTimeout(t);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!trip || !req) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text tone="secondary">No active trip.</Text>
        <Button title="Back" onPress={() => router.replace('/drive')} style={{ marginTop: Spacing.lg }} />
      </View>
    );
  }

  const act = (action: 'arrived' | 'start' | 'complete') => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    api.updateDriverTrip(trip.id, action);
  };

  const done = () => {
    finishTrip(trip);
    router.replace('/drive');
  };

  const cancel = () =>
    Alert.alert('Cancel this trip?', 'Frequent cancellations can affect your account.', [
      { text: 'Keep trip', style: 'cancel' },
      {
        text: 'Cancel trip',
        style: 'destructive',
        onPress: () => {
          // The rider is matched with another driver
          api.updateDriverTrip(trip.id, 'cancel').catch(() => {});
          setActiveTrip(null);
          router.replace('/drive');
        },
      },
    ]);

  const progress = STAGES.indexOf(trip.stage) / (STAGES.length - 1);

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...trip.location, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsCompass={false}>
        {trip.stage === 'in_trip' ? (
          <Polyline coordinates={tripPath} strokeColor={colors.brand} strokeWidth={5} />
        ) : trip.stage === 'to_pickup' ? (
          <Polyline coordinates={[trip.location, req.pickup.coords]} strokeColor={colors.accent} strokeWidth={4} lineDashPattern={[6, 6]} />
        ) : null}
        <PinMarker coordinate={req.pickup.coords} kind="pickup" title="Pickup" />
        <PinMarker coordinate={req.dropoff.coords} kind="dropoff" title="Drop-off" />
        <CarMarker id="me" coordinate={trip.location} />
      </MapView>

      <View style={[styles.top, { top: insets.top + Spacing.sm }]}>
        <IconButton icon="close" label="Cancel trip" onPress={cancel} />
        <IconButton
          icon="navigate"
          label="Open navigation"
          onPress={() => Alert.alert('Navigation', 'Turn-by-turn handoff to Apple Maps is coming soon.')}
        />
      </View>

      <Sheet>
        {trip.stage === 'to_pickup' && (
          <>
            <TripStatus title={`Picking up ${req.riderName}`} subtitle={`${trip.liveEtaMin} min · ${req.pickup.name}`} progress={progress} />
            <RiderRow name={req.riderName} rating={req.riderRating} />
            <Button title="I've arrived" onPress={() => act('arrived')} />
          </>
        )}
        {trip.stage === 'at_pickup' && (
          <>
            <TripStatus title={`Waiting for ${req.riderName}`} subtitle="Confirm the rider's name before starting." progress={progress} />
            <RiderRow name={req.riderName} rating={req.riderRating} />
            <Button title="Start trip" onPress={() => act('start')} />
          </>
        )}
        {trip.stage === 'in_trip' && (
          <>
            <TripStatus
              title={trip.liveEtaMin > 0 ? `${trip.liveEtaMin} min to drop-off` : 'At drop-off'}
              subtitle={req.dropoff.name}
              progress={progress}
            />
            <Button title="Complete trip" variant={trip.liveEtaMin > 0 ? 'secondary' : 'primary'} onPress={() => act('complete')} />
          </>
        )}
        {trip.stage === 'completed' && trip.cancelledBy && (
          <>
            <View style={styles.doneHeader}>
              <Ionicons name="close-circle" size={48} color={colors.textSecondary} />
              <Text variant="title">{trip.cancelledBy === 'rider' ? `${req.riderName} cancelled` : 'Trip cancelled'}</Text>
              <Text tone="secondary">This trip was cancelled, so it doesn&apos;t count toward your earnings.</Text>
            </View>
            <Button title="Done" onPress={() => (setActiveTrip(null), router.replace('/drive'))} />
          </>
        )}
        {trip.stage === 'completed' && !trip.cancelledBy && (
          <>
            <View style={styles.doneHeader}>
              <Ionicons name="checkmark-circle" size={48} color={colors.accent} />
              <Text variant="title">Trip complete</Text>
              <Text variant="hero" tone="accent">+{formatMoney(trip.earnings)}</Text>
              <Text tone="secondary">
                {req.quote.label} · {req.quote.distanceKm} km · rider paid {formatMoney(req.quote.fare)}
              </Text>
            </View>
            <Button title="Done" onPress={done} />
          </>
        )}
      </Sheet>
    </View>
  );
}

function RiderRow({ name, rating }: { name: string; rating: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rider}>
      <Avatar name={name} />
      <View style={{ flex: 1 }}>
        <Text variant="heading">{name}</Text>
        <Text variant="caption" tone="secondary">
          <Ionicons name="star" size={12} color={colors.warning} /> {rating.toFixed(2)}
        </Text>
      </View>
      <IconButton icon="call" label="Call rider" onPress={() => Alert.alert('Calling rider', 'Calls are simulated in this demo.')} />
      <IconButton icon="chatbubble" label="Message rider" onPress={() => Alert.alert('Message rider', 'Chat is coming soon.')} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  top: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between' },
  rider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  doneHeader: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
});
