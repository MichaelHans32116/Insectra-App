/**
 * /alerts — In-app notifications inbox.
 *
 * Shows the alert feed populated by:
 *   - dashboard.tsx (HIGH aggregate outbreak risk)
 *   - app/analytics/[id].tsx (HIGH per-device risk + robust-z anomalies)
 *
 * Tapping an alert with a deviceId routes to the per-device analytics screen
 * so the farmer can immediately see what triggered the alert. Tapping any
 * alert marks it read; the bell badge in the header updates live.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, EmptyState, SectionHeader, type BadgeTone } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import {
  clearAlerts,
  markAllRead,
  markRead,
  subscribeAlerts,
  type AppAlert,
} from '@/services/alerts';

function timeAgo(ms: number): string {
  const dt = Date.now() - ms;
  if (dt < 60_000) return 'just now';
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  return `${Math.floor(dt / 86_400_000)}d ago`;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function severityMeta(s: AppAlert['severity']): { tone: BadgeTone; label: string; icon: IconName } {
  switch (s) {
    case 'critical': return { tone: 'danger', label: 'CRITICAL', icon: 'alert-decagram' };
    case 'watch':    return { tone: 'warning', label: 'WATCH', icon: 'alert-outline' };
    case 'info':     return { tone: 'info', label: 'INFO', icon: 'information-outline' };
  }
}

export default function AlertsScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    return subscribeAlerts((a) => { setAlerts(a); setLoaded(true); });
  }, []);

  // When the user opens the inbox, mark everything as read after a short
  // delay so the unread dots are visible momentarily, then the bell badge
  // clears. Previously the user had to tap each alert individually — they
  // (rightly) expected viewing the inbox to dismiss the badge.
  useEffect(() => {
    const timer = setTimeout(() => { markAllRead(); }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleClear = () => {
    Alert.alert('Clear all alerts?', 'This permanently deletes the alert history on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearAlerts() },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Button
          icon="arrow-left"
          label="Back"
          variant="ghost"
          size="sm"
          onPress={() => router.back()}
          style={styles.backBtn}
        />
        <Text style={styles.h1}>Alerts</Text>
      </View>

      <SectionHeader
        title="Inbox"
        icon="bell-outline"
        actionLabel={alerts.length > 0 ? 'Mark all read' : undefined}
        onAction={alerts.length > 0 ? () => markAllRead() : undefined}
      />

      {!loaded ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : alerts.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell-check-outline"
            title="You're all caught up"
            body="Outbreak warnings and unusual sensor readings appear here."
          />
        </Card>
      ) : (
        alerts.map((a) => {
          const m = severityMeta(a.severity);
          return (
            <Card
              key={a.id}
              variant="elevated"
              onPress={() => {
                markRead(a.id);
                if (a.route) router.push(a.route as any);
                else if (a.deviceId) router.push(`/analytics/${a.deviceId}` as any);
              }}
              accessibilityLabel={a.title}
              style={styles.row}
            >
              <MaterialCommunityIcons name={m.icon} size={20} color={Colors.textSecondary} />
              <View style={styles.flex1}>
                <View style={styles.titleRow}>
                  <Badge label={m.label} tone={m.tone} />
                  {!a.read && <View style={styles.dot} />}
                </View>
                <Text style={styles.title} numberOfLines={2}>{a.title}</Text>
                <Text style={styles.body}>{a.body}</Text>
                <Text style={styles.meta}>{timeAgo(a.t)}</Text>
              </View>
            </Card>
          );
        })
      )}

      {alerts.length > 0 && (
        <Button
          label="Clear alert history"
          icon="trash-can-outline"
          variant="ghost"
          size="sm"
          onPress={handleClear}
          style={styles.clearBtn}
        />
      )}
    </Screen>
  );
}

const createStyles = () => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backBtn: { paddingHorizontal: Spacing.sm },
  h1: { ...Type.h1, color: Colors.primaryDark },

  loader: { marginTop: Spacing.xl },

  row: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md },
  flex1: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  title: { ...Type.bodyStrong, color: Colors.textPrimary, marginTop: Spacing.xs },
  body: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  meta: { ...Type.micro, color: Colors.textTertiary, marginTop: Spacing.xs, fontWeight: '500' },

  clearBtn: { alignSelf: 'center', marginTop: Spacing.sm },
});
