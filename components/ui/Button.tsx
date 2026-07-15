import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Single button component. Replaces 8+ ad-hoc button styles across the app.
 * Always >=44px tall for touch targets. Colors are read at render time so the
 * button follows light/dark mode.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  accessibilityLabel,
  accessibilityHint,
  disabled,
  loading,
  fullWidth,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  const v = variantValues()[variant];
  const s = SIZE[size];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border, paddingVertical: s.py, paddingHorizontal: s.px },
        fullWidth && styles.fullWidth,
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ActivityIndicator size="small" color={v.fg} />
          <Text style={[styles.label, { color: v.fg, fontSize: s.font }]}>{label}</Text>
        </View>
      ) : (
        <View style={styles.row}>
          {icon ? <MaterialCommunityIcons name={icon} size={s.icon} color={v.fg} /> : null}
          <Text
            style={[styles.label, { color: v.fg, fontSize: s.font }]}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {label}
          </Text>
          {iconRight ? <MaterialCommunityIcons name={iconRight} size={s.icon} color={v.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { fontWeight: '600' },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});

function variantValues(): Record<ButtonVariant, { bg: string; fg: string; border: string }> {
  return {
    primary: { bg: Colors.primary, fg: Colors.textOnPrimary, border: Colors.primary },
    secondary: { bg: Colors.surface, fg: Colors.primaryDark, border: Colors.border },
    ghost: { bg: Colors.transparent, fg: Colors.primaryDark, border: Colors.transparent },
    danger: { bg: Colors.danger, fg: Colors.textOnDanger, border: Colors.danger },
  };
}

const SIZE: Record<ButtonSize, { py: number; px: number; font: number; icon: number }> = {
  sm: { py: 8, px: Spacing.md, font: 13, icon: 16 },
  md: { py: 12, px: Spacing.lg, font: 14, icon: 18 },
  lg: { py: 14, px: Spacing.xl, font: 16, icon: 20 },
};
