/**
 * SeriesChart — lightweight, dependency-free time-series chart for the
 * Insectra analytics screen. Renders bars (for counts) or polyline-style
 * vertical sticks (for temperature / humidity), with an optional shaded
 * "optimal band" overlay (e.g. 25–30 °C, 60–70 % RH).
 *
 * Implementation notes:
 *   - Pure View-based; works on web AND native without react-native-svg.
 *   - Bar mode: each bucket is a vertical View whose height is proportional
 *     to (value - yMin) / (yMax - yMin).
 *   - Line mode: each bucket is a thin filled rectangle anchored at the
 *     bucket's value, so the eye reads it as a stepped line / sparkline.
 *   - We fade buckets that have sampleN === 0 so the user can see the gap.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import type { Bucket } from '@/services/samplesStore';

export interface OptimalBand {
  min: number;
  max: number;
  color: string;     // RGBA fill colour for the band background
}

interface Props {
  title: string;
  buckets: Bucket[];
  field: 'count' | 'daily' | 'temperature' | 'humidity';
  unit?: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  optimalBand?: OptimalBand;
  mode?: 'bar' | 'line';
  formatTick?: (v: number) => string;
  startMs: number;
  endMs: number;
  emptyHint?: string;
}

function defaultFormat(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function timeAxisLabels(startMs: number, endMs: number): string[] {
  const span = endMs - startMs;
  const fmt = (ms: number): string => {
    const d = new Date(ms);
    if (span < 6 * 60 * 60_000) {
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (span < 3 * 24 * 60 * 60_000) {
      return `${d.getHours()}:00`;
    }
    if (span < 14 * 24 * 60 * 60_000) {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return [fmt(startMs), fmt((startMs + endMs) / 2), fmt(endMs)];
}

export default function SeriesChart(props: Props) {
  const styles = useThemeStyles(makeStyles);
  const {
    title, buckets, field, unit = '', height = 160,
    optimalBand, mode = 'bar', startMs, endMs, emptyHint,
  } = props;

  const values = useMemo(
    () => buckets.map((b) => (b[field] !== null ? (b[field] as number) : null)),
    [buckets, field],
  );
  const realValues = values.filter((v): v is number => v !== null);

  const inferredMin = realValues.length ? Math.min(...realValues) : 0;
  const inferredMax = realValues.length ? Math.max(...realValues) : 1;
  const yMin = props.yMin ?? Math.min(0, inferredMin);
  const yMaxRaw = props.yMax ?? Math.max(inferredMax, optimalBand?.max ?? -Infinity);
  const yMax = yMaxRaw <= yMin ? yMin + 1 : yMaxRaw;
  const span = yMax - yMin;

  const fmt = props.formatTick ?? defaultFormat;

  const bandTopPct = optimalBand
    ? Math.max(0, Math.min(100, (1 - (optimalBand.max - yMin) / span) * 100))
    : 0;
  const bandBottomPct = optimalBand
    ? Math.max(0, Math.min(100, (1 - (optimalBand.min - yMin) / span) * 100))
    : 0;

  const axisLabels = timeAxisLabels(startMs, endMs);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {realValues.length > 0 && (
          <Text style={styles.headerStat}>
            min {fmt(Math.min(...realValues))}{unit} · max {fmt(Math.max(...realValues))}{unit}
          </Text>
        )}
      </View>
      <View style={styles.plotRow}>
        {/* Y axis labels */}
        <View style={[styles.yAxis, { height }]}>
          <Text style={styles.axisLabel}>{fmt(yMax)}{unit}</Text>
          <Text style={styles.axisLabel}>{fmt(yMin + span / 2)}{unit}</Text>
          <Text style={styles.axisLabel}>{fmt(yMin)}{unit}</Text>
        </View>

        {/* Plot area */}
        <View style={[styles.plot, { height }]}>
          {/* Optimal band overlay */}
          {optimalBand && (
            <View
              pointerEvents="none"
              style={[
                styles.bandOverlay,
                {
                  top: `${bandTopPct}%`,
                  bottom: `${100 - bandBottomPct}%`,
                  backgroundColor: optimalBand.color,
                },
              ]}
            />
          )}

          {realValues.length === 0 ? (
            <View style={styles.emptyOverlay}>
              <Text style={styles.emptyText}>{emptyHint ?? 'No data in this range yet.'}</Text>
            </View>
          ) : (
            <View style={styles.bars}>
              {buckets.map((b, i) => {
                const v = values[i];
                if (v === null) {
                  return <View key={i} style={[styles.bar, styles.barEmpty]} />;
                }
                const norm = (v - yMin) / span;
                const heightPct = Math.max(2, Math.min(100, norm * 100));
                if (mode === 'line') {
                  // Render a thin "stick" topped with a 3px cap at the value level.
                  return (
                    <View key={i} style={styles.bar}>
                      <View style={{ height: `${100 - heightPct}%` }} />
                      <View
                        style={[
                          styles.lineCap,
                          { backgroundColor: colorFor(field) },
                        ]}
                      />
                      <View
                        style={[
                          styles.lineStem,
                          { height: `${heightPct - 3}%`, backgroundColor: colorFor(field) },
                        ]}
                      />
                    </View>
                  );
                }
                return (
                  <View key={i} style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { height: `${heightPct}%`, backgroundColor: colorFor(field) },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
      {/* X axis labels */}
      <View style={styles.xAxis}>
        <Text style={styles.axisLabel}>{axisLabels[0]}</Text>
        <Text style={styles.axisLabel}>{axisLabels[1]}</Text>
        <Text style={styles.axisLabel}>{axisLabels[2]}</Text>
      </View>
    </View>
  );
}

function colorFor(field: Props['field']): string {
  switch (field) {
    case 'count':
    case 'daily':       return Colors.primaryDark;
    case 'temperature': return '#C0392B';
    case 'humidity':    return '#2D6A8F';
  }
}

const makeStyles = () => StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary },
  headerStat: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },

  plotRow: { flexDirection: 'row', gap: 6 },
  yAxis: { width: 38, justifyContent: 'space-between', alignItems: 'flex-end' },
  axisLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: '600' },
  plot: {
    flex: 1,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
    position: 'relative',
  },
  bandOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  emptyOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic' },

  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1, padding: 2 },
  bar: { flex: 1, height: '100%', justifyContent: 'flex-end', overflow: 'hidden' },
  barEmpty: { backgroundColor: 'transparent' },
  barFill: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  lineStem: { width: 1, alignSelf: 'center' },
  lineCap: { width: '90%', height: 3, alignSelf: 'center', borderRadius: 2 },

  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 44,
    marginTop: 2,
  },
});
