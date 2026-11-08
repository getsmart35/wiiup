import { StyleSheet, View } from 'react-native';

import type { Place } from '@/api/types';
import { Spacing, useTheme } from '@/theme';
import { Text } from './Text';

export function RouteSummary({ pickup, dropoff }: { pickup: Place; dropoff: Place }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <View style={[styles.square, { backgroundColor: colors.brand }]} />
      </View>
      <View style={{ flex: 1, gap: Spacing.md }}>
        <View>
          <Text variant="label" numberOfLines={1}>{pickup.name}</Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>{pickup.address}</Text>
        </View>
        <View>
          <Text variant="label" numberOfLines={1}>{dropoff.name}</Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>{dropoff.address}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.md },
  rail: { alignItems: 'center', paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 2, flex: 1, marginVertical: 4 },
  square: { width: 10, height: 10 },
});
