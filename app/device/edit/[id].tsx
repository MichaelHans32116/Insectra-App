/**
 * Edit a registered Pi device — name, location pin, location label, crop.
 *
 * Only the farm Owner can reach this screen (the Edit nav item is hidden
 * for Members in `device/[id].tsx`). Firestore rules enforce this on the
 * server side anyway: `match /farms/{farmId}/devices/{deviceId}` only
 * allows update if `isFarmOwner(farmId)`.
 *
 * Location editing is intentionally manual map-pin only. The Pi has no
 * GPS module; geo-fencing on top of LTE-only telemetry is not reliable
 * enough to alert on (cell-tower triangulation drift is hundreds of
 * meters). We surface a user-set pin and label instead.
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, SectionHeader, EmptyState } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { useActiveGroup } from '@/services/activeGroup';
import { getDevice, updateDeviceFields, type RegisteredDevice } from '@/services/devices';
import { refreshVerificationStatus } from '@/services/firebaseAuth';
import MapPicker from '@/components/MapPicker';

export default function EditDeviceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveGroup();
  const styles = useThemeStyles(createStyles);

  const [device, setDevice] = useState<RegisteredDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [crop, setCrop] = useState('');
  const [locLabel, setLocLabel] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [labelEditing, setLabelEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!active || !id) return;
    setLoading(true);
    getDevice(active.id, String(id))
      .then((d) => {
        if (cancelled || !d) return;
        setDevice(d);
        setName(d.name);
        setCrop(d.cropType);
        setLocLabel(d.locationLabel);
        setLat(d.latitude);
        setLng(d.longitude);
      })
      .catch((e) => {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : 'Could not load device.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, id]);

  const handleSave = async () => {
    if (!active || !id) return;
    setErrorMsg(null);
    setOkMsg(null);
    if (!name.trim()) {
      setErrorMsg('Device name is required.');
      return;
    }
    setSaving(true);
    try {
      try { await refreshVerificationStatus(); } catch { /* non-fatal */ }
      await updateDeviceFields(active.id, String(id), {
        name,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        locationLabel: locLabel,
        cropType: crop,
      });
      setOkMsg('Saved.');
      // Brief pause so the user sees the OK state, then return.
      setTimeout(() => router.back(), 600);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Could not save.';
      setErrorMsg(
        raw.toLowerCase().includes('permission')
          ? 'Firestore rejected the update. You must be the farm owner and have a verified email.'
          : raw,
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <ActivityIndicator color={Colors.primary} />
      </Screen>
    );
  }

  if (!device) {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <EmptyState icon="cctv-off" title="Device not found" />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex1}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
            <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.flex1}>
            <Text style={styles.title}>Edit device</Text>
            <Text style={styles.subtitle}>{device.piCode}</Text>
          </View>
        </View>

        <Card>
          <SectionHeader title="Trap details" icon="tag-outline" />

          <Text style={styles.label}>Device name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Field A North trap"
            placeholderTextColor={Colors.textTertiary}
          />

          <Text style={styles.label}>Crop monitored</Text>
          <TextInput
            style={styles.input}
            value={crop}
            onChangeText={setCrop}
            placeholder="Bitter gourd (Ampalaya)"
            placeholderTextColor={Colors.textTertiary}
          />
        </Card>

        <Card>
          <SectionHeader title="Location pin" icon="map-marker-outline" />
          <Text style={styles.hint}>
            Drop the pin on this trap's spot. The Pi has no GPS — this is how we map it.
          </Text>
          <View style={styles.mapWrap}>
            <MapPicker
              latitude={lat}
              longitude={lng}
              onChange={(la, ln) => {
                setLat(la);
                setLng(ln);
              }}
              onLabelChange={(label) => setLocLabel(label)}
              height={260}
            />
          </View>

          {/* Pinned-location chip — doubles as the human-readable label.
              Tapping the pencil opens an inline editor so power users can
              still rename without us re-introducing the redundant text field. */}
          {(locLabel || (lat !== null && lng !== null)) && (
            <View style={styles.pinnedCard}>
              <MaterialCommunityIcons name="map-marker-check" size={20} color={Colors.primaryDark} />
              <View style={styles.flex1}>
                <Text style={styles.pinnedLabel}>Pinned location</Text>
                {labelEditing ? (
                  <TextInput
                    style={styles.pinnedInput}
                    value={locLabel}
                    onChangeText={setLocLabel}
                    placeholder="e.g. Brgy. San Vicente, Block 3"
                    placeholderTextColor={Colors.textTertiary}
                    autoFocus
                    onBlur={() => setLabelEditing(false)}
                    returnKeyType="done"
                    onSubmitEditing={() => setLabelEditing(false)}
                  />
                ) : (
                  <Text style={styles.pinnedValue} numberOfLines={2}>
                    {locLabel || 'Pin only — tap the pencil to add a name'}
                  </Text>
                )}
                {lat !== null && lng !== null && (
                  <Text style={styles.pinnedCoord}>{lat.toFixed(5)}, {lng.toFixed(5)}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setLabelEditing((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={labelEditing ? 'Done editing location name' : 'Edit location name'}
              >
                <MaterialCommunityIcons
                  name={labelEditing ? 'check' : 'pencil-outline'}
                  size={18}
                  color={Colors.primaryDark}
                />
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {errorMsg && (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.danger} />
            <Text style={styles.errorBannerText}>{errorMsg}</Text>
          </View>
        )}
        {okMsg && (
          <View style={styles.okBanner}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color={Colors.primaryDark} />
            <Text style={styles.okBannerText}>{okMsg}</Text>
          </View>
        )}

        <Button
          label="Save changes"
          icon="content-save"
          loading={saving}
          onPress={handleSave}
          fullWidth
          style={styles.saveBtn}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  flex1: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Type.h1, color: Colors.textPrimary },
  subtitle: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  label: { ...Type.label, color: Colors.textPrimary, marginTop: Spacing.md, marginBottom: Spacing.xs },
  hint: { ...Type.caption, color: Colors.textSecondary, marginBottom: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    ...Type.body,
    color: Colors.textPrimary,
    minHeight: 44,
  },
  mapWrap: { borderRadius: Radius.md, overflow: 'hidden' },
  pinnedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    backgroundColor: Colors.primaryTint,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pinnedLabel: { ...Type.micro, color: Colors.primaryDark, textTransform: 'uppercase' },
  pinnedValue: { ...Type.bodyStrong, color: Colors.textPrimary, marginTop: 2 },
  pinnedCoord: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
  pinnedInput: {
    ...Type.bodyStrong,
    color: Colors.textPrimary,
    marginTop: 2,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primaryDark,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  errorBannerText: { flex: 1, ...Type.caption, color: Colors.dangerLight },
  okBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryTint,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  okBannerText: { flex: 1, ...Type.caption, color: Colors.primaryDark, fontWeight: '700' },
  saveBtn: { marginTop: Spacing.sm },
});
