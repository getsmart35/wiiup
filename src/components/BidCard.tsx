import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { Bid } from '@/api/types';
import { formatMoney } from '@/lib/fare';
import { Radius, Spacing, useTheme } from '@/theme';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Text } from './Text';

/** One driver's fare for the rider's trip, with Accept and Decline. `standard` is the quoted price, for comparison. */
export function BidCard({ bid, standard, lowest, busy, onAccept, onDecline }: {
  bid: Bid;
  standard: number;
  lowest: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const diff = Math.round((bid.fare - standard) * 100) / 100;
  return (
    <View
      accessible
      accessibilityLabel={`${bid.driver.name}, ${formatMoney(bid.fare)}, ${bid.etaMin} minutes away`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: lowest ? colors.brand : 'transparent' }]}>
      <View style={styles.top}>
        <Avatar name={bid.driver.name} />
        <View style={{ flex: 1 }}>
          <View style={styles.inline}>
            <Text variant="heading">{bid.driver.name}</Text>
            {lowest && (
              <View style={[styles.badge, { backgroundColor: colors.brand }]}>
                <Text variant="caption" style={{ color: colors.textInverse, fontWeight: '800' }}>Lowest</Text>
              </View>
            )}
          </View>
          <View style={styles.inline}>
            <Ionicons name="star" size={13} color={colors.warning} />
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {bid.driver.rating.toFixed(2)} · {bid.driver.car} · {bid.etaMin} min away
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="title">{formatMoney(bid.fare)}</Text>
          <Text variant="caption" tone={diff < 0 ? 'brand' : 'secondary'}>
            {diff === 0 ? 'Standard price' : `${formatMoney(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'}`}
          </Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Button title="Decline" variant="secondary" disabled={busy} onPress={onDecline} style={styles.button} />
        <Button title="Accept" disabled={busy} onPress={onAccept} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md, borderRadius: Radius.lg, gap: Spacing.md, borderWidth: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  button: { flex: 1, minHeight: 44 },
});
