import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { ApiError } from '@/api/http';
import { Button } from '@/components/Button';
import { LineItem } from '@/components/RateControls';
import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { INSTANT_FEE_RATE, INSTANT_MINIMUM, PAYOUT_DESTINATION, payoutQuote } from '@/lib/payouts';
import { availableBalance, useDriver } from '@/store/useDriver';
import { usePlanStatus } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

export default function InstantPayout() {
  const { colors } = useTheme();
  const completed = useDriver((s) => s.completed);
  const payouts = useDriver((s) => s.payouts);
  const addPayout = useDriver((s) => s.addPayout);
  const { plan } = usePlanStatus();
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [sent, setSent] = useState<string | null>(null);
  const [today] = useState(() => new Date().toDateString());
  const available = availableBalance(completed, payouts);
  const paidToday = payouts.filter((p) => new Date(p.at).toDateString() === today).reduce((sum, p) => sum + p.amount, 0);
  const quote = payoutQuote(available, plan, paidToday);

  const send = async () => {
    setStep('sending');
    try {
      const payout = await api.requestInstantPayout(quote.amount, quote.fee, PAYOUT_DESTINATION);
      addPayout(payout);
      setSent(`${formatMoney(payout.net)} is on its way to your ${payout.destination}.`);
    } catch (e) {
      // The server explains limits and pauses (for example right after a failover)
      Alert.alert('Payout failed', e instanceof ApiError ? `${e.message} No money left your balance.` : 'No money left your balance. Try again in a moment.');
    } finally {
      setStep('idle');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Text variant="caption" tone="secondary">Available now</Text>
        <Text variant="hero">{formatMoney(available)}</Text>
        <Text variant="caption" tone="secondary">Fares from completed trips, less earlier payouts. You keep 100%.</Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <LineItem label="Send to" value={PAYOUT_DESTINATION} />
        <LineItem label="Cash out" value={formatMoney(quote.amount)} />
        <LineItem label={`Transaction fee (${(INSTANT_FEE_RATE * 100).toFixed(1)}%, $0.50 minimum)`} value={`-${formatMoney(quote.fee)}`} />
        <LineItem total label="You receive" value={formatMoney(quote.net)} />
        <Text variant="caption" tone="secondary">Daily limit {formatMoney(quote.limit)}{plan === 'platinum' ? ' with Platinum' : ''}. {formatMoney(paidToday)} used today.</Text>
        {quote.limited && <Text variant="caption" tone="secondary">The rest of your balance stays here until you can cash it out.</Text>}
      </View>
      {sent && (
        <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: colors.brandSoft }]}>
          <Text variant="label">Payout sent</Text>
          <Text variant="caption">{sent}</Text>
        </View>
      )}
      {step === 'confirm' ? (
        <View style={styles.buttons}>
          <Button title="Cancel" variant="secondary" onPress={() => setStep('idle')} style={{ flex: 1 }} />
          <Button title={`Confirm ${formatMoney(quote.net)}`} onPress={send} style={{ flex: 2 }} />
        </View>
      ) : (
        <Button title={quote.ok ? `Cash out ${formatMoney(quote.net)}` : 'Nothing to cash out yet'} disabled={!quote.ok} loading={step === 'sending'} onPress={() => { setSent(null); setStep('confirm'); }} />
      )}
      {!quote.ok && <Text variant="caption" tone="secondary">Complete a trip to add to your balance. The minimum is {formatMoney(INSTANT_MINIMUM)}.</Text>}

      <Text variant="label" tone="secondary">RECENT PAYOUTS</Text>
      {payouts.length === 0 ? (
        <Text tone="secondary">Your payouts will show up here.</Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {payouts.slice(0, 10).map((p) => (
            <LineItem key={p.id} label={new Date(p.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} value={formatMoney(p.net)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 48 },
  hero: { padding: Spacing.xl, borderRadius: Radius.lg, gap: Spacing.xs },
  card: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.sm },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
});
