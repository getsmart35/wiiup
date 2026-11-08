import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FareQuote } from '@/api/types';
import { formatMoney } from '@/lib/fare';
import { Radius, Spacing, useTheme } from '@/theme';
import { Text } from './Text';

const ICONS = { go: 'car-outline', comfort: 'car-sport-outline', xl: 'bus-outline', platinum: 'diamond-outline' } as const;

export function RideTierCard({ quote, selected, onPress }: { quote: FareQuote; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={[
        styles.card,
        {
          borderColor: selected ? colors.brand : colors.border,
          backgroundColor: selected ? colors.brandSoft : colors.background,
        },
      ]}>
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        <Ionicons name={ICONS[quote.tier]} size={26} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.inline}>
          <Text variant="heading">{quote.label}</Text>
          <Ionicons name="person" size={12} color={colors.textSecondary} />
          <Text variant="caption" tone="secondary">{quote.seats}</Text>
        </View>
        <Text variant="caption" tone="secondary">
          {quote.etaMin} min away · {quote.durationMin} min trip
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="heading">{formatMoney(quote.fare)}</Text>
        {quote.surge > 1 && (
          <Text variant="caption" tone="danger">
            ⚡ {quote.surge}x busy
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 2 },
  icon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
