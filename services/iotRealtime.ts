import { initializeApp, getApps } from 'firebase/app';
import { DESIGN_MODE } from '@/constants/designMode';
import {
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from '@/services/firebase';
import { discoverPi, getPiApiBase, getCachedPiHost } from '@/services/piDiscovery';
import { Platform } from 'react-native';

export type DeviceState = {
  source?: 'cloud' | 'local';
  totalCount: number;
  status: string;
  lastSeen: Date | null;
  dailyCount?: number;
  lastConfidence?: number;
  inferenceMs?: number;
  lastDetection?: Date | null;
  temperature?: number | null;
  humidity?: number | null;
  visibleCount?: number;
  batteryPercent?: number | null;
  batteryVoltage?: number | null;
  powerSource?: string | null;
  signalStrength?: number | null;
  trapCapacity?: number | null;
  trapFullnessPercent?: number | null;
  countSinceService?: number | null;
  teamId?: string | null;
  farmName?: string | null;
  farmZone?: string | null;
};

export type CommandResult = {
  sentAt: Date;
};

// ── Pi Direct Connection Config ──────────────────────────
// When Firebase is not configured, poll the Pi's local HTTP API instead.
// Pi is auto-discovered on the network via piDiscovery.ts
const PI_DISCONNECTED = false;
const PI_API_PORT = 8080;
const PI_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

function ensureFirebase() {
  if (!hasFirebaseConfig()) {
    return null;
  }

  if (!getApps().length) {
    initializeApp(firebaseConfig);
  }

  return getFirestore();
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

/**
 * Poll the Pi's local HTTP API for device state.
 * Auto-discovers the Pi on the network if not already found.
 */
function listenDeviceStateDirect(
  deviceId: string,
  onChange: (state: DeviceState) => void,
): () => void {
  let active = true;
  let errorCount = 0;
  let discoveryDone = false;

  async function poll() {
    // Auto-discover Pi first
    if (!getCachedPiHost()) {
      onChange({
        source: 'local',
        totalCount: 0,
        status: 'Searching for Pi on network...',
        lastSeen: null,
      });
      const host = await discoverPi();
      discoveryDone = true;
      if (!host) {
        onChange({
          source: 'local',
          totalCount: 0,
          status: 'Pi not found — check WiFi & power',
          lastSeen: null,
        });
        // Retry discovery after 5s
        await new Promise<void>((r) => { setTimeout(r, 5000); });
      }
    }

    while (active) {
      const baseUrl = getPiApiBase();
      if (!baseUrl) {
        // Re-discover
        onChange({
          source: 'local',
          totalCount: 0,
          status: 'Reconnecting to Pi...',
          lastSeen: null,
        });
        await discoverPi();
        await new Promise<void>((r) => { setTimeout(r, 3000); });
        continue;
      }

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${baseUrl}/state`, { signal: ctrl.signal });
        clearTimeout(timer);
        const data = await res.json();
        errorCount = 0;

        onChange({
          source: 'local',
          totalCount: Number(data.totalCount ?? 0),
          status: String(data.status ?? 'offline'),
          lastSeen: data.lastSeen ? new Date(data.lastSeen) : null,
          dailyCount: Number(data.dailyCount ?? 0),
          lastConfidence: Number(data.lastConfidence ?? 0),
          inferenceMs: Number(data.inferenceMs ?? 0),
          lastDetection: data.lastDetection ? new Date(data.lastDetection) : null,
          temperature: toOptionalNumber(data.temperature),
          humidity: toOptionalNumber(data.humidity),
          visibleCount: Number(data.visibleCount ?? 0),
          batteryPercent: toOptionalNumber(data.batteryPercent ?? data.batteryLevel),
          batteryVoltage: toOptionalNumber(data.batteryVoltage),
          powerSource: data.powerSource ? String(data.powerSource) : null,
          signalStrength: toOptionalNumber(data.signalStrength),
          trapCapacity: toOptionalNumber(data.trapCapacity),
          trapFullnessPercent: toOptionalNumber(data.trapFullnessPercent),
          countSinceService: toOptionalNumber(data.countSinceService),
          teamId: data.teamId ? String(data.teamId) : null,
          farmName: data.farmName ? String(data.farmName) : null,
          farmZone: data.farmZone ? String(data.farmZone) : null,
        });
      } catch {
        errorCount++;
        if (errorCount <= 3) {
          onChange({
            source: 'local',
            totalCount: 0,
            status: `reconnecting to Pi (${getCachedPiHost()})...`,
            lastSeen: null,
          });
        } else {
          // Lost connection — force re-discovery
          onChange({
            source: 'local',
            totalCount: 0,
            status: 'Pi lost — re-scanning network...',
            lastSeen: null,
          });
          await discoverPi();
          errorCount = 0;
        }
      }

      await new Promise<void>((r) => { setTimeout(r, PI_POLL_INTERVAL_MS); });
    }
  }

  poll();
  return () => { active = false; };
}

export function listenDeviceState(
  deviceId: string,
  onChange: (state: DeviceState) => void,
): () => void {
  if (DESIGN_MODE) {
    onChange({
      source: 'cloud', totalCount: 128, status: 'online', lastSeen: new Date(),
      dailyCount: 6, lastConfidence: 0.94, inferenceMs: 210,
      lastDetection: new Date(Date.now() - 12 * 60_000),
      temperature: 31.2, humidity: 78, visibleCount: 2,
      batteryPercent: 82, batteryVoltage: 7.9, powerSource: 'solar',
      signalStrength: -71, trapCapacity: 300, trapFullnessPercent: 43,
      countSinceService: 128, farmName: 'Sto. Tomas Ampalaya Farm', farmZone: 'North plot',
    });
    return () => {};
  }
  const db = ensureFirebase();

  // If Firebase is not configured, use direct Pi connection
  if (!db) {
    // If Pi is disconnected (standalone mode), return static offline state
    if (PI_DISCONNECTED) {
      onChange({
        source: 'local',
        totalCount: 0,
        status: 'disconnected (Pi standalone mode)',
        lastSeen: null,
        dailyCount: 0,
      });
      return () => {};  // no-op cleanup
    }
    return listenDeviceStateDirect(deviceId, onChange);
  }

  const ref = doc(db, 'devices', deviceId);
  let directCleanup: (() => void) | null = null;
  let receivedCloudSnapshot = false;
  const fallbackTimer = setTimeout(() => {
    if (!receivedCloudSnapshot && !directCleanup) {
      directCleanup = listenDeviceStateDirect(deviceId, onChange);
    }
  }, 4000);

  const unsubscribe = onSnapshot(
    ref,
    (snapshot) => {
      const data = snapshot.data() ?? {};
      const hasUsefulCloudData = snapshot.exists() && Object.keys(data).length > 0;
      if (!hasUsefulCloudData && !directCleanup) {
        return;
      }

      receivedCloudSnapshot = true;
      clearTimeout(fallbackTimer);
      if (directCleanup) {
        directCleanup();
        directCleanup = null;
      }

      const lastSeenRaw = data.lastSeen;
      let lastSeen: Date | null = null;
      if (lastSeenRaw instanceof Timestamp) {
        lastSeen = lastSeenRaw.toDate();
      } else if (lastSeenRaw instanceof Date) {
        lastSeen = lastSeenRaw;
      }

      onChange({
        source: 'cloud',
        totalCount: Number(data.totalCount ?? 0),
        status: String(data.status ?? 'offline'),
        lastSeen,
        dailyCount: Number(data.dailyCount ?? 0),
        lastConfidence: Number(data.lastConfidence ?? 0),
        inferenceMs: Number(data.inferenceMs ?? 0),
        temperature: toOptionalNumber(data.temperature),
        humidity: toOptionalNumber(data.humidity),
        visibleCount: Number(data.visibleCount ?? 0),
        batteryPercent: toOptionalNumber(data.batteryPercent ?? data.batteryLevel),
        batteryVoltage: toOptionalNumber(data.batteryVoltage),
        powerSource: data.powerSource ? String(data.powerSource) : null,
        signalStrength: toOptionalNumber(data.signalStrength),
        trapCapacity: toOptionalNumber(data.trapCapacity),
        trapFullnessPercent: toOptionalNumber(data.trapFullnessPercent),
        countSinceService: toOptionalNumber(data.countSinceService),
        teamId: data.teamId ? String(data.teamId) : null,
        farmName: data.farmName ? String(data.farmName) : null,
        farmZone: data.farmZone ? String(data.farmZone) : null,
      });
    },
    (error) => {
      clearTimeout(fallbackTimer);
      console.warn('Firestore listener unavailable, falling back to direct Pi mode.', error);
      if (!directCleanup) {
        directCleanup = listenDeviceStateDirect(deviceId, onChange);
      }
    },
  );

  return () => {
    clearTimeout(fallbackTimer);
    unsubscribe();
    if (directCleanup) {
      directCleanup();
    }
  };
}

export async function sendIoTCommand(
  deviceId: string,
  farmId: string,
  command:
    | 'start_detection'
    | 'stop_detection'
    | 'capture_snapshot'
    | 'reset_daily_count'
    | 'mark_serviced',
): Promise<CommandResult> {
  const db = ensureFirebase();
  if (!db) {
    // Direct mode: commands not yet supported without Firebase
    console.warn('Direct Pi mode: commands sent via Firebase are not available.');
    console.warn('The Pi is running autonomously with --api flag.');
    return { sentAt: new Date() };
  }

  const commandRef = doc(db, 'deviceCommands', deviceId);
  const sentAt = new Date();

  await setDoc(
    commandRef,
    {
      command,
      source: 'expo-app',
      createdAt: serverTimestamp(),
      targetDeviceId: deviceId,
      farmId,
      ack: false,
      ackAt: null,
    },
    { merge: true },
  );

  return { sentAt };
}
