import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { Driver } from '@/api/types';
import { Radius, Spacing, useTheme } from '@/theme';
import { Avatar } from './Avatar';
import { Text } from './Text';

export function DriverCard({ driver }: { driver: Driver }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface }]}>
      <Avatar name={driver.name} />
      <View style={{ flex: 1 }}>
        <Text variant="heading">{driver.name}</Text>
        <View style={styles.inline}>
          <Ionicons name="star" size={13} color={colors.warning} />
          <Text variant="caption" tone="secondary">
            {driver.rating.toFixed(2)} · {driver.color} {driver.car}
          </Text>
        </View>
      </View>
      <View style={[styles.plate, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <Text variant="label">{driver.plate}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  plate: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
});
