import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';
import { Text } from './Text';

export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brandSoft },
      ]}>
      <Text variant="label" tone="brand" style={{ fontSize: size * 0.38 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ circle: { alignItems: 'center', justifyContent: 'center' } });
