/**
 * TimeRangePicker — chip selector + custom date range modal.
 *
 * Renders a horizontally-scrolling row of preset chips
 * (15m / 1h / 6h / 24h / 3d / 7d / 14d / 30d / Custom). The "Custom" chip
 * opens a modal with two date pickers (web: <input type="date">; native:
 * plain TextInputs in YYYY-MM-DD format to avoid bringing in a date picker
 * dependency).
 */
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, Radius } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import type { RangePreset, RangeSpec } from '@/services/samplesStore';

interface Props {
  value: RangeSpec;
  onChange: (next: RangeSpec) => void;
}

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'last_15m', label: '15 min' },
  { key: 'last_1h', label: '1 hr' },
  { key: 'last_6h', label: '6 hr' },
  { key: 'last_24h', label: '24 hr' },
  { key: 'last_3d', label: '3 days' },
  { key: 'last_7d', label: '7 days' },
  { key: 'last_14d', label: '14 days' },
  { key: 'last_30d', label: '30 days' },
];

function toDateInput(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromDateInput(s: string, endOfDay = false): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export default function TimeRangePicker(props: Props) {
  const styles = useThemeStyles(makeStyles);
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {PRESETS.map((p) => {
          const active = props.value.preset === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => props.onChange({ preset: p.key })}
              style={[styles.chip, active && styles.chipActive]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={{ top: 6, bottom: 6 }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          onPress={() => setCustomOpen(true)}
          style={[styles.chip, props.value.preset === 'custom' && styles.chipActive]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: props.value.preset === 'custom' }}
          hitSlop={{ top: 6, bottom: 6 }}
        >
          <Text style={[styles.chipText, props.value.preset === 'custom' && styles.chipTextActive]}>
            Custom…
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <CustomRangeModal
        visible={customOpen}
        initialStart={props.value.startMs}
        initialEnd={props.value.endMs}
        onClose={() => setCustomOpen(false)}
        onApply={(startMs, endMs) => {
          setCustomOpen(false);
          props.onChange({ preset: 'custom', startMs, endMs });
        }}
      />
    </View>
  );
}

function CustomRangeModal(props: {
  visible: boolean;
  initialStart?: number;
  initialEnd?: number;
  onClose: () => void;
  onApply: (startMs: number, endMs: number) => void;
}) {
  const styles = useThemeStyles(makeStyles);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (props.visible) {
      const now = Date.now();
      setStart(toDateInput(props.initialStart ?? now - 7 * 24 * 60 * 60_000));
      setEnd(toDateInput(props.initialEnd ?? now));
      setErr('');
    }
  }, [props.visible, props.initialStart, props.initialEnd]);

  const handleApply = () => {
    const sMs = fromDateInput(start);
    const eMs = fromDateInput(end, true);
    if (sMs === null || eMs === null) {
      setErr('Use YYYY-MM-DD format for both dates.');
      return;
    }
    if (sMs >= eMs) {
      setErr('Start date must be before end date.');
      return;
    }
    props.onApply(sMs, eMs);
  };

  // Web uses a real <input type="date"> for nicer UX.
  const isWeb = Platform.OS === 'web';

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Custom date range</Text>
          <Text style={styles.modalHint}>
            Pick a start and end date. The chart will show every sample we
            received from this device between those days.
          </Text>

          <Text style={styles.label}>Start date</Text>
          {isWeb ? (
            // @ts-ignore — web-only DOM input
            <input
              type="date"
              value={start}
              onChange={(e: any) => setStart(e.target.value)}
              style={webInputStyle as any}
            />
          ) : (
            <TextInput
              style={styles.input}
              value={start}
              onChangeText={setStart}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
            />
          )}

          <Text style={styles.label}>End date</Text>
          {isWeb ? (
            // @ts-ignore
            <input
              type="date"
              value={end}
              onChange={(e: any) => setEnd(e.target.value)}
              style={webInputStyle as any}
            />
          ) : (
            <TextInput
              style={styles.input}
              value={end}
              onChangeText={setEnd}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
            />
          )}

          {!!err && <Text style={styles.err}>{err}</Text>}

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={props.onClose} style={styles.cancelBtn} activeOpacity={0.85}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleApply} style={styles.applyBtn} activeOpacity={0.85}>
              <Text style={styles.applyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const webInputStyle = {
  border: `1px solid ${Colors.border}`,
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: Colors.textPrimary,
  background: Colors.surface,
  marginBottom: 6,
  width: '100%',
  boxSizing: 'border-box',
};

const makeStyles = () => StyleSheet.create({
  wrap: { gap: 6 },
  row: { gap: 6, paddingVertical: 4 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primaryDark, borderColor: Colors.primaryDark },
  chipText: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  chipTextActive: { color: Colors.textOnPrimary },

  modalScrim: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 18,
    gap: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: Colors.primaryDark },
  modalHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16, marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  err: { fontSize: 12, color: Colors.danger, marginTop: 4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: Colors.textSecondary, fontWeight: '700', fontSize: 13 },
  applyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.md,
  },
  applyText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 13 },
});
