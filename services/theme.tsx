/**
 * InsecTra theme — light + dark palettes with persistence.
 *
 * Strategy:
 *   - The existing `Colors` object in `@/constants/theme` is the LIGHT palette
 *     and is imported by ~every component. Refactoring every import to a
 *     hook would touch hundreds of lines. So instead we:
 *
 *     1. Mutate the exported `Colors` object in-place when the theme changes.
 *     2. Bump a global subscriber (any consumer of `useThemeMode()` re-renders).
 *     3. Wrap the app in <ThemeProvider> which forces a re-render on switch
 *        by changing a `key` it passes to children.
 *
 *   - `Radius` is theme-independent and never mutated.
 *
 * Persistence:
 *   - Stored in AsyncStorage as 'insectra.theme' = 'light' | 'dark' | 'system'
 *   - On launch, ThemeProvider reads stored value; if 'system', uses
 *     `useColorScheme()` from RN.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'insectra.theme';
type Palette = { [K in keyof typeof Colors]: string };

// ── Light palette: snapshot of the original Colors at module load time.
// We capture this BEFORE any mutation so we can restore it on switch back.
const LIGHT: Palette = { ...Colors };

// ── Dark palette: hand-tuned to keep brand identity (green) but flip
// surfaces, text, and borders for readability on OLED-friendly dark UI.
// Contrast targets: WCAG AA on textPrimary vs background (≥ 4.5:1).
const DARK: Palette = {
  primary:       '#76D99F',
  primaryDark:   '#93E5B7',
  primaryDarker: '#CFF6DC',
  primaryMid:    '#59B986',
  primaryLight:  '#88E2AD',
  primaryPale:   '#3E7659',
  primaryTint:   '#173523',
  primaryFaint:  '#111B16',

  background:    '#0D100E',
  surface:       '#171C19',
  surfaceAlt:    '#202722',
  border:        '#344039',
  borderLight:   '#28332D',
  divider:       '#252E29',

  textPrimary:   '#F3F8F5',
  textSecondary: '#B8C9BE',
  textTertiary:  '#829689',
  textOnPrimary: '#07110B',
  textOnDanger:  '#FFFFFF',

  danger:        '#FF7C78',
  dangerBg:      '#321816',
  dangerLight:   '#FFAAA6',
  warning:       '#F4BD61',
  warningBg:     '#2D2112',
  info:          '#86D7AE',

  accent:        '#B8C9BE',
  accentBg:      '#111B16',
  success:       '#93E5B7',
  successBg:     '#173523',

  tabActive:     '#93E5B7',
  tabInactive:   '#829689',
  tabBarBg:      '#171C19',
  tabBarBorder:  '#344039',

  shadow:        '#000000',
  overlay:       'rgba(0, 0, 0, 0.6)',
  transparent:   'transparent',
};

function applyPalette(p: Palette): void {
  // Object.assign mutates in place so every importer of `Colors` sees the
  // new values. Components re-render via the ThemeProvider's key bump.
  Object.assign(Colors, p);
}

let appliedTheme: ResolvedTheme | null = null;

function ensurePalette(resolved: ResolvedTheme): void {
  if (appliedTheme === resolved) return;
  applyPalette(resolved === 'dark' ? DARK : LIGHT);
  appliedTheme = resolved;
}

// ── Pub-sub for non-React consumers (rare but useful) ────────────────────
type ModeListener = (mode: ResolvedTheme) => void;
const listeners = new Set<ModeListener>();

interface ThemeContextValue {
  mode: ThemeMode;            // user preference (light/dark/system)
  resolved: ResolvedTheme;    // actual rendered theme
  setMode: (m: ThemeMode) => void | Promise<void>;
  toggle: () => void | Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Hydrate stored preference once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && (v === 'light' || v === 'dark' || v === 'system')) {
          setModeState(v);
        }
      } catch {
        /* ignore */
      } finally {
        /* no-op */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const resolved: ResolvedTheme = useMemo(() => {
    if (mode === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }
    return mode;
  }, [mode, systemScheme]);

  // Apply before children render. If this waits for an effect, screens that
  // build StyleSheet values during render can capture the previous palette,
  // which is what caused the light/dark colors to appear swapped or mixed.
  ensurePalette(resolved);

  // Notify non-React subscribers after the palette has changed.
  useEffect(() => {
    for (const cb of listeners) {
      try {
        cb(resolved);
      } catch {
        /* ignore */
      }
    }
  }, [resolved]);

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useThemeStyles<T>(factory: () => T): T {
  const { resolved } = useThemeMode();
  return useMemo(factory, [resolved]);
}

export function subscribeTheme(cb: ModeListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
