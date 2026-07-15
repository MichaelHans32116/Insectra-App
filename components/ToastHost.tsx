/**
 * InsecTra ToastHost — single floating overlay that renders any `AppEvent`
 * dispatched through `services/eventBus`. Mount once at the root of the
 * app (inside ThemeProvider) so toasts appear above every screen.
 *
 * Design notes:
 *  - Up to 3 toasts stacked from the top (newer pushes older down then out).
 *  - Each toast auto-dismisses after `durationMs` (defaults to 3.5s).
 *  - Tap a toast to dismiss it immediately.
 *  - Tinting: kind=ok → primary green, info → primaryMid, warn → warning,
 *    err → danger. Always uses theme-aware Colors so dark mode flips with it.
 *  - Uses `useNativeDriver: true` for opacity (works on web + native).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius } from '@/constants/theme';
import { subscribe, type AppEvent, type AppEventKind } from '@/services/eventBus';
import { useThemeStyles } from '@/services/theme';

const MAX_VISIBLE = 3;

interface QueuedToast extends AppEvent {
  // `anim` is created on insert so that the fade-in/out is per-toast.
  anim: Animated.Value;
}

function colorsFor(kind: AppEventKind): { bg: string; fg: string; border: string; icon: keyof typeof MaterialCommunityIcons.glyphMap } {
  switch (kind) {
    case 'ok':
      return { bg: Colors.primary, fg: Colors.textOnPrimary, border: Colors.primaryDark, icon: 'check-circle' };
    case 'info':
      return { bg: Colors.surface, fg: Colors.textPrimary, border: Colors.primaryMid, icon: 'information' };
    case 'warn':
      return { bg: Colors.warningBg, fg: Colors.warning, border: Colors.warning, icon: 'alert' };
    case 'err':
      return { bg: Colors.dangerBg, fg: Colors.danger, border: Colors.danger, icon: 'alert-circle' };
  }
}

export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const styles = useThemeStyles(createStyles);
  const [items, setItems] = useState<QueuedToast[]>([]);
  // Track timers so we can cancel them when a toast is dismissed early.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const itemsRef = useRef<QueuedToast[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const unsub = subscribe((evt) => {
      const duplicateVisible = itemsRef.current.some((x) => (
        x.kind === evt.kind
        && x.category === evt.category
        && x.title === evt.title
        && x.detail === evt.detail
      ));
      if (duplicateVisible) {
        return;
      }

      const item: QueuedToast = { ...evt, anim: new Animated.Value(0) };
      setItems((prev) => {
        const next = [item, ...prev].slice(0, MAX_VISIBLE);
        return next;
      });
      Animated.timing(item.anim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web', // RN-web warns on native driver
      }).start();
      const dur = item.durationMs ?? 3500;
      if (dur > 0) {
        const t = setTimeout(() => dismiss(item.id), dur);
        timers.current.set(item.id, t);
      }
    });
    return () => {
      unsub();
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    };
  }, []);

  const dismiss = (id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) {
        Animated.timing(target.anim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: Platform.OS !== 'web',
        }).start(() => {
          setItems((cur) => cur.filter((x) => x.id !== id));
        });
        return prev;
      }
      return prev.filter((x) => x.id !== id);
    });
  };

  if (items.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: Math.max(insets.top + 8, 16) }]}>
      {items.map((it) => {
        const c = colorsFor(it.kind);
        return (
          <Animated.View
            key={it.id}
            style={[
              styles.toast,
              {
                backgroundColor: c.bg,
                borderColor: c.border,
                opacity: it.anim,
                transform: [
                  {
                    translateY: it.anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
                  },
                ],
              },
            ]}
          >
            <Pressable
              onPress={() => dismiss(it.id)}
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`${it.title}. Tap to dismiss.`}
            >
              <MaterialCommunityIcons name={c.icon} size={18} color={c.fg} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.fg }]} numberOfLines={2}>
                  {it.title}
                </Text>
                {it.detail ? (
                  <Text style={[styles.detail, { color: c.fg, opacity: 0.85 }]} numberOfLines={3}>
                    {it.detail}
                  </Text>
                ) : null}
              </View>
              <MaterialCommunityIcons name="close" size={14} color={c.fg} style={{ opacity: 0.7 }} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  host: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    gap: 6,
  },
  toast: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 13, fontWeight: '700' },
  detail: { fontSize: 11, marginTop: 2 },
});
