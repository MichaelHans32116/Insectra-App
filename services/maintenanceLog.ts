import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_KEY = 'insectra.maintenance.log.v1';
const MAX_ENTRIES = 50;

export type MaintenanceKind =
  | 'lure_replacement'
  | 'battery_check'
  | 'trap_service'
  | 'general';

export type MaintenanceEntry = {
  id: string;
  kind: MaintenanceKind;
  note: string;
  performedAt: string; // ISO
};

export async function loadMaintenanceLog(): Promise<MaintenanceEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function addMaintenanceEntry(
  kind: MaintenanceKind,
  note: string,
): Promise<MaintenanceEntry[]> {
  const log = await loadMaintenanceLog();
  const entry: MaintenanceEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    note: note.trim() || describeKind(kind),
    performedAt: new Date().toISOString(),
  };
  const next = [...log, entry].slice(-MAX_ENTRIES);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(next));
  return next;
}

export async function clearMaintenanceLog(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
}

export function describeKind(kind: MaintenanceKind): string {
  switch (kind) {
    case 'lure_replacement': return 'Cue-Lure replaced';
    case 'battery_check': return 'Battery checked';
    case 'trap_service': return 'Trap serviced and reset';
    default: return 'General maintenance';
  }
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const ms = Date.now() - then;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function lastEntryOf(
  log: MaintenanceEntry[],
  kind: MaintenanceKind,
): MaintenanceEntry | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i].kind === kind) return log[i];
  }
  return null;
}
