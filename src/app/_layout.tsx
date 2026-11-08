import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useAuth } from '@/store/useAuth';
import { useLocation } from '@/store/useLocation';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.role);
  const hydrated = useAuth((s) => s.hydrated);

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync();
  }, [hydrated]);

  useEffect(() => {
    if (user) useLocation.getState().refresh();
  }, [user]);

  if (!hydrated) return null;

  const home = role === 'driver' ? '/drive' : '/';
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: colors.brand, background: colors.background, card: colors.background, text: colors.text, border: colors.border },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!user} redirectTo={home}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={!!user && role === 'rider'} redirectTo={user ? '/drive' : '/welcome'}>
          <Stack.Screen name="(rider)" />
        </Stack.Protected>
        <Stack.Protected guard={!!user && role === 'driver'} redirectTo={user ? '/' : '/welcome'}>
          <Stack.Screen name="(driver)" />
        </Stack.Protected>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="profile" options={{ presentation: 'modal', headerShown: true, title: 'Account' }} />
          <Stack.Screen name="history" options={{ headerShown: true, title: 'Your trips', headerBackTitle: 'Back' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
