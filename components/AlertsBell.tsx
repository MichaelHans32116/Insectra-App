/**
 * AlertsBell — header-mounted bell icon with an unread badge.
 *
 * Routes to /alerts on tap. Subscribes to the alerts feed so the badge
 * count updates the moment a new alert is pushed (e.g. when the dashboard
 * detects a HIGH-risk crossing).
 */
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import { subscribeAlerts } from '@/services/alerts';

export default function AlertsBell({ tint = Colors.textOnPrimary }: { tint?: string }) {
  const styles = useThemeStyles(makeStyles);
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    return subscribeAlerts((arr) => {
      setUnread(arr.filter((a) => !a.read).length);
    });
  }, []);

  return (
    <TouchableOpacity
      hitSlop={10}
      onPress={() => router.push('/alerts' as any)}
      style={styles.wrap}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `${unread} unread alerts` : 'Open alerts'}
      accessibilityHint="Opens the alerts inbox."
    >
      <MaterialCommunityIcons name="bell-outline" size={22} color={tint} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: { padding: 4 },
  badge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.danger,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
