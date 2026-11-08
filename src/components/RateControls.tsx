import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import type { RideTier } from '@/api/types';
import { TIER_ORDER, TIERS } from '@/lib/fare';
import { Radius, Spacing, useTheme } from '@/theme';
import { Text } from './Text';

export function TierTabs({ tier, onChange }: { tier: RideTier; onChange: (t: RideTier) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: colors.border }]}>
      {TIER_ORDER.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="tab"
          accessibilityState={{ selected: t === tier }}
          onPress={() => onChange(t)}
          style={[styles.tab, t === tier && { borderBottomColor: colors.brand }]}>
          <Text variant="label" tone={t === tier ? 'default' : 'secondary'} numberOfLines={1}>{TIERS[t].label.replace('WiiUp ', '')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Stepper({ label, onLower, onRaise, lowerDisabled, raiseDisabled }: { label: string; onLower: () => void; onRaise: () => void; lowerDisabled?: boolean; raiseDisabled?: boolean }) {
  const { colors } = useTheme();
  const press = (fn: () => void) => () => {
    Haptics.selectionAsync().catch(() => {});
    fn();
  };
  const part = (sign: string, name: string, disabled: boolean | undefined, fn: () => void, divider: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${label.toLowerCase()}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={press(fn)}
      style={[styles.step, divider && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
      <Text variant="heading" style={{ color: disabled ? colors.border : colors.text }}>{sign}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.stepper, { borderColor: colors.border }]}>
      {part('−', 'Lower', lowerDisabled, onLower, false)}
      {part('+', 'Raise', raiseDisabled, onRaise, true)}
    </View>
  );
}

/** A labeled value with − and + buttons, for the calculator's inputs. */
export function StepperRow({ label, value, onLower, onRaise, lowerDisabled, raiseDisabled }: { label: string; value: string; onLower: () => void; onRaise: () => void; lowerDisabled?: boolean; raiseDisabled?: boolean }) {
  return (
    <View style={styles.stepperRow}>
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="secondary">{label}</Text>
        <Text variant="heading">{value}</Text>
      </View>
      <Stepper label={label} onLower={onLower} onRaise={onRaise} lowerDisabled={lowerDisabled} raiseDisabled={raiseDisabled} />
    </View>
  );
}

export function LineItem({ label, value, total }: { label: string; value: string; total?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.line, total && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: Spacing.sm }]}>
      <Text variant={total ? 'label' : 'caption'} tone={total ? 'default' : 'secondary'} style={{ flex: 1 }}>{label}</Text>
      <Text variant={total ? 'label' : 'caption'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  stepper: { flexDirection: 'row', width: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, overflow: 'hidden' },
  step: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
});
