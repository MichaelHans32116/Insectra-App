import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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

export type FarmTaskStatus = 'open' | 'done';

export interface FarmTask {
  id: string;
  farmId: string;
  title: string;
  details: string;
  assigneeUid: string;
  assigneeName: string;
  assigneeEmail: string;
  createdByUid: string;
  createdByName: string;
  status: FarmTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function toIso(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return '';
}

function sortTasks(tasks: FarmTask[]): FarmTask[] {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'open' ? -1 : 1;
    }
    const leftTime = Date.parse(left.updatedAt || left.createdAt || '1970-01-01T00:00:00.000Z');
    const rightTime = Date.parse(right.updatedAt || right.createdAt || '1970-01-01T00:00:00.000Z');
    return rightTime - leftTime;
  });
}

function mapTask(farmId: string, snapshot: any): FarmTask {
  const data = snapshot.data() as any;
  return {
    id: snapshot.id,
    farmId,
    title: String(data.title ?? ''),
    details: String(data.details ?? ''),
    assigneeUid: String(data.assigneeUid ?? ''),
    assigneeName: String(data.assigneeName ?? data.assigneeEmail ?? 'Member'),
    assigneeEmail: String(data.assigneeEmail ?? ''),
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: String(data.createdByName ?? 'Farm Owner'),
    status: data.status === 'done' ? 'done' : 'open',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    completedAt: data.completedAt ? toIso(data.completedAt) : null,
  };
}

export function subscribeFarmTasks(farmId: string, onChange: (tasks: FarmTask[]) => void): () => void {
  // Cap to the 50 most-recently-created tasks (re-sorted client-side: open
  // first, newest updated). Prevents an unbounded whole-collection read as the
  // farm accumulates task history. All app-created tasks carry createdAt.
  const q = query(
    collection(db(), 'farms', farmId, 'tasks'),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      onChange(sortTasks(snapshot.docs.map((docSnap) => mapTask(farmId, docSnap))));
    },
    () => {
      onChange([]);
    },
  );
}

export function subscribeAssignedTasks(
  farmId: string,
  assigneeUid: string,
  onChange: (tasks: FarmTask[]) => void,
): () => void {
  const taskQuery = query(
    collection(db(), 'farms', farmId, 'tasks'),
    where('assigneeUid', '==', assigneeUid),
  );
  return onSnapshot(
    taskQuery,
    (snapshot) => {
      onChange(sortTasks(snapshot.docs.map((docSnap) => mapTask(farmId, docSnap))));
    },
    () => {
      onChange([]);
    },
  );
}

export async function createFarmTask(input: {
  farmId: string;
  title: string;
  details?: string;
  assigneeUid: string;
  assigneeName: string;
  assigneeEmail: string;
  createdByUid: string;
  createdByName: string;
}): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error('Task title is required.');
  if (!input.assigneeUid) throw new Error('Pick a member to assign.');

  await addDoc(collection(db(), 'farms', input.farmId, 'tasks'), {
    farmId: input.farmId,
    title,
    details: (input.details ?? '').trim(),
    assigneeUid: input.assigneeUid,
    assigneeName: input.assigneeName,
    assigneeEmail: input.assigneeEmail.toLowerCase(),
    createdByUid: input.createdByUid,
    createdByName: input.createdByName,
    status: 'open' as FarmTaskStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
}

export async function updateFarmTaskStatus(
  farmId: string,
  taskId: string,
  status: FarmTaskStatus,
): Promise<void> {
  await updateDoc(doc(db(), 'farms', farmId, 'tasks', taskId), {
    status,
    updatedAt: serverTimestamp(),
    completedAt: status === 'done' ? new Date().toISOString() : null,
  });
}