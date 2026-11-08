import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Animated, BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PLANS } from '@/lib/plans';
import { useAuth } from '@/store/useAuth';
import { useDriver } from '@/store/useDriver';
import { usePlanStatus } from '@/store/useRateCards';
import { Spacing, useTheme } from '@/theme';
import { Avatar } from './Avatar';
import { Text } from './Text';

const WIDTH = 300;

/** The slide-out menu behind the three-line button on the driver's home screen. */
export function DriverMenu({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, setRole } = useAuth();
  const completed = useDriver((s) => s.completed);
  const { plan } = usePlanStatus();
  const [slide] = useState(() => new Animated.Value(-WIDTH));

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [slide, onClose]);

  const open = (href: Href) => {
    onClose();
    router.push(href);
  };
  const notice = (title: string, body: string) => {
    onClose();
    Alert.alert(title, body);
  };
  const switchToRide = () => {
    onClose();
    if (useDriver.getState().activeTrip) {
      Alert.alert('Trip in progress', 'Finish your current trip before switching to Ride mode.');
      return;
    }
    useDriver.getState().setOnline(false);
    if (router.canDismiss()) router.dismissAll();
    setRole('rider');
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" style={styles.scrim} onPress={onClose} />
      <Animated.View accessibilityViewIsModal style={[styles.panel, { backgroundColor: colors.background, transform: [{ translateX: slide }] }]}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }}>
          <View style={styles.top}>
            <Avatar name={user?.name ?? ''} size={72} />
            <Text variant="heading">Hello, {user?.name?.split(' ')[0]}</Text>
            <Text variant="label" tone="brand" onPress={() => open('/profile')} accessibilityRole="link">View profile</Text>
            <View style={styles.stats}>
              <Stat value="4.95" label="Rating" />
              <Stat value={String(completed.length)} label="Trips" />
              <Stat value="100%" label="Fares kept" />
            </View>
          </View>
          <Divider />
          <Row icon="pricetag-outline" label="My rate card" onPress={() => open('/rate-card')} />
          <Row icon="hand-left-outline" label="Bid on trips" detail="Set your own fare" onPress={() => open('/bid-trips')} />
          <Row icon="calculator-outline" label="Rate calculator" onPress={() => open('/rate-calculator')} />
          <Row icon="flash-outline" label="Instant payout" onPress={() => open('/instant-payout')} />
          <Row icon="stats-chart-outline" label="Earnings" onPress={() => open('/earnings')} />
          <Divider />
          <Row icon="card-outline" label="My subscription" detail={PLANS[plan].name} onPress={() => open('/subscription')} />
          <Row icon="document-text-outline" label="Documents" onPress={() => notice('Documents', 'Document upload is coming soon.')} />
          <Divider />
          <Row icon="shield-checkmark-outline" label="Safety" onPress={() => notice('Safety', 'Emergency assistance and trip sharing are coming soon.')} />
          <Row icon="help-circle-outline" label="Help" onPress={() => notice('Help', 'Support chat is coming soon.')} />
          <Row icon="person-outline" label="Switch to Ride" onPress={switchToRide} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.surface }]} />;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="label">{value}</Text>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  );
}

function Row({ icon, label, detail, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <View>
        <Text>{label}</Text>
        {detail && <Text variant="caption" tone="secondary">{detail}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, width: WIDTH, maxWidth: '85%' },
  top: { alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: Spacing.sm },
  divider: { height: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 50, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs },
});
