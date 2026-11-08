import { useColorScheme } from 'react-native';

const palette = {
  brand: '#16C060',
  brandDark: '#0F9A4C',
  danger: '#FF4D5E',
  warning: '#FFB020',
};

export const Colors = {
  light: {
    ...palette,
    accent: '#0B7A3C',
    brandText: '#0B7A3C',
    text: '#0A0A0A',
    textSecondary: '#5C635E',
    textInverse: '#04140A',
    background: '#FFFFFF',
    surface: '#F3F5F3',
    surfaceRaised: '#FFFFFF',
    border: '#E1E5E1',
    brandSoft: '#E2F7EA',
    shadow: '#000000',
  },
  dark: {
    ...palette,
    accent: '#33D67B',
    brandText: '#33D67B',
    text: '#F4F6F4',
    textSecondary: '#9DA59F',
    textInverse: '#04140A',
    background: '#000000',
    surface: '#111311',
    surfaceRaised: '#1A1D1A',
    border: '#262A26',
    brandSoft: '#0E2A1A',
    shadow: '#000000',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const Type = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' as const },
  heading: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
};

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return { colors: dark ? Colors.dark : Colors.light, dark };
}
