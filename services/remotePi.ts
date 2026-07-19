/**
 * services/remotePi.ts
 * --------------------
 * Listens to Firestore `devices/{deviceId}` documents and pushes the
 * `publicApiUrl` field into piDiscovery so that the Pi camera & capture
 * endpoints work even when the user is OFF the LAN (e.g. on mobile data
 * or in another country).
 *
 * The Pi-side workflow is:
 *   1. Run cloudflared:  cloudflared tunnel --url http://localhost:8080
 *   2. Publish the current URL into the matching cloud device document
 *      for the registered Pi (or override it in the in-app Remote Access screen).
 *
 * The Owner can also write the URL via the in-app Remote Access screen
 * (`app/remote-access.tsx`).
 *
 * Read access is open to anyone in the farm group; write access is
 * Owner-only (enforced by Firestore rules).
 */
import { DESIGN_MODE } from '@/constants/designMode';
import { doc, onSnapshot, setDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { firebaseConfig, hasFirebaseConfig } from '@/services/firebase';
import { setRemotePiBase, getRemotePiBase } from '@/services/piDiscovery';

let _unsub: (() => void) | null = null;
let _attached = false;
let _attachedDeviceId: string | null = null;

function ensureFirestore() {
  if (!hasFirebaseConfig()) return null;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

/**
 * Start listening to devices/{id}.publicApiUrl and update the in-memory
 * remote base whenever it changes. Safe to call multiple times — only
 * the current target device stays attached.
 */
export function attachRemotePiListener(deviceId: string | null | undefined) {
  if (DESIGN_MODE) return ;
  const normalizedDeviceId = (deviceId ?? '').trim() || null;
  if (!normalizedDeviceId) {
    detachRemotePiListener();
    return;
  }

  if (_attached && _attachedDeviceId === normalizedDeviceId) return;

  if (_unsub) {
    _unsub();
    _unsub = null;
  }

  const db = ensureFirestore();
  if (!db) {
    _attached = false;
    _attachedDeviceId = null;
    return;
  }

  _attached = true;
  _attachedDeviceId = normalizedDeviceId;
  _unsub = onSnapshot(
    doc(db, 'devices', normalizedDeviceId),
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const url = (data?.publicApiUrl as string | undefined) ?? null;
      setRemotePiBase(url);
    },
    () => {
      // ignore errors silently — LAN path still works
    },
  );
}

export function detachRemotePiListener() {
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
  _attached = false;
  _attachedDeviceId = null;
  setRemotePiBase(null);
}

/**
 * Write a new public URL to Firestore. Owner-only (rules enforce this).
 * Pass empty string / null to clear.
 */
export async function savePublicApiUrl(url: string | null, deviceId: string) {
  const db = ensureFirestore();
  if (!db) throw new Error('Firebase not configured');
  const ref = doc(db, 'devices', deviceId);
  const trimmed = (url ?? '').trim();
  await setDoc(
    ref,
    {
      publicApiUrl: trimmed || null,
      publicApiUrlUpdatedAt: new Date(),
    },
    { merge: true },
  );
  // Update local cache immediately so this client benefits without waiting
  // for the snapshot round-trip.
  setRemotePiBase(trimmed || null);
}

export function getCurrentPublicApiUrl(): string | null {
  return getRemotePiBase();
}

export function subscribePublicApiUrl(
  deviceId: string | null | undefined,
  onChange: (url: string | null) => void,
) {
  const normalizedDeviceId = (deviceId ?? '').trim() || null;
  if (!normalizedDeviceId) {
    onChange(null);
    return () => {};
  }

  const db = ensureFirestore();
  if (!db) {
    onChange(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, 'devices', normalizedDeviceId),
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const url = (data?.publicApiUrl as string | undefined) ?? null;
      onChange(url);
    },
    () => {
      onChange(null);
    },
  );
}
