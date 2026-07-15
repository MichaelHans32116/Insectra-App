import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, StatTile, EmptyState, SectionHeader } from '@/components/ui';
import { useActiveGroup } from '@/services/activeGroup';
import {
  cloudDocIdForPiCode,
  getDevice,
  setLiveDetect,
  updateDeviceModules,
  type DeviceModules,
  type RegisteredDevice,
} from '@/services/devices';
import { toast } from '@/services/eventBus';
import { listenDeviceState, type DeviceState } from '@/services/iotRealtime';
import { useThemeStyles } from '@/services/theme';

function moduleLabelForKey(key: keyof DeviceModules): string {
  switch (key) {
    case 'solarBattery':
      return 'Solar panel + battery';
    case 'dataModule':
      return 'Data module';
    case 'attractantLightWarmYellow':
      return 'Attractant light';
    case 'interiorLightWhite':
      return 'Interior light';
  }
}

export default function DeviceDetailScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveGroup();
  const [device, setDevice] = useState<RegisteredDevice | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLive, setSavingLive] = useState(false);
  const [savingModules, setSavingModules] = useState(false);

  const isOwner = active?.role === 'Farm Owner';

  useEffect(() => {
    if (!active || !id) return;
    let mounted = true;
    (async () => {
      try {
        const d = await getDevice(active.id, id);
        if (mounted) setDevice(d);
      } catch {
        if (mounted) setDevice(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [active?.id, id]);

  // Subscribe to live device state once we know the Pi code.
  useEffect(() => {
    if (!device) return;
    const cloudId = cloudDocIdForPiCode(device.piCode);
    const unsub = listenDeviceState(cloudId, (next) => setState(next));
    return unsub;
  }, [device?.piCode]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!active || !device) {
    return (
      <View style={styles.empty}>
        <EmptyState
          icon="alert-circle-outline"
          title="Trap not found"
          body="We couldn't load this trap."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const handleToggleLiveDetect = async (next: boolean) => {
    if (!isOwner) {
      Alert.alert('Members are view-only', 'Only the Farm Owner can change device settings.');
      return;
    }
    setSavingLive(true);
    try {
      await setLiveDetect(active.id, device.id, next);
      setDevice({ ...device, liveDetectOn: next });
      toast.ok(
        'device',
        next ? 'Live detection ON' : 'Live detection OFF',
        next
          ? 'The Pi will now run detection on incoming frames.'
          : 'The Pi will stop running live detection until you enable it again.',
      );
    } catch (e) {
      toast.err('device', 'Could not update', e instanceof Error ? e.message : 'Try again.');
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSavingLive(false);
    }
  };

  const handleToggleModule = async (key: keyof DeviceModules, next: boolean) => {
    if (!isOwner) {
      Alert.alert('Members are view-only', 'Only the Farm Owner can change modules.');
      return;
    }
    const updated = { ...device.modules, [key]: next };
    setSavingModules(true);
    try {
      await updateDeviceModules(active.id, device.id, updated);
      setDevice({ ...device, modules: updated });
      toast.ok(
        'device',
        `${moduleLabelForKey(key)} ${next ? 'enabled' : 'disabled'}`,
        next ? 'Device configuration saved.' : 'Module setting saved.',
      );
    } catch (e) {
      toast.err('device', 'Could not update', e instanceof Error ? e.message : 'Try again.');
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSavingModules(false);
    }
  };

  // ── Online detection ────────────────────────────────────────────
  // The Pi runs a status heartbeat every HEARTBEAT_INTERVAL seconds
  // (currently 300s in IoT/main.py) which writes `status: "online"`
  // and bumps `lastSeen`. Using a 120s window here meant the badge
  // flickered "Offline" every time the heartbeat had not yet fired —
  // even for a perfectly healthy Pi. Widen the window to ~6 min so
  // we don't lie to the farmer between heartbeats; trust the explicit
  // status string when present, but still fall back to staleness if
  // the Pi got SIGKILL'd without setting status:'offline'.
  const ONLINE_WINDOW_S = 6 * 60;
  const lastSeen = state?.lastSeen
    ? Math.floor((Date.now() - state.lastSeen.getTime()) / 1000)
    : null;
  const statusSaysOnline = state?.status === 'online' || state?.status === 'running';
  const isOnline =
    statusSaysOnline && (lastSeen === null || lastSeen < ONLINE_WINDOW_S);

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.deviceName} numberOfLines={1}>{device.name}</Text>
          <Text style={styles.devicePi}>{device.piCode}</Text>
        </View>
        <Badge
          label={isOnline ? 'Online' : 'Offline'}
          tone={isOnline ? 'success' : 'neutral'}
          dot
        />
      </View>

      {/* Farm context */}
      <Card variant="accent">
        <View style={styles.contextBar}>
          <View style={styles.contextIconWrap}>
            <MaterialCommunityIcons name="sprout-outline" size={18} color={Colors.primaryDark} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.contextEyebrow}>CURRENT FARM</Text>
            <Text style={styles.contextTitle} numberOfLines={1}>{active.name}</Text>
            <Text style={styles.contextMeta} numberOfLines={1}>
              {device.locationLabel || 'Trap location not set yet'}
            </Text>
          </View>
        </View>
      </Card>

      {/* Action nav — quick links to the main per-device screens. */}
      <View style={styles.navGrid}>
        <Button
          label="Camera"
          icon="cctv"
          variant="secondary"
          style={styles.navBtn}
          onPress={() => router.push('/detect' as any)}
        />
        <Button
          label="Trends"
          icon="chart-timeline-variant"
          variant="secondary"
          style={styles.navBtn}
          onPress={() => router.push(`/analytics/${id}` as any)}
        />
        <Button
          label="Service"
          icon="wrench"
          variant="secondary"
          style={styles.navBtn}
          onPress={() => router.push('/maintenance' as any)}
        />
        {isOwner && (
          <Button
            label="Edit"
            icon="pencil"
            variant="secondary"
            style={styles.navBtn}
            onPress={() => router.push(`/device/edit/${id}` as any)}
          />
        )}
      </View>

      {/* Live telemetry */}
      <View style={styles.statGrid}>
        <StatTile
          icon="bug"
          label="Total count"
          value={state?.totalCount?.toString() ?? '—'}
          style={styles.statTile}
        />
        <StatTile
          icon="calendar-today"
          label="Today"
          value={state?.dailyCount?.toString() ?? '—'}
          style={styles.statTile}
        />
        <StatTile
          icon="thermometer"
          label="Temp"
          value={state?.temperature != null ? state.temperature.toFixed(1) : '—'}
          unit={state?.temperature != null ? '°C' : undefined}
          style={styles.statTile}
        />
        <StatTile
          icon="water-percent"
          label="Humidity"
          value={state?.humidity != null ? state.humidity.toFixed(0) : '—'}
          unit={state?.humidity != null ? '%' : undefined}
          style={styles.statTile}
        />
      </View>

      {/* Location */}
      {!!device.locationLabel && (
        <Card>
          <SectionHeader title="Location" icon="map-marker-outline" />
          <Text style={styles.cardValue}>{device.locationLabel}</Text>
          {device.latitude != null && device.longitude != null && (
            <Text style={styles.cardHint}>
              {device.latitude.toFixed(5)}, {device.longitude.toFixed(5)}
            </Text>
          )}
        </Card>
      )}

      {/* Camera + Live Detect */}
      <Card>
        <SectionHeader title="Camera & detection" icon="cctv" />
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Live detection</Text>
            <Text style={styles.toggleHint}>Pi runs YOLO per frame and pushes counts.</Text>
          </View>
          {savingLive ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Switch
              value={!!device.liveDetectOn}
              onValueChange={handleToggleLiveDetect}
              disabled={!isOwner}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={device.liveDetectOn ? Colors.primaryDark : Colors.surface}
              accessibilityLabel="Live detection"
              accessibilityRole="switch"
              accessibilityState={{ checked: !!device.liveDetectOn, disabled: !isOwner }}
            />
          )}
        </View>
        <Button
          label="Open camera view"
          icon="cctv"
          variant="ghost"
          size="sm"
          style={styles.linkBtn}
          onPress={() => router.push('/detect' as any)}
        />
      </Card>

      {/* Maintenance */}
      <Card>
        <SectionHeader title="Maintenance" icon="wrench" />
        <Text style={styles.cardHint}>
          Trap fullness {state?.trapFullnessPercent != null ? `${state.trapFullnessPercent}%` : '—'} ·
          {' '}Counts since service {state?.countSinceService ?? '—'}
        </Text>
        <Button
          label="Open maintenance log"
          icon="wrench"
          variant="ghost"
          size="sm"
          style={styles.linkBtn}
          onPress={() => router.push('/maintenance' as any)}
        />
      </Card>

      {/* Modules */}
      <Card>
        <SectionHeader title="Installed modules" icon="puzzle-outline" />
        <ModuleRow
          label="Solar panel + battery"
          hint="Off-grid power for fields with no AC outlet."
          value={device.modules.solarBattery}
          disabled={!isOwner || savingModules}
          onChange={(v) => handleToggleModule('solarBattery', v)}
        />
        <ModuleRow
          label="Data module (LTE / WiFi)"
          hint="Uplinks counts and telemetry to Firebase."
          value={device.modules.dataModule}
          disabled={!isOwner || savingModules}
          onChange={(v) => handleToggleModule('dataModule', v)}
        />
        <ModuleRow
          label="Attractant light (warm yellow)"
          hint="Outdoor LED tuned to attract Bactrocera spp. fruit flies."
          value={device.modules.attractantLightWarmYellow}
          disabled={!isOwner || savingModules}
          onChange={(v) => handleToggleModule('attractantLightWarmYellow', v)}
        />
        <ModuleRow
          label="Interior light (white, for camera)"
          hint="Illuminates the trap floor for the YOLO inference camera."
          value={device.modules.interiorLightWhite}
          disabled={!isOwner || savingModules}
          onChange={(v) => handleToggleModule('interiorLightWhite', v)}
        />
      </Card>

      {/* Crop info */}
      <Card>
        <SectionHeader title="Crop monitored" icon="sprout-outline" />
        <Text style={styles.cardValue}>{device.cropType || 'Not set'}</Text>
      </Card>

      {!isOwner && (
        <View style={styles.memberBanner}>
          <MaterialCommunityIcons name="eye-outline" size={16} color={Colors.primaryDark} />
          <Text style={styles.memberBannerText}>
            View-only access. The farm owner controls device settings.
          </Text>
        </View>
      )}
    </Screen>
  );
}

function ModuleRow(props: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={styles.moduleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.moduleLabel}>{props.label}</Text>
        <Text style={styles.moduleHint}>{props.hint}</Text>
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ false: Colors.border, true: Colors.primaryLight }}
        thumbColor={props.value ? Colors.primaryDark : Colors.surface}
        accessibilityLabel={props.label}
        accessibilityRole="switch"
        accessibilityState={{ checked: props.value, disabled: props.disabled }}
      />
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  empty: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  deviceName: { ...Type.h2, color: Colors.primaryDark },
  devicePi: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  contextIconWrap: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextEyebrow: { ...Type.micro, color: Colors.textTertiary },
  contextTitle: { ...Type.title, color: Colors.primaryDark, marginTop: 2 },
  contextMeta: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  cardValue: { ...Type.body, color: Colors.textPrimary, fontWeight: '600', marginTop: Spacing.xs },
  cardHint: { ...Type.caption, color: Colors.textSecondary },

  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  navBtn: { flexBasis: '48%', flexGrow: 1 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statTile: { flexBasis: '48%', flexGrow: 1 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  toggleLabel: { ...Type.label, color: Colors.textPrimary },
  toggleHint: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  linkBtn: { alignSelf: 'flex-start', marginTop: Spacing.xs },

  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  moduleLabel: { ...Type.label, color: Colors.textPrimary },
  moduleHint: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  memberBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryFaint,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  memberBannerText: { ...Type.caption, color: Colors.primaryDark, flex: 1 },
});
