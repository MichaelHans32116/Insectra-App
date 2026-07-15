/**
 * /analytics/[id] — per-device deep analytics screen.
 *
 * URL: /analytics/<deviceId>
 *
 * Features:
 *   - Time range picker (15m → 30d, plus custom date range)
 *   - Charts: cumulative count, daily catch (rolling), temperature with the
 *     25–30 °C optimum band shaded, humidity with 60–70 % optimum band
 *   - Outbreak risk panel using the v3 population-gated algorithm — driven by
 *     the FILTERED range so users can ask "what was risk during last week?"
 *   - 3-day / 7-day / 14-day risk projections
 *   - Recommendation list (research-backed IPM actions)
 *   - Recent samples table
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import { Screen, Card, Button, Badge, StatTile, EmptyState, SectionHeader } from '@/components/ui';
import { useActiveGroup } from '@/services/activeGroup';
import {
  bucketSamples,
  clearSamples,
  dailyCountHistory,
  loadSamples,
  querySamples,
  rangeBoundaries,
  rangeLabel,
  type Bucket,
  type RangeSpec,
  type Sample,
} from '@/services/samplesStore';
import { listenDeviceState, type DeviceState } from '@/services/iotRealtime';
import { recordDeviceSample } from '@/services/samplesStore';
import { getDevice, type RegisteredDevice } from '@/services/devices';
import {
  BIO_CONSTANTS,
  computeRisk,
  type RiskResult,
} from '@/services/riskScoring';
import TimeRangePicker from '@/components/TimeRangePicker';
import SeriesChart from '@/components/SeriesChart';
import {
  mirrorSampleToCloud,
  loadCloudSamples,
  shouldBackfill,
  markBackfilled,
} from '@/services/samplesCloud';
import { detectAnomalies, type AnomalySignal } from '@/services/anomaly';
import { pushAlert } from '@/services/alerts';
import { exportPdfReport } from '@/services/pdfReport';
import AlertsBell from '@/components/AlertsBell';
import SprayPlanCard from '@/components/SprayPlanCard';
import ForecastAuditCard from '@/components/ForecastAuditCard';
import { Platform } from 'react-native';

function cloudDocIdForPiCode(piCode: string): string {
  if (piCode === 'INSECTRA-PI-001') return 'trap-001';
  return piCode.toLowerCase();
}

// How many buckets to show on the chart for a given range — denser ranges
// get more buckets to expose minute-level structure.
function bucketCountFor(spec: RangeSpec): number {
  switch (spec.preset) {
    case 'last_15m': return 15;
    case 'last_1h':  return 30;
    case 'last_6h':  return 36;
    case 'last_24h': return 48;
    case 'last_3d':  return 36;
    case 'last_7d':  return 28;
    case 'last_14d': return 28;
    case 'last_30d': return 30;
    case 'custom':   return 36;
  }
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const styles = useThemeStyles(createStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveGroup();
  const [device, setDevice] = useState<RegisteredDevice | null>(null);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [range, setRange] = useState<RangeSpec>({ preset: 'last_24h' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showRiskDetails, setShowRiskDetails] = useState(false);

  // Load device metadata.
  useEffect(() => {
    if (!active || !id) return;
    let alive = true;
    (async () => {
      try {
        const d = await getDevice(active.id, id);
        if (alive) setDevice(d);
      } catch {
        if (alive) setDevice(null);
      } finally {
        if (alive) setDeviceLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [active?.id, id]);

  // Subscribe to live device state — push every update into the rolling
  // sample buffer so charts grow live.
  useEffect(() => {
    if (!device) return;
    const cloudId = cloudDocIdForPiCode(device.piCode);
    const unsub = listenDeviceState(cloudId, (state: DeviceState) => {
      const status = (state.status ?? '').toLowerCase();
      const isOffline =
        status.includes('offline') ||
        status.includes('searching') ||
        status.includes('not found');
      // Even when offline we record the heartbeat so the chart shows the gap,
      // but we null-out the values we cannot trust.
      const sampleInput = {
        t: Date.now(),
        count: typeof state.totalCount === 'number' ? state.totalCount : null,
        daily: typeof state.dailyCount === 'number' ? state.dailyCount : null,
        temperature:
          !isOffline && typeof state.temperature === 'number' ? state.temperature : null,
        humidity:
          !isOffline && typeof state.humidity === 'number' ? state.humidity : null,
        status: state.status ?? null,
      };
      recordDeviceSample(id!, sampleInput).then((next) => setSamples([...next]));
      // Mirror to cloud (rate-limited inside).
      if (active) {
        mirrorSampleToCloud(active.id, id!, { ...sampleInput });
      }
    });
    return unsub;
  }, [device?.piCode, id, active?.id]);

  // Cloud backfill — gives a brand-new device a populated 30-day history without
  // waiting for the buffer to refill. Guarded to run at most once per device per
  // session: without this it re-fired on every screen open (an uncached read of
  // up to 2000 docs), the largest free-tier read cost.
  useEffect(() => {
    if (!active || !id) return;
    if (!shouldBackfill(active.id, id)) return;
    markBackfilled(active.id, id);
    const sinceMs = Date.now() - 30 * 24 * 60 * 60_000;
    loadCloudSamples(active.id, id, sinceMs).then((cloud) => {
      if (cloud.length === 0) return;
      setSamples((prev) => {
        // Merge by timestamp, dedupe, sort.
        const seen = new Set(prev.map((s) => s.t));
        const merged = [...prev];
        for (const s of cloud) if (!seen.has(s.t)) merged.push(s);
        merged.sort((a, b) => a.t - b.t);
        return merged;
      });
    });
  }, [active?.id, id]);

  // Initial load (in case there are persisted samples from a previous session).
  useEffect(() => {
    if (!id) return;
    loadSamples(id).then((s) => setSamples([...s]));
  }, [id, refreshKey]);

  // ── Derived state ──────────────────────────────────────────────────────
  const { startMs, endMs } = useMemo(() => rangeBoundaries(range), [range]);
  const filteredSamples = useMemo(
    () => samples.filter((s) => s.t >= startMs && s.t <= endMs),
    [samples, startMs, endMs],
  );
  const buckets: Bucket[] = useMemo(
    () => bucketSamples(filteredSamples, startMs, endMs, bucketCountFor(range)),
    [filteredSamples, startMs, endMs, range],
  );

  // For the risk panel we use the FILTERED window so users can ask
  // counterfactuals ("what was risk during the heatwave last week?").
  const dailyHistory = useMemo(() => dailyCountHistory(samples, 7), [samples]);
  const tempSeries = useMemo(
    () => filteredSamples.map((s) => s.temperature),
    [filteredSamples],
  );
  const humSeries = useMemo(
    () => filteredSamples.map((s) => s.humidity),
    [filteredSamples],
  );
  const latestDaily = useMemo(() => {
    for (let i = filteredSamples.length - 1; i >= 0; i--) {
      if (filteredSamples[i].daily !== null) return filteredSamples[i].daily;
    }
    return null;
  }, [filteredSamples]);

  const risk: RiskResult = useMemo(
    () =>
      computeRisk({
        dailyCount: latestDaily,
        countHistory: dailyHistory,
        tempSeries,
        humSeries,
      }),
    [latestDaily, dailyHistory, tempSeries, humSeries],
  );

  // Anomaly detection — robust z-score over rolling samples.
  const anomalies: AnomalySignal[] = useMemo(
    () => detectAnomalies(samples),
    [samples],
  );

  // Push an alert when risk crosses HIGH or any anomaly fires (deduped).
  useEffect(() => {
    if (!device) return;
    if (risk.level === 'high' && risk.confidence >= 0.5) {
      pushAlert({
        severity: 'critical',
        title: `HIGH outbreak risk on ${device.name}`,
        body: risk.advice,
        deviceId: id,
        dedupeKey: `outbreak.high.${id}`,
      });
    }
    for (const a of anomalies) {
      if (a.severity === 'alert') {
        pushAlert({
          severity: 'critical',
          title: `Unusual ${a.channel} on ${device.name}`,
          body: a.description,
          deviceId: id,
          dedupeKey: `anomaly.${a.channel}.${id}`,
        });
      }
    }
  }, [risk.level, risk.confidence, anomalies, device?.name, id]);

  const summary = useMemo(() => {
    const realTemps = tempSeries.filter((x): x is number => x !== null);
    const realHums = humSeries.filter((x): x is number => x !== null);
    const dailies = filteredSamples
      .map((s) => s.daily)
      .filter((x): x is number => x !== null);
    return {
      sampleN: filteredSamples.length,
      tMin: realTemps.length ? Math.min(...realTemps) : null,
      tMax: realTemps.length ? Math.max(...realTemps) : null,
      hMin: realHums.length ? Math.min(...realHums) : null,
      hMax: realHums.length ? Math.max(...realHums) : null,
      peakDaily: dailies.length ? Math.max(...dailies) : null,
    };
  }, [filteredSamples, tempSeries, humSeries]);

  if (!active) {
    return (
      <Screen scroll={false}>
        <EmptyState
          icon="login-variant"
          title="Sign in to view analytics"
        />
      </Screen>
    );
  }
  if (!device && deviceLoading) {
    return (
      <Screen scroll={false} contentStyle={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </Screen>
    );
  }
  if (!device) {
    return (
      <Screen scroll={false}>
        <EmptyState
          icon="alert-circle-outline"
          title="Device not found"
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const handleClear = () => {
    Alert.alert(
      'Clear local samples?',
      'Wipes the on-device buffer for this Pi. Cloud history is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearSamples(id!);
            setRefreshKey((k) => k + 1);
            setSamples([]);
          },
        },
      ],
    );
  };

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.flex1}>
          <Text style={styles.deviceName} numberOfLines={1}>{device.name}</Text>
          <Text style={styles.devicePi} numberOfLines={1}>
            {device.piCode} · {rangeLabel(range)}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClear} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear local samples">
          <MaterialCommunityIcons name="trash-can-outline" size={20} color={Colors.danger} />
        </TouchableOpacity>
        <AlertsBell tint={Colors.primaryDark} />
      </View>

      {/* Time range picker */}
      <TimeRangePicker value={range} onChange={setRange} />

      {/* Risk card — farmer-first.
          Hierarchy: ONE big number + label (headline), ONE sentence of advice
          (the action), then optional v3 diagnostics behind a toggle. */}
      <View style={[styles.riskCard, { backgroundColor: risk.bgColor, borderColor: risk.color + '40' }]}>
        <View style={styles.riskHead}>
          <View style={[styles.riskScoreBadge, { backgroundColor: risk.color }]}>
            <Text style={styles.riskScoreText}>{Math.round(risk.score * 100)}</Text>
            <Text style={styles.riskScoreSub}>/100</Text>
          </View>
          <View style={styles.flex1}>
            <Text style={[styles.riskKicker, { color: risk.color }]}>Pest outbreak risk today</Text>
            <Text style={[styles.riskLabel, { color: risk.color }]}>{risk.label}</Text>
          </View>
        </View>
        <Text style={[styles.riskAdvice, { color: risk.color }]}>{risk.advice}</Text>

        <TouchableOpacity
          style={styles.detailsToggle}
          activeOpacity={0.7}
          onPress={() => setShowRiskDetails((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showRiskDetails }}
        >
          <Text style={[styles.detailsToggleText, { color: risk.color }]}>
            {showRiskDetails ? 'Hide details' : 'Show details'}
          </Text>
          <MaterialCommunityIcons
            name={showRiskDetails ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={risk.color}
          />
        </TouchableOpacity>

        {showRiskDetails && (
          <View style={styles.detailsBlock}>
            <Text style={[styles.detailsLabel, { color: risk.color }]}>What drives this score</Text>
            {/* v3 model: actual catch (population pressure) is the GATE; weather
                (environmental conditions) only amplifies a present population. */}
            <View style={styles.riskMetaRow}>
              <RiskMeta
                label="Population pressure"
                value={risk.populationPressure}
                color={risk.color}
                styles={styles}
              />
              <RiskMeta
                label="Environmental conditions"
                value={risk.environmentalSuitability}
                color={risk.color}
                styles={styles}
              />
            </View>
            <Text style={[styles.confText, { color: risk.color }]}>
              {risk.weatherOnly
                ? 'Weather-only watch — catch gates the score, so weather alone is capped.'
                : 'Catch present — weather conditions amplify the risk.'}
            </Text>
            <Text style={[styles.confText, { color: risk.color }]}>
              Confidence: {Math.round(risk.confidence * 100)}%
              {risk.missing.length > 0 && ` · missing: ${risk.missing.join(', ')}`}
            </Text>
            {(risk.projectedRisk3d !== null ||
              risk.projectedRisk7d !== null ||
              risk.projectedRisk14d !== null) && (
              <View style={styles.projWrap}>
                <Text style={[styles.detailsLabel, { color: risk.color }]}>Projected risk</Text>
                <View style={styles.projRow}>
                  <ProjChip label="in 3 d" value={risk.projectedRisk3d} styles={styles} />
                  <ProjChip label="in 7 d" value={risk.projectedRisk7d} styles={styles} />
                  <ProjChip label="in 14 d" value={risk.projectedRisk14d} styles={styles} />
                </View>
                {risk.generationTimeDays !== null && (
                  <Text style={styles.genText}>
                    Pest generation time ≈ {risk.generationTimeDays} days
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Recommendations */}
      {risk.recommendations.length > 0 && (
        <Card>
          <SectionHeader title="What to do next" icon="clipboard-check-outline" />
          {risk.recommendations.map((r, i) => (
            <View key={i} style={styles.recRow}>
              <Text style={styles.recBullet}>{i + 1}.</Text>
              <Text style={styles.recText}>{r}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Spray plan + forecast audit (preserved child components) */}
      <SprayPlanCard
        farmId={active.id}
        farmName={active.name}
        deviceId={id}
        risk={risk}
        dailyCount={latestDaily}
        countHistory={dailyHistory}
        onOpenSettings={() => router.push('/spray-settings' as any)}
      />

      <ForecastAuditCard
        farmId={active.id}
        deviceId={id}
        risk={risk}
        dailyCount={latestDaily}
        countHistory={dailyHistory}
        samples={samples}
      />

      {/* Anomaly panel — robust z-score against this farm's own baseline */}
      {anomalies.length > 0 ? (
        <Card style={styles.anomCard}>
          <View style={styles.anomHeader}>
            <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={18} color={Colors.danger} />
            <Text style={styles.anomTitle}>Anomalies vs. baseline</Text>
          </View>
          {anomalies.map((a, i) => (
            <View key={i} style={styles.anomRow}>
              <Badge
                label={`z=${a.zScore.toFixed(1)}`}
                tone={a.severity === 'alert' ? 'danger' : 'warning'}
              />
              <Text style={styles.anomText}>{a.description}</Text>
            </View>
          ))}
        </Card>
      ) : (
        samples.length >= 8 && (
          <View style={styles.anomQuiet}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.anomQuietText}>
              No anomalies — readings within this trap's normal range.
            </Text>
          </View>
        )
      )}

      {/* Summary chips */}
      <SectionHeader title="Range summary" icon="chart-box-outline" />
      <View style={styles.summaryGrid}>
        <StatTile label="Samples" value={String(summary.sampleN)} style={styles.statTile} />
        <StatTile
          label="Peak daily"
          value={summary.peakDaily !== null ? String(summary.peakDaily) : '—'}
          style={styles.statTile}
        />
        <StatTile
          label="Temp range"
          value={
            summary.tMin !== null
              ? `${summary.tMin.toFixed(1)}–${summary.tMax!.toFixed(1)}`
              : '—'
          }
          unit={summary.tMin !== null ? '°C' : undefined}
          style={styles.statTile}
        />
        <StatTile
          label="Humidity range"
          value={
            summary.hMin !== null
              ? `${summary.hMin.toFixed(0)}–${summary.hMax!.toFixed(0)}`
              : '—'
          }
          unit={summary.hMin !== null ? '%' : undefined}
          style={styles.statTile}
        />
      </View>

      {/* Export bar */}
      <Button
        label={`Export ${filteredSamples.length} sample${filteredSamples.length === 1 ? '' : 's'} CSV`}
        icon="file-download-outline"
        variant="secondary"
        fullWidth
        onPress={() => exportSamplesCsv(device.name, filteredSamples)}
      />
      <Button
        label="Export PDF report"
        icon="file-pdf-box"
        variant="primary"
        fullWidth
        onPress={() =>
          exportPdfReport({
            deviceName: device.name,
            deviceId: id ?? '',
            farmName: active?.name ?? '—',
            rangeLabel: rangeLabel(range),
            generatedAt: Date.now(),
            samples: filteredSamples,
            anomalies,
            risk: risk
              ? { level: risk.level, confidence: risk.confidence, advice: risk.advice }
              : null,
            recommendations: risk?.recommendations ?? [],
            projection3d: risk?.projectedRisk3d != null ? Math.round(risk.projectedRisk3d * 100) : null,
            projection7d: risk?.projectedRisk7d != null ? Math.round(risk.projectedRisk7d * 100) : null,
          })
        }
      />

      {/* Charts */}
      <SeriesChart
        title="Daily fly count (Pi-reported, rolling 24h)"
        buckets={buckets}
        field="daily"
        unit=""
        startMs={startMs}
        endMs={endMs}
        emptyHint="No daily-count data in this range yet."
      />
      <SeriesChart
        title="Temperature"
        buckets={buckets}
        field="temperature"
        unit=" °C"
        yMin={10}
        yMax={40}
        optimalBand={{
          min: BIO_CONSTANTS.TEMP_OPTIMAL_LO,
          max: BIO_CONSTANTS.TEMP_OPTIMAL_HI,
          color: 'rgba(45,106,79,0.15)',
        }}
        startMs={startMs}
        endMs={endMs}
        mode="line"
        emptyHint="DHT11 has not reported temperature in this range."
      />
      <SeriesChart
        title="Relative humidity"
        buckets={buckets}
        field="humidity"
        unit=" %"
        yMin={20}
        yMax={100}
        optimalBand={{
          min: BIO_CONSTANTS.RH_OPTIMAL_LO,
          max: BIO_CONSTANTS.RH_OPTIMAL_HI,
          color: 'rgba(45,106,143,0.15)',
        }}
        startMs={startMs}
        endMs={endMs}
        mode="line"
        emptyHint="DHT11 has not reported humidity in this range."
      />
      <SeriesChart
        title="Cumulative count"
        buckets={buckets}
        field="count"
        unit=""
        startMs={startMs}
        endMs={endMs}
        emptyHint="No cumulative count yet."
      />

      {/* Recent samples table */}
      <Card>
        <SectionHeader title="Recent samples (last 8)" icon="table" />
        {filteredSamples.length === 0 ? (
          <Text style={styles.tableEmpty}>Waiting for the Pi to push data in this window.</Text>
        ) : (
          [...filteredSamples].slice(-8).reverse().map((s, i) => (
            <View key={`${s.t}-${i}`} style={styles.tableRow}>
              <Text style={styles.tableTime}>{new Date(s.t).toLocaleString()}</Text>
              <Text style={styles.tableCell}>
                {s.daily !== null ? `${s.daily}/d` : '—'}
              </Text>
              <Text style={styles.tableCell}>
                {s.temperature !== null ? `${s.temperature.toFixed(1)}°C` : '—'}
              </Text>
              <Text style={styles.tableCell}>
                {s.humidity !== null ? `${s.humidity.toFixed(0)}%` : '—'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.footnote}>
        Algorithm v3 (population-gated): catch + 3-day trend = population pressure
        (the gate); temperature × humidity = environmental conditions, which only
        amplify a present population. Refs: Dhillon 2005, Vargas 2000, Kandakoor
        2019, Barma 2021, FAO/IAEA 2019, PCAARRD 2017.
      </Text>
    </Screen>
  );
}

type Styles = ReturnType<typeof createStyles>;

function RiskMeta(props: {
  label: string;
  value: number | null;
  color: string;
  styles: Styles;
}) {
  const { styles } = props;
  return (
    <View style={styles.riskMetaCell}>
      <Text style={[styles.riskMetaLabel, { color: props.color }]} numberOfLines={2}>
        {props.label}
      </Text>
      <Text style={[styles.riskMetaValue, { color: props.color }]}>
        {props.value === null ? '—' : `${Math.round(props.value * 100)}%`}
      </Text>
    </View>
  );
}

function ProjChip(props: { label: string; value: number | null; styles: Styles }) {
  const { styles } = props;
  const display = props.value === null ? '—' : `${Math.round(props.value * 100)}%`;
  return (
    <View style={styles.projChip}>
      <Text style={styles.projLabel}>{props.label}</Text>
      <Text style={styles.projValue}>{display}</Text>
    </View>
  );
}

/**
 * Export the currently filtered samples as CSV. On web we trigger a
 * direct download via a Blob; on native we copy a CSV preview to the
 * clipboard via a simple alert (we don't bundle expo-file-system here
 * to keep dependencies lean — agronomists requesting the data on a
 * phone will overwhelmingly do so via the web build).
 */
function exportSamplesCsv(deviceName: string, samples: Sample[]): void {
  if (samples.length === 0) {
    Alert.alert('Nothing to export', 'No samples in the current range.');
    return;
  }
  const header = 'iso_time,epoch_ms,count_total,daily,temperature_c,humidity_pct,status';
  const rows = samples.map((s) =>
    [
      new Date(s.t).toISOString(),
      s.t,
      s.count ?? '',
      s.daily ?? '',
      s.temperature ?? '',
      s.humidity ?? '',
      (s.status ?? '').replace(/[",\n]/g, ' '),
    ].join(','),
  );
  const csv = [header, ...rows].join('\n');
  const safeName = deviceName.replace(/[^a-z0-9-_]+/gi, '_');
  const filename = `insectra_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    } catch {
      /* fall through */
    }
  }
  // Native or web fallback: show the first 1 KB so the user can copy.
  Alert.alert(
    `Exported ${samples.length} rows`,
    `Filename: ${filename}\n\n${csv.slice(0, 1000)}${csv.length > 1000 ? '\n…' : ''}`,
  );
}

const createStyles = () => StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  deviceName: { ...Type.h2, color: Colors.primaryDark },
  devicePi: { ...Type.caption, color: Colors.textSecondary, marginTop: 2 },

  riskCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  riskHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  riskScoreBadge: {
    minWidth: 64,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskScoreText: { color: Colors.textOnPrimary, fontSize: 22, fontWeight: '800', lineHeight: 24 },
  riskScoreSub: { color: Colors.textOnPrimary, fontSize: 10, fontWeight: '700', opacity: 0.85 },
  riskKicker: { ...Type.micro, textTransform: 'uppercase' },
  riskLabel: { ...Type.h2, fontWeight: '800', marginTop: 1 },
  riskAdvice: { ...Type.body },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: 2,
    paddingVertical: Spacing.xs,
  },
  detailsToggleText: { ...Type.caption, fontWeight: '700' },
  detailsBlock: { gap: Spacing.sm, marginTop: 2 },
  detailsLabel: { ...Type.micro },
  riskMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  riskMetaCell: {
    flexGrow: 1,
    flexBasis: '45%',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface + 'AA',
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  riskMetaLabel: { ...Type.micro, fontWeight: '700', textAlign: 'center', letterSpacing: 0 },
  riskMetaValue: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  confText: { ...Type.caption, fontWeight: '700' },
  projWrap: { gap: Spacing.xs, marginTop: 2 },
  projRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  projChip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface + 'AA',
  },
  projLabel: { ...Type.micro, color: Colors.textSecondary },
  projValue: { ...Type.label, fontWeight: '800', color: Colors.textPrimary },
  genText: { ...Type.caption, color: Colors.textSecondary, fontStyle: 'italic' },

  recRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  recBullet: { ...Type.caption, fontWeight: '800', color: Colors.primaryDark, width: 18 },
  recText: { flex: 1, ...Type.caption, lineHeight: 17, color: Colors.textPrimary },

  anomCard: { backgroundColor: Colors.dangerBg, borderColor: Colors.danger + '40', gap: Spacing.sm },
  anomHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  anomTitle: { ...Type.label, fontWeight: '800', color: Colors.danger },
  anomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  anomText: { flex: 1, ...Type.caption, lineHeight: 17, color: Colors.textPrimary },
  anomQuiet: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryFaint,
    borderWidth: 1, borderColor: Colors.primaryLight,
    borderRadius: Radius.md, padding: Spacing.md,
  },
  anomQuietText: { flex: 1, ...Type.caption, color: Colors.primaryDark, fontWeight: '600' },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statTile: { flexBasis: '48%', flexGrow: 1 },

  tableEmpty: { ...Type.caption, color: Colors.textTertiary, fontStyle: 'italic' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  tableTime: { flex: 2, ...Type.caption, color: Colors.textSecondary },
  tableCell: { flex: 1, ...Type.caption, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right' },

  footnote: { ...Type.caption, fontSize: 10, color: Colors.textTertiary, lineHeight: 14, marginTop: Spacing.xs },
});
