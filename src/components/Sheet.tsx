import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, useTheme } from '@/theme';

/** A bottom card that floats over the map. */
export function Sheet({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sheet,
        {
          backgroundColor: colors.background,
          shadowColor: colors.shadow,
          paddingBottom: Math.max(insets.bottom, Spacing.lg),
        },
        style,
      ]}>
      <View style={[styles.grabber, { backgroundColor: colors.border }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: Spacing.xs },
});
