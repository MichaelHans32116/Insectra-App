/**
 * /settings — App preferences screen.
 *
 * Currently exposes:
 *   - Language picker (English / Filipino), persisted via services/i18n.ts.
 *
 * Designed to grow into the canonical "preferences" home (notification
 * channels, units, theme, etc.) as more user-controllable settings arrive.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, SectionHeader } from '@/components/ui';
import { useLocale, useLocalText, useT, type Locale } from '@/services/i18n';
import { useThemeMode, useThemeStyles, type ThemeMode } from '@/services/theme';
import { toast } from '@/services/eventBus';

export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const [locale, setLocale] = useLocale();
  const text = useLocalText();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode } = useThemeMode();
  const styles = useThemeStyles(createStyles);

  const themeOptions: Array<{ value: ThemeMode; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; sub: string }> = [
    {
      value: 'light',
      icon: 'white-balance-sunny',
      label: locale === 'tl' ? 'Maliwanag' : 'Light',
      sub: locale === 'tl' ? 'Klasikong puti at berde.' : 'Classic white + green.',
    },
    {
      value: 'dark',
      icon: 'weather-night',
      label: locale === 'tl' ? 'Madilim' : 'Dark',
      sub: locale === 'tl' ? 'Mababang ilaw, tipid sa battery.' : 'Easier on the eyes; saves battery.',
    },
    {
      value: 'system',
      icon: 'theme-light-dark',
      label: locale === 'tl' ? 'Sundan ang device' : 'Match device',
      sub: locale === 'tl' ? 'Sumusunod sa system setting.' : 'Follows your phone’s theme.',
    },
  ];

  const handleThemeChange = async (next: ThemeMode) => {
    if (next === themeMode) return;
    await setThemeMode(next);
    toast.ok(
      'system',
      locale === 'tl' ? 'Tema na-update' : 'Theme updated',
      next === 'system'
        ? (locale === 'tl' ? 'Sumusunod na sa device.' : 'Following the device theme.')
        : (next === 'dark' ? (locale === 'tl' ? 'Naka-Dark mode.' : 'Switched to dark mode.') : (locale === 'tl' ? 'Naka-Light mode.' : 'Switched to light mode.')),
    );
  };

  const langOptions: Array<{ value: Locale; label: string; native: string; flag: string }> = [
    { value: 'en', label: t('settings.english'), native: 'English', flag: '🇺🇸' },
    { value: 'tl', label: t('settings.filipino'), native: 'Filipino / Tagalog', flag: '🇵🇭' },
  ];

  const activeBadge = (
    <Badge label={locale === 'tl' ? 'Aktibo' : 'Active'} tone="success" icon="check" />
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Button
          label={text('Back', 'Bumalik')}
          icon="arrow-left"
          variant="ghost"
          size="sm"
          onPress={() => router.back()}
          style={styles.backBtn}
        />
        <Text style={styles.h1}>{text('Settings', 'Mga Setting')}</Text>
      </View>

      {/* ── Language ──────────────────────────────────────────── */}
      <View>
        <SectionHeader title={t('settings.language')} icon="translate" />
        <Card padded={false}>
          {langOptions.map((opt, idx) => {
            const selected = locale === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.row,
                  idx > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                onPress={() => setLocale(opt.value)}
              >
                <Text style={styles.flag}>{opt.flag}</Text>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{opt.label}</Text>
                  <Text style={styles.rowSub}>{opt.native}</Text>
                </View>
                {selected ? (
                  activeBadge
                ) : (
                  <MaterialCommunityIcons name="radiobox-blank" size={22} color={Colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </Card>
        <Text style={styles.hint}>
          {locale === 'tl'
            ? 'Magbabago kaagad ang wika ng buong app.'
            : 'The whole app updates immediately.'}
        </Text>
      </View>

      {/* ── Theme ─────────────────────────────────────────────── */}
      <View>
        <SectionHeader title={locale === 'tl' ? 'Tema' : 'Theme'} icon="palette-outline" />
        <Card padded={false}>
          {themeOptions.map((opt, idx) => {
            const selected = themeMode === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.row,
                  idx > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                onPress={() => handleThemeChange(opt.value)}
              >
                <View style={[styles.iconBubble, selected && styles.iconBubbleActive]}>
                  <MaterialCommunityIcons
                    name={opt.icon}
                    size={20}
                    color={selected ? Colors.primaryDark : Colors.textSecondary}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{opt.label}</Text>
                  <Text style={styles.rowSub}>{opt.sub}</Text>
                </View>
                {selected ? (
                  activeBadge
                ) : (
                  <MaterialCommunityIcons name="radiobox-blank" size={22} color={Colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </Card>
        <Text style={styles.hint}>
          {locale === 'tl'
            ? `Kasalukuyan: ${themeResolved === 'dark' ? 'Madilim' : 'Maliwanag'}.`
            : `Currently rendering in ${themeResolved} mode.`}
        </Text>
      </View>

      {/* ── Account shortcut ─────────────────────────────────── */}
      <View>
        <SectionHeader title={locale === 'tl' ? 'Akaunt' : 'Account'} icon="account-circle-outline" />
        <Card
          variant="elevated"
          padded={false}
          onPress={() => router.push('/profile' as any)}
          accessibilityLabel={text('Edit my profile', 'I-edit ang profile')}
        >
          <View style={styles.row}>
            <View style={styles.iconBubble}>
              <MaterialCommunityIcons name="account-circle-outline" size={20} color={Colors.primaryDark} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{text('Edit my profile', 'I-edit ang profile')}</Text>
              <Text style={styles.rowSub}>
                {locale === 'tl' ? 'Pangalan, password, mga sakahan.' : 'Name, password, communities.'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textTertiary} />
          </View>
        </Card>
      </View>

      {/* ── Device / Remote access ───────────────────────────── */}
      <View>
        <SectionHeader title={locale === 'tl' ? 'Aparato' : 'Device'} icon="cctv" />
        <Card
          variant="elevated"
          padded={false}
          onPress={() => router.push('/remote-access' as any)}
          accessibilityLabel={text('Open worldwide camera settings', 'Buksan ang worldwide camera settings')}
        >
          <View style={styles.row}>
            <View style={styles.iconBubble}>
              <MaterialCommunityIcons name="earth" size={20} color={Colors.primaryDark} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {text('Worldwide Camera', 'Pandaigdigang Camera')}
              </Text>
              <Text style={styles.rowSub}>
                {locale === 'tl'
                  ? 'Tingnan ang live cam kahit nasa ibang bansa.'
                  : 'View the live camera from anywhere.'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textTertiary} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const createStyles = () => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backBtn: { paddingHorizontal: 0 },
  h1: { ...Type.h1, color: Colors.primaryDark, flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  rowPressed: { opacity: 0.85 },
  rowText: { flex: 1, minWidth: 0 },
  flag: { fontSize: 24 },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubbleActive: { backgroundColor: Colors.primaryTint },
  rowTitle: { ...Type.bodyStrong, color: Colors.textPrimary },
  rowSub: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  hint: { ...Type.caption, color: Colors.textTertiary, marginTop: Spacing.sm, marginLeft: Spacing.xs },
});
