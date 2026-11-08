import { Stack } from 'expo-router';

export const unstable_settings = { anchor: 'drive' };

export default function DriverLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="drive" />
      <Stack.Screen name="drive-trip" options={{ gestureEnabled: false }} />
      <Stack.Screen name="earnings" options={{ headerShown: true, title: 'Earnings', headerBackTitle: 'Back' }} />
      <Stack.Screen name="rate-card" options={{ headerShown: true, title: 'My rate card', headerBackTitle: 'Back' }} />
      <Stack.Screen name="bid-trips" options={{ headerShown: true, title: 'Bid on trips', headerBackTitle: 'Back' }} />
      <Stack.Screen name="rate-calculator" options={{ headerShown: true, title: 'Rate calculator', headerBackTitle: 'Back' }} />
      <Stack.Screen name="instant-payout" options={{ headerShown: true, title: 'Instant payout', headerBackTitle: 'Back' }} />
      <Stack.Screen name="subscription" options={{ headerShown: true, title: 'My subscription', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
