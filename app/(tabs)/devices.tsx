import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import FarmAccessBar from '@/components/FarmAccessBar';
import { Screen, Card, Button, Badge, EmptyState } from '@/components/ui';
import { useActiveGroup } from '@/services/activeGroup';
import { useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';
import {
  ALLOWED_PI_CODES,
  isAllowedPiCode,
  listDevicesForFarm,
  registerDevice,
  type DeviceModules,
  type RegisteredDevice,
} from '@/services/devices';
import { getCurrentAppUser, refreshVerificationStatus } from '@/services/firebaseAuth';
import MapPicker from '@/components/MapPicker';

const DEFAULT_MODULES: DeviceModules = {
  solarBattery: true,
  dataModule: true,
  attractantLightWarmYellow: true,
  interiorLightWhite: true,
};

const DEVICE_LOAD_TIMEOUT_MS = 12000;
const GROUP_LOAD_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={centeredStyles.wrap}>{children}</View>;
}

export default function DevicesScreen() {
  const router = useRouter();
  const { active, loading: groupLoading, refresh } = useActiveGroup();
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupLoadTimedOut, setGroupLoadTimedOut] = useState(false);

  const isOwner = active?.role === 'Farm Owner';
  const roleLabel = isOwner
    ? text('Owner', 'May-ari')
    : text('Member', 'Miyembro');

  const loadDevices = async () => {
    if (!active) {
      setDevices([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const list = await withTimeout(
        listDevicesForFarm(active.id),
        DEVICE_LOAD_TIMEOUT_MS,
        'device-load-timeout',
      );
      setDevices(list);
    } catch (error) {
      setDevices([]);
      setLoadError(
        error instanceof Error && error.message === 'device-load-timeout'
          ? text('Loading is taking too long. Tap retry.', 'Matagal mag-load. Pindutin ang retry.')
          : text('Could not load the trap list.', 'Hindi ma-load ang listahan ng trap.'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [active?.id]);

  useEffect(() => {
    if (!groupLoading) {
      setGroupLoadTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setGroupLoadTimedOut(true), GROUP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [groupLoading]);

  if (groupLoading && !groupLoadTimedOut) {
    return (
      <Centered>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={centeredStyles.loadingText}>{text('Loading your farm...', 'Nilo-load ang sakahan...')}</Text>
      </Centered>
    );
  }

  if (groupLoading && groupLoadTimedOut) {
    return (
      <Centered>
        <EmptyState
          icon="cloud-sync-outline"
          title={text('Still connecting', 'Kumokonekta pa')}
          body={text('The farm list is slow to load. Retry the sync.', 'Mabagal mag-load ang farm list. Subukan ulit.')}
          actionLabel={text('Retry sync', 'Subukan ulit')}
          onAction={() => { refresh().catch(() => undefined); }}
        />
      </Centered>
    );
  }

  if (!active) {
    return (
      <Centered>
        <EmptyState
          icon="folder-question-outline"
          title={text('No farm selected', 'Walang napiling sakahan')}
          body={text('Join or create a farm to see your traps.', 'Sumali o gumawa ng sakahan para makita ang mga trap.')}
          actionLabel={text('Get started', 'Magsimula')}
          onAction={() => router.push('/register-role')}
        />
      </Centered>
    );
  }

  return (
    <>
      <Screen>
        <FarmAccessBar />

        <View style={styles.headerRow}>
          <View style={styles.flex1}>
            <Text style={styles.headerTitle} numberOfLines={1}>{active.name}</Text>
            <Text style={styles.headerSubtitle}>
              {devices.length} {text(devices.length === 1 ? 'trap' : 'traps', devices.length === 1 ? 'trap' : 'trap')} · {roleLabel}
            </Text>
          </View>
          {isOwner && (
            <Button
              label={text('Add trap', 'Idagdag trap')}
              icon="plus"
              size="sm"
              onPress={() => setModalOpen(true)}
              accessibilityHint={text('Opens the trap registration form.', 'Binubuksan ang form ng trap.')}
            />
          )}
        </View>

        {!isOwner && (
          <View style={styles.memberBanner}>
            <MaterialCommunityIcons name="information-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.memberBannerText}>
              {text('Members can view traps; only the owner can add them.', 'Makakakita ang miyembro ng trap; may-ari lang ang makakapagdagdag.')}
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>{text('Checking registered traps...', 'Tinitingnan ang mga trap...')}</Text>
          </View>
        ) : loadError ? (
          <Card>
            <EmptyState
              icon="cloud-alert-outline"
              title={text('Could not load traps', 'Hindi ma-load')}
              body={loadError}
              actionLabel={text('Retry', 'Subukan ulit')}
              onAction={loadDevices}
            />
          </Card>
        ) : devices.length === 0 ? (
          <Card>
            <EmptyState
              icon="cctv-off"
              title={text('No traps yet', 'Wala pang trap')}
              body={isOwner
                ? text('Tap Add to register your first Pi trap.', 'Pindutin ang Idagdag para sa unang Pi trap.')
                : text('The owner has not added any traps yet.', 'Wala pang trap na idinagdag ang may-ari.')}
            />
          </Card>
        ) : (
          devices.map((d) => (
            <Card
              key={d.id}
              variant="elevated"
              onPress={() => router.push(`/device/${d.id}` as any)}
              accessibilityLabel={`${d.name}. ${text('Open trap details', 'Buksan ang detalye ng trap')}`}
              style={styles.deviceCard}
            >
              <View style={styles.deviceRow}>
                <View style={styles.deviceIcon}>
                  <MaterialCommunityIcons name="cctv" size={22} color={Colors.primaryDark} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.deviceName} numberOfLines={1}>{d.name}</Text>
                  <View style={styles.deviceMetaRow}>
                    <Badge label={d.piCode} tone="neutral" />
                    {!!d.locationLabel && (
                      <View style={styles.locRow}>
                        <MaterialCommunityIcons name="map-marker-outline" size={12} color={Colors.textTertiary} />
                        <Text style={styles.deviceLocation} numberOfLines={1}>{d.locationLabel}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textTertiary} />
              </View>
            </Card>
          ))
        )}
      </Screen>

      <AddDeviceModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={async () => {
          setModalOpen(false);
          await loadDevices();
        }}
      />
    </>
  );
}

// ── Add Device Modal ─────────────────────────────────────────────────────
function AddDeviceModal(props: {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { active } = useActiveGroup();
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const [piCode, setPiCode] = useState(ALLOWED_PI_CODES[0]);
  const [name, setName] = useState('');
  const [crop, setCrop] = useState('');
  const [locLabel, setLocLabel] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [modules, setModules] = useState<DeviceModules>(DEFAULT_MODULES);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (props.visible) {
      setPiCode(ALLOWED_PI_CODES[0]);
      setName('');
      setCrop('');
      setLocLabel('');
      setLat(null);
      setLng(null);
      setModules(DEFAULT_MODULES);
      setErrorMsg(null);
    }
  }, [props.visible]);

  const handleSubmit = async () => {
    setErrorMsg(null);
    const user = getCurrentAppUser();
    if (!active || !user) return;
    if (!isAllowedPiCode(piCode)) {
      setErrorMsg(
        text(
          `Pi code "${piCode}" is not supported. Available: ${ALLOWED_PI_CODES.join(', ')}.`,
          `Hindi suportado ang "${piCode}". Available: ${ALLOWED_PI_CODES.join(', ')}.`,
        ),
      );
      return;
    }
    if (!name.trim()) {
      setErrorMsg(text('Give this trap a name.', 'Bigyan ng pangalan ang trap.'));
      return;
    }
    const finalLat = lat ?? 0;
    const finalLng = lng ?? 0;
    setBusy(true);
    try {
      try { await refreshVerificationStatus(); } catch { /* non-fatal */ }
      await registerDevice({
        farmId: active.id,
        piCode,
        name,
        ownerUid: user.uid,
        latitude: finalLat,
        longitude: finalLng,
        locationLabel: locLabel,
        cropType: crop,
        modules,
      });
      props.onAdded();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Try again.';
      const lower = raw.toLowerCase();
      const friendly = lower.includes('another farm owner')
        ? text(
          `This Pi (${piCode}) is owned by another farm. Ask them to release it first.`,
          `Ang Pi na ito (${piCode}) ay sa ibang sakahan. Pa-release muna sa kanila.`,
        )
        : lower.includes('already')
        ? text(
          `This Pi (${piCode}) is already registered to this farm.`,
          `Ang Pi na ito (${piCode}) ay nakarehistro na sa sakahang ito.`,
        )
        : lower.includes('permission')
          ? text(
            'Write rejected. Verify your email and confirm you own this farm.',
            'Tinanggihan ang write. I-verify ang email at tiyaking ikaw ang may-ari.',
          )
          : raw;
      setErrorMsg(friendly);
      // eslint-disable-next-line no-console
      console.error('[devices] register failed:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      transparent={false}
      onRequestClose={props.onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{text('Add trap', 'Magdagdag ng trap')}</Text>
          <TouchableOpacity
            onPress={props.onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={text('Close add trap form', 'Isara ang form ng trap')}
          >
            <MaterialCommunityIcons name="close" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>{text('Pi device code', 'Pi device code')}</Text>
          <View style={styles.piPickerRow}>
            {ALLOWED_PI_CODES.map((code) => (
              <TouchableOpacity
                key={code}
                style={[
                  styles.piChip,
                  piCode === code && { backgroundColor: Colors.primaryDark, borderColor: Colors.primaryDark },
                ]}
                onPress={() => setPiCode(code)}
                activeOpacity={0.85}
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityRole="button"
                accessibilityLabel={text(`Select Pi code ${code}`, `Piliin ang Pi code ${code}`)}
                accessibilityState={{ selected: piCode === code }}
              >
                <Text style={[styles.piChipText, piCode === code && { color: Colors.textOnPrimary }]}>
                  {code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldHint}>
            {text('Pick the code printed on the Pi hardware you are installing.', 'Piliin ang code na nasa Pi hardware na ini-install mo.')}
          </Text>

          <Text style={styles.fieldLabel}>{text('Trap name', 'Pangalan ng trap')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={text('e.g. Field A North', 'hal. Field A Hilaga')}
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel={text('Trap name', 'Pangalan ng trap')}
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>{text('Crop monitored', 'Bantay na pananim')}</Text>
          <TextInput
            style={styles.input}
            value={crop}
            onChangeText={setCrop}
            placeholder={text('e.g. Bitter gourd, Mango', 'hal. Ampalaya, Mangga')}
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel={text('Crop monitored', 'Bantay na pananim')}
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>{text('Location (pick on map)', 'Lokasyon (piliin sa mapa)')}</Text>
          <MapPicker
            latitude={lat}
            longitude={lng}
            onChange={(la, ln) => {
              setLat(la);
              setLng(ln);
            }}
            onLabelChange={(n) => {
              if (!locLabel.trim()) setLocLabel(n);
            }}
          />

          <Text style={styles.fieldLabel}>{text('Location label (optional)', 'Pangalan ng lokasyon (opsyonal)')}</Text>
          <TextInput
            style={styles.input}
            value={locLabel}
            onChangeText={setLocLabel}
            placeholder={text('e.g. Brgy. San Vicente', 'hal. Brgy. San Vicente')}
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel={text('Location label', 'Pangalan ng lokasyon')}
          />

          <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>{text('Modules installed', 'Naka-install na module')}</Text>
          <ModuleToggle
            label={text('Solar panel + battery', 'Solar panel + baterya')}
            value={modules.solarBattery}
            onValueChange={(v) => setModules({ ...modules, solarBattery: v })}
          />
          <ModuleToggle
            label={text('Data module (LTE / WiFi)', 'Data module (LTE / WiFi)')}
            value={modules.dataModule}
            onValueChange={(v) => setModules({ ...modules, dataModule: v })}
          />
          <ModuleToggle
            label={text('Attractant light (warm yellow)', 'Pang-akit na ilaw (dilaw)')}
            value={modules.attractantLightWarmYellow}
            onValueChange={(v) => setModules({ ...modules, attractantLightWarmYellow: v })}
          />
          <ModuleToggle
            label={text('Interior light (white, camera)', 'Ilaw sa loob (puti, camera)')}
            value={modules.interiorLightWhite}
            onValueChange={(v) => setModules({ ...modules, interiorLightWhite: v })}
          />

          {errorMsg && (
            <View style={styles.errorBanner}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          )}

          <Button
            label={text('Register trap', 'Irehistro')}
            icon="check"
            loading={busy}
            onPress={handleSubmit}
            fullWidth
            style={styles.submitBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ModuleToggle(props: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{props.label}</Text>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        trackColor={{ false: Colors.border, true: Colors.primaryLight }}
        thumbColor={props.value ? Colors.primaryDark : Colors.surface}
        accessibilityLabel={props.label}
        accessibilityRole="switch"
        accessibilityState={{ checked: props.value }}
      />
    </View>
  );
}

const centeredStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.background },
  loadingText: { ...Type.body, color: Colors.textSecondary, marginTop: Spacing.md, textAlign: 'center' },
});

const createStyles = () => StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  listLoader: { marginTop: Spacing.xl },
  loadingPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  loadingText: { ...Type.caption, color: Colors.textSecondary, textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  headerTitle: { ...Type.h2, color: Colors.primaryDark },
  headerSubtitle: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  memberBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryFaint,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  memberBannerText: { ...Type.caption, color: Colors.primaryDark, flex: 1 },

  deviceCard: { padding: Spacing.md },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  deviceIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceName: { ...Type.bodyStrong, color: Colors.textPrimary },
  deviceMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4, flexShrink: 1 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  deviceLocation: { ...Type.caption, color: Colors.textTertiary, flexShrink: 1 },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: { ...Type.h2, color: Colors.primaryDark },
  modalScroll: { padding: Spacing.lg, paddingBottom: 60, gap: Spacing.xs },
  fieldLabel: { ...Type.label, color: Colors.textPrimary, marginTop: Spacing.md, marginBottom: Spacing.xs },
  fieldHint: { ...Type.caption, color: Colors.textSecondary, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    ...Type.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    minHeight: 44,
  },
  piPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  piChip: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  piChipText: { ...Type.caption, fontWeight: '700', color: Colors.textPrimary },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  toggleLabel: { flex: 1, ...Type.body, color: Colors.textPrimary },
  submitBtn: { marginTop: Spacing.lg },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
  },
  errorBannerText: { flex: 1, ...Type.caption, color: Colors.dangerLight },
});
