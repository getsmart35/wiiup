import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { RatingStars } from '@/components/RatingStars';
import { RouteSummary } from '@/components/RouteSummary';
import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, useTheme } from '@/theme';

const TIPS = [0, 1, 2, 5];

export default function Rate() {
  const { colors } = useTheme();
  const ride = useRide((s) => s.activeRide);
  const finishRide = useRide((s) => s.finishRide);
  const resetBooking = useRide((s) => s.resetBooking);
  const [rating, setRating] = useState(5);
  const [tip, setTip] = useState(0);

  const done = () => {
    if (ride) finishRide({ ...ride, rating, tip });
    resetBooking();
    router.replace('/');
  };

  if (!ride) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Button title="Back to map" onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  const total = ride.quote.fare + tip;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.check, { backgroundColor: colors.accent }]}>
          <Ionicons name="checkmark" size={36} color="#fff" />
        </View>
        <Text variant="title" style={{ textAlign: 'center' }}>
          You’ve arrived!
        </Text>
        <Text tone="secondary" style={{ textAlign: 'center' }}>
          {ride.dropoff.name}
        </Text>

        {ride.driver && (
          <View style={styles.driver}>
            <Avatar name={ride.driver.name} size={64} />
            <Text variant="heading">How was your ride with {ride.driver.name}?</Text>
            <RatingStars value={rating} onChange={setRating} />
          </View>
        )}

        <View style={{ gap: Spacing.sm }}>
          <Text variant="label">Add a tip</Text>
          <View style={styles.tips}>
            {TIPS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setTip(t)}
                accessibilityState={{ selected: tip === t }}
                style={[
                  styles.tip,
                  { borderColor: tip === t ? colors.brand : colors.border, backgroundColor: tip === t ? colors.brandSoft : 'transparent' },
                ]}>
                <Text variant="label">{t === 0 ? 'No tip' : `$${t}`}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.receipt, { backgroundColor: colors.surface }]}>
          <RouteSummary pickup={ride.pickup} dropoff={ride.dropoff} />
          <View style={[styles.hr, { backgroundColor: colors.border }]} />
          <Row label={`${ride.quote.label} · ${ride.quote.distanceKm} km`} value={formatMoney(ride.quote.fare)} />
          {tip > 0 && <Row label="Tip" value={formatMoney(tip)} />}
          <Row label="Total · Visa •••• 4242" value={formatMoney(total)} bold />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Done" onPress={done} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={bold ? 'label' : 'body'} tone={bold ? 'default' : 'secondary'}>{label}</Text>
      <Text variant={bold ? 'heading' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  content: { padding: Spacing.xl, gap: Spacing.lg },
  check: { alignSelf: 'center', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  driver: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  tips: { flexDirection: 'row', gap: Spacing.sm },
  tip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 2 },
  receipt: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.md },
  hr: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md },
});
