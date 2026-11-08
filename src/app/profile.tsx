import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { type Role, useAuth } from '@/store/useAuth';
import { useDriver } from '@/store/useDriver';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, useTheme } from '@/theme';

export default function Profile() {
  const { colors } = useTheme();
  const { user, role, setRole, signOut } = useAuth();
  const activeRide = useRide((s) => s.activeRide);
  const activeTrip = useDriver((s) => s.activeTrip);

  const switchRole = (next: Role) => {
    if (next === role) return;
    const busy = role === 'rider' ? activeRide && activeRide.status !== 'completed' && activeRide.status !== 'cancelled' : activeTrip;
    if (busy) {
      Alert.alert('Trip in progress', `Finish your current trip before switching to ${next} mode.`);
      return;
    }
    if (next === 'rider') useDriver.getState().setOnline(false);
    router.dismissAll();
    setRole(next);
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          useDriver.getState().setOnline(false);
          useRide.getState().resetBooking();
          router.dismissAll();
          signOut();
        },
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Avatar name={user?.name ?? ''} size={72} />
        <Text variant="title">{user?.name}</Text>
        <Text tone="secondary">{user?.phone}</Text>
      </View>

      <Text variant="label" tone="secondary">MODE</Text>
      <View style={[styles.segment, { backgroundColor: colors.surface }]}>
        {(['rider', 'driver'] as Role[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="tab"
            accessibilityState={{ selected: role === r }}
            onPress={() => switchRole(r)}
            style={[styles.segmentItem, role === r && { backgroundColor: colors.brand }]}>
            <Ionicons name={r === 'rider' ? 'person' : 'car'} size={18} color={role === r ? colors.textInverse : colors.text} />
            <Text variant="label" tone={role === r ? 'inverse' : 'default'}>
              {r === 'rider' ? 'Ride' : 'Drive'}
            </Text>
          </Pressable>
        ))}
      </View>

      {role === 'driver' && (
        <>
          <Text variant="label" tone="secondary">DRIVING</Text>
          <View style={[styles.group, { backgroundColor: colors.surface }]}>
            <Item icon="pricetag-outline" label="My rate card" onPress={() => { router.back(); router.push('/rate-card'); }} />
            <Item icon="calculator-outline" label="Rate calculator" onPress={() => { router.back(); router.push('/rate-calculator'); }} />
            <Item icon="flash-outline" label="Instant payout" onPress={() => { router.back(); router.push('/instant-payout'); }} />
            <Item icon="card-outline" label="My subscription" onPress={() => { router.back(); router.push('/subscription'); }} last />
          </View>
        </>
      )}

      <Text variant="label" tone="secondary">ACCOUNT</Text>
      <View style={[styles.group, { backgroundColor: colors.surface }]}>
        <Item icon="time-outline" label="Your trips" onPress={() => { router.back(); router.push('/history'); }} />
        <Item icon="card-outline" label="Payment" detail="Visa •••• 4242" onPress={() => Alert.alert('Payment', 'Payments are simulated in this MVP.')} />
        <Item icon="shield-checkmark-outline" label="Safety" onPress={() => Alert.alert('Safety', 'Emergency assistance and trip sharing are coming soon.')} />
        <Item icon="help-circle-outline" label="Help" onPress={() => Alert.alert('Help', 'Support chat is coming soon.')} last />
      </View>

      <Pressable onPress={confirmSignOut} style={[styles.group, styles.signOut, { backgroundColor: colors.surface }]}>
        <Text variant="label" tone="danger">Sign out</Text>
      </Pressable>
      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>WiiUp MVP · v1.0.0</Text>
    </ScrollView>
  );
}

function Item({ icon, label, detail, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail?: string; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.item, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={{ flex: 1 }}>{label}</Text>
      {detail && <Text tone="secondary">{detail}</Text>}
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 48 },
  header: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  segment: { flexDirection: 'row', padding: 4, borderRadius: Radius.lg },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 44, borderRadius: Radius.md },
  group: { borderRadius: Radius.lg, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, height: 54 },
  signOut: { alignItems: 'center', justifyContent: 'center', height: 54, marginTop: Spacing.md },
});
