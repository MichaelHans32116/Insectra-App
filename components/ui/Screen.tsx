import React from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

/**
 * Responsive, safe-area-aware page container. Horizontal padding adapts to
 * screen width, content is centered + max-width capped on tablets/web, and the
 * bottom inset clears the tab bar. Use as the root of every tab screen so the
 * layout behaves on phones from <360dp up to large tablets.
 */
export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
  gap = Spacing.lg,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  const styles = useThemeStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const hPad = width < 360 ? Spacing.md : width > 720 ? Spacing.xxl : Spacing.lg;
  const inner: StyleProp<ViewStyle> = {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: hPad,
    gap,
  };

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: Colors.background }, style]}>
        <View style={[inner, { paddingTop: Spacing.md, flex: 1 }, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: Colors.background }, style]}
      contentContainerStyle={[
        inner,
        { paddingTop: Spacing.md, paddingBottom: Math.max(insets.bottom + Spacing.xxl, 96) },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const makeStyles = () => StyleSheet.create({
  flex: { flex: 1 },
});
