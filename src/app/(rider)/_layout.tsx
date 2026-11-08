import { Stack } from 'expo-router';

export default function RiderLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ presentation: 'modal' }} />
      <Stack.Screen name="options" />
      <Stack.Screen name="trip" options={{ gestureEnabled: false }} />
      <Stack.Screen name="rate" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
