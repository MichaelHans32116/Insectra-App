/**
 * alerts.ts — In-app alerts feed.
 *
 * A lightweight, persistent notification queue stored in AsyncStorage. The
 * dashboard's bell icon reads from here, the analytics screen and the dashboard
 * write into it whenever the v2 risk algo crosses HIGH or an anomaly fires.
 *
 * Why local-first?
 *   We can't ship Expo Push without an EAS Project ID and APNs/FCM credentials,
 *   which is out of scope for this iteration. A persistent local feed already
 *   satisfies "farmer should be told when something is wrong" because the app
 *   re-reads it on every cold start and surfaces unread counts. Future work:
 *   Cloud Function that mirrors HIGH alerts to FCM topic `farm_${farmId}`.
 *
 * De-duplication:
 *   Each alert has a `dedupeKey` (e.g. `outbreak.HIGH.deviceId`). If an alert
 *   with the same key already exists within `DEDUPE_WINDOW_MS`, we drop the
 *   new one — keeps the bell from spamming when the same condition persists.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AlertSeverity = 'info' | 'watch' | 'critical';

export interface AppAlert {
  id: string;
  t: number;                  // epoch ms
  severity: AlertSeverity;
  title: string;
  body: string;
  deviceId?: string;
  route?: string;
  read: boolean;
  dedupeKey?: string;
}

const KEY = 'insectra.alerts.v1';
const MAX_ALERTS = 200;
const DEDUPE_WINDOW_MS = 4 * 60 * 60_000; // 4h

let cache: AppAlert[] | null = null;
const subscribers = new Set<(alerts: AppAlert[]) => void>();

async function load(): Promise<AppAlert[]> {
  if (cache !== null) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as AppAlert[]) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function notify(): void {
  if (cache === null) return;
  const snapshot = [...cache];
  for (const fn of subscribers) {
    try { fn(snapshot); } catch { /* ignore */ }
  }
}

async function persist(): Promise<void> {
  if (cache === null) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage full / web private mode → ignore.
  }
}

export async function listAlerts(): Promise<AppAlert[]> {
  return [...(await load())].sort((a, b) => b.t - a.t);
}

export function subscribeAlerts(fn: (alerts: AppAlert[]) => void): () => void {
  subscribers.add(fn);
  load().then((arr) => fn([...arr].sort((a, b) => b.t - a.t)));
  return () => { subscribers.delete(fn); };
}

export async function pushAlert(input: Omit<AppAlert, 'id' | 't' | 'read'> & { t?: number }): Promise<void> {
  const arr = await load();
  const t = input.t ?? Date.now();
  if (input.dedupeKey) {
    const recent = arr.find(
      (a) => a.dedupeKey === input.dedupeKey && t - a.t < DEDUPE_WINDOW_MS,
    );
    if (recent) return;
  }
  const alert: AppAlert = {
    id: `${t}-${Math.random().toString(36).slice(2, 8)}`,
    t,
    read: false,
    severity: input.severity,
    title: input.title,
    body: input.body,
    deviceId: input.deviceId,
    route: input.route,
    dedupeKey: input.dedupeKey,
  };
  arr.push(alert);
  while (arr.length > MAX_ALERTS) arr.shift();
  cache = arr;
  await persist();
  notify();
}

export async function markRead(id: string): Promise<void> {
  const arr = await load();
  const a = arr.find((x) => x.id === id);
  if (a && !a.read) {
    a.read = true;
    await persist();
    notify();
  }
}

export async function markAllRead(): Promise<void> {
  const arr = await load();
  let changed = false;
  for (const a of arr) {
    if (!a.read) { a.read = true; changed = true; }
  }
  if (changed) {
    await persist();
    notify();
  }
}

export async function clearAlerts(): Promise<void> {
  cache = [];
  await AsyncStorage.removeItem(KEY);
  notify();
}

export async function unreadCount(): Promise<number> {
  const arr = await load();
  return arr.filter((a) => !a.read).length;
}
