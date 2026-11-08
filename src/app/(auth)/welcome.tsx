import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/theme';

/** Always dark: the brand splash looks the same in light and dark mode. */
const c = Colors.dark;

export default function Welcome() {
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: c.brand }]}>
          <Ionicons name="navigate" size={44} color="#fff" />
        </View>
        <Text variant="hero" style={{ color: c.text }}>
          WiiUp
        </Text>
        <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
          Rides in minutes. Fair prices, friendly drivers.
        </Text>
      </View>
      <View style={styles.footer}>
        <Button title="Get started" onPress={() => router.push('/sign-in')} />
        <Text variant="caption" style={{ color: c.textSecondary, textAlign: 'center' }}>
          By continuing you agree to the WiiUp Terms and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Spacing.xl },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  logo: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, transform: [{ rotate: '-8deg' }] },
  footer: { gap: Spacing.md, paddingBottom: Spacing.lg },
});
