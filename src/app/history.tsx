import { Ionicons } from '@expo/vector-icons';
import { FlatList, StyleSheet, View } from 'react-native';

import { RouteSummary } from '@/components/RouteSummary';
import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, useTheme } from '@/theme';

export default function History() {
  const { colors } = useTheme();
  const history = useRide((s) => s.history);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      data={history}
      keyExtractor={(r) => r.id}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="car-outline" size={48} color={colors.textSecondary} />
          <Text variant="heading">No trips yet</Text>
          <Text tone="secondary" style={{ textAlign: 'center' }}>Your completed rides will show up here.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.header}>
            <Text variant="label">
              {new Date(item.completedAt ?? item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
            <Text variant="heading">{formatMoney(item.quote.fare + (item.tip ?? 0))}</Text>
          </View>
          <RouteSummary pickup={item.pickup} dropoff={item.dropoff} />
          <Text variant="caption" tone="secondary">
            {item.quote.label}
            {item.driver ? ` · ${item.driver.name}` : ''}
            {item.rating ? ` · You rated ${item.rating}★` : ''}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingTop: 80 },
  card: { padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
