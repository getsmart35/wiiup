import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { formatMoney } from '@/lib/fare';
import { PLANS } from '@/lib/plans';
import { usePlanStatus, useRateCards } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

/** Shown once a driver reaches their tier's limit. They can't accept rides again until they upgrade or the period resets. */
export function UpgradeCard() {
  const { colors } = useTheme();
  const status = usePlanStatus();
  const buyUpgrade = useRateCards((s) => s.buyUpgrade);
  const [step, setStep] = useState<'idle' | 'confirm' | 'paying'>('idle');
  const option = status.upgradeOption;
  if (!status.atLimit || !option || status.limit == null) return null;
  const resets = new Date(status.period.end).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const pay = async () => {
    setStep('paying');
    try {
      await api.purchaseUpgrade(option.to, option.price);
      buyUpgrade(option.to, status.period.start);
    } catch {
      Alert.alert('Payment failed', "You weren't charged. Try again in a moment.");
      setStep('idle');
    }
  };

  return (
    <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: colors.brandSoft }]}>
      <Text variant="heading">You&apos;ve reached your {PLANS[status.plan].name} limit</Text>
      <Text variant="caption">
        You earned {formatMoney(status.limit)} this period, so you can&apos;t accept rides until you upgrade or your plan resets on {resets}.
      </Text>
      {step === 'confirm' ? (
        <View style={styles.buttons}>
          <Button title="Cancel" variant="secondary" onPress={() => setStep('idle')} style={{ flex: 1 }} />
          <Button title={`Pay ${formatMoney(option.price)}`} onPress={pay} style={{ flex: 2 }} />
        </View>
      ) : (
        <Button title={`Upgrade to ${PLANS[option.to].name} · ${formatMoney(option.price)}`} loading={step === 'paying'} onPress={() => setStep('confirm')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.sm },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
});
