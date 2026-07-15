import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import FarmAccessBar from '@/components/FarmAccessBar';
import { Screen, Card, Button, Badge, StatTile, EmptyState, type BadgeTone } from '@/components/ui';
import { listenDeviceState, type DeviceState } from '@/services/iotRealtime';
import { computeRisk } from '@/services/riskScoring';
import { computeBatteryHealth, computeTrapCapacity } from '@/services/deviceHealth';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useActiveGroup } from '@/services/activeGroup';
import { useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';
import {
  cloudDocIdForPiCode,
  listDevicesForFarm,
  type RegisteredDevice,
} from '@/services/devices';

// If the device hasn't reported within this window, treat env/count fields as stale.
const STALE_AFTER_MS = 3 * 60 * 1000; // 3 minutes
const ONLINE_WINDOW_MS = 6 * 60 * 1000; // 6 minutes

function isStale(lastSeen: Date | null): boolean {
  if (!lastSeen) return true;
  return Date.now() - lastSeen.getTime() > STALE_AFTER_MS;
}

function formatLastSeen(date: Date | null, text: (en: string, tl: string) => string): string {
  if (!date) return text('no data yet', 'wala pang datos');
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return text('just now', 'kakaupdate');
  if (diffMin < 60) return text(`${diffMin}m ago`, `${diffMin}m nakalipas`);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return text(`${diffHr}h ago`, `${diffHr}h nakalipas`);
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function getDisplayStatus(rawStatus: string, lastSeen: Date | null): string {
  const normalized = rawStatus.toLowerCase();
  if (
    normalized.includes('search')
    || normalized.includes('connect')
    || normalized.includes('scan')
    || normalized.includes('reconnect')
  ) {
    return rawStatus;
  }
  const statusSaysOnline = normalized === 'online' || normalized === 'running';
  if (!statusSaysOnline) return rawStatus;
  if (!lastSeen) return 'offline';
  return Date.now() - lastSeen.getTime() < ONLINE_WINDOW_MS ? 'online' : 'offline';
}

function formatStatus(status: string, text: (en: string, tl: string) => string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'online' || normalized === 'running') return text('Online', 'Online');
  if (normalized === 'offline') return text('Offline', 'Offline');
  if (normalized.includes('connect')) return text('Connecting', 'Kumokonekta');
  if (normalized.includes('search') || normalized.includes('scan')) return text('Searching', 'Naghahanap');
  return status;
}

function statusTone(status: string): BadgeTone {
  const n = status.toLowerCase();
  if (n === 'online' || n === 'running') return 'success';
  if (n === 'offline') return 'danger';
  if (n.includes('connect') || n.includes('search') || n.includes('scan')) return 'warning';
  return 'neutral';
}

function healthLabel(label: string, text: (en: string, tl: string) => string): string {
  switch (label) {
    case 'Waiting': return text('Waiting', 'Naghihintay');
    case 'Good': return text('Good', 'Maayos');
    case 'Low': return text('Low', 'Mababa');
    case 'Watch': return text('Watch', 'Bantayan');
    case 'Critical': return text('Critical', 'Kritikal');
    case 'Open': return text('Open', 'May espasyo');
    case 'Filling': return text('Filling', 'Napupuno');
    case 'Service Soon': return text('Service Soon', 'Linisin na');
    case 'Full': return text('Full', 'Puno');
    default: return label;
  }
}

function healthTone(level: string): BadgeTone {
  switch (level) {
    case 'critical': return 'danger';
    case 'warning': return 'warning';
    case 'watch': return 'accent';
    case 'unknown': return 'neutral';
    default: return 'success';
  }
}

function statTone(level: string): 'default' | 'danger' | 'warning' | 'accent' | 'success' {
  switch (level) {
    case 'critical': return 'danger';
    case 'warning': return 'warning';
    case 'watch': return 'accent';
    case 'unknown': return 'default';
    default: return 'success';
  }
}

function riskBadgeTone(level: string, insufficient: boolean): BadgeTone {
  if (insufficient) return 'neutral';
  if (level === 'critical' || level === 'high') return 'danger';
  if (level === 'moderate') return 'warning';
  if (level === 'watch') return 'accent';
  return 'success';
}

function riskLabel(level: string, insufficient: boolean, text: (en: string, tl: string) => string): string {
  if (insufficient) return text('Insufficient data', 'Kulang ang datos');
  switch (level) {
    case 'critical': return text('Critical', 'Kritikal');
    case 'high': return text('High', 'Mataas');
    case 'moderate': return text('Moderate', 'Katamtaman');
    case 'watch': return text('Watch', 'Bantayan');
    default: return text('Low', 'Mababa');
  }
}

function riskColor(level: string, insufficient: boolean): string {
  if (insufficient) return Colors.textSecondary;
  if (level === 'critical') return Colors.danger;
  if (level === 'high') return Colors.dangerLight;
  if (level === 'moderate') return Colors.warning;
  if (level === 'watch') return Colors.accent;
  return Colors.primaryDark;
}

function riskAdviceText(level: string, insufficient: boolean, text: (en: string, tl: string) => string): string {
  if (insufficient) {
    return text(
      'Waiting for the Pi to report a catch and weather before scoring risk.',
      'Hinihintay ang ulat ng Pi sa bilang at panahon bago mag-score.',
    );
  }
  if (level === 'critical') return text('Outbreak-level catch. Intervene now.', 'Outbreak-level na nahuli. Kumilos na.');
  if (level === 'high') return text('Catch at the action threshold. Plan IPM within 48h.', 'Nasa action threshold na. Mag-IPM sa loob ng 48h.');
  if (level === 'moderate') return text('Some real trap activity. Watch closely.', 'May totoong aktibidad. Bantayang mabuti.');
  if (level === 'watch') return text('Weather favors flies, but catch is low. Do not spray on weather alone.', 'Pabor ang panahon pero mababa ang huli. Huwag mag-spray base sa panahon lang.');
  return text('Low activity and conditions. Routine monitoring is enough.', 'Mababa ang aktibidad at kondisyon. Sapat ang regular na pagbabantay.');
}

export default function DashboardScreen() {
  const router = useRouter();
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const { active } = useActiveGroup();
  const [loading, setLoading] = useState(true);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [targetDevice, setTargetDevice] = useState<RegisteredDevice | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const targetCloudDeviceId = targetDevice ? cloudDocIdForPiCode(targetDevice.piCode) : null;

  useEffect(() => {
    let mounted = true;
    const loadDevices = async () => {
      if (!active) {
        setTargetDevice(null);
        setDeviceState(null);
        setDeviceLoading(false);
        setLoading(false);
        return;
      }
      setDeviceLoading(true);
      try {
        const devices = await listDevicesForFarm(active.id);
        if (!mounted) return;
        setTargetDevice(devices[0] ?? null);
        if (!devices[0]) {
          setDeviceState(null);
          setLoading(false);
        }
      } catch {
        if (!mounted) return;
        setTargetDevice(null);
        setDeviceState(null);
        setLoading(false);
      } finally {
        if (mounted) setDeviceLoading(false);
      }
    };
    loadDevices();
    return () => {
      mounted = false;
    };
  }, [active?.id]);

  useEffect(() => {
    if (!targetCloudDeviceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = listenDeviceState(targetCloudDeviceId, (next) => {
      setDeviceState(next);
      setLoading(false);
    });
    return unsubscribe;
  }, [targetCloudDeviceId]);

  const rawStatusLabel = deviceState?.status ?? 'offline';
  const dataSource = deviceState?.source ?? 'local';
  const lastSeen = deviceState?.lastSeen ?? null;
  const dailyCount = deviceState?.dailyCount ?? 0;
  const lastConfidence = deviceState?.lastConfidence ?? 0;
  const inferenceMs = deviceState?.inferenceMs ?? 0;
  const temperatureC = deviceState?.temperature ?? null;
  const humidityPct = deviceState?.humidity ?? null;
  const stale = isStale(lastSeen);
  const riskDailyCount = !stale && typeof deviceState?.dailyCount === 'number'
    ? deviceState.dailyCount
    : null;
  const statusLabel = getDisplayStatus(rawStatusLabel, lastSeen);
  const isDirect = dataSource === 'local';
  const battery = useMemo(() => computeBatteryHealth(deviceState), [deviceState]);
  const trap = useMemo(() => computeTrapCapacity(deviceState), [deviceState]);

  const risk = useMemo(
    () => computeRisk({
      temperatureC: !stale ? temperatureC : null,
      humidityPct: !stale ? humidityPct : null,
      dailyCount: riskDailyCount,
    }),
    [temperatureC, humidityPct, riskDailyCount, stale],
  );

  const currentTrapLabel = targetDevice?.name ?? text('No trap yet', 'Wala pang trap');
  const statusDisplay = formatStatus(statusLabel, text);
  const insufficient = risk.missing.length >= 3;
  const rColor = riskColor(risk.level, insufficient);
  const canOpenTrap = !!targetDevice;
  const envBadge = (value: number | null): { label: string; tone: BadgeTone } =>
    value === null
      ? { label: text('Waiting', 'Naghihintay'), tone: 'neutral' }
      : stale
        ? { label: text('Stale', 'Luma'), tone: 'warning' }
        : { label: text('Live', 'Live'), tone: 'success' };

  return (
    <Screen>
      <FarmAccessBar />

      <Text style={styles.title}>{text('Farm Home', 'Home ng Sakahan')}</Text>

      {/* Current trap + quick actions */}
      <Card variant="elevated" style={styles.gap12}>
        <View style={styles.trapHeader}>
          <View style={styles.trapIcon}>
            <MaterialCommunityIcons name="cctv" size={20} color={Colors.primaryDark} />
          </View>
          <View style={styles.flex1}>
            <Text style={styles.trapTitle} numberOfLines={1}>{currentTrapLabel}</Text>
            <Text style={styles.trapMeta} numberOfLines={1}>
              {targetDevice
                ? `${targetDevice.piCode}${targetDevice.locationLabel ? ' · ' + targetDevice.locationLabel : ''}`
                : text('Register a trap to start monitoring', 'Magrehistro ng trap para magsimula')}
            </Text>
          </View>
          {deviceLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Badge label={canOpenTrap ? text('Ready', 'Handa') : text('Setup', 'I-setup')} tone={canOpenTrap ? 'success' : 'neutral'} />
          )}
        </View>

        <View style={styles.actionsRow}>
          <View style={styles.flex1}>
            <Button
              label={text('Trap details', 'Detalye ng trap')}
              icon="file-document-outline"
              variant="secondary"
              size="sm"
              fullWidth
              accessibilityHint={text('Opens this trap record and settings.', 'Binubuksan ang record at settings ng trap.')}
              onPress={() => router.push((targetDevice ? `/device/${targetDevice.id}` : '/devices') as any)}
            />
          </View>
          <View style={styles.flex1}>
            <Button
              label={text('Camera test', 'Test camera')}
              icon="camera-outline"
              variant="secondary"
              size="sm"
              fullWidth
              accessibilityHint={text('Opens the live camera test screen.', 'Binubuksan ang live camera test.')}
              onPress={() => router.push((targetDevice ? '/detect' : '/devices') as any)}
            />
          </View>
          <View style={styles.flex1}>
            <Button
              label={text('Service log', 'Service log')}
              icon="wrench-outline"
              variant="secondary"
              size="sm"
              fullWidth
              accessibilityHint={text('Opens cleaning and maintenance tasks.', 'Binubuksan ang linis at maintenance.')}
              onPress={() => router.push((targetDevice ? '/maintenance' : '/devices') as any)}
            />
          </View>
        </View>
      </Card>

      {!canOpenTrap && !deviceLoading ? (
        <Card>
          <EmptyState
            icon="cctv-off"
            title={text('No trap registered', 'Walang nakarehistrong trap')}
            body={text('Register the Pi device to see live counts, camera, and maintenance.', 'Irehistro ang Pi device para sa live count, camera, at maintenance.')}
            actionLabel={text('Open traps', 'Buksan ang mga trap')}
            onAction={() => router.push('/devices' as any)}
          />
        </Card>
      ) : null}

      {canOpenTrap ? (
        <>
          {/* Hero: today's catch */}
          <Card variant="elevated" style={styles.gap8}>
            <View style={styles.rowBetween}>
              <View style={styles.rowCenter}>
                <MaterialCommunityIcons name="bug-outline" size={18} color={Colors.primaryDark} />
                <Text style={styles.cardLabel}>{text("Today's catch", 'Huli ngayon')}</Text>
              </View>
              <Badge label={statusDisplay} tone={statusTone(statusLabel)} dot />
            </View>
            {loading ? (
              <View style={styles.heroLoading}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>{text('Waiting for latest trap count...', 'Hinihintay ang bagong bilang ng trap...')}</Text>
              </View>
            ) : (
              <StatTile label="" value={dailyCount} unit={text('flies', 'langaw')} hero tone="success" style={styles.heroTile} />
            )}
            <Text style={styles.metaLine} numberOfLines={1}>
              {targetDevice?.piCode} · {text('updated', 'na-update')} {formatLastSeen(lastSeen, text)}
            </Text>
          </Card>

          {/* Outbreak risk */}
          <Card variant="elevated" style={[styles.gap8, { borderColor: rColor + '55' }]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowCenter}>
                <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={rColor} />
                <Text style={[styles.cardLabel, { color: rColor }]}>{text('Outbreak risk', 'Panganib ng pagdami')}</Text>
              </View>
              <Badge label={riskLabel(risk.level, insufficient, text)} tone={riskBadgeTone(risk.level, insufficient)} />
            </View>
            <View style={styles.riskScoreRow}>
              <Text style={[styles.riskScore, { color: rColor }]}>{(risk.score * 100).toFixed(0)}%</Text>
              <Text style={styles.riskAdvice}>{riskAdviceText(risk.level, insufficient, text)}</Text>
            </View>
            {!insufficient ? (
              <View style={styles.gap8}>
                <FactorBar
                  label={text('Pest pressure (catch + trend)', 'Presyur ng peste (huli + trend)')}
                  value={risk.populationPressure}
                  color={rColor}
                  styles={styles}
                />
                <FactorBar
                  label={text('Conditions (temp × humidity)', 'Kondisyon (temp × halumigmig)')}
                  value={risk.environmentalSuitability ?? 0}
                  color={Colors.accent}
                  styles={styles}
                />
              </View>
            ) : null}
          </Card>

          {/* Health */}
          <View style={styles.statGrid}>
            <View style={styles.flex1}>
              <StatTile
                label={text('Battery', 'Baterya')}
                value={battery.percent === null ? '—' : `${battery.percent}%`}
                icon="battery-heart-outline"
                tone={statTone(battery.level)}
                hint={healthLabel(battery.label, text)}
              />
            </View>
            <View style={styles.flex1}>
              <StatTile
                label={text('Trap fill', 'Laman ng trap')}
                value={`${trap.percent}%`}
                icon="archive-alert-outline"
                tone={statTone(trap.level)}
                hint={`${trap.countSinceService}/${trap.capacity}`}
              />
            </View>
          </View>

          {/* Environment */}
          <View style={styles.statGrid}>
            <View style={styles.flex1}>
              <StatTile
                label={text('Temperature', 'Temperatura')}
                value={temperatureC === null ? '—' : `${temperatureC.toFixed(1)}°`}
                unit="C"
                icon="thermometer"
                hint={envBadge(temperatureC).label}
              />
            </View>
            <View style={styles.flex1}>
              <StatTile
                label={text('Humidity', 'Halumigmig')}
                value={humidityPct === null ? '—' : `${humidityPct.toFixed(0)}%`}
                icon="water-percent"
                hint={envBadge(humidityPct).label}
              />
            </View>
          </View>

          {/* Live inference (only when reading the Pi directly) */}
          {isDirect && (inferenceMs > 0 || lastConfidence > 0) ? (
            <View style={styles.statGrid}>
              <View style={styles.flex1}>
                <StatTile
                  label={text('Inference', 'Inference')}
                  value={inferenceMs > 0 ? `${inferenceMs}` : '—'}
                  unit="ms"
                  icon="speedometer"
                  hint="YOLO11n"
                />
              </View>
              <View style={styles.flex1}>
                <StatTile
                  label={text('Confidence', 'Tiwala')}
                  value={lastConfidence > 0 ? `${(lastConfidence * 100).toFixed(0)}%` : '—'}
                  icon="target"
                  hint={text('last detection', 'huling detect')}
                />
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function FactorBar({
  label,
  value,
  color,
  styles,
}: {
  label: string;
  value: number;
  color: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.factorTrack}>
        <View style={[styles.factorFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.factorPct, { color }]}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  title: { ...Type.h1, color: Colors.textPrimary },
  flex1: { flex: 1, minWidth: 0 },
  gap8: { gap: Spacing.sm },
  gap12: { gap: Spacing.md },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },

  trapHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  trapIcon: {
    width: 42, height: 42, borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint, alignItems: 'center', justifyContent: 'center',
  },
  trapTitle: { ...Type.title, color: Colors.primaryDark },
  trapMeta: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },

  cardLabel: { ...Type.bodyStrong, color: Colors.textPrimary },
  heroLoader: { marginVertical: Spacing.lg, alignSelf: 'flex-start' },
  heroLoading: { alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.lg },
  loadingText: { ...Type.caption, color: Colors.textSecondary },
  heroTile: { backgroundColor: Colors.transparent, padding: 0 },
  metaLine: { ...Type.caption, color: Colors.textTertiary },

  riskScoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  riskScore: { ...Type.display },
  riskAdvice: { ...Type.caption, color: Colors.textSecondary, flex: 1 },

  factorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  factorLabel: { ...Type.caption, color: Colors.textSecondary, flex: 1 },
  factorTrack: { width: 90, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceAlt, overflow: 'hidden' },
  factorFill: { height: '100%', borderRadius: 3 },
  factorPct: { ...Type.caption, fontWeight: '700', width: 34, textAlign: 'right' },

  statGrid: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'stretch' },
});
