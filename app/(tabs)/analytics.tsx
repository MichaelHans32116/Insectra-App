/**
 * /(tabs)/analytics — index/landing for analytics.
 *
 * Per-device analytics now live at /analytics/<deviceId>, because outbreak
 * scoring, temperature/humidity charts, and projections are only meaningful
 * for ONE Pi at a time (different farms / rows / blocks have very different
 * micro-climates). This screen lists the registered Pis in the active farm
 * and routes the user to the deep analytics screen for the chosen device.
 *
 * Notes for reviewers:
 *   - Removed the previous default-fallback hallucination (`?? 29` °C, `?? 65`
 *     %) that was silently feeding optimal-pest-breeding values into
 *     `computeRisk()` whenever a sensor was offline. The new screen never
 *     fabricates environmental data — risk is computed inside the per-device
 *     screen with explicit "missing channel" handling.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Badge, EmptyState, SectionHeader } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { useActiveGroup } from '@/services/activeGroup';
import { listDevicesForFarm, type RegisteredDevice } from '@/services/devices';

export default function AnalyticsLanding() {
  const router = useRouter();
  const { active } = useActiveGroup();
  const styles = useThemeStyles(createStyles);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listDevicesForFarm(active.id)
      .then((list) => setDevices(list))
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [active]);

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading trap insights…</Text>
      </Screen>
    );
  }

  if (!active) {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <EmptyState
          icon="folder-question-outline"
          title="No farm selected"
          body="Join or create a farm to see analytics."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader title="Trap insights" icon="chart-timeline-variant" />
      <Text style={styles.intro}>
        Choose a registered trap to see its counts, trend, and recent field conditions.
      </Text>

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon="raspberry-pi"
            title="No traps registered yet"
            body="Add a trap first so this page can show counts and trends."
            actionLabel="Open Traps"
            onAction={() => router.push('/devices' as any)}
          />
        </Card>
      ) : (
        devices.map((d) => (
          <Card
            key={d.id}
            variant="elevated"
            onPress={() => router.push(`/analytics/${d.id}` as any)}
            accessibilityLabel={`${d.name}. Open trap insights.`}
            style={styles.deviceCard}
          >
            <View style={styles.deviceRow}>
              <View style={styles.deviceIcon}>
                <MaterialCommunityIcons name="chart-timeline-variant" size={22} color={Colors.primaryDark} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.deviceName} numberOfLines={1}>{d.name}</Text>
                <View style={styles.deviceMetaRow}>
                  <Badge label={d.piCode} tone="neutral" />
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textTertiary} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const createStyles = () => StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { ...Type.body, color: Colors.textSecondary, marginTop: Spacing.md, textAlign: 'center' },
  intro: { ...Type.body, color: Colors.textSecondary },

  deviceCard: { padding: Spacing.md },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  deviceIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceName: { ...Type.bodyStrong, color: Colors.textPrimary },
  deviceMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4, flexShrink: 1 },
});
