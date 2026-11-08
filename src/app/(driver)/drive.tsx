import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import type { RideRequest } from '@/api/types';
import { Button } from '@/components/Button';
import { DriverMenu } from '@/components/DriverMenu';
import { IconButton } from '@/components/IconButton';
import { CarMarker, PinMarker } from '@/components/MapMarkers';
import { RouteSummary } from '@/components/RouteSummary';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { UpgradeCard } from '@/components/UpgradeCard';
import { formatMoney } from '@/lib/fare';
import { availableBalance, useDriver } from '@/store/useDriver';
import { useLocation } from '@/store/useLocation';
import { usePlanStatus } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

const DELTA = { latitudeDelta: 0.03, longitudeDelta: 0.03 };
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

export default function DriverHome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const deviceCoords = useLocation((s) => s.coords);
  const { online, setOnline, position, completed, payouts, activeTrip, setActiveTrip } = useDriver();
  const planStatus = usePlanStatus();
  const here = position ?? deviceCoords;
  const [request, setRequest] = useState<RideRequest | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [accepting, setAccepting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Listen for ride offers while online and idle.
  useEffect(() => {
    if (!online || activeTrip || planStatus.atLimit) return;
    return api.subscribeRequests(
      () => useDriver.getState().position ?? useLocation.getState().coords,
      (req) => {
        setRequest((cur) => {
          if (cur) return cur; // already showing an offer
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          setMenuOpen(false); // an offer has a short window to accept, so it takes over from the menu
          return req;
        });
      },
    );
  }, [online, activeTrip, planStatus.atLimit]);

  // At a tier's limit a driver can't accept rides, so they go offline until they upgrade or the period resets.
  useEffect(() => {
    if (planStatus.atLimit && online) setOnline(false);
  }, [planStatus.atLimit, online, setOnline]);

  // Countdown for the current offer.
  useEffect(() => {
    if (!request) return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= request.expiresAt) setRequest(null);
    }, 250);
    return () => clearInterval(iv);
  }, [request]);

  useEffect(() => {
    if (request) {
      map.current?.fitToCoordinates([here, request.pickup.coords, request.dropoff.coords], {
        edgePadding: { top: insets.top + 90, right: 60, bottom: 440, left: 60 },
        animated: true,
      });
    } else {
      map.current?.animateToRegion({ ...here, ...DELTA }, 400);
    }
  }, [request, here, insets.top]);

  const accept = async () => {
    if (!request) return;
    setAccepting(true);
    try {
      const trip = await api.acceptRequest(request, here, request.quote.fare);
      setActiveTrip(trip);
      setRequest(null);
      router.push('/drive-trip');
    } catch {
      Alert.alert('Could not accept', 'This ride is no longer available.');
      setRequest(null);
    } finally {
      setAccepting(false);
    }
  };

  const toggleOnline = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRequest(null);
    setOnline(!online);
  };

  const today = completed.filter((t) => (t.completedAt ?? 0) >= startOfToday());
  const todayTotal = today.reduce((sum, t) => sum + t.earnings, 0);
  const balance = availableBalance(completed, payouts);
  const secondsLeft = request ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : 0;

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={{ ...here, ...DELTA }} showsCompass={false}>
        <CarMarker id="me" coordinate={here} />
        {request && <PinMarker coordinate={request.pickup.coords} kind="pickup" title="Pickup" />}
        {request && <PinMarker coordinate={request.dropoff.coords} kind="dropoff" title="Drop-off" />}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]}>
        <IconButton icon="menu" label="Menu" onPress={() => setMenuOpen(true)} />
        <View style={[styles.earningsPill, { backgroundColor: colors.text }]}>
          <Text variant="heading" style={{ color: colors.background }} onPress={() => router.push('/earnings')}>
            {formatMoney(todayTotal)}
          </Text>
        </View>
        <IconButton icon="stats-chart" label="Earnings" onPress={() => router.push('/earnings')} />
      </View>

      <Sheet>
        {activeTrip ? (
          <>
            <Text variant="heading">You have a trip in progress</Text>
            <Button title="Return to trip" onPress={() => router.push('/drive-trip')} />
          </>
        ) : request ? (
          <>
            <View style={styles.offerHeader}>
              <View>
                <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                  NEW REQUEST · {request.quote.label.toUpperCase()}
                </Text>
                <Text variant="hero">{formatMoney(request.quote.fare)}</Text>
                <Text tone="secondary">
                  {request.quote.etaMin} min away · {request.quote.distanceKm} km trip
                </Text>
              </View>
              <View style={[styles.timer, { borderColor: colors.brand }]}>
                <Text variant="heading" tone="brand">{secondsLeft}</Text>
              </View>
            </View>
            <View style={styles.rider}>
              <Ionicons name="person-circle" size={22} color={colors.textSecondary} />
              <Text tone="secondary">
                {request.riderName} · <Ionicons name="star" size={12} color={colors.warning} /> {request.riderRating.toFixed(2)}
              </Text>
            </View>
            <RouteSummary pickup={request.pickup} dropoff={request.dropoff} />
            <View style={styles.buttons}>
              <Button title="Decline" variant="secondary" onPress={() => setRequest(null)} style={{ flex: 1 }} />
              <Button title="Accept" onPress={accept} loading={accepting} style={{ flex: 2 }} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: online ? colors.accent : colors.textSecondary }]} />
              <Text variant="title">{online ? "You're online" : "You're offline"}</Text>
            </View>
            <Text tone="secondary">
              {online ? 'Looking for ride requests near you…' : 'Go online to start receiving ride requests.'}
            </Text>
            <View style={[styles.stats, { backgroundColor: colors.surface }]}>
              <Stat label="Today" value={formatMoney(todayTotal)} />
              <Stat label="Trips" value={String(today.length)} />
              <Stat label="Rating" value="4.95" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Instant payout, ${formatMoney(balance)} available`}
              onPress={() => router.push('/instant-payout')}
              style={[styles.payout, { backgroundColor: colors.surface }]}>
              <Ionicons name="flash" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text variant="label">Instant payout</Text>
                <Text variant="caption" tone="secondary">{formatMoney(balance)} available</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
            {planStatus.atLimit && planStatus.upgradeOption ? (
              <UpgradeCard />
            ) : (
              <Button title={online ? 'Go offline' : 'Go online'} variant={online ? 'secondary' : 'primary'} onPress={toggleOnline} />
            )}
          </>
        )}
      </Sheet>
      {menuOpen && <DriverMenu onClose={closeMenu} />}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earningsPill: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.pill },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  timer: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  rider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  stats: { flexDirection: 'row', paddingVertical: Spacing.md, borderRadius: Radius.lg },
  payout: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg },
});
