import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, Badge, StatTile, SectionHeader, EmptyState } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { useActiveGroup } from '@/services/activeGroup';
import {
  cloudDocIdForPiCode,
  ensureCloudDeviceBinding,
  listDevicesForFarm,
  type RegisteredDevice,
} from '@/services/devices';
import { listenDeviceState, sendIoTCommand, type DeviceState } from '@/services/iotRealtime';
import { computeBatteryHealth, computeTrapCapacity } from '@/services/deviceHealth';
import {
  addMaintenanceEntry,
  clearMaintenanceLog,
  daysSince,
  describeKind,
  lastEntryOf,
  loadMaintenanceLog,
  type MaintenanceEntry,
  type MaintenanceKind,
} from '@/services/maintenanceLog';
import { toast } from '@/services/eventBus';

const QUICK_ACTIONS: Array<{ kind: MaintenanceKind; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
  { kind: 'lure_replacement', label: 'Replace Lure', icon: 'flask-outline' },
  { kind: 'battery_check', label: 'Battery Check', icon: 'battery-check-outline' },
  { kind: 'trap_service', label: 'Service Trap', icon: 'broom' },
  { kind: 'general', label: 'General Note', icon: 'note-outline' },
];

const LURE_REPLACE_DAYS = 14;
const BATTERY_CHECK_DAYS = 7;

// Curated PH replacement-part shortcuts for the field unit. Edit URLs to
// point to Shopee PH search results (we keep these as searches rather than
// product IDs so they keep working when SKUs change).
const REPLACEMENT_LINKS: Array<{
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  url: string;
}> = [
  {
    key: 'cuelure',
    label: 'Cue-lure refill',
    hint: 'Replace every 14 days',
    icon: 'flask-outline',
    url: 'https://shopee.ph/search?keyword=cue%20lure%20fruit%20fly',
  },
  {
    key: 'battery',
    label: '12 V 7 Ah SLA battery',
    hint: 'Solar trap power pack',
    icon: 'car-battery',
    url: 'https://shopee.ph/search?keyword=12v%207ah%20sla%20battery',
  },
  {
    key: 'solar',
    label: '20 W solar panel',
    hint: 'Mono-crystalline, 12 V',
    icon: 'solar-panel',
    url: 'https://shopee.ph/search?keyword=20w%20solar%20panel%2012v',
  },
  {
    key: 'dht',
    label: 'DHT11 sensor',
    hint: 'Spare temp + humidity sensor',
    icon: 'thermometer-lines',
    url: 'https://shopee.ph/search?keyword=dht11%20sensor%20module',
  },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MaintenanceScreen() {
  const styles = useThemeStyles(createStyles);
  const { active } = useActiveGroup();
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [targetDevice, setTargetDevice] = useState<RegisteredDevice | null>(null);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [log, setLog] = useState<MaintenanceEntry[]>([]);
  const [activeKind, setActiveKind] = useState<MaintenanceKind>('lure_replacement');
  const [note, setNote] = useState('');
  const targetCloudDeviceId = useMemo(
    () => (targetDevice ? cloudDocIdForPiCode(targetDevice.piCode) : null),
    [targetDevice],
  );

  useEffect(() => {
    loadMaintenanceLog().then(setLog).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active?.id) {
      setTargetDevice(null);
      setDeviceLoading(false);
      return;
    }

    let alive = true;
    setDeviceLoading(true);

    listDevicesForFarm(active.id)
      .then((devices) => {
        if (!alive) return;
        setTargetDevice(devices[0] ?? null);
      })
      .catch(() => {
        if (alive) setTargetDevice(null);
      })
      .finally(() => {
        if (alive) setDeviceLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [active?.id]);

  useEffect(() => {
    if (!targetCloudDeviceId) {
      setDeviceState(null);
      return;
    }

    const unsubscribe = listenDeviceState(targetCloudDeviceId, setDeviceState);
    return unsubscribe;
  }, [targetCloudDeviceId]);

  const battery = useMemo(() => computeBatteryHealth(deviceState), [deviceState]);
  const trap = useMemo(() => computeTrapCapacity(deviceState), [deviceState]);

  const lastLure = useMemo(() => lastEntryOf(log, 'lure_replacement'), [log]);
  const lastBattery = useMemo(() => lastEntryOf(log, 'battery_check'), [log]);
  const lastService = useMemo(() => lastEntryOf(log, 'trap_service'), [log]);

  const lureDays = daysSince(lastLure?.performedAt ?? null);
  const batteryDays = daysSince(lastBattery?.performedAt ?? null);

  const reminders = useMemo(() => {
    const list: Array<{ id: string; label: string; tone: 'good' | 'watch' | 'warning' }> = [];
    if (lureDays === null || lureDays >= LURE_REPLACE_DAYS) {
      list.push({ id: 'lure', label: lureDays === null ? 'Log first Cue-Lure replacement' : `Cue-Lure ${lureDays}d old - replace now`, tone: 'warning' });
    } else if (lureDays >= LURE_REPLACE_DAYS - 3) {
      list.push({ id: 'lure', label: `Cue-Lure due in ${LURE_REPLACE_DAYS - lureDays}d`, tone: 'watch' });
    } else {
      list.push({ id: 'lure', label: `Cue-Lure ok (${LURE_REPLACE_DAYS - lureDays}d left)`, tone: 'good' });
    }

    if (batteryDays === null || batteryDays >= BATTERY_CHECK_DAYS) {
      list.push({ id: 'battery', label: batteryDays === null ? 'Log first battery check' : `Battery ${batteryDays}d unchecked - check now`, tone: 'warning' });
    } else {
      list.push({ id: 'battery', label: `Battery checked ${batteryDays}d ago`, tone: 'good' });
    }

    if (trap.percent >= 75) {
      list.push({ id: 'trap', label: `Trap ${trap.percent}% full - service soon`, tone: trap.percent >= 90 ? 'warning' : 'watch' });
    }

    if (battery.level === 'critical' || battery.level === 'warning') {
      list.push({ id: 'battery-state', label: `Battery ${battery.label.toLowerCase()} - charge or swap`, tone: 'warning' });
    }

    return list;
  }, [lureDays, batteryDays, trap, battery]);

  const [cmdBusy, setCmdBusy] = useState<null | 'reset' | 'serviced'>(null);
  const [cmdMsg, setCmdMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flashMsg = (kind: 'ok' | 'err', text: string) => {
    setCmdMsg({ kind, text });
    setTimeout(() => setCmdMsg(null), 3000);
  };

  const ensureCommandTarget = async (): Promise<{ cloudDeviceId: string; farmId: string }> => {
    if (!active?.id || !targetDevice) {
      throw new Error('Register a trap in My Devices first so commands know which Pi to control.');
    }

    await ensureCloudDeviceBinding({
      farmId: active.id,
      piCode: targetDevice.piCode,
      ownerUid: targetDevice.ownerUid,
      name: targetDevice.name,
    });

    return { cloudDeviceId: cloudDocIdForPiCode(targetDevice.piCode), farmId: active.id };
  };

  const requestTrapService = async (entryNote: string): Promise<boolean> => {
    if (cmdBusy) return false;
    setCmdBusy('serviced');
    try {
      const { cloudDeviceId, farmId } = await ensureCommandTarget();
      await sendIoTCommand(cloudDeviceId, farmId, 'mark_serviced');
      const next = await addMaintenanceEntry('trap_service', entryNote);
      setLog(next);
      const detail = 'Capacity meter resets to 0% after the Pi applies the service command.';
      flashMsg('ok', detail);
      toast.ok('device', 'Trap serviced', detail);
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not send service command.';
      flashMsg('err', m);
      toast.err('device', 'Service command failed', m);
      return false;
    } finally {
      setCmdBusy(null);
    }
  };

  const handleQuickLog = async (kind: MaintenanceKind) => {
    if (kind === 'trap_service') {
      await requestTrapService('Trap serviced from quick log');
      return;
    }

    const next = await addMaintenanceEntry(kind, '');
    setLog(next);
  };

  const handleResetDaily = async () => {
    if (cmdBusy) return;
    const webConfirm = (globalThis as unknown as { confirm?: (message: string) => boolean }).confirm;
    const ok =
      Platform.OS === 'web' && typeof webConfirm === 'function'
        ? webConfirm('Reset today’s catch counter back to 0?')
        : true;
    if (!ok) return;
    setCmdBusy('reset');
    try {
      const { cloudDeviceId, farmId } = await ensureCommandTarget();
      await sendIoTCommand(cloudDeviceId, farmId, 'reset_daily_count');
      flashMsg('ok', 'Reset request sent. Counter clears on the Pi within ~30s.');
      toast.ok('device', 'Reset sent', 'Counter clears on the Pi within ~30s.');
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not send reset command.';
      flashMsg('err', m);
      toast.err('device', 'Reset failed', m);
    } finally {
      setCmdBusy(null);
    }
  };

  const handleMarkServiced = async () => {
    await requestTrapService('Marked serviced from app');
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      flashMsg('err', 'Could not open link.');
    });
  };

  const handleSaveNote = async () => {
    const trimmedNote = note.trim();

    if (activeKind === 'trap_service') {
      const ok = await requestTrapService(trimmedNote || 'Trap serviced from note');
      if (ok) setNote('');
      return;
    }

    const next = await addMaintenanceEntry(activeKind, trimmedNote);
    setLog(next);
    setNote('');
  };

  const handleClear = () => {
    Alert.alert('Clear Maintenance Log', 'Remove all stored maintenance entries on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearMaintenanceLog();
          setLog([]);
        },
      },
    ]);
  };

  const commandsReady = cmdBusy === null && !!targetCloudDeviceId;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Maintenance</Text>
        <Text style={styles.subtitle}>Log lures, batteries, and trap servicing.</Text>
        {deviceLoading ? (
          <Badge label="Checking device..." tone="neutral" icon="cloud-sync-outline" />
        ) : targetDevice ? (
          <Badge label={`${targetDevice.name} · ${targetDevice.piCode}`} tone="success" icon="cctv" />
        ) : (
          <Badge label="No trap registered" tone="warning" icon="cctv-off" />
        )}
      </View>

      <View style={styles.statusGrid}>
        <StatTile
          label="Battery"
          value={battery.percent === null ? '-' : `${battery.percent}%`}
          hint={battery.label}
          icon="battery-heart-outline"
          tone={battery.level === 'critical' ? 'danger' : battery.level === 'warning' ? 'warning' : 'success'}
          style={styles.statTile}
        />
        <StatTile
          label="Trap"
          value={`${trap.percent}%`}
          hint={trap.label}
          icon="archive-alert-outline"
          tone={trap.percent >= 90 ? 'danger' : trap.percent >= 75 ? 'warning' : 'success'}
          style={styles.statTile}
        />
        <StatTile
          label="Service"
          value={lastService ? `${daysSince(lastService.performedAt) ?? 0}d` : '-'}
          hint="Since last"
          icon="clock-outline"
          style={styles.statTile}
        />
      </View>

      <Card>
        <SectionHeader title="Reminders" icon="bell-alert-outline" />
        {reminders.map((reminder) => (
          <View key={reminder.id} style={[styles.reminderRow, { backgroundColor: reminderBg(reminder.tone) }]}>
            <View style={[styles.reminderDot, { backgroundColor: reminderColor(reminder.tone) }]} />
            <Text style={styles.reminderText}>{reminder.label}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <SectionHeader title="Quick log" icon="lightning-bolt-outline" />
        <View style={styles.actionGrid}>
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.kind}
              label={action.label}
              icon={action.icon}
              variant="secondary"
              size="sm"
              onPress={() => handleQuickLog(action.kind)}
              style={styles.gridButton}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader title="Send to trap" icon="remote" />
        <Text style={styles.hint}>
          {targetDevice
            ? 'Commands target the active farm trap.'
            : 'Add a device in My Devices to send commands.'}
        </Text>
        <View style={styles.actionGrid}>
          <Button
            label={cmdBusy === 'reset' ? 'Sending...' : "Reset count"}
            icon="counter"
            variant="secondary"
            size="sm"
            loading={cmdBusy === 'reset'}
            disabled={!commandsReady && cmdBusy !== 'reset'}
            onPress={handleResetDaily}
            style={styles.gridButton}
          />
          <Button
            label={cmdBusy === 'serviced' ? 'Sending...' : 'Mark serviced'}
            icon="broom"
            variant="secondary"
            size="sm"
            loading={cmdBusy === 'serviced'}
            disabled={!commandsReady && cmdBusy !== 'serviced'}
            onPress={handleMarkServiced}
            style={styles.gridButton}
          />
        </View>
        {cmdMsg && (
          <Text style={[styles.cmdMsg, { color: cmdMsg.kind === 'ok' ? Colors.primaryDark : Colors.danger }]}>
            {cmdMsg.text}
          </Text>
        )}
      </Card>

      <Card>
        <SectionHeader title="Replacement parts" icon="cart-outline" />
        <Text style={styles.hint}>Curated Shopee PH searches. Prices vary by seller.</Text>
        {REPLACEMENT_LINKS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={styles.linkRow}
            activeOpacity={0.8}
            onPress={() => openLink(p.url)}
          >
            <MaterialCommunityIcons name={p.icon} size={20} color={Colors.primaryDark} />
            <View style={styles.flex1}>
              <Text style={styles.linkLabel}>{p.label}</Text>
              <Text style={styles.linkHint}>{p.hint}</Text>
            </View>
            <MaterialCommunityIcons name="open-in-new" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </Card>

      <Card>
        <SectionHeader title="Add note" icon="pencil-outline" />
        <View style={styles.kindRow}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.kind}
              style={[styles.kindChip, activeKind === action.kind && styles.kindChipActive]}
              activeOpacity={0.8}
              onPress={() => setActiveKind(action.kind)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeKind === action.kind }}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <Text style={[styles.kindChipText, activeKind === action.kind && styles.kindChipTextActive]}>
                {describeKind(action.kind)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Optional note (visible to the team)"
          placeholderTextColor={Colors.textTertiary}
          style={styles.noteInput}
          multiline
        />
        <Button label="Save entry" icon="content-save-outline" size="sm" onPress={handleSaveNote} />
      </Card>

      <Card>
        <SectionHeader
          title="Log"
          icon="history"
          actionLabel={log.length ? 'Clear' : undefined}
          onAction={log.length ? handleClear : undefined}
        />
        {log.length === 0 ? (
          <EmptyState icon="history" title="No entries yet" body="Maintenance you log will appear here." />
        ) : (
          [...log].reverse().map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <Text style={styles.logKind}>{describeKind(entry.kind)}</Text>
              {!!entry.note && <Text style={styles.logNote}>{entry.note}</Text>}
              <Text style={styles.logTime}>{formatTimestamp(entry.performedAt)}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function reminderColor(tone: 'good' | 'watch' | 'warning'): string {
  if (tone === 'warning') return Colors.danger;
  if (tone === 'watch') return Colors.warning;
  return Colors.primaryLight;
}

function reminderBg(tone: 'good' | 'watch' | 'warning'): string {
  if (tone === 'warning') return Colors.dangerBg;
  if (tone === 'watch') return Colors.warningBg;
  return Colors.primaryFaint;
}

const createStyles = () =>
  StyleSheet.create({
    flex1: { flex: 1, minWidth: 0 },

    header: { gap: Spacing.sm, alignItems: 'flex-start' },
    title: { ...Type.h1, color: Colors.primaryDark },
    subtitle: { ...Type.body, color: Colors.textSecondary },

    statusGrid: { flexDirection: 'row', gap: Spacing.sm },
    statTile: { flex: 1 },

    reminderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.sm,
    },
    reminderDot: { width: 8, height: 8, borderRadius: 4 },
    reminderText: { ...Type.caption, color: Colors.textPrimary, flex: 1 },

    hint: { ...Type.caption, color: Colors.textSecondary },
    cmdMsg: { ...Type.caption },

    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    gridButton: { flexGrow: 1, flexBasis: '46%' },

    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: Colors.borderLight,
    },
    linkLabel: { ...Type.bodyStrong, color: Colors.textPrimary },
    linkHint: { ...Type.caption, color: Colors.textSecondary },

    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    kindChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: Colors.borderLight,
      backgroundColor: Colors.surfaceAlt,
    },
    kindChipActive: { backgroundColor: Colors.primaryTint, borderColor: Colors.primaryPale },
    kindChipText: { ...Type.caption, color: Colors.textSecondary },
    kindChipTextActive: { color: Colors.primaryDark, fontWeight: '700' },

    noteInput: {
      minHeight: 64,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: Colors.borderLight,
      padding: Spacing.md,
      ...Type.body,
      color: Colors.textPrimary,
      backgroundColor: Colors.surfaceAlt,
      textAlignVertical: 'top',
    },

    logRow: {
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: Colors.borderLight,
      gap: 2,
    },
    logKind: { ...Type.label, color: Colors.primaryDark },
    logNote: { ...Type.caption, color: Colors.textPrimary },
    logTime: { ...Type.caption, color: Colors.textTertiary },
  });
