import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import type { Ride, RideStatus } from '@/api/types';
import { BidCard } from '@/components/BidCard';
import { Button } from '@/components/Button';
import { DriverCard } from '@/components/DriverCard';
import { IconButton } from '@/components/IconButton';
import { CarMarker, PinMarker } from '@/components/MapMarkers';
import { RouteSummary } from '@/components/RouteSummary';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { TripStatus } from '@/components/TripStatus';
import { formatMoney } from '@/lib/fare';
import { routePath } from '@/lib/geo';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, useTheme } from '@/theme';

const STEPS: RideStatus[] = ['searching', 'driver_assigned', 'arriving', 'arrived', 'in_trip', 'completed'];

function statusCopy(ride: Ride): { title: string; subtitle?: string } {
  const eta = ride.liveEtaMin ?? 0;
  switch (ride.status) {
    case 'bidding':
      return { title: 'Drivers are bidding', subtitle: `Choose a fare. The standard ${ride.quote.label} price is ${formatMoney(ride.quote.fare)}.` };
    case 'searching':
      return { title: 'Finding your driver…', subtitle: 'Matching you with a nearby WiiUp driver.' };
    case 'driver_assigned':
      return { title: 'Driver found!', subtitle: `${ride.driver?.name} is heading your way.` };
    case 'arriving':
      return { title: `Arriving in ${eta} min`, subtitle: `Meet at ${ride.pickup.address}` };
    case 'arrived':
      return { title: 'Your driver is here', subtitle: `Look for the ${ride.driver?.color} ${ride.driver?.car}.` };
    case 'in_trip':
      return { title: `${eta} min to destination`, subtitle: `Heading to ${ride.dropoff.name}` };
    case 'completed':
      return { title: 'You have arrived' };
    case 'cancelled':
      return { title: 'Ride cancelled' };
  }
}

export default function Trip() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const ride = useRide((s) => s.activeRide);
  const setActiveRide = useRide((s) => s.setActiveRide);
  const resetBooking = useRide((s) => s.resetBooking);
  const rideId = ride?.id;
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (!rideId) return;
    return api.subscribeRide(rideId, (r) => {
      const prev = useRide.getState().activeRide;
      if (prev?.status !== r.status) {
        if (r.status === 'driver_assigned' || r.status === 'arrived') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
      setActiveRide(r);
      if (r.status === 'completed') router.replace('/rate');
    });
  }, [rideId, setActiveRide]);

  const tripPath = useMemo(
    () => (ride ? routePath(ride.pickup.coords, ride.dropoff.coords, 40) : []),
    [ride?.pickup, ride?.dropoff], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Re-frame the map when the trip moves to a new stage.
  const status = ride?.status;
  useEffect(() => {
    if (!ride) return;
    const pts =
      status === 'in_trip'
        ? tripPath
        : ride.driver
          ? [ride.driver.location, ride.pickup.coords]
          : [ride.pickup.coords, ride.dropoff.coords];
    const t = setTimeout(
      () =>
        map.current?.fitToCoordinates(pts, {
          edgePadding: { top: insets.top + 90, right: 70, bottom: 420, left: 70 },
          animated: true,
        }),
      300,
    );
    return () => clearTimeout(t);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ride) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text tone="secondary">No active ride.</Text>
        <Button title="Back to map" onPress={() => router.replace('/')} style={{ marginTop: Spacing.lg }} />
      </View>
    );
  }

  const decide = async (bidId: string, accept: boolean) => {
    setDeciding(true);
    try {
      if (accept) await api.acceptBid(ride.id, bidId);
      else await api.declineBid(ride.id, bidId);
    } catch (e) {
      Alert.alert('Bid unavailable', e instanceof Error ? e.message : 'This bid is no longer available.');
    } finally {
      setDeciding(false);
    }
  };

  const copy = statusCopy(ride);
  const step = STEPS.indexOf(ride.status);
  const canCancel = ride.status !== 'in_trip' && ride.status !== 'completed' && ride.status !== 'cancelled';

  const cancel = () =>
    Alert.alert('Cancel ride?', ride.driver ? 'Your driver is already on the way.' : undefined, [
      { text: 'Keep ride', style: 'cancel' },
      {
        text: 'Cancel ride',
        style: 'destructive',
        onPress: async () => {
          await api.cancelRide(ride.id);
          resetBooking();
          router.replace('/');
        },
      },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...ride.pickup.coords, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsCompass={false}>
        {ride.status === 'in_trip' ? (
          <Polyline coordinates={tripPath} strokeColor={colors.brand} strokeWidth={5} />
        ) : (
          ride.driver && (
            <Polyline
              coordinates={[ride.driver.location, ride.pickup.coords]}
              strokeColor={colors.textSecondary}
              strokeWidth={3}
              lineDashPattern={[6, 6]}
            />
          )
        )}
        <PinMarker coordinate={ride.pickup.coords} kind="pickup" title="Pickup" />
        <PinMarker coordinate={ride.dropoff.coords} kind="dropoff" title={ride.dropoff.name} />
        {ride.driver && <CarMarker id={ride.driver.id} coordinate={ride.driver.location} />}
      </MapView>

      <View style={[styles.top, { top: insets.top + Spacing.sm }]}>
        <IconButton icon="map-outline" label="Back to map" onPress={() => router.navigate('/')} />
      </View>

      <Sheet>
        <TripStatus title={copy.title} subtitle={copy.subtitle} progress={Math.max(0, step) / (STEPS.length - 1)} />
        {ride.status === 'searching' && <ActivityIndicator color={colors.brand} style={{ paddingVertical: Spacing.lg }} />}
        {ride.status === 'bidding' &&
          (ride.bids?.length ? (
            ride.bids.map((b, i) => (
              <BidCard
                key={b.id}
                bid={b}
                standard={ride.quote.fare}
                lowest={i === 0}
                busy={deciding}
                onAccept={() => decide(b.id, true)}
                onDecline={() => decide(b.id, false)}
              />
            ))
          ) : (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.brand} />
              <Text tone="secondary">Waiting for drivers to bid…</Text>
            </View>
          ))}
        {ride.driver && <DriverCard driver={ride.driver} />}
        {ride.driver && ride.status !== 'in_trip' && (
          <View style={styles.actions}>
            <ActionChip icon="call" label="Call" onPress={() => Alert.alert('Calling driver', 'Calls are simulated in this demo.')} />
            <ActionChip icon="chatbubble" label="Message" onPress={() => Alert.alert('Message driver', 'Chat is coming soon.')} />
            <ActionChip icon="share-outline" label="Share trip" onPress={() => Alert.alert('Trip shared', 'Trip sharing is simulated in this demo.')} />
          </View>
        )}
        <RouteSummary pickup={ride.pickup} dropoff={ride.dropoff} />
        <View style={styles.fareRow}>
          <Text tone="secondary">{ride.quote.label}</Text>
          <Text variant="heading">{formatMoney(ride.quote.fare)}</Text>
        </View>
        {canCancel && <Button title="Cancel ride" variant="secondary" onPress={cancel} />}
      </Sheet>
    </View>
  );
}

function ActionChip({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text variant="caption">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  top: { position: 'absolute', left: Spacing.lg },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
