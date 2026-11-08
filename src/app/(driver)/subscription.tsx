import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { StepperRow } from '@/components/RateControls';
import { Text } from '@/components/Text';
import { UpgradeCard } from '@/components/UpgradeCard';
import { formatMoney } from '@/lib/fare';
import { compareMonth, EARNINGS_LIMIT, isLadderPlan, isUpgradeOnly, ladderFee, needsApproval, PLANS, PLATINUM_PERKS, type PlanId } from '@/lib/plans';
import { usePlanStatus, useRateCards } from '@/store/useRateCards';
import { Radius, Spacing, useTheme } from '@/theme';

export default function Subscription() {
  const { colors } = useTheme();
  const { livery, setLivery, setPlan } = useRateCards();
  const status = usePlanStatus();
  const [fares, setFares] = useState(Math.max(Math.round(status.earned / 100) * 100, 1500));
  const [license, setLicense] = useState('');
  const [sending, setSending] = useState(false);

  // While a livery license is under review, check for the admin's decision
  useEffect(() => {
    if (livery.status !== 'pending' || !livery.submittedAt) return;
    const { license: number, submittedAt } = livery;
    const iv = setInterval(async () => {
      const next = await api.getPlatinumReview(submittedAt);
      if (next !== 'pending') setLivery({ status: next, license: number, submittedAt });
    }, 1000);
    return () => clearInterval(iv);
  }, [livery, setLivery]);

  const canChoose = (id: PlanId) => !isUpgradeOnly(id) && (!needsApproval(id) || livery.status === 'approved');
  const rows = compareMonth(fares, 0);
  const best = rows.filter((r) => !r.overLimit && (canChoose(r.id) || isUpgradeOnly(r.id))).reduce((a, b) => (b.cost < a.cost ? b : a));
  const ladder = isLadderPlan(status.plan) ? ladderFee(status.plan, status.earned) : null;
  const resets = new Date(status.period.end).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const apply = async () => {
    setSending(true);
    try {
      const { submittedAt } = await api.applyForPlatinum(license.trim());
      setLivery({ status: 'pending', license: license.trim(), submittedAt });
    } catch {
      Alert.alert('Could not submit', 'Your license was not sent. Try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <UpgradeCard />
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="caption" tone="secondary">Your plan</Text>
        <Text variant="heading">{PLANS[status.plan].name}</Text>
        <Text variant="caption" tone="secondary">{formatMoney(status.earned)} in fares this period. Resets {resets}.</Text>
        {status.upgraded && <Text variant="caption" tone="secondary">Upgraded from {PLANS[status.basePlan].name} until {resets}, then back to {PLANS[status.basePlan].name}.</Text>}
        {ladder && (
          <Text variant="caption" tone="secondary">
            {ladder.installments === 0
              ? 'Nothing is due until your first fare.'
              : `${formatMoney(ladder.fee)} paid in ${ladder.installments} installments. ${ladder.next ? `Next ${formatMoney(ladder.next.installment)} when fares pass ${formatMoney(ladder.next.at)}.` : 'Nothing more is due this period.'}`}
          </Text>
        )}
      </View>

      <Text variant="label" tone="secondary">COMPARE A MONTH</Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <StepperRow label="Fares in a month" value={formatMoney(fares)} lowerDisabled={fares <= 0} raiseDisabled={fares >= 10000} onLower={() => setFares(Math.max(0, fares - 100))} onRaise={() => setFares(fares + 100)} />
      </View>

      {rows.map((r) => {
        const current = r.id === status.plan;
        return (
          <View key={r.id} style={[styles.plan, { borderColor: current ? colors.brand : colors.border }]}>
            <View style={styles.planTop}>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{PLANS[r.id].name}</Text>
                <Text variant="caption" tone="secondary">{PLANS[r.id].price}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="heading">{formatMoney(r.cost)}</Text>
                <Text variant="caption" tone="secondary">take home {formatMoney(r.takeHome)}</Text>
              </View>
            </View>
            <Text variant="caption" tone="secondary">{PLANS[r.id].blurb}</Text>
            {r.id === 'platinum' && (
              <View style={{ gap: 2 }}>
                <Text variant="label">Platinum includes:</Text>
                {PLATINUM_PERKS.map((perk) => <Text key={perk} variant="caption" tone="secondary">• {perk}</Text>)}
              </View>
            )}
            {r.id === best.id && <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>Lowest cost for this month</Text>}
            {r.overLimit && <Text variant="caption" tone="danger">These fares are over this plan&apos;s {formatMoney(EARNINGS_LIMIT[r.id] ?? 0)} limit</Text>}

            {current ? (
              <Text variant="label" tone="brand">Current plan</Text>
            ) : isUpgradeOnly(r.id) ? (
              <Text variant="caption" tone="secondary">Offered when you reach Gold&apos;s limit.</Text>
            ) : needsApproval(r.id) && livery.status !== 'approved' ? (
              livery.status === 'pending' ? (
                <Text variant="label">License under review. An admin will approve or decline it.</Text>
              ) : (
                <View style={{ gap: Spacing.sm }}>
                  {livery.status === 'rejected' && <Text variant="caption" tone="danger">Your license wasn&apos;t approved. Check the number and apply again.</Text>}
                  <TextInput
                    accessibilityLabel="Livery license number"
                    placeholder="Livery license number"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="characters"
                    value={license}
                    onChangeText={setLicense}
                    style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
                  />
                  <Button title="Apply for Platinum" variant="secondary" disabled={license.trim().length < 4} loading={sending} onPress={apply} />
                </View>
              )
            ) : (
              <Button title={`Switch to ${PLANS[r.id].name}`} variant="secondary" onPress={() => {
                setPlan(r.id);
                Alert.alert('Plan updated', `You're on ${PLANS[r.id].name} from your next billing period.`);
              }} />
            )}
          </View>
        );
      })}
      <Text variant="caption" tone="secondary">Fees exclude taxes. In this demo, admin approval is simulated and takes a few seconds.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 48 },
  card: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.sm },
  plan: { padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 2, gap: Spacing.sm },
  planTop: { flexDirection: 'row', gap: Spacing.md },
  input: { height: 48, borderRadius: Radius.md, paddingHorizontal: Spacing.md, fontSize: 16 },
});
