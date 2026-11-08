import { Text as RNText, TextProps } from 'react-native';

import { Type, useTheme } from '@/theme';

type Props = TextProps & {
  variant?: keyof typeof Type;
  tone?: 'default' | 'secondary' | 'brand' | 'inverse' | 'danger' | 'accent';
};

export function Text({ variant = 'body', tone = 'default', style, ...rest }: Props) {
  const { colors } = useTheme();
  const color = {
    default: colors.text,
    secondary: colors.textSecondary,
    brand: colors.brandText,
    inverse: colors.textInverse,
    danger: colors.danger,
    accent: colors.accent,
  }[tone];
  return <RNText style={[Type[variant], { color }, style]} {...rest} />;
}
