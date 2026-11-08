import { StyleSheet, View } from 'react-native';

import { Spacing, useTheme } from '@/theme';
import { Text } from './Text';

/** Heading + subtitle + progress bar used at the top of trip sheets. */
export function TripStatus({ title, subtitle, progress }: { title: string; subtitle?: string; progress?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: Spacing.xs }}>
      <Text variant="title">{title}</Text>
      {subtitle ? <Text tone="secondary">{subtitle}</Text> : null}
      {progress !== undefined && (
        <View style={[styles.track, { backgroundColor: colors.surface }]}>
          <View style={[styles.fill, { backgroundColor: colors.brand, width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: Spacing.xs },
  fill: { height: 4, borderRadius: 2 },
});
