import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

export function RatingStars({ value, onChange, size = 40 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityValue={{ min: 1, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
          hitSlop={6}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onChange(n);
          }}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? colors.warning : colors.border} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 8, justifyContent: 'center' } });
