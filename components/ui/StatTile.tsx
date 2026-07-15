import React from 'react';
import { Text, View, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type Tone = 'default' | 'danger' | 'warning' | 'accent' | 'success';

/**
 * A single metric (label + big value + optional unit/icon/hint). Replaces the
 * per-screen StatCard re-implementations. The value font scales down on narrow
 * phones so big headline numbers no longer overflow on <360dp devices.
 */
export function StatTile({
  label,
  value,
  unit,
  icon,
  hint,
  tone = 'default',
  hero,
  style,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: IconName;
  hint?: string;
  tone?: Tone;
  hero?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemeStyles(makeStyles);
  const { width } = useWindowDimensions();
  const narrow = width < 360;
  const valueColor = toneColor(tone);
  const valueSize = hero ? (narrow ? 38 : 50) : narrow ? 22 : 26;
  return (
    <View style={[styles.base, style]}>
      <View style={styles.labelRow}>
        {icon ? <MaterialCommunityIcons name={icon} size={14} color={Colors.textTertiary} /> : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: valueColor, fontSize: valueSize }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case 'danger':
      return Colors.danger;
    case 'warning':
      return Colors.warning;
    case 'accent':
      return Colors.accent;
    case 'success':
      return Colors.primaryDark;
    default:
      return Colors.textPrimary;
  }
}

const makeStyles = () =>
  StyleSheet.create({
    base: {
      backgroundColor: Colors.surfaceAlt,
      borderRadius: Radius.md,
      padding: Spacing.md,
      gap: Spacing.xs,
      minWidth: 0,
    },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    label: { ...Type.caption, color: Colors.textSecondary, flexShrink: 1 },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    value: { fontWeight: '800', color: Colors.textPrimary },
    unit: { ...Type.label, color: Colors.textTertiary },
    hint: { ...Type.caption, color: Colors.textTertiary },
  });
