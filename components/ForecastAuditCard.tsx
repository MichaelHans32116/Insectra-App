import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import type { RiskResult } from '@/services/riskScoring';
import type { Sample } from '@/services/samplesStore';
import {
  resolveForecastAudit,
  subscribeRecentForecastAudits,
  upsertForecastAudit,
  type ForecastAudit,
  type ForecastVerdict,
} from '@/services/forecastAudit';

interface Props {
  farmId: string;
  deviceId: string;
  risk: RiskResult;
  dailyCount: number | null;
  countHistory: Array<number | null>;
  samples: Sample[];
}

export default function ForecastAuditCard({
  farmId,
  deviceId,
  risk,
  dailyCount,
  countHistory,
  samples,
}: Props) {
  const styles = useThemeStyles(makeStyles);
  const [audits, setAudits] = useState<ForecastAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [writeError, setWriteError] = useState<string | null>(null);
  const lastUpsertKey = useRef<string | null>(null);

  useEffect(() => {
    setLoading(true);
    return subscribeRecentForecastAudits(
      farmId,
      deviceId,
      (next) => {
        setAudits(next);
        setLoading(false);
      },
      (error) => {
        setWriteError(error.message);
        setLoading(false);
      },
    );
  }, [farmId, deviceId]);

  useEffect(() => {
    if (!farmId || !deviceId || risk.confidence < 0.5 || dailyCount === null) return;
    const horizonHours = 6;
    const bucket = Math.floor(Date.now() / (horizonHours * 60 * 60_000));
    const key = `${farmId}/${deviceId}/${bucket}/${risk.score}/${dailyCount}`;
    if (lastUpsertKey.current === key) return;
    lastUpsertKey.current = key;
    upsertForecastAudit({
      farmId,
      deviceId,
      risk,
      dailyCount,
      countHistory,
      horizonHours,
    }).catch((error) => {
      setWriteError(error instanceof Error ? error.message : 'Could not save audit snapshot.');
    });
  }, [farmId, deviceId, risk, dailyCount, countHistory]);

  useEffect(() => {
    const due = audits.filter((audit) => audit.status === 'pending' && Date.now() >= audit.dueMs);
    if (due.length === 0) return;
    due.forEach((audit) => {
      resolveForecastAudit(audit, samples).catch((error) => {
        setWriteError(error instanceof Error ? error.message : 'Could not resolve forecast audit.');
      });
    });
  }, [audits, samples]);

  const currentAudit = useMemo(
    () => audits.find((audit) => audit.status === 'pending') ?? audits[0] ?? null,
    [audits],
  );
  const resolved = audits.filter((audit) => audit.status === 'resolved').slice(0, 3);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  if (risk.confidence < 0.5 || dailyCount === null) {
    return (
      <View style={styles.card}>
        <Header tone="muted" />
        <Text style={styles.body}>
          Waiting for enough count, trend, temperature, and humidity data before saving forecast audits.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Header tone={toneFor(currentAudit?.verdict ?? 'pending')} />

      {currentAudit ? (
        <View style={styles.focusRow}>
          <View style={styles.focusMetric}>
            <Text style={styles.metricLabel}>Forecast</Text>
            <Text style={styles.metricValue}>
              {currentAudit.predictedDailyAtDue === null ? '-' : currentAudit.predictedDailyAtDue}
            </Text>
            <Text style={styles.metricSub}>daily count at review</Text>
          </View>
          <View style={styles.focusMetric}>
            <Text style={styles.metricLabel}>Review time</Text>
            <Text style={styles.metricValue}>{formatTime(currentAudit.dueMs)}</Text>
            <Text style={styles.metricSub}>{currentAudit.horizonHours}h audit window</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.body}>Saving the first 6-hour forecast audit.</Text>
      )}

      {currentAudit?.status === 'resolved' && (
        <View style={[styles.verdictBox, toneStyle(currentAudit.verdict)]}>
          <Text style={[styles.verdictText, { color: toneColor(currentAudit.verdict) }]}>
            {verdictLabel(currentAudit.verdict)}
          </Text>
          <Text style={styles.body}>
            Actual {currentAudit.actualDailyAtDue ?? '-'} vs predicted{' '}
            {currentAudit.predictedDailyAtDue ?? '-'}
            {currentAudit.errorPct !== null ? ` (${Math.round(currentAudit.errorPct * 100)}% error)` : ''}
          </Text>
        </View>
      )}

      {resolved.length > 0 && (
        <View style={styles.historyBlock}>
          <Text style={styles.sectionLabel}>Recent audit results</Text>
          {resolved.map((audit) => (
            <View key={audit.id} style={styles.auditRow}>
              <Text style={[styles.badge, toneStyle(audit.verdict), { color: toneColor(audit.verdict) }]}>
                {verdictLabel(audit.verdict)}
              </Text>
              <Text style={styles.auditText}>
                {formatDateTime(audit.dueMs)}: predicted {audit.predictedDailyAtDue ?? '-'}, actual{' '}
                {audit.actualDailyAtDue ?? '-'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {writeError && (
        <Text style={styles.errorText}>
          Audit sync issue: {writeError}
        </Text>
      )}
    </View>
  );
}

function Header({ tone }: { tone: 'muted' | ReturnType<typeof toneFor> }) {
  const styles = useThemeStyles(makeStyles);
  const color = tone === 'muted' ? Colors.textSecondary : toneColor(tone);
  return (
    <View style={styles.headerRow}>
      <MaterialCommunityIcons name="clipboard-pulse-outline" size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color }]}>Forecast Audit</Text>
        <Text style={styles.subtitle}>Auto-checks model forecast vs. actual trap data.</Text>
      </View>
    </View>
  );
}

function toneFor(verdict: ForecastVerdict): ForecastVerdict {
  return verdict;
}

function toneColor(verdict: ForecastVerdict): string {
  switch (verdict) {
    case 'within_tolerance':
      return Colors.primaryDark;
    case 'over_predicted':
      return Colors.warning;
    case 'under_predicted':
      return Colors.danger;
    case 'insufficient_actual':
      return Colors.textSecondary;
    default:
      return Colors.primary;
  }
}

function toneStyle(verdict: ForecastVerdict) {
  switch (verdict) {
    case 'within_tolerance':
      return { backgroundColor: Colors.primaryFaint, borderColor: Colors.primaryLight };
    case 'over_predicted':
      return { backgroundColor: Colors.warningBg, borderColor: Colors.warning };
    case 'under_predicted':
      return { backgroundColor: Colors.dangerBg, borderColor: Colors.danger };
    case 'insufficient_actual':
      return { backgroundColor: Colors.surfaceAlt, borderColor: Colors.border };
    default:
      return { backgroundColor: Colors.primaryTint, borderColor: Colors.primaryPale };
  }
}

function verdictLabel(verdict: ForecastVerdict): string {
  switch (verdict) {
    case 'within_tolerance':
      return 'Matched';
    case 'over_predicted':
      return 'Over-predicted';
    case 'under_predicted':
      return 'Under-predicted';
    case 'insufficient_actual':
      return 'Needs data';
    default:
      return 'Pending';
  }
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const makeStyles = () => StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.borderLight,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '800' },
  subtitle: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  body: { color: Colors.textPrimary, fontSize: 12, lineHeight: 17 },
  focusRow: { flexDirection: 'row', gap: 10 },
  focusMetric: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderColor: Colors.borderLight,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 10,
  },
  metricLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  metricValue: { color: Colors.primaryDark, fontSize: 22, fontWeight: '800', marginTop: 2 },
  metricSub: { color: Colors.textSecondary, fontSize: 10, marginTop: 2 },
  verdictBox: { borderRadius: Radius.md, borderWidth: 1, gap: 4, padding: 10 },
  verdictText: { fontSize: 13, fontWeight: '800' },
  historyBlock: { gap: 6 },
  sectionLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800' },
  auditRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  auditText: { flex: 1, color: Colors.textPrimary, fontSize: 11, lineHeight: 16 },
  errorText: { color: Colors.danger, fontSize: 11, lineHeight: 16 },
});
