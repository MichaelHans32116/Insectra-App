/**
 * Spray Settings — owner-only editor for the per-farm pesticide config used
 * by the SprayPlanCard cost calculation. Members see a read-only view.
 *
 * Stored at: /farms/{farmId}/settings/spray
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { Screen, Card, Button, StatTile, SectionHeader, EmptyState } from '@/components/ui';
import { useThemeStyles } from '@/services/theme';
import { useActiveGroup } from '@/services/activeGroup';
import {
  DEFAULT_SPRAY_SETTINGS,
  getLastSpray,
  loadSpraySettings,
  saveSpraySettings,
  type SpraySettings,
  type SprayEvent,
  computeSprayCostPhp,
} from '@/services/sprayAdvisor';
import { toast } from '@/services/eventBus';

type FormState = {
  productName: string;
  pricePhpPerLiter: string;
  doseLitersPerHectare: string;
  areaHectares: string;
  cropName: string;
  yieldKgPerHectare: string;
  pricePhpPerKg: string;
  expectedDamagePercent: string; // 0..100, converted to fraction on save
};

function toForm(s: SpraySettings): FormState {
  return {
    productName: s.productName,
    pricePhpPerLiter: String(s.pricePhpPerLiter),
    doseLitersPerHectare: String(s.doseLitersPerHectare),
    areaHectares: String(s.areaHectares),
    cropName: s.cropName,
    yieldKgPerHectare: String(s.yieldKgPerHectare),
    pricePhpPerKg: String(s.pricePhpPerKg),
    expectedDamagePercent: String(Math.round(s.expectedDamageFraction * 100)),
  };
}

function parseNonNeg(s: string, fallback: number): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export default function SpraySettingsScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { active, loading: groupLoading } = useActiveGroup();
  const isOwner = active?.role === 'Farm Owner';

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(toForm(DEFAULT_SPRAY_SETTINGS));
  const [lastSpray, setLastSpray] = useState<SprayEvent | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!active) {
        setLoading(false);
        return;
      }
      try {
        const [s, last] = await Promise.all([
          loadSpraySettings(active.id),
          getLastSpray(active.id),
        ]);
        if (cancelled) return;
        setForm(toForm(s ?? DEFAULT_SPRAY_SETTINGS));
        setLastSpray(last);
      } catch (e) {
        if (!cancelled) {
          setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not load settings.' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id]);

  const previewCost = useMemo(() => {
    return computeSprayCostPhp({
      ...DEFAULT_SPRAY_SETTINGS,
      pricePhpPerLiter: parseNonNeg(form.pricePhpPerLiter, 0),
      doseLitersPerHectare: parseNonNeg(form.doseLitersPerHectare, 0),
      areaHectares: parseNonNeg(form.areaHectares, 0),
    });
  }, [form.pricePhpPerLiter, form.doseLitersPerHectare, form.areaHectares]);

  const handleSave = async () => {
    if (!active || !isOwner) return;
    setBusy(true);
    setMsg(null);
    try {
      const next: SpraySettings = {
        productName: form.productName.trim() || DEFAULT_SPRAY_SETTINGS.productName,
        pricePhpPerLiter: parseNonNeg(form.pricePhpPerLiter, DEFAULT_SPRAY_SETTINGS.pricePhpPerLiter),
        doseLitersPerHectare: parseNonNeg(form.doseLitersPerHectare, DEFAULT_SPRAY_SETTINGS.doseLitersPerHectare),
        areaHectares: parseNonNeg(form.areaHectares, DEFAULT_SPRAY_SETTINGS.areaHectares),
        cropName: form.cropName.trim() || DEFAULT_SPRAY_SETTINGS.cropName,
        yieldKgPerHectare: parseNonNeg(form.yieldKgPerHectare, DEFAULT_SPRAY_SETTINGS.yieldKgPerHectare),
        pricePhpPerKg: parseNonNeg(form.pricePhpPerKg, DEFAULT_SPRAY_SETTINGS.pricePhpPerKg),
        expectedDamageFraction: Math.max(
          0,
          Math.min(1, parseNonNeg(form.expectedDamagePercent, 30) / 100),
        ),
      };
      await saveSpraySettings(active.id, next);
      setMsg({ kind: 'ok', text: 'Settings saved. Spray Plan card updates on next refresh.' });
      toast.ok('spray', 'Settings saved', `${next.productName} • ${next.areaHectares} ha`);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not save settings.';
      setMsg({ kind: 'err', text: m });
      toast.err('spray', 'Save failed', m);
    } finally {
      setBusy(false);
    }
  };

  if (groupLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!active) {
    return (
      <View style={styles.center}>
        <EmptyState icon="folder-question-outline" title="Pick a farm first" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <Screen>
        <View style={styles.headerRow}>
          <Button variant="ghost" size="sm" icon="arrow-left" label="" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} />
          <View style={styles.flex1}>
            <Text style={styles.title} numberOfLines={1}>Spray settings</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {active.name} • {isOwner ? 'Editable' : 'View only'}
            </Text>
          </View>
        </View>

        <Card>
          <SectionHeader title="Pesticide / bait" icon="spray" />
          <Field label="Product name" value={form.productName} onChange={(v) => setForm({ ...form, productName: v })} disabled={!isOwner} styles={styles} />
          <Field label="Price (₱ per liter)" value={form.pricePhpPerLiter} onChange={(v) => setForm({ ...form, pricePhpPerLiter: v })} keyboard="numeric" disabled={!isOwner} styles={styles} />
          <Field label="Dose (liters per hectare)" value={form.doseLitersPerHectare} onChange={(v) => setForm({ ...form, doseLitersPerHectare: v })} keyboard="numeric" disabled={!isOwner} styles={styles} />
          <Field label="Farm area (hectares)" value={form.areaHectares} onChange={(v) => setForm({ ...form, areaHectares: v })} keyboard="numeric" disabled={!isOwner} styles={styles} />
          <StatTile
            label="Estimated cost per spray"
            value={`₱${previewCost.toLocaleString()}`}
            icon="cash"
            tone="success"
            style={styles.previewTile}
          />
        </Card>

        <Card>
          <SectionHeader title="Crop value" icon="sprout" />
          <Field label="Crop name" value={form.cropName} onChange={(v) => setForm({ ...form, cropName: v })} disabled={!isOwner} styles={styles} />
          <Field label="Yield (kg per hectare)" value={form.yieldKgPerHectare} onChange={(v) => setForm({ ...form, yieldKgPerHectare: v })} keyboard="numeric" disabled={!isOwner} styles={styles} />
          <Field label="Farm-gate price (₱ per kg)" value={form.pricePhpPerKg} onChange={(v) => setForm({ ...form, pricePhpPerKg: v })} keyboard="numeric" disabled={!isOwner} styles={styles} />
          <Field label="Expected damage if uncontrolled (%)" value={form.expectedDamagePercent} onChange={(v) => setForm({ ...form, expectedDamagePercent: v })} keyboard="numeric" disabled={!isOwner} hint="Default 30% (PCAARRD cucurbit losses)." styles={styles} />
        </Card>

        {lastSpray && (
          <Card variant="outline">
            <SectionHeader title="Last logged spray" icon="history" />
            <Text style={styles.muted}>
              {lastSpray.product} • {lastSpray.litersUsed.toFixed(2)} L • ₱{lastSpray.costPhp.toLocaleString()}
            </Text>
            <Text style={styles.muted}>
              {lastSpray.performedAt.toLocaleString()} • by {lastSpray.byName || 'unknown'}
            </Text>
          </Card>
        )}

        {msg && (
          <View style={[styles.msgBanner, msg.kind === 'ok' ? styles.msgBannerOk : styles.msgBannerErr]}>
            <MaterialCommunityIcons
              name={msg.kind === 'ok' ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={msg.kind === 'ok' ? Colors.primaryDark : Colors.danger}
            />
            <Text style={[styles.msgText, { color: msg.kind === 'ok' ? Colors.primaryDark : Colors.dangerLight }]}>
              {msg.text}
            </Text>
          </View>
        )}

        {isOwner && (
          <Button
            label="Save settings"
            icon="content-save"
            loading={busy}
            onPress={handleSave}
            fullWidth
            style={styles.saveBtn}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard?: 'default' | 'numeric';
  disabled?: boolean;
  hint?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const { styles } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.disabled && styles.inputDisabled]}
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.keyboard ?? 'default'}
        editable={!props.disabled}
        accessibilityLabel={props.label}
        autoCapitalize="none"
        placeholderTextColor={Colors.textTertiary}
      />
      {props.hint && <Text style={styles.fieldHint}>{props.hint}</Text>}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },
    flex1: { flex: 1, minWidth: 0 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    backBtn: { paddingHorizontal: Spacing.sm },
    title: { ...Type.h1, color: Colors.primaryDark },
    subtitle: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },
    field: { gap: Spacing.xs, marginTop: Spacing.sm },
    fieldLabel: { ...Type.label, color: Colors.textPrimary },
    fieldHint: { ...Type.caption, color: Colors.textTertiary, fontStyle: 'italic' },
    input: {
      borderWidth: 1,
      borderColor: Colors.borderLight,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 10,
      ...Type.body,
      color: Colors.textPrimary,
      backgroundColor: Colors.surface,
      minHeight: 44,
    },
    inputDisabled: { backgroundColor: Colors.surfaceAlt, color: Colors.textSecondary },
    previewTile: { marginTop: Spacing.md },
    muted: { ...Type.caption, color: Colors.textSecondary },
    msgBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      borderRadius: Radius.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    msgBannerOk: { backgroundColor: Colors.successBg },
    msgBannerErr: { backgroundColor: Colors.dangerBg },
    msgText: { flex: 1, ...Type.caption },
    saveBtn: { marginTop: Spacing.sm },
  });
