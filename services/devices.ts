/**
 * Devices service — register and list IoT trap devices per farm/group.
 *
 * RULES:
 *  - Only Pi codes in `ALLOWED_PI_CODES` may be registered. This prevents
 *    hallucinated/duplicate device IDs (e.g. "DATSYS-style" failure mode).
 *  - The same Pi code cannot be registered twice within the same farm.
 *  - A Pi can be attached to multiple farms only when those farms have the
 *    same owner. A different owner cannot claim an already-owned Pi.
 *  - Telemetry fields default to NULL (no fake data); the dashboard treats
 *    null as "Awaiting sensor reading".
 *
 * Schema:
 *   /farms/{farmId}/devices/{deviceId}
 *     { piCode, cloudDeviceId, name, ownerUid, latitude, longitude, locationLabel,
 *       cropType, modules: { solarBattery, dataModule, attractantLightWarmYellow,
 *                            interiorLightWhite }, liveDetectOn, registeredAt }
 *
 * The deviceId in this subcollection equals the piCode for uniqueness within the farm.
 */
import { initializeApp, getApp, getApps } from 'firebase/app';
import { DESIGN_MODE } from '@/constants/designMode';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from './firebase';

let cachedDb: Firestore | null = null;
function db(): Firestore {
  if (cachedDb) return cachedDb;
  if (!hasFirebaseConfig()) throw new Error('Firebase configuration missing.');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

/** Hard-coded allow-list of physical Pi devices we control.
 *
 *  ⚠️ DO NOT GUESS / GENERATE. These must match real hardware that has
 *  been provisioned and is running the InsecTra Pi service. */
export const ALLOWED_PI_CODES = ['INSECTRA-PI-001'] as const;
export type AllowedPiCode = typeof ALLOWED_PI_CODES[number];

export function isAllowedPiCode(code: string): code is AllowedPiCode {
  return (ALLOWED_PI_CODES as readonly string[]).includes(code.trim().toUpperCase());
}

export function cloudDocIdForPiCode(piCode: string): string {
  const normalized = piCode.trim().toUpperCase();
  if (normalized === 'INSECTRA-PI-001') return 'trap-001';
  return normalized.toLowerCase();
}

export interface DeviceModules {
  solarBattery: boolean;
  dataModule: boolean;
  attractantLightWarmYellow: boolean;
  interiorLightWhite: boolean;
}

export interface RegisteredDevice {
  id: string;             // === piCode
  piCode: string;
  name: string;
  ownerUid: string;
  farmId: string;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string;
  cropType: string;
  modules: DeviceModules;
  liveDetectOn: boolean;
  registeredAt: string;
}

const DEFAULT_MODULES: DeviceModules = {
  solarBattery: true,           // recommended baseline
  dataModule: true,             // baseline
  attractantLightWarmYellow: true,
  interiorLightWhite: true,
};

export interface RegisterDeviceInput {
  farmId: string;
  piCode: string;
  name: string;
  ownerUid: string;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string;
  cropType: string;
  modules?: Partial<DeviceModules>;
}

export async function ensureCloudDeviceBinding(input: {
  farmId: string;
  piCode: string;
  ownerUid: string;
  name?: string;
}): Promise<string> {
  const piCode = input.piCode.trim().toUpperCase();
  const cloudDeviceId = cloudDocIdForPiCode(piCode);
  const database = db();
  const ref = doc(database, 'devices', cloudDeviceId);
  const existing = await getDoc(ref);
  const existingData = existing.exists() ? existing.data() as any : null;

  if (existingData?.ownerUid && existingData.ownerUid !== input.ownerUid) {
    throw new Error(`This Pi (${piCode}) is already registered to another farm owner.`);
  }
  if (existingData?.piCode && existingData.piCode !== piCode) {
    throw new Error(`This cloud device id is already bound to ${existingData.piCode}.`);
  }

  await setDoc(
    ref,
    {
      deviceId: cloudDeviceId,
      piCode,
      farmId: existingData?.farmId || input.farmId,
      farmIds: arrayUnion(input.farmId),
      lastRegisteredFarmId: input.farmId,
      ownerUid: input.ownerUid,
      name: input.name?.trim() || piCode,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return cloudDeviceId;
}

export async function registerDevice(input: RegisterDeviceInput): Promise<RegisteredDevice> {
  const piCode = input.piCode.trim().toUpperCase();
  if (!isAllowedPiCode(piCode)) {
    throw new Error(
      `Pi code "${piCode}" is not recognized. Allowed devices: ${ALLOWED_PI_CODES.join(', ')}.`,
    );
  }
  if (!input.farmId) throw new Error('Pick a farm/group before registering a device.');
  if (!input.name.trim()) throw new Error('Device name is required.');

  const database = db();
  const farmRef = doc(database, 'farms', input.farmId);
  const ref = doc(database, 'farms', input.farmId, 'devices', piCode);
  const cloudDeviceId = cloudDocIdForPiCode(piCode);
  const cloudRef = doc(database, 'devices', cloudDeviceId);
  const [farmSnap, existingFarmDevice, existingCloudDevice] = await Promise.all([
    getDoc(farmRef),
    getDoc(ref),
    getDoc(cloudRef),
  ]);

  if (!farmSnap.exists()) throw new Error('Selected farm/group was not found.');
  const farmData = farmSnap.data() as any;
  if (farmData.ownerUid !== input.ownerUid) {
    throw new Error('Only the owner of this farm can register an InsecTra IoT device.');
  }
  if (existingFarmDevice.exists()) {
    throw new Error(`This Pi (${piCode}) is already registered in this farm.`);
  }

  const existingCloud = existingCloudDevice.exists() ? existingCloudDevice.data() as any : null;
  if (existingCloud?.ownerUid && existingCloud.ownerUid !== input.ownerUid) {
    throw new Error(`This Pi (${piCode}) is already registered to another farm owner.`);
  }
  if (existingCloud?.piCode && existingCloud.piCode !== piCode) {
    throw new Error(`This cloud device id is already bound to ${existingCloud.piCode}.`);
  }

  const modules: DeviceModules = { ...DEFAULT_MODULES, ...(input.modules ?? {}) };
  const data = {
    piCode,
    cloudDeviceId,
    name: input.name.trim(),
    ownerUid: input.ownerUid,
    farmId: input.farmId,
    latitude: input.latitude,
    longitude: input.longitude,
    locationLabel: input.locationLabel.trim(),
    cropType: input.cropType.trim() || 'Bitter gourd (Ampalaya)',
    modules,
    liveDetectOn: false,
    registeredAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  };

  const batch = writeBatch(database);
  batch.set(ref, data);
  batch.set(
    cloudRef,
    {
      deviceId: cloudDeviceId,
      piCode,
      farmId: existingCloud?.farmId || input.farmId,
      farmIds: arrayUnion(input.farmId),
      lastRegisteredFarmId: input.farmId,
      ownerUid: input.ownerUid,
      name: data.name,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  await batch.commit();

  return {
    id: piCode,
    piCode,
    name: data.name,
    ownerUid: data.ownerUid,
    farmId: data.farmId,
    latitude: data.latitude,
    longitude: data.longitude,
    locationLabel: data.locationLabel,
    cropType: data.cropType,
    modules,
    liveDetectOn: false,
    registeredAt: data.registeredAt,
  };
}

export async function listDevicesForFarm(farmId: string): Promise<RegisteredDevice[]> {
  if (DESIGN_MODE) {
    const mk = (n: number, name: string, label: string, live: boolean): RegisteredDevice => ({
      id: `INSECTRA-0${n}`, piCode: `INSECTRA-0${n}`, name, ownerUid: 'design-user', farmId,
      latitude: 14.0865 + n * 0.002, longitude: 121.1453 + n * 0.002, locationLabel: label,
      cropType: 'Ampalaya (bitter gourd)',
      modules: { solarBattery: true, dataModule: true, attractantLightWarmYellow: true, interiorLightWhite: true },
      liveDetectOn: live, registeredAt: new Date().toISOString(),
    });
    return [mk(1, 'Trap 1 - North Plot', 'North plot, near the trellis', true),
            mk(2, 'Trap 2 - Creek Side', 'South-east corner by the creek', false)];
  }
  const snap = await getDocs(collection(db(), 'farms', farmId, 'devices'));
  return snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      piCode: x.piCode ?? d.id,
      name: x.name ?? d.id,
      ownerUid: x.ownerUid,
      farmId: x.farmId ?? farmId,
      latitude: x.latitude ?? null,
      longitude: x.longitude ?? null,
      locationLabel: x.locationLabel ?? '',
      cropType: x.cropType ?? '',
      modules: { ...DEFAULT_MODULES, ...(x.modules ?? {}) },
      liveDetectOn: !!x.liveDetectOn,
      registeredAt: x.registeredAt ?? '',
    };
  });
}

export async function getDevice(farmId: string, deviceId: string): Promise<RegisteredDevice | null> {
  const snap = await getDoc(doc(db(), 'farms', farmId, 'devices', deviceId));
  if (!snap.exists()) return null;
  const x = snap.data() as any;
  return {
    id: snap.id,
    piCode: x.piCode ?? snap.id,
    name: x.name ?? snap.id,
    ownerUid: x.ownerUid,
    farmId,
    latitude: x.latitude ?? null,
    longitude: x.longitude ?? null,
    locationLabel: x.locationLabel ?? '',
    cropType: x.cropType ?? '',
    modules: { ...DEFAULT_MODULES, ...(x.modules ?? {}) },
    liveDetectOn: !!x.liveDetectOn,
    registeredAt: x.registeredAt ?? '',
  };
}

export async function setLiveDetect(
  farmId: string,
  deviceId: string,
  on: boolean,
): Promise<void> {
  await updateDoc(doc(db(), 'farms', farmId, 'devices', deviceId), { liveDetectOn: on });
}

export async function updateDeviceModules(
  farmId: string,
  deviceId: string,
  modules: Partial<DeviceModules>,
): Promise<void> {
  const cur = await getDevice(farmId, deviceId);
  if (!cur) throw new Error('Device not found.');
  await updateDoc(doc(db(), 'farms', farmId, 'devices', deviceId), {
    modules: { ...cur.modules, ...modules },
  });
}

/** Update editable device fields (name, location pin, location label, crop). */
export async function updateDeviceFields(
  farmId: string,
  deviceId: string,
  fields: {
    name?: string;
    latitude?: number;
    longitude?: number;
    locationLabel?: string;
    cropType?: string;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof fields.name === 'string' && fields.name.trim()) patch.name = fields.name.trim();
  if (typeof fields.latitude === 'number' && Number.isFinite(fields.latitude))
    patch.latitude = fields.latitude;
  if (typeof fields.longitude === 'number' && Number.isFinite(fields.longitude))
    patch.longitude = fields.longitude;
  if (typeof fields.locationLabel === 'string') patch.locationLabel = fields.locationLabel.trim();
  if (typeof fields.cropType === 'string' && fields.cropType.trim())
    patch.cropType = fields.cropType.trim();
  if (Object.keys(patch).length === 0) return;
  await updateDoc(doc(db(), 'farms', farmId, 'devices', deviceId), patch);
}
