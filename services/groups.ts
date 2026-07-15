/**
 * Groups (a.k.a. Farms) service — Firestore-backed.
 *
 * Each group represents a farm community. The creator is the OWNER
 * within that group. Other users join via a 6-character invite code
 * and become MEMBERs with view access.
 *
 * Schema:
 *   /farms/{farmId}             — { name, ownerUid, ownerEmail, inviteCode, createdAt }
 *   /farms/{farmId}/members/{uid} — { uid, email, fullName, role, status, joinedAt }
 *   /users/{uid}                — { uid, email, fullName, primaryFarmId, createdAt, updatedAt }
 *
 * A user may belong to multiple farms (one as owner, others as member).
 */
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
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

export type GroupRole = 'Farm Owner' | 'Farm Member';

export interface GroupMember {
  uid: string;
  email: string;
  fullName: string;
  role: GroupRole;
  status: 'active' | 'pending' | 'removed';
  joinedAt: string;
}

export interface Group {
  id: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  inviteCode: string;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  primaryFarmId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InviteCodeRecord {
  farmId: string;
  farmName: string;
  ownerUid: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function ensureInviteCodeIndex(input: InviteCodeRecord & { code: string }): Promise<void> {
  if (!input.code) return;
  try {
    const ref = doc(db(), 'inviteCodes', input.code);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      farmId: input.farmId,
      farmName: input.farmName,
      ownerUid: input.ownerUid,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* best-effort */
  }
}

async function readInviteCode(code: string): Promise<InviteCodeRecord | null> {
  const ref = doc(db(), 'inviteCodes', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return {
    farmId: data.farmId ?? '',
    farmName: data.farmName ?? '',
    ownerUid: data.ownerUid ?? '',
  };
}

// ── User profile ─────────────────────────────────────────────────────────
export async function ensureUserProfile(input: {
  uid: string;
  email: string;
  fullName: string;
}): Promise<UserProfile> {
  const ref = doc(db(), 'users', input.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as any;
    return {
      uid: input.uid,
      email: input.email,
      fullName: data.fullName ?? input.fullName,
      primaryFarmId: data.primaryFarmId ?? null,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  const now = new Date().toISOString();
  await setDoc(ref, {
    uid: input.uid,
    email: input.email.toLowerCase(),
    fullName: input.fullName,
    primaryFarmId: null,
    createdAt: now,
    updatedAt: now,
  });
  return {
    uid: input.uid,
    email: input.email,
    fullName: input.fullName,
    primaryFarmId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function setPrimaryFarm(uid: string, farmId: string): Promise<void> {
  const ref = doc(db(), 'users', uid);
  await setDoc(
    ref,
    { primaryFarmId: farmId, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

// ── Group create ─────────────────────────────────────────────────────────
export async function createGroup(input: {
  name: string;
  ownerUid: string;
  ownerEmail: string;
  ownerFullName: string;
}): Promise<Group> {
  const name = input.name.trim();
  if (!name) throw new Error('Farm/Group name is required.');
  const inviteCode = generateInviteCode();
  const farmRef = await addDoc(collection(db(), 'farms'), {
    name,
    ownerUid: input.ownerUid,
    ownerEmail: input.ownerEmail.toLowerCase(),
    inviteCode,
    createdAt: serverTimestamp(),
  });
  // Owner becomes the first member.
  await setDoc(doc(db(), 'farms', farmRef.id, 'members', input.ownerUid), {
    uid: input.ownerUid,
    email: input.ownerEmail.toLowerCase(),
    fullName: input.ownerFullName,
    role: 'Farm Owner' as GroupRole,
    status: 'active',
    joinedAt: new Date().toISOString(),
  });
  await setPrimaryFarm(input.ownerUid, farmRef.id);
  // Also append to the user's farmIds list so listGroupsForUser can avoid
  // a collectionGroup query (which Firestore rules cannot easily allow).
  try {
    await updateDoc(doc(db(), 'users', input.ownerUid), {
      farmIds: arrayUnion(farmRef.id),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // user doc may not exist yet — fall back to setDoc merge.
    await setDoc(
      doc(db(), 'users', input.ownerUid),
      { farmIds: [farmRef.id], updatedAt: new Date().toISOString() },
      { merge: true },
    );
  }
  await ensureInviteCodeIndex({
    code: inviteCode,
    farmId: farmRef.id,
    farmName: name,
    ownerUid: input.ownerUid,
  });
  return {
    id: farmRef.id,
    name,
    ownerUid: input.ownerUid,
    ownerEmail: input.ownerEmail.toLowerCase(),
    inviteCode,
    createdAt: new Date().toISOString(),
  };
}

// ── Group join by invite code ────────────────────────────────────────────
export async function joinGroupByCode(input: {
  code: string;
  uid: string;
  email: string;
  fullName: string;
}): Promise<Group> {
  const code = input.code.trim().toUpperCase();
  if (code.length < 4) throw new Error('Invite code is too short.');
  await ensureUserProfile({
    uid: input.uid,
    email: input.email,
    fullName: input.fullName,
  });
  const invite = await readInviteCode(code);
  if (!invite || !invite.farmId) {
    throw new Error('Invite code not found. Double-check with the farm owner.');
  }
  const farmId = invite.farmId;
  let farmData: any = null;
  try {
    const farmSnap = await getDoc(doc(db(), 'farms', farmId));
    if (farmSnap.exists()) farmData = farmSnap.data() as any;
  } catch {
    /* not a member yet */
  }
  const isOwner = (farmData?.ownerUid ?? invite.ownerUid) === input.uid;
  // Guard: if the joiner is already the owner of this farm, skip the
  // member upsert (which would otherwise demote them from
  // 'Farm Owner' to 'Farm Member' via the setDoc below).
  if (!isOwner) {
    await setDoc(doc(db(), 'farms', farmId, 'members', input.uid), {
      uid: input.uid,
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      role: 'Farm Member' as GroupRole,
      status: 'active',
      joinedAt: new Date().toISOString(),
      inviteCode: code,
    });
  }
  if (!farmData) {
    const farmSnap = await getDoc(doc(db(), 'farms', farmId));
    if (farmSnap.exists()) farmData = farmSnap.data() as any;
  }
  // If the user has no primary farm yet, set this one.
  const userSnap = await getDoc(doc(db(), 'users', input.uid));
  if (!userSnap.exists() || !userSnap.data().primaryFarmId) {
    await setPrimaryFarm(input.uid, farmId);
  }
  // Append farmId so listGroupsForUser can find it without collectionGroup.
  try {
    await updateDoc(doc(db(), 'users', input.uid), {
      farmIds: arrayUnion(farmId),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    await setDoc(
      doc(db(), 'users', input.uid),
      { farmIds: [farmId], updatedAt: new Date().toISOString() },
      { merge: true },
    );
  }
  return {
    id: farmId,
    name: farmData?.name ?? invite.farmName ?? 'Unknown Farm',
    ownerUid: farmData?.ownerUid ?? invite.ownerUid ?? '',
    ownerEmail: farmData?.ownerEmail ?? '',
    inviteCode: farmData?.inviteCode ?? code,
    createdAt: farmData?.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
  };
}

// ── Listings ─────────────────────────────────────────────────────────────
export async function listGroupsForUser(uid: string): Promise<Array<Group & { role: GroupRole }>> {
  // Strategy: read /users/{uid}.farmIds (denormalized list maintained by
  // createGroup/joinGroupByCode), then fetch each farm + member doc.
  // This avoids a collectionGroup query, which Firestore rules cannot
  // efficiently allow without exposing /members across all farms.
  const userSnap = await getDoc(doc(db(), 'users', uid));
  const userData: any = userSnap.exists() ? userSnap.data() : {};
  const farmIds: string[] = Array.isArray(userData.farmIds) ? [...userData.farmIds] : [];
  // Backfill: legacy users may only have primaryFarmId (no farmIds array yet).
  if (userData.primaryFarmId && !farmIds.includes(userData.primaryFarmId)) {
    farmIds.push(userData.primaryFarmId);
    // Persist the backfill so subsequent reads are consistent.
    try {
      await updateDoc(doc(db(), 'users', uid), {
        farmIds: arrayUnion(userData.primaryFarmId),
      });
    } catch {
      /* ignore */
    }
  }
  const results: Array<Group & { role: GroupRole }> = [];
  for (const farmId of farmIds) {
    try {
      const [farmSnap, memberSnap] = await Promise.all([
        getDoc(doc(db(), 'farms', farmId)),
        getDoc(doc(db(), 'farms', farmId, 'members', uid)),
      ]);
      if (!farmSnap.exists() || !memberSnap.exists()) continue;
      const f = farmSnap.data() as any;
      const m = memberSnap.data() as any;
      if (f.ownerUid === uid && typeof f.inviteCode === 'string' && f.inviteCode) {
        await ensureInviteCodeIndex({
          code: f.inviteCode,
          farmId: farmSnap.id,
          farmName: f.name ?? '',
          ownerUid: f.ownerUid,
        });
      }
      // Self-heal: if this user is the farm's owner but the member doc was
      // accidentally written with role 'Farm Member' (an old bug in the join
      // flow let owners "join" their own farm and demote themselves), repair
      // the role on the fly.
      let role = m.role as GroupRole;
      if (f.ownerUid === uid && role !== 'Farm Owner') {
        role = 'Farm Owner';
        try {
          await setDoc(
            doc(db(), 'farms', farmSnap.id, 'members', uid),
            { role: 'Farm Owner' },
            { merge: true },
          );
        } catch {
          /* best-effort */
        }
      }
      results.push({
        id: farmSnap.id,
        name: f.name,
        ownerUid: f.ownerUid,
        ownerEmail: f.ownerEmail,
        inviteCode: f.inviteCode,
        createdAt: f.createdAt?.toDate?.()?.toISOString?.() ?? '',
        role,
      });
    } catch {
      // Skip farms we can't read (deleted, kicked, etc.)
    }
  }
  return results;
}

export async function getGroup(farmId: string): Promise<Group | null> {
  const snap = await getDoc(doc(db(), 'farms', farmId));
  if (!snap.exists()) return null;
  const f = snap.data() as any;
  return {
    id: snap.id,
    name: f.name,
    ownerUid: f.ownerUid,
    ownerEmail: f.ownerEmail,
    inviteCode: f.inviteCode,
    createdAt: f.createdAt?.toDate?.()?.toISOString?.() ?? '',
  };
}

export async function listMembers(farmId: string): Promise<GroupMember[]> {
  const snap = await getDocs(collection(db(), 'farms', farmId, 'members'));
  return snap.docs.map((d) => d.data() as GroupMember);
}
