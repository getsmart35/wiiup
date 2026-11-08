import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import type { RideTier } from '@/api/types';
import { Button } from '@/components/Button';
import { LineItem, StepperRow, TierTabs } from '@/components/RateControls';
import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { limitReached, PLANS, planCost } from '@/lib/plans';
import { cents, ratesInUse, suggestedRates, tripFare } from '@/lib/rates';
import { usePlanStatus, useRateCards } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

const TRIPS = [
  { label: 'Short', miles: 3, minutes: 12 },
  { label: 'Typical', miles: 8, minutes: 22 },
  { label: 'Airport', miles: 18, minutes: 35 },
];

export default function RateCalculator() {
  const { colors } = useTheme();
  const cards = useRateCards((s) => s.cards);
  const { plan } = usePlanStatus();
  const [tier, setTier] = useState<RideTier>('go');
  const [miles, setMiles] = useState(8);
  const [minutes, setMinutes] = useState(22);
  const [busy, setBusy] = useState(false);
  const [perDay, setPerDay] = useState(12);
  const [days, setDays] = useState(14);

  const rates = ratesInUse(cards, tier);
  const result = tripFare(rates, miles, minutes, busy);
  const suggestedFare = tripFare(suggestedRates(tier), miles, minutes, busy).fare;
  const diff = cents(result.fare - suggestedFare);
  const monthFares = cents(result.fare * perDay * days);
  const fee = planCost(plan, monthFares);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <TierTabs tier={tier} onChange={setTier} />
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.chips}>
          {TRIPS.map((t) => {
            const on = miles === t.miles && minutes === t.minutes;
            return (
              <Pressable
                key={t.label}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => { setMiles(t.miles); setMinutes(t.minutes); }}
                style={[styles.chip, { borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brandSoft : 'transparent' }]}>
                <Text variant="label">{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <StepperRow label="Distance" value={`${miles} mi`} lowerDisabled={miles <= 1} raiseDisabled={miles >= 100} onLower={() => setMiles(miles - 1)} onRaise={() => setMiles(miles + 1)} />
        <StepperRow label="Time" value={`${minutes} min`} lowerDisabled={minutes <= 1} raiseDisabled={minutes >= 180} onLower={() => setMinutes(minutes - 1)} onRaise={() => setMinutes(minutes + 1)} />
        <View style={styles.toggle}>
          <Text variant="label" style={{ flex: 1 }}>Busy time (adds surge)</Text>
          <Switch accessibilityLabel="Busy time" value={busy} onValueChange={setBusy} trackColor={{ true: colors.brand }} />
        </View>
        <View accessibilityLiveRegion="polite">
          <Text variant="caption" tone="secondary">{cards[tier].useSuggested ? 'Suggested rates' : 'Your custom rates'} · you earn</Text>
          <Text variant="hero">{formatMoney(result.fare)}</Text>
          <Text variant="caption" tone="secondary">
            {diff === 0 ? 'Same as suggested rates' : `${formatMoney(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than suggested (${formatMoney(suggestedFare)})`}
          </Text>
        </View>
        <LineItem label="Base fare" value={formatMoney(result.base)} />
        <LineItem label={`${miles} mi × ${formatMoney(rates.perMile)}`} value={formatMoney(result.distance)} />
        <LineItem label={`${minutes} min × ${formatMoney(rates.perMin)}`} value={formatMoney(result.time)} />
        {result.minimumApplied && <LineItem label="Raised to your minimum fare" value={formatMoney(rates.minimum)} />}
        {busy && <LineItem label="Surge" value={formatMoney(result.surge)} />}
        <LineItem total label="Fare" value={formatMoney(result.fare)} />
      </View>

      <Text variant="label" tone="secondary">IF EVERY TRIP WERE LIKE THIS</Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <StepperRow label="Trips a day" value={String(perDay)} lowerDisabled={perDay <= 1} raiseDisabled={perDay >= 40} onLower={() => setPerDay(perDay - 1)} onRaise={() => setPerDay(perDay + 1)} />
        <StepperRow label="Days a month" value={String(days)} lowerDisabled={days <= 1} raiseDisabled={days >= 31} onLower={() => setDays(days - 1)} onRaise={() => setDays(days + 1)} />
        <LineItem label="Fares in a month" value={formatMoney(monthFares)} />
        <LineItem label={`${PLANS[plan].name} fee`} value={`-${formatMoney(fee)}`} />
        <LineItem total label="You take home, before tips and costs" value={formatMoney(monthFares - fee)} />
        {limitReached(plan, monthFares) && <Text variant="caption" tone="danger">These fares reach your {PLANS[plan].name} limit, so you&apos;d need to upgrade to keep accepting rides.</Text>}
      </View>
      <Button title="Change my rates" variant="secondary" onPress={() => router.push('/rate-card')} />
      <Text variant="caption" tone="secondary">Estimates only. Gas, insurance, taxes and vehicle costs aren&apos;t included.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 48 },
  card: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.md },
  chips: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, height: 40, borderRadius: Radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
