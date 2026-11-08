import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';

import type { RideTier } from '@/api/types';
import { Button } from '@/components/Button';
import { Stepper, TierTabs } from '@/components/RateControls';
import { Text } from '@/components/Text';
import { formatMoney, TIERS } from '@/lib/fare';
import { cents, RATE_FIELDS, suggestedRates, type RateField } from '@/lib/rates';
import { useRateCards } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

export default function RateCard() {
  const { colors } = useTheme();
  const { cards, saveCard } = useRateCards();
  const [tier, setTier] = useState<RideTier>('go');
  const [drafts, setDrafts] = useState(cards);
  const draft = drafts[tier];
  const saved = cards[tier];
  const suggested = suggestedRates(tier);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  const nudge = (id: RateField, step: number, min: number, max: number) =>
    setDrafts((d) => ({ ...d, [tier]: { ...d[tier], custom: { ...d[tier].custom, [id]: Math.min(max, Math.max(min, cents(d[tier].custom[id] + step))) } } }));

  const submit = () => {
    saveCard(tier, draft);
    Alert.alert('Rate card updated', `Your ${TIERS[tier].label} rates apply to your next ride offer.`);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <TierTabs tier={tier} onChange={setTier} />
      <View style={[styles.status, { backgroundColor: colors.surface }]}>
        <Text variant="caption">{TIERS[tier].label} is using {saved.useSuggested ? 'suggested' : 'your custom'} rates. You keep 100%.</Text>
      </View>

      <View style={styles.row}>
        <Text variant="caption" tone="secondary" style={styles.left}>SUGGESTED</Text>
        <Text variant="caption" tone="secondary" style={styles.middle}>CUSTOM</Text>
        <View style={{ width: 96 }} />
      </View>
      {RATE_FIELDS.map((f) => {
        const value = draft.custom[f.id];
        return (
          <View key={f.id} style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={styles.left}>
              <Text variant="caption" tone="secondary">{f.label}</Text>
              <Text variant="label">{formatMoney(suggested[f.id])}</Text>
            </View>
            <Text variant="label" tone={draft.useSuggested ? 'secondary' : 'default'} style={styles.middle}>
              {formatMoney(draft.useSuggested ? suggested[f.id] : value)}
            </Text>
            <Stepper
              label={f.label}
              lowerDisabled={draft.useSuggested || value <= f.min}
              raiseDisabled={draft.useSuggested || value >= f.max}
              onLower={() => nudge(f.id, -f.step, f.min, f.max)}
              onRaise={() => nudge(f.id, f.step, f.min, f.max)}
            />
          </View>
        );
      })}

      <View style={styles.toggle}>
        <Text variant="label" style={{ flex: 1 }}>Use suggested rate card</Text>
        <Switch
          accessibilityLabel="Use suggested rate card"
          value={draft.useSuggested}
          onValueChange={(useSuggested) => setDrafts((d) => ({ ...d, [tier]: { ...d[tier], useSuggested } }))}
          trackColor={{ true: colors.brand }}
        />
      </View>
      {draft.useSuggested && <Text variant="caption" tone="secondary">Turn this off to set your own rates with the − and + buttons.</Text>}
      <Text variant="caption" tone="secondary">Surge is a flat amount added to each trip at busy times. A trip never costs less than your minimum fare.</Text>

      <Button title="Submit" disabled={!changed} onPress={submit} />
      <Button title="See what this pays" variant="secondary" onPress={() => router.push('/rate-calculator')} />
      <Button title="Bid on trips with these rates" variant="secondary" onPress={() => router.push('/bid-trips')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: 48 },
  status: { padding: Spacing.md, borderRadius: Radius.md, marginVertical: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  left: { flex: 1 },
  middle: { width: 72 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
});
