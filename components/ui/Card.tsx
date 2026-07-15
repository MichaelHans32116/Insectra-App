import React from 'react';
import { Pressable, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius, Spacing, Elevation } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

export type CardVariant = 'plain' | 'elevated' | 'accent' | 'outline';

/**
 * Standard surface. Replaces the ~6 bespoke `card` StyleSheets that each screen
 * used to redefine. `variant` encodes hierarchy so primary/actionable cards no
 * longer look identical to passive informational ones. Colors are resolved at
 * render time so it follows light/dark mode (see services/theme).
 */
export function Card({
  children,
  variant = 'plain',
  style,
  padded = true,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useThemeStyles(makeStyles);
  const variantStyle =
    variant === 'elevated'
      ? styles.vElevated
      : variant === 'accent'
        ? styles.vAccent
        : variant === 'outline'
          ? styles.vOutline
          : null;
  const content = (
    <View style={[styles.base, padded && styles.padded, variantStyle, style]}>{children}</View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    base: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: Colors.borderLight,
    },
    padded: { padding: Spacing.lg },
    pressed: { opacity: 0.85 },
    vElevated: { borderColor: Colors.border, ...Elevation.card },
    vAccent: { backgroundColor: Colors.accentBg, borderColor: Colors.accent + '55' },
    vOutline: { backgroundColor: Colors.transparent, borderColor: Colors.border },
  });
