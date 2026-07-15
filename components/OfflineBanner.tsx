/**
 * OfflineBanner — global indicator for "you are offline; data may be stale".
 *
 * Detects connectivity using:
 *   - Web: `navigator.onLine` + 'online'/'offline' events
 *   - Native: a lightweight probe to a connectivity endpoint every 15 s
 *
 * This is intentionally minimal — it only renders when we are CONFIDENT we
 * are offline, never as a flicker on slow but working connections.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

const CONNECTIVITY_PROBE_URL = 'https://clients3.google.com/generate_204';
const PROBE_TIMEOUT_MS = 4000;
const FAILURES_BEFORE_OFFLINE = 2;

export default function OfflineBanner() {
  const styles = useThemeStyles(makeStyles);
  const [offline, setOffline] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const update = () => setOffline(!navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
    // Native fallback — require repeated failures before showing offline.
    let cancelled = false;
    let consecutiveFailures = 0;
    const ping = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(CONNECTIVITY_PROBE_URL, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const reachable = response.status === 204 || response.ok;
        if (reachable) {
          consecutiveFailures = 0;
          if (!cancelled) setOffline(false);
          return;
        }
        consecutiveFailures += 1;
        if (!cancelled) setOffline(consecutiveFailures >= FAILURES_BEFORE_OFFLINE);
      } catch {
        clearTimeout(timeoutId);
        consecutiveFailures += 1;
        if (!cancelled) setOffline(consecutiveFailures >= FAILURES_BEFORE_OFFLINE);
      }
    };
    ping();
    const id = setInterval(ping, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!offline) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { paddingTop: Math.max(insets.top, 8), minHeight: 40 + insets.top }]}
    >
      <MaterialCommunityIcons name="wifi-off" size={14} color="#fff" />
      <Text style={styles.text}>
        You are offline. Showing cached data. New samples will sync when you reconnect.
      </Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingBottom: 8, paddingHorizontal: 12,
    backgroundColor: Colors.danger,
  },
  text: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
});
