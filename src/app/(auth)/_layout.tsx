import { Stack } from 'expo-router';

export const unstable_settings = { anchor: 'welcome' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" options={{ headerShown: true, title: '', headerTransparent: true, headerBackTitle: 'Back' }} />
    </Stack>
  );
}
