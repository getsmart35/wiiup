import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { formatMoney } from '@/lib/fare';
import { useDriver } from '@/store/useDriver';
import { Radius, Spacing, useTheme } from '@/theme';

const DAY = 24 * 60 * 60 * 1000;

export default function Earnings() {
  const { colors } = useTheme();
  const completed = useDriver((s) => s.completed);
  const [now] = useState(() => Date.now());
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const sum = (since: number) =>
    completed.filter((t) => (t.completedAt ?? 0) >= since).reduce((s, t) => s + t.earnings, 0);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      data={completed}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={
        <View style={{ gap: Spacing.md, marginBottom: Spacing.lg }}>
          <View style={[styles.hero, { backgroundColor: colors.brand }]}>
            <Text variant="caption" tone="inverse">TODAY</Text>
            <Text variant="hero" tone="inverse">{formatMoney(sum(todayStart))}</Text>
          </View>
          <View style={styles.row}>
            <Card label="Last 7 days" value={formatMoney(sum(now - 7 * DAY))} />
            <Card label="All trips" value={String(completed.length)} />
          </View>
          <Text variant="heading" style={{ marginTop: Spacing.sm }}>Recent trips</Text>
        </View>
      }
      ListEmptyComponent={<Text tone="secondary">No trips yet. Go online to start earning.</Text>}
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border }]} />}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text variant="label" numberOfLines={1}>{item.request.dropoff.name}</Text>
            <Text variant="caption" tone="secondary">
              {new Date(item.completedAt ?? item.acceptedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {item.request.quote.label}
            </Text>
          </View>
          <Text variant="heading" tone="accent">+{formatMoney(item.earnings)}</Text>
        </View>
      )}
    />
  );
}

function Card({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text variant="caption" tone="secondary">{label}</Text>
      <Text variant="title">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg },
  hero: { padding: Spacing.xl, borderRadius: Radius.xl, gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md },
  card: { flex: 1, padding: Spacing.lg, borderRadius: Radius.lg, gap: Spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, gap: Spacing.md },
  sep: { height: StyleSheet.hairlineWidth },
});
