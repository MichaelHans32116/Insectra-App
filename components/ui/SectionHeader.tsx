import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Consistent section title with an optional trailing action. Gives every screen
 * the same scannable hierarchy instead of ad-hoc eyebrow labels.
 */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  icon,
  actionHint,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
  actionHint?: string;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.titleWrap}>
        {icon ? <MaterialCommunityIcons name={icon} size={18} color={Colors.primary} /> : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityHint={actionHint}
          hitSlop={8}
          style={styles.actionTouch}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    titleWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
    title: { ...Type.h2, color: Colors.textPrimary, flexShrink: 1 },
    actionTouch: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs },
    action: { ...Type.label, color: Colors.primary },
  });
