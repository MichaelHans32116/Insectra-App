/**
 * samplesCloud.ts — Cloud mirror of the per-device sample buffer.
 *
 * The local AsyncStorage buffer (samplesStore.ts) is fast and offline-friendly,
 * but it is single-device: a farmer who installs the app on a new phone, or an
 * agronomist reviewing a farm remotely, would see an empty history. This module
 * mirrors a *down-sampled* slice of every push into Firestore so the data
 * survives device wipes, app reinstalls, and is queryable from any client that
 * is a member of the farm.
 *
 * Storage layout (Firestore):
 *   farms/{farmId}/devices/{deviceId}/samples/{epochMs}
 *     { t, count, daily, temperature, humidity, status }
 *
 * Bandwidth strategy:
 *   - We rate-limit cloud writes to MIN_CLOUD_GAP_MS (default 5 minutes).
 *     The Pi pushes every ~2 s, but for analytics the 5-minute resolution
 *     is more than enough — and it keeps us comfortably inside Firestore's
 *     free tier even with hundreds of farms.
 *   - Writes are fire-and-forget: a network error must NEVER block the UI
 *     or the local buffer.
 *
 * Backfill / recovery:
 *   - `loadCloudSamples(farmId, deviceId, sinceMs)` returns persisted samples
 *     for the analytics screen to merge into the local buffer when the user
 *     first opens it on a new device.
 */
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from './firebase';
import type { Sample } from './samplesStore';

let cachedDb: Firestore | null = null;
function db(): Firestore {
  if (cachedDb) return cachedDb;
  if (!hasFirebaseConfig()) throw new Error('Firebase configuration missing.');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

const MIN_CLOUD_GAP_MS = 5 * 60_000; // 5 min
const lastCloudWriteAt = new Map<string, number>(); // key = `${farmId}/${deviceId}`

// ── Backfill throttle ──────────────────────────────────────────────────────
// The analytics backfill (`loadCloudSamples`, up to 2000 uncached docs) must not
// run on every screen open — that was the dominant free-tier read cost. We run it
// at most once per (farm, device) per BACKFILL_TTL_MS of app-session runtime.
const BACKFILL_TTL_MS = 6 * 60 * 60_000; // 6 h
const backfilledAt = new Map<string, number>(); // key = `${farmId}/${deviceId}`

/** True if a cloud history backfill for this device is worth doing now. */
export function shouldBackfill(farmId: string, deviceId: string, now = Date.now()): boolean {
  if (!farmId || !deviceId) return false;
  const last = backfilledAt.get(`${farmId}/${deviceId}`) ?? 0;
  return now - last >= BACKFILL_TTL_MS;
}

/** Record that a backfill just ran, to suppress repeat reads on later opens. */
export function markBackfilled(farmId: string, deviceId: string, now = Date.now()): void {
  if (!farmId || !deviceId) return;
  backfilledAt.set(`${farmId}/${deviceId}`, now);
}

/**
 * Mirror a single sample to Firestore, throttled to MIN_CLOUD_GAP_MS per
 * (farm, device). Always returns immediately — errors are swallowed so the
 * UI is never blocked by network conditions.
 */
export function mirrorSampleToCloud(
  farmId: string,
  deviceId: string,
  sample: Sample,
): void {
  if (!farmId || !deviceId) return;
  const key = `${farmId}/${deviceId}`;
  const last = lastCloudWriteAt.get(key) ?? 0;
  if (sample.t - last < MIN_CLOUD_GAP_MS) return;
  lastCloudWriteAt.set(key, sample.t);

  // Skip writes that have NO useful data (status-only heartbeats are noise).
  if (
    sample.count === null &&
    sample.daily === null &&
    sample.temperature === null &&
    sample.humidity === null
  ) {
    return;
  }

  const ref = doc(
    db(),
    'farms', farmId,
    'devices', deviceId,
    'samples', String(sample.t),
  );
  // Strip undefined → Firestore rejects them.
  const payload = {
    t: sample.t,
    count: sample.count,
    daily: sample.daily,
    temperature: sample.temperature,
    humidity: sample.humidity,
    status: sample.status,
  };
  setDoc(ref, payload).catch(() => {
    // Roll back the throttle stamp so we retry on the next push.
    lastCloudWriteAt.delete(key);
  });
}

/**
 * Backfill from cloud — used on first open of analytics on a new client.
 * Returns samples newer than `sinceMs`, oldest first, capped at `max`.
 */
export async function loadCloudSamples(
  farmId: string,
  deviceId: string,
  sinceMs: number,
  max = 2000,
): Promise<Sample[]> {
  if (!farmId || !deviceId) return [];
  try {
    const col = collection(db(), 'farms', farmId, 'devices', deviceId, 'samples');
    const q = query(
      col,
      where('t', '>=', sinceMs),
      orderBy('t', 'asc'),
      fsLimit(max),
    );
    const snap = await getDocs(q);
    const out: Sample[] = [];
    snap.forEach((d) => {
      const data = d.data() as Partial<Sample>;
      if (typeof data.t === 'number') {
        out.push({
          t: data.t,
          count: data.count ?? null,
          daily: data.daily ?? null,
          temperature: data.temperature ?? null,
          humidity: data.humidity ?? null,
          status: data.status ?? null,
        });
      }
    });
    return out;
  } catch {
    return [];
  }
}
