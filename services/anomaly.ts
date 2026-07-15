/**
 * anomaly.ts — Lightweight anomaly detection over the rolling sample buffer.
 *
 * Rationale:
 *   The v2 risk algorithm answers "given current conditions, how outbreak-prone
 *   are we?". Anomaly detection answers a complementary question: "is anything
 *   unusual happening RIGHT NOW relative to this farm's own history?". A trap
 *   that normally sees 2 flies/day suddenly catching 14 is a stronger signal
 *   than a trap whose baseline is already 14 — but the absolute risk score may
 *   not differentiate them. Experts asked for both views.
 *
 * Method:
 *   - Robust z-score using median + MAD (median absolute deviation), which is
 *     resistant to the same outliers we are trying to detect (a single huge
 *     catch should not poison the baseline). |z| ≥ 3 → anomaly, |z| ≥ 2 →
 *     suspicious.
 *   - Computed on three channels independently: dailyCount, temperature,
 *     humidity. Each emits an `AnomalySignal`.
 *   - Requires ≥ 7 historical samples to publish anything; below that we
 *     return [] so the UI shows "Building baseline…" instead of false alarms.
 */
import type { Sample } from './samplesStore';

export type AnomalyChannel = 'count' | 'temperature' | 'humidity';
export type AnomalySeverity = 'normal' | 'watch' | 'alert';

export interface AnomalySignal {
  channel: AnomalyChannel;
  severity: AnomalySeverity;
  zScore: number;        // robust z (signed)
  current: number;       // latest observed value
  median: number;        // baseline center
  mad: number;           // median absolute deviation
  description: string;   // human-readable
}

const MIN_BASELINE_N = 7;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function mad(xs: number[], med: number): number {
  if (xs.length === 0) return 0;
  const dev = xs.map((x) => Math.abs(x - med));
  const m = median(dev);
  // 1.4826 = consistency factor for normal distributions (Rousseeuw & Croux 1993).
  return m * 1.4826;
}

function robustZ(current: number, history: number[]): { z: number; med: number; mad: number } {
  const med = median(history);
  let m = mad(history, med);
  // Floor MAD at a tiny epsilon so we don't divide by zero on perfectly flat
  // histories (which mean ANY change is in some sense an anomaly, but we
  // don't want infinity). 0.5 is a sensible floor for count and °C; for RH
  // the user can interpret a z=10 as "huge change" without it being inf.
  if (m < 0.5) m = 0.5;
  return { z: (current - med) / m, med, mad: m };
}

function severityFor(absZ: number): AnomalySeverity {
  if (absZ >= 3) return 'alert';
  if (absZ >= 2) return 'watch';
  return 'normal';
}

function describe(channel: AnomalyChannel, z: number, current: number, med: number): string {
  const dir = z > 0 ? 'above' : 'below';
  const word = Math.abs(z) >= 3 ? 'far' : 'unusually';
  switch (channel) {
    case 'count':
      return `Today's catch (${current.toFixed(0)}) is ${word} ${dir} this trap's typical level (${med.toFixed(0)}/day).`;
    case 'temperature':
      return `Temperature (${current.toFixed(1)} °C) is ${word} ${dir} the recent baseline (${med.toFixed(1)} °C).`;
    case 'humidity':
      return `Humidity (${current.toFixed(0)} %) is ${word} ${dir} the recent baseline (${med.toFixed(0)} %).`;
  }
}

/** Detect anomalies in the latest sample relative to history. */
export function detectAnomalies(samples: Sample[]): AnomalySignal[] {
  if (samples.length < MIN_BASELINE_N + 1) return [];
  const latest = samples[samples.length - 1];
  const history = samples.slice(0, -1);
  const out: AnomalySignal[] = [];

  // dailyCount channel
  const dailyHist = history.map((s) => s.daily).filter((v): v is number => v !== null);
  if (latest.daily !== null && dailyHist.length >= MIN_BASELINE_N) {
    const { z, med, mad } = robustZ(latest.daily, dailyHist);
    const sev = severityFor(Math.abs(z));
    if (sev !== 'normal') {
      out.push({
        channel: 'count',
        severity: sev,
        zScore: z,
        current: latest.daily,
        median: med,
        mad,
        description: describe('count', z, latest.daily, med),
      });
    }
  }

  // temperature
  const tempHist = history.map((s) => s.temperature).filter((v): v is number => v !== null);
  if (latest.temperature !== null && tempHist.length >= MIN_BASELINE_N) {
    const { z, med, mad } = robustZ(latest.temperature, tempHist);
    const sev = severityFor(Math.abs(z));
    if (sev !== 'normal') {
      out.push({
        channel: 'temperature',
        severity: sev,
        zScore: z,
        current: latest.temperature,
        median: med,
        mad,
        description: describe('temperature', z, latest.temperature, med),
      });
    }
  }

  // humidity
  const humHist = history.map((s) => s.humidity).filter((v): v is number => v !== null);
  if (latest.humidity !== null && humHist.length >= MIN_BASELINE_N) {
    const { z, med, mad } = robustZ(latest.humidity, humHist);
    const sev = severityFor(Math.abs(z));
    if (sev !== 'normal') {
      out.push({
        channel: 'humidity',
        severity: sev,
        zScore: z,
        current: latest.humidity,
        median: med,
        mad,
        description: describe('humidity', z, latest.humidity, med),
      });
    }
  }

  return out;
}
