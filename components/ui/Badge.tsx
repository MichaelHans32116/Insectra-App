import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'info';

/** Compact status pill. One component for every status/label chip in the app. */
export function Badge({
  label,
  tone = 'neutral',
  icon,
  dot,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  dot?: boolean;
}) {
  const styles = useThemeStyles(makeStyles);
  const t = tones()[tone];
  return (
    <View
      style={[styles.base, { backgroundColor: t.bg }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: t.fg }]} /> : null}
      {icon ? <MaterialCommunityIcons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: Type.caption.fontSize, fontWeight: '700' },
});

function tones(): Record<BadgeTone, { bg: string; fg: string }> {
  return {
    neutral: { bg: Colors.surfaceAlt, fg: Colors.textSecondary },
    success: { bg: Colors.successBg, fg: Colors.primaryDark },
    warning: { bg: Colors.warningBg, fg: Colors.warning },
    danger: { bg: Colors.dangerBg, fg: Colors.danger },
    accent: { bg: Colors.accentBg, fg: Colors.accent },
    info: { bg: Colors.primaryFaint, fg: Colors.primary },
  };
}
