/**
 * /remote-access — Owner-only Cloudflare Tunnel URL configuration.
 *
 * Lets the farm Owner publish (and update) the Pi's public API URL so that
 * any farmer in the world — not just those on the same WiFi — can use the
 * Live Camera and Capture Image features.
 *
 * Pi-side setup:
 *   1. Install: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
 *      sudo install cloudflared /usr/local/bin/
 *   2. Run as a quick tunnel:
 *        cloudflared tunnel --url http://localhost:8080
 *      You'll see a URL like https://random-words-1234.trycloudflare.com
 *   3. Paste it into the field below and tap Save.
 *
 * Members see a read-only view explaining the feature.
 *
 * Stored at: devices/{deviceId}.publicApiUrl
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, SectionHeader } from '@/components/ui';
import { usePrimaryCloudDevice } from '@/services/activeDevice';
import { useActiveGroup } from '@/services/activeGroup';
import { useLocale } from '@/services/i18n';
import { toast } from '@/services/eventBus';
import { savePublicApiUrl, subscribePublicApiUrl } from '@/services/remotePi';
import { getRemotePiBase, isRemotePiReachable, recordRemotePiProbe } from '@/services/piDiscovery';
import { useThemeStyles } from '@/services/theme';

function normalizeUrlInput(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

function isValidUrl(s: string): boolean {
  const trimmed = normalizeUrlInput(s);
  if (!trimmed) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function formatTunnelError(url: string, error: unknown): string {
  const host = url.replace(/^https?:\/\//i, '').split('/')[0];
  const raw = error instanceof Error ? error.message.trim() : '';
  const lower = raw.toLowerCase();

  if (
    lower.includes('resolve')
    || lower.includes('dns')
    || lower.includes('name')
    || lower.includes('network request failed')
    || lower.includes('failed to fetch')
  ) {
    return `Could not reach ${host}. The saved Cloudflare quick tunnel may already be expired. Restart cloudflared on the Pi, then save the new URL here.`;
  }

  return raw || 'No response from the Pi tunnel.';
}

export default function RemoteAccessScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const [locale] = useLocale();
  const { active } = useActiveGroup();
  const { device: targetDevice, cloudDeviceId: targetCloudDeviceId, loading: targetDeviceLoading } = usePrimaryCloudDevice();
  const isOwner = active?.role === 'Farm Owner';

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reachable, setReachable] = useState<null | boolean>(null);
  const [loading, setLoading] = useState(true);
  const [lastTestedUrl, setLastTestedUrl] = useState('');

  useEffect(() => {
    if (targetDeviceLoading) {
      setLoading(true);
      return;
    }

    if (!targetCloudDeviceId) {
      setUrl('');
      setReachable(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    return subscribePublicApiUrl(targetCloudDeviceId, (current) => {
      const normalized = current ? normalizeUrlInput(current) : '';
      const currentBase = getRemotePiBase();
      const sameAsLiveBase = Boolean(
        normalized
        && currentBase
        && normalizeUrlInput(currentBase) === normalized,
      );
      setUrl(normalized);
      setReachable(sameAsLiveBase && isRemotePiReachable() ? true : null);
      setLoading(false);
    });
  }, [targetCloudDeviceId, targetDeviceLoading]);

  const handleSave = async () => {
    if (!isOwner) return;
    if (!targetCloudDeviceId) {
      toast.err(
        'device',
        locale === 'tl' ? 'Wala pang rehistradong IoT device' : 'No registered IoT device yet',
        locale === 'tl'
          ? 'Magrehistro muna sa My Devices para alam ng app kung aling Pi ang tatargetin ng Cloudflare link.'
          : 'Register the Pi first in My Devices so the app knows which device should receive the Cloudflare link.',
      );
      return;
    }
    const normalized = normalizeUrlInput(url);
    if (normalized && !isValidUrl(normalized)) {
      toast.err('device', locale === 'tl' ? 'Invalid URL' : 'Invalid URL', locale === 'tl' ? 'Dapat nag-uumpisa sa https://' : 'Must start with https://');
      return;
    }
    setBusy(true);
    try {
      await savePublicApiUrl(normalized || null, targetCloudDeviceId);
      setUrl(normalized);
      setReachable(normalized ? (isRemotePiReachable() ? true : null) : null);
      setLastTestedUrl('');
      toast.ok(
        'device',
        normalized
          ? (locale === 'tl' ? 'Remote access ON' : 'Remote access ON')
          : (locale === 'tl' ? 'Remote access OFF' : 'Remote access OFF'),
        normalized
          ? (locale === 'tl' ? 'Lahat ng farmer (kahit nasa ibang bansa) makikita na ang live cam.' : 'Farmers worldwide can now view the live camera.')
          : (locale === 'tl' ? 'LAN-only ulit.' : 'Back to LAN-only mode.'),
      );
    } catch (e) {
      toast.err('device', 'Save failed', e instanceof Error ? e.message : 'Could not save URL.');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    const normalized = normalizeUrlInput(url);
    if (!isValidUrl(normalized)) {
      toast.err('device', 'Invalid URL', locale === 'tl' ? 'Dapat nag-uumpisa sa https://' : 'Must start with https://');
      return;
    }
    setTesting(true);
    setReachable(null);
    setLastTestedUrl(normalized);
    setUrl(normalized);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${normalized}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json();
      const ok = res.ok && data?.ok === true;
      setReachable(ok);
      recordRemotePiProbe(normalized, ok);
      if (ok) toast.ok('device', 'Tunnel OK', 'Pi reachable via Cloudflare.');
      else {
        toast.err(
          'device',
          'Tunnel unreachable',
          `Got HTTP ${res.status}. Restart cloudflared on the Pi if this quick tunnel has expired.`,
        );
      }
    } catch (e) {
      setReachable(false);
      recordRemotePiProbe(normalized, false);
      toast.err('device', 'Tunnel unreachable', formatTunnelError(normalized, e));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const liveBase = getRemotePiBase();
  const savedReachable = isRemotePiReachable();
  const testedSavedUrl = Boolean(lastTestedUrl && liveBase && lastTestedUrl === liveBase);
  const targetLabel = targetDevice ? `${targetDevice.name} (${targetDevice.piCode})` : null;

  // Connection status badge for the live camera tunnel.
  const statusBadge = liveBase
    ? savedReachable
      ? { tone: 'success' as const, icon: 'wifi-check' as const, label: locale === 'tl' ? 'Konektado' : 'Connected' }
      : { tone: 'warning' as const, icon: 'clock-outline' as const, label: locale === 'tl' ? 'Naka-save' : 'Saved' }
    : { tone: 'neutral' as const, icon: 'lan-disconnect' as const, label: locale === 'tl' ? 'LAN lang' : 'LAN only' };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={locale === 'tl' ? 'Bumalik' : 'Back'}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.h1}>{locale === 'tl' ? 'Worldwide na Camera' : 'Worldwide Camera'}</Text>
          <Badge label={statusBadge.label} tone={statusBadge.tone} icon={statusBadge.icon} />
        </View>

        <Card variant="accent">
          <View style={styles.heroTop}>
            <MaterialCommunityIcons name="earth" size={24} color={Colors.primaryDark} />
            <Text style={styles.heroTitle}>
              {locale === 'tl' ? 'Live cam mula kahit saan' : 'Live cam from anywhere'}
            </Text>
          </View>
          <Text style={styles.heroSub}>
            {locale === 'tl'
              ? 'May Cloudflare Tunnel sa Pi? Makikita ng lahat ng farmer ang live cam, kahit nasa ibang bansa o mobile data.'
              : 'With a Cloudflare Tunnel on the Pi, every farmer can view the live cam — even abroad or on mobile data.'}
          </Text>
          <View style={styles.boundRow}>
            <MaterialCommunityIcons
              name={targetLabel ? 'cctv' : 'alert-circle-outline'}
              size={14}
              color={targetLabel ? Colors.primaryDark : Colors.warning}
            />
            <Text style={[styles.boundText, !targetLabel && styles.boundTextWarn]}>
              {targetLabel
                ? (locale === 'tl' ? `Device: ${targetLabel}` : `Device: ${targetLabel}`)
                : (locale === 'tl' ? 'Walang IoT device — magrehistro sa My Devices.' : 'No IoT device — register one in My Devices.')}
            </Text>
          </View>
        </Card>

        {/* Pi setup steps */}
        <View>
          <SectionHeader title={locale === 'tl' ? 'Step 1 — Sa Raspberry Pi' : 'Step 1 — On the Pi'} icon="raspberry-pi" />
          <Card>
            <Text style={styles.code}>{`cd ~/insectra\nchmod +x setup_cloudflared.sh run_cloudflared_tunnel.sh\n./setup_cloudflared.sh`}</Text>
            <Text style={styles.hint}>
              {locale === 'tl'
                ? 'Awtomatikong sine-save ng Pi ang bagong URL. Manual paste ay override lang.'
                : 'The Pi auto-saves the latest URL. Manual paste is just an override.'}
            </Text>
          </Card>
        </View>

        {/* URL field */}
        <View>
          <SectionHeader title={locale === 'tl' ? 'Step 2 — Manual override' : 'Step 2 — Manual override'} icon="link-variant" />
          <Card>
            <Text style={styles.label}>{locale === 'tl' ? 'Public Cloudflare URL' : 'Public Cloudflare URL'}</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://your-tunnel.trycloudflare.com"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={isOwner && !busy}
              style={styles.input}
            />
            {!targetCloudDeviceId && (
              <Text style={styles.hint}>
                {locale === 'tl'
                  ? 'Kailangan muna ng rehistradong IoT device sa My Devices.'
                  : 'Needs a registered IoT device in My Devices first.'}
              </Text>
            )}
            {liveBase ? (
              <View style={styles.liveRow}>
                <MaterialCommunityIcons name="link-variant" size={16} color={Colors.primaryDark} />
                <Text style={styles.liveText}>
                  {locale === 'tl' ? `Naka-save: ${liveBase}` : `Saved: ${liveBase}`}
                </Text>
              </View>
            ) : (
              <View style={styles.liveRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={Colors.warning} />
                <Text style={styles.liveTextWarn}>
                  {locale === 'tl' ? 'Walang remote URL — LAN-only.' : 'No remote URL — LAN-only.'}
                </Text>
              </View>
            )}

            {liveBase && (
              <View style={styles.liveRow}>
                <MaterialCommunityIcons
                  name={savedReachable ? 'wifi-check' : 'clock-outline'}
                  size={16}
                  color={savedReachable ? Colors.primaryDark : Colors.warning}
                />
                <Text style={savedReachable ? styles.liveText : styles.liveTextWarn}>
                  {savedReachable
                    ? (locale === 'tl' ? 'Verified na reachable.' : 'Verified reachable.')
                    : (locale === 'tl' ? 'Gagamitin pag sumagot ang Pi sa /health.' : 'Used once the Pi answers /health.')}
                </Text>
              </View>
            )}

            {reachable !== null && (
              <View style={styles.liveRow}>
                <MaterialCommunityIcons
                  name={reachable ? 'wifi-check' : 'wifi-off'}
                  size={16}
                  color={reachable ? Colors.primaryDark : Colors.danger}
                />
                <Text style={reachable ? styles.liveText : styles.liveTextErr}>
                  {reachable
                    ? (locale === 'tl' ? 'Test passed — sumagot ang Pi.' : 'Test passed — the Pi responded.')
                    : (locale === 'tl' ? 'Test failed — hindi maabot.' : 'Test failed — not reachable.')}
                </Text>
              </View>
            )}

            {!savedReachable && liveBase && testedSavedUrl && reachable === false && (
              <Text style={styles.hint}>
                {locale === 'tl'
                  ? 'Madalas mag-expire ang quick tunnel pag ni-restart ang cloudflared. Kunin ang bagong URL sa Pi, saka i-save ulit.'
                  : 'Quick tunnels expire when cloudflared restarts. Copy the latest URL from the Pi, then save it again.'}
              </Text>
            )}

            <View style={styles.btnRow}>
              <Button
                label={locale === 'tl' ? 'I-test' : 'Test'}
                icon="lan-connect"
                variant="secondary"
                loading={testing}
                disabled={testing || !normalizeUrlInput(url)}
                onPress={handleTest}
                style={styles.flexBtn}
              />
              <Button
                label={locale === 'tl' ? 'I-save' : 'Save'}
                icon="content-save"
                variant="primary"
                loading={busy}
                disabled={!isOwner || busy || !targetCloudDeviceId}
                onPress={handleSave}
                style={styles.flexBtn}
              />
            </View>

            {!isOwner && (
              <Text style={styles.hint}>
                {locale === 'tl'
                  ? 'Ang Farm Owner lang ang puwedeng magbago nito.'
                  : 'Only the Farm Owner can change this.'}
              </Text>
            )}

            {isOwner && (
              <Text style={styles.hint}>
                {locale === 'tl'
                  ? 'Tip: hostname lang ay ok — auto-idaragdag ang https://.'
                  : 'Tip: paste just the hostname — https:// is added automatically.'}
              </Text>
            )}
          </Card>
        </View>

        {/* Notes */}
        <View>
          <SectionHeader title={locale === 'tl' ? 'Paalala' : 'Notes'} icon="information-outline" />
          <Card>
            <Text style={styles.note}>
              {locale === 'tl'
                ? '• Nagbabago ang quick tunnel URL pag nag-restart ang cloudflared. Para permanent, mag-named tunnel sa Cloudflare dashboard.\n• Walang port-forward na kailangan.\n• Libre ang Cloudflare Tunnel para sa personal use.\n• Mas mabilis ang LAN — gagamitin pa rin pag pareho kayo ng WiFi ng Pi.'
                : '• Quick tunnel URLs rotate when cloudflared restarts. For a permanent one, set up a named tunnel in the Cloudflare dashboard.\n• No router port-forwarding needed.\n• Cloudflare Tunnel is free for personal use.\n• LAN is faster — the app prefers it on the same WiFi as the Pi.'}
            </Text>
          </Card>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  h1: { ...Type.h1, color: Colors.primaryDark, flex: 1, marginLeft: Spacing.sm },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroTitle: { ...Type.title, color: Colors.textPrimary, flex: 1 },
  heroSub: { ...Type.body, color: Colors.textSecondary, marginTop: Spacing.sm },
  boundRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.md },
  boundText: { ...Type.caption, color: Colors.primaryDark, flex: 1 },
  boundTextWarn: { color: Colors.warning },
  label: { ...Type.label, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    color: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    ...Type.body,
    minHeight: 44,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hint: { ...Type.caption, color: Colors.textTertiary, marginTop: Spacing.sm },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  liveText: { ...Type.caption, color: Colors.primaryDark, flex: 1 },
  liveTextWarn: { ...Type.caption, color: Colors.warning, flex: 1 },
  liveTextErr: { ...Type.caption, color: Colors.danger, flex: 1 },
  btnRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  flexBtn: { flex: 1 },
  note: { ...Type.caption, color: Colors.textSecondary, lineHeight: 18 },
});
