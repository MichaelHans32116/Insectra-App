/**
 * samplesStore.ts — High-resolution rolling sample buffer (per device).
 *
 * Stores up to 30 days of timestamped device-state snapshots in AsyncStorage,
 * one bucket per device, so the analytics screen can render charts at any
 * resolution from "last 60 minutes" to "last 30 days" or a custom date range.
 *
 * Sampling policy:
 *   - On every device-state push from `listenDeviceState`, we either INSERT a
 *     new sample or COALESCE into the latest one if it's < SAMPLE_MIN_GAP_MS
 *     old. This keeps the buffer dense enough for minute charts without
 *     blowing up storage (a 2-second push rate would otherwise produce
 *     ~1.3M samples/month).
 *   - Storage cap: MAX_SAMPLES per device (oldest dropped first).
 *
 * Range queries support both fixed presets ("last 1h", "last 24h", etc.)
 * and arbitrary [start, end] timestamps.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

export type Sample = {
  t: number;                       // epoch ms (sample timestamp)
  count: number | null;            // cumulative running count from Pi
  daily: number | null;            // count over the last 24h (Pi-reported)
  temperature: number | null;      // °C
  humidity: number | null;         // %
  status: string | null;           // 'online' | 'offline' | 'searching' ...
};

export type RangePreset =
  | 'last_15m'
  | 'last_1h'
  | 'last_6h'
  | 'last_24h'
  | 'last_3d'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'custom';

export interface RangeSpec {
  preset: RangePreset;
  startMs?: number;   // only used when preset = 'custom'
  endMs?: number;     // only used when preset = 'custom'
}

const KEY_PREFIX = 'insectra.samples.v1.';
const MAX_SAMPLES = 4320;           // ~30 days of one sample per ~10 min
const SAMPLE_MIN_GAP_MS = 60_000;   // coalesce pushes within 1 minute

// In-memory cache of buffers we've loaded this session — keeps repeated
// chart re-renders cheap.
const memCache = new Map<string, Sample[]>();

function keyFor(deviceId: string): string {
  return `${KEY_PREFIX}${deviceId}`;
}

// ── Debounced persistence ──────────────────────────────────────────────────
// The buffer is mutated on every device push (~every 2-3 s). Re-serializing the
// whole array (up to MAX_SAMPLES) to AsyncStorage that often is the dominant
// JS-thread cost on low-end phones. memCache stays authoritative for reads; we
// flush to disk at most once per PERSIST_GAP_MS, plus immediately on background.
const PERSIST_GAP_MS = 30_000;
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushDirty(): Promise<void> {
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const buf = memCache.get(id);
    if (!buf) continue;
    try {
      await AsyncStorage.setItem(keyFor(id), JSON.stringify(buf));
    } catch {
      dirty.add(id); // retry on the next flush
    }
  }
}

function schedulePersist(deviceId: string): void {
  dirty.add(deviceId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDirty();
  }, PERSIST_GAP_MS);
}

/** Force an immediate flush of all pending buffers (called on app background). */
export async function flushSamples(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushDirty();
}

// Never lose the local buffer when the user leaves the app.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') void flushSamples();
});

/** Load the full sample buffer for a device. */
export async function loadSamples(deviceId: string): Promise<Sample[]> {
  if (memCache.has(deviceId)) return memCache.get(deviceId)!;
  try {
    const raw = await AsyncStorage.getItem(keyFor(deviceId));
    if (!raw) {
      memCache.set(deviceId, []);
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      memCache.set(deviceId, []);
      return [];
    }
    memCache.set(deviceId, parsed);
    return parsed;
  } catch {
    memCache.set(deviceId, []);
    return [];
  }
}

/**
 * Append (or coalesce) a sample into the per-device buffer. Returns the
 * updated buffer.
 */
export async function recordDeviceSample(
  deviceId: string,
  s: Omit<Sample, 't'> & { t?: number },
): Promise<Sample[]> {
  const buf = await loadSamples(deviceId);
  const t = s.t ?? Date.now();
  const last = buf[buf.length - 1];

  if (last && t - last.t < SAMPLE_MIN_GAP_MS) {
    // Coalesce into the latest sample — prefer non-null real values.
    last.t = t;
    if (s.count !== null) last.count = s.count;
    if (s.daily !== null) last.daily = s.daily;
    if (s.temperature !== null) last.temperature = s.temperature;
    if (s.humidity !== null) last.humidity = s.humidity;
    if (s.status !== null) last.status = s.status;
  } else {
    buf.push({
      t,
      count: s.count,
      daily: s.daily,
      temperature: s.temperature,
      humidity: s.humidity,
      status: s.status,
    });
  }

  // Trim oldest if over cap.
  while (buf.length > MAX_SAMPLES) buf.shift();

  memCache.set(deviceId, buf);
  // Debounced persistence — memCache is already current, so we avoid
  // re-serializing the whole buffer on every push (see schedulePersist).
  schedulePersist(deviceId);
  return buf;
}

/** Erase all samples for a device. */
export async function clearSamples(deviceId: string): Promise<void> {
  memCache.delete(deviceId);
  dirty.delete(deviceId);
  await AsyncStorage.removeItem(keyFor(deviceId));
}

// ── Range queries ────────────────────────────────────────────────────────

export function rangeBoundaries(spec: RangeSpec): { startMs: number; endMs: number } {
  const now = Date.now();
  switch (spec.preset) {
    case 'last_15m':  return { startMs: now - 15 * 60_000, endMs: now };
    case 'last_1h':   return { startMs: now - 60 * 60_000, endMs: now };
    case 'last_6h':   return { startMs: now - 6 * 60 * 60_000, endMs: now };
    case 'last_24h':  return { startMs: now - 24 * 60 * 60_000, endMs: now };
    case 'last_3d':   return { startMs: now - 3 * 24 * 60 * 60_000, endMs: now };
    case 'last_7d':   return { startMs: now - 7 * 24 * 60 * 60_000, endMs: now };
    case 'last_14d':  return { startMs: now - 14 * 24 * 60 * 60_000, endMs: now };
    case 'last_30d':  return { startMs: now - 30 * 24 * 60 * 60_000, endMs: now };
    case 'custom':
      return {
        startMs: spec.startMs ?? now - 24 * 60 * 60_000,
        endMs: spec.endMs ?? now,
      };
  }
}

/** Filter the in-memory buffer to samples within the requested range. */
export async function querySamples(
  deviceId: string,
  spec: RangeSpec,
): Promise<{ samples: Sample[]; startMs: number; endMs: number }> {
  const buf = await loadSamples(deviceId);
  const { startMs, endMs } = rangeBoundaries(spec);
  const samples = buf.filter((s) => s.t >= startMs && s.t <= endMs);
  return { samples, startMs, endMs };
}

// ── Bucketing for charts ────────────────────────────────────────────────

export type Bucket = {
  t: number;          // bucket center (epoch ms)
  count: number | null;
  daily: number | null;
  temperature: number | null;
  humidity: number | null;
  sampleN: number;    // how many raw samples fell in this bucket
};

/**
 * Down-sample a sample list into N evenly-spaced buckets between [startMs, endMs].
 * Within each bucket we report:
 *   - count       : MAX (cumulative counter is monotonic)
 *   - daily       : MEAN of non-null
 *   - temperature : MEAN of non-null
 *   - humidity    : MEAN of non-null
 * Returns one bucket per slot; bucket.sampleN === 0 means no data in that slot.
 */
export function bucketSamples(
  samples: Sample[],
  startMs: number,
  endMs: number,
  numBuckets: number,
): Bucket[] {
  const span = Math.max(1, endMs - startMs);
  const slot = span / numBuckets;
  const buckets: Bucket[] = [];
  for (let i = 0; i < numBuckets; i++) {
    buckets.push({
      t: startMs + slot * (i + 0.5),
      count: null,
      daily: null,
      temperature: null,
      humidity: null,
      sampleN: 0,
    });
  }
  // Bucket accumulators.
  const acc: Array<{
    countMax: number | null;
    dailySum: number; dailyN: number;
    tempSum: number; tempN: number;
    humSum: number; humN: number;
  }> = buckets.map(() => ({
    countMax: null, dailySum: 0, dailyN: 0,
    tempSum: 0, tempN: 0, humSum: 0, humN: 0,
  }));
  for (const s of samples) {
    let idx = Math.floor((s.t - startMs) / slot);
    if (idx < 0) idx = 0;
    if (idx >= numBuckets) idx = numBuckets - 1;
    const a = acc[idx];
    buckets[idx].sampleN++;
    if (s.count !== null && (a.countMax === null || s.count > a.countMax)) a.countMax = s.count;
    if (s.daily !== null) { a.dailySum += s.daily; a.dailyN++; }
    if (s.temperature !== null) { a.tempSum += s.temperature; a.tempN++; }
    if (s.humidity !== null) { a.humSum += s.humidity; a.humN++; }
  }
  for (let i = 0; i < numBuckets; i++) {
    const a = acc[i];
    buckets[i].count = a.countMax;
    buckets[i].daily = a.dailyN > 0 ? a.dailySum / a.dailyN : null;
    buckets[i].temperature = a.tempN > 0 ? a.tempSum / a.tempN : null;
    buckets[i].humidity = a.humN > 0 ? a.humSum / a.humN : null;
  }
  return buckets;
}

/** Pretty-print a range preset for the UI. */
export function rangeLabel(spec: RangeSpec): string {
  switch (spec.preset) {
    case 'last_15m': return 'Last 15 minutes';
    case 'last_1h':  return 'Last hour';
    case 'last_6h':  return 'Last 6 hours';
    case 'last_24h': return 'Last 24 hours';
    case 'last_3d':  return 'Last 3 days';
    case 'last_7d':  return 'Last 7 days';
    case 'last_14d': return 'Last 14 days';
    case 'last_30d': return 'Last 30 days';
    case 'custom': {
      const s = spec.startMs ? new Date(spec.startMs) : null;
      const e = spec.endMs ? new Date(spec.endMs) : null;
      if (!s || !e) return 'Custom range';
      const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
      return `${fmt(s)} → ${fmt(e)}`;
    }
  }
}

/** Group N daily-resolution samples (for the 7-day count history used by risk scoring). */
export function dailyCountHistory(samples: Sample[], days: number): number[] {
  const now = Date.now();
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = now - (i + 1) * 24 * 60 * 60_000;
    const dayEnd = now - i * 24 * 60 * 60_000;
    let max: number | null = null;
    for (const s of samples) {
      if (s.t < dayStart || s.t >= dayEnd) continue;
      if (s.daily === null) continue;
      if (max === null || s.daily > max) max = s.daily;
    }
    out.push(max ?? 0);
  }
  return out;
}
