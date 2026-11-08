import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  style?: ViewStyle;
};

export function IconButton({ icon, onPress, label, style }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: colors.surfaceRaised, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 },
        style,
      ]}>
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});
