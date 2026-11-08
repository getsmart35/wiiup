import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { LatLng } from '@/api/types';
import { useTheme } from '@/theme';

export function CarMarker({ coordinate, id }: { coordinate: LatLng; id: string }) {
  const { colors } = useTheme();
  return (
    <Marker identifier={id} coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={[styles.car, { backgroundColor: colors.text, borderColor: colors.background }]}>
        <Ionicons name="car" size={16} color={colors.background} />
      </View>
    </Marker>
  );
}

export function PinMarker({ coordinate, kind, title }: { coordinate: LatLng; kind: 'pickup' | 'dropoff'; title?: string }) {
  const { colors } = useTheme();
  const color = kind === 'pickup' ? colors.accent : colors.brand;
  return (
    <Marker coordinate={coordinate} title={title} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={[styles.pinOuter, { backgroundColor: color }]}>
        <View style={[kind === 'pickup' ? styles.dot : styles.square, { backgroundColor: '#fff' }]} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  car: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  pinOuter: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  square: { width: 8, height: 8 },
});
