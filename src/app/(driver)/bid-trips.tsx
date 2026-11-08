import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import type { TripForBid } from '@/api/types';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/RateControls';
import { RouteSummary } from '@/components/RouteSummary';
import { Text } from '@/components/Text';
import { UpgradeCard } from '@/components/UpgradeCard';
import { BID_RANGE, BID_STEP, clampBid, MAX_BIDDERS } from '@/lib/bids';
import { formatMoney } from '@/lib/fare';
import { useDriver } from '@/store/useDriver';
import { useLocation } from '@/store/useLocation';
import { usePlanStatus } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Open trips that take bids. Each starts at the driver's rate card price; the driver sets their own fare. */
export default function BidTrips() {
  const { colors } = useTheme();
  const activeTrip = useDriver((s) => s.activeTrip);
  const setActiveTrip = useDriver((s) => s.setActiveTrip);
  const planStatus = usePlanStatus();
  const [trips, setTrips] = useState<TripForBid[] | null>(null);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [sending, setSending] = useState<string | null>(null);
  const started = useRef(new Set<string>());

  useEffect(
    () => api.subscribeTripsForBid(() => useDriver.getState().position ?? useLocation.getState().coords, setTrips),
    [],
  );

  // A rider accepted one of this driver's bids: the trip starts
  useEffect(() => {
    const won = trips?.find((t) => t.myBid?.status === 'accepted' && t.myBid.trip && !started.current.has(t.id));
    if (!won?.myBid?.trip || useDriver.getState().activeTrip) return;
    started.current.add(won.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setActiveTrip(won.myBid.trip);
    router.push('/drive-trip');
  }, [trips, setActiveTrip]);

  const fareFor = (t: TripForBid) => bids[t.id] ?? t.cardFare;
  const nudge = (t: TripForBid, step: number) =>
    setBids((b) => ({ ...b, [t.id]: clampBid(fareFor(t) + step, { min: t.minBid, max: t.maxBid }) }));

  const send = async (t: TripForBid) => {
    setSending(t.id);
    try {
      await api.placeBid(t.id, fareFor(t));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Bid not sent', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setSending(null);
    }
  };

  const blocked = planStatus.atLimit ? 'limit' : activeTrip ? 'busy' : null;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.intro, { backgroundColor: colors.brandSoft }]}>
        <Text variant="label">Set your own fare</Text>
        <Text variant="caption">
          Each bid starts at your rate card price for the trip. You can bid from {pct(BID_RANGE.min)} to {pct(BID_RANGE.max)} of it, in{' '}
          {formatMoney(BID_STEP)} steps. Up to {MAX_BIDDERS} drivers can bid on a trip. Riders see the three lowest bids, and you keep 100% of the fare.
        </Text>
        <Button title="Change my rate card" variant="ghost" onPress={() => router.push('/rate-card')} style={{ minHeight: 36, alignSelf: 'flex-start', paddingHorizontal: 0 }} />
      </View>

      {blocked === 'limit' && <UpgradeCard />}
      {blocked === 'busy' && (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="label">Finish your current trip to bid again</Text>
          <Button title="Return to trip" onPress={() => router.push('/drive-trip')} />
        </View>
      )}

      {trips === null ? (
        <ActivityIndicator color={colors.brand} style={{ paddingVertical: 40 }} />
      ) : trips.length === 0 ? (
        <Text tone="secondary" style={{ textAlign: 'center', paddingVertical: 40 }}>No trips are taking bids nearby right now.</Text>
      ) : (
        trips.map((t) => {
          const fare = fareFor(t);
          const diff = Math.round((fare - t.cardFare) * 100) / 100;
          return (
            <View key={t.id} style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.spread}>
                <Text variant="label">{t.quote.label}</Text>
                <Text variant="caption" tone="secondary">
                  {t.quote.distanceKm} km · {t.quote.durationMin} min · {t.quote.etaMin} min away
                </Text>
              </View>
              <RouteSummary pickup={t.pickup} dropoff={t.dropoff} />
              <View style={styles.inline}>
                <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
                <Text variant="caption" tone="secondary" style={{ flex: 1 }}>{t.riderName} · {t.riderRating.toFixed(2)}★</Text>
                {!t.myBid && (
                  <Text variant="caption" tone={t.bidsLeft > 0 ? 'secondary' : 'danger'}>
                    {t.bidsLeft > 0 ? `${MAX_BIDDERS - t.bidsLeft} of ${MAX_BIDDERS} bids` : 'Bidding full'}
                  </Text>
                )}
              </View>

              {t.myBid ? (
                <BidStatus trip={t} />
              ) : (
                <>
                  <View style={styles.bidRow}>
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" tone="secondary">Your bid · rate card {formatMoney(t.cardFare)}</Text>
                      <Text variant="title">{formatMoney(fare)}</Text>
                      <Text variant="caption" tone={diff === 0 ? 'secondary' : 'brand'}>
                        {diff === 0 ? 'Your rate card price' : `${formatMoney(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your rate card`}
                      </Text>
                    </View>
                    <Stepper
                      label="bid"
                      lowerDisabled={fare <= t.minBid}
                      raiseDisabled={fare >= t.maxBid}
                      onLower={() => nudge(t, -BID_STEP)}
                      onRaise={() => nudge(t, BID_STEP)}
                    />
                  </View>
                  <Button
                    title={t.bidsLeft > 0 ? `Bid ${formatMoney(fare)}` : `${MAX_BIDDERS} drivers have bid`}
                    loading={sending === t.id}
                    disabled={!!blocked || sending !== null || t.bidsLeft <= 0}
                    onPress={() => send(t)}
                  />
                </>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function BidStatus({ trip }: { trip: TripForBid }) {
  const { colors } = useTheme();
  const bid = trip.myBid!;
  const copy = {
    pending: { icon: 'time-outline', text: `Bid of ${formatMoney(bid.fare)} sent. Waiting for ${trip.riderName} to choose.` },
    accepted: { icon: 'checkmark-circle', text: `${trip.riderName} accepted your ${formatMoney(bid.fare)} bid.` },
    lost: { icon: 'close-circle-outline', text: `${trip.riderName} chose another driver.` },
    declined: { icon: 'close-circle-outline', text: `${trip.riderName} declined your bid.` },
    expired: { icon: 'hourglass-outline', text: 'Your bid expired.' },
  }[bid.status] as { icon: keyof typeof Ionicons.glyphMap; text: string };
  return (
    <View accessibilityLiveRegion="polite" style={[styles.inline, styles.status, { backgroundColor: bid.status === 'accepted' ? colors.brandSoft : colors.background }]}>
      <Ionicons name={copy.icon} size={18} color={bid.status === 'accepted' ? colors.brand : colors.textSecondary} />
      <Text variant="caption" style={{ flex: 1 }}>{copy.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 48 },
  intro: { padding: Spacing.md, borderRadius: Radius.lg, gap: 4 },
  card: { padding: Spacing.md, borderRadius: Radius.lg, gap: Spacing.sm },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  status: { padding: Spacing.sm, borderRadius: Radius.md },
});
