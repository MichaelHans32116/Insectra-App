import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import { Button } from './Button';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Consistent empty/zero/error state. Replaces 4+ bespoke empty-state blocks. */
export function EmptyState({
  icon = 'information-outline',
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useThemeStyles(makeStyles);
  return (
    <View style={styles.base}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={26} color={Colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" style={styles.action} />
      ) : null}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    base: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: Colors.primaryFaint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { ...Type.title, color: Colors.textPrimary, textAlign: 'center' },
    body: { ...Type.body, color: Colors.textSecondary, textAlign: 'center', maxWidth: 320 },
    action: { marginTop: Spacing.sm },
  });
