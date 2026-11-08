import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Place } from '@/api/types';
import { Text } from '@/components/Text';
import { searchPlaces } from '@/lib/places';
import { useLocation } from '@/store/useLocation';
import { useRide } from '@/store/useRide';
import { Radius, Spacing, Type, useTheme } from '@/theme';

export default function Search() {
  const { colors } = useTheme();
  const coords = useLocation((s) => s.coords);
  const { pickup, recents, setDropoff } = useRide();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; places: Place[] } | null>(null);
  const results = found?.places ?? [];
  const loading = found?.query !== query;

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const places = await searchPlaces(query, coords);
      if (live) setFound({ query, places });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, coords]);

  const choose = (place: Place) => {
    setDropoff(place);
    router.replace('/options');
  };

  const data = query.trim() ? results : [...recents, ...results.filter((r) => !recents.some((p) => p.id === r.id))];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text variant="heading">Plan your ride</Text>
        <Pressable accessibilityLabel="Close" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
      </View>

      <View style={[styles.fields, { backgroundColor: colors.surface }]}>
        <View style={styles.fieldRow}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <Text numberOfLines={1} style={{ flex: 1 }}>
            {pickup?.address ?? 'Current location'}
          </Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.fieldRow}>
          <View style={[styles.square, { backgroundColor: colors.brand }]} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Where to?"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: Spacing.lg }} color={colors.brand} />}

      <FlatList
        data={data}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          !loading ? (
            <Text tone="secondary" style={{ textAlign: 'center', marginTop: Spacing.xl }}>
              No places found. Try a street address or landmark.
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const recent = recents.some((r) => r.id === item.id);
          return (
            <Pressable
              onPress={() => choose(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface : 'transparent' }]}>
              <View style={[styles.icon, { backgroundColor: colors.surface }]}>
                <Ionicons name={recent ? 'time-outline' : 'location-outline'} size={18} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>{item.name}</Text>
                <Text variant="caption" tone="secondary" numberOfLines={1}>{item.address}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  fields: { borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, height: 50 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 22 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  square: { width: 10, height: 10 },
  input: { ...Type.body, flex: 1, height: 50 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xs, borderRadius: Radius.md },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
