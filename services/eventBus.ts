/**
 * InsecTra event bus + lightweight toast notifications.
 *
 * Why a custom toast service?
 *   - On `react-native-web`, `Alert.alert()` is silent (RN limitation).
 *   - We want a single, consistent in-app feedback surface that matches
 *     the InsecTra color palette and can be tinted by event kind
 *     (success / info / warn / error).
 *
 * Public API:
 *   - `emit(event)`   — fire an app-wide event (any subscriber receives it)
 *   - `subscribe(cb)` — listen to all events (used by ToastHost + audit)
 *   - `toast.ok(msg)` / `.info(msg)` / `.warn(msg)` / `.err(msg)` — sugar
 *   - `recentEvents()` — the last N events (used by an audit drawer if needed)
 *
 * Events are NOT persisted — they live in memory and exist for the duration
 * of the app session. (For permanent audit, write to /alerts in Firestore.)
 */

export type AppEventKind = 'ok' | 'info' | 'warn' | 'err';

export type AppEventCategory =
  | 'spray'
  | 'community'
  | 'camera'
  | 'capture'
  | 'liveCamera'
  | 'profile'
  | 'auth'
  | 'device'
  | 'system';

export interface AppEvent {
  id: string;
  kind: AppEventKind;
  category: AppEventCategory;
  title: string;
  detail?: string;
  /** Milliseconds the toast should remain visible; 0 = sticky (user dismiss) */
  durationMs?: number;
  at: number; // epoch ms
}

type Subscriber = (e: AppEvent) => void;

const subs = new Set<Subscriber>();
const recent: AppEvent[] = [];
const RECENT_MAX = 50;
let nextId = 1;

function makeId(): string {
  // Deterministic enough for de-dupe inside ToastHost; not security-critical.
  nextId += 1;
  return `${Date.now().toString(36)}-${nextId.toString(36)}`;
}

export function emit(input: Omit<AppEvent, 'id' | 'at'>): AppEvent {
  const event: AppEvent = {
    id: makeId(),
    at: Date.now(),
    durationMs: input.durationMs ?? 3500,
    ...input,
  };
  recent.push(event);
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  for (const cb of subs) {
    try {
      cb(event);
    } catch {
      /* a misbehaving subscriber should not break the bus */
    }
  }
  return event;
}

export function subscribe(cb: Subscriber): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function recentEvents(): readonly AppEvent[] {
  return recent.slice();
}

/**
 * Convenience helpers — most callers only need these three lines:
 *   import { toast } from '@/services/eventBus';
 *   toast.ok('community', 'Comment posted');
 */
export const toast = {
  ok(category: AppEventCategory, title: string, detail?: string) {
    return emit({ kind: 'ok', category, title, detail });
  },
  info(category: AppEventCategory, title: string, detail?: string) {
    return emit({ kind: 'info', category, title, detail });
  },
  warn(category: AppEventCategory, title: string, detail?: string) {
    return emit({ kind: 'warn', category, title, detail, durationMs: 5000 });
  },
  err(category: AppEventCategory, title: string, detail?: string) {
    return emit({ kind: 'err', category, title, detail, durationMs: 6000 });
  },
};
