/**
 * Community service — group announcements + replies.
 *
 * Both farm OWNERS and MEMBERS can post.
 *
 * Schema:
 *   /farms/{farmId}/community/{postId}
 *     { authorUid, authorName, authorRole, body, createdAt }
 *   /farms/{farmId}/community/{postId}/replies/{replyId}
 *     { authorUid, authorName, authorRole, body, createdAt }
 */
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from './firebase';
import type { GroupRole } from './groups';

let cachedDb: Firestore | null = null;
function db(): Firestore {
  if (cachedDb) return cachedDb;
  if (!hasFirebaseConfig()) throw new Error('Firebase configuration missing.');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

export interface CommunityPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorRole: GroupRole;
  body: string;
  createdAt: Date | null;
  replyCount?: number;
  likedBy: string[];
}

export interface CommunityReply {
  id: string;
  authorUid: string;
  authorName: string;
  authorRole: GroupRole;
  body: string;
  createdAt: Date | null;
  likedBy: string[];
}

export async function postAnnouncement(input: {
  farmId: string;
  authorUid: string;
  authorName: string;
  authorRole: GroupRole;
  body: string;
}): Promise<void> {
  const body = input.body.trim();
  if (!body) throw new Error('Write something to post.');
  await addDoc(collection(db(), 'farms', input.farmId, 'community'), {
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorRole: input.authorRole,
    body,
    createdAt: serverTimestamp(),
    likedBy: [],
  });
}

export async function postReply(input: {
  farmId: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorRole: GroupRole;
  body: string;
}): Promise<void> {
  const body = input.body.trim();
  if (!body) throw new Error('Write a reply.');
  await addDoc(
    collection(db(), 'farms', input.farmId, 'community', input.postId, 'replies'),
    {
      authorUid: input.authorUid,
      authorName: input.authorName,
      authorRole: input.authorRole,
      body,
      createdAt: serverTimestamp(),
      likedBy: [],
    },
  );
}

/**
 * Toggle a like on a post. Stored as an `arrayUnion`/`arrayRemove` of the
 * liker's uid so the count is just `likedBy.length` and we never need a
 * separate counter document.
 */
export async function togglePostLike(input: {
  farmId: string;
  postId: string;
  uid: string;
  liked: boolean; // current state — we flip it
}): Promise<void> {
  const ref = doc(db(), 'farms', input.farmId, 'community', input.postId);
  await updateDoc(ref, {
    likedBy: input.liked ? arrayRemove(input.uid) : arrayUnion(input.uid),
  });
}

export async function toggleReplyLike(input: {
  farmId: string;
  postId: string;
  replyId: string;
  uid: string;
  liked: boolean;
}): Promise<void> {
  const ref = doc(
    db(),
    'farms',
    input.farmId,
    'community',
    input.postId,
    'replies',
    input.replyId,
  );
  await updateDoc(ref, {
    likedBy: input.liked ? arrayRemove(input.uid) : arrayUnion(input.uid),
  });
}

/**
 * Delete a post. Caller is responsible for permission checks (author or
 * farm owner). Replies under the post are NOT deleted server-side here —
 * Firestore doesn't cascade. We best-effort delete known replies.
 */
export async function deletePost(input: {
  farmId: string;
  postId: string;
}): Promise<void> {
  // Best-effort cascade: delete child replies first so they don't orphan.
  try {
    const repliesSnap = await getDocs(
      collection(db(), 'farms', input.farmId, 'community', input.postId, 'replies'),
    );
    await Promise.all(repliesSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch {
    /* ignore — main delete is what matters */
  }
  await deleteDoc(doc(db(), 'farms', input.farmId, 'community', input.postId));
}

export async function deleteReply(input: {
  farmId: string;
  postId: string;
  replyId: string;
}): Promise<void> {
  await deleteDoc(
    doc(db(), 'farms', input.farmId, 'community', input.postId, 'replies', input.replyId),
  );
}

/** Live subscription to community posts (newest first). Returns unsubscribe. */
export function subscribePosts(
  farmId: string,
  cb: (posts: CommunityPost[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(db(), 'farms', farmId, 'community'),
    orderBy('createdAt', 'desc'),
    // Cap the live listener to the 25 most recent posts. The feed grows for the
    // farm's lifetime, so an unbounded onSnapshot re-reads every post on each
    // open (and on every reconnect) — the largest community read cost.
    limit(25),
  );
  return onSnapshot(
    q,
    (snap) => {
      const posts = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          authorUid: x.authorUid,
          authorName: x.authorName,
          authorRole: x.authorRole,
          body: x.body,
          createdAt: x.createdAt?.toDate?.() ?? null,
          likedBy: Array.isArray(x.likedBy) ? x.likedBy : [],
        } as CommunityPost;
      });
      cb(posts);
    },
    (error) => {
      onError?.(error);
    },
  );
}

export async function listReplies(
  farmId: string,
  postId: string,
): Promise<CommunityReply[]> {
  const q = query(
    collection(db(), 'farms', farmId, 'community', postId, 'replies'),
    orderBy('createdAt', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      authorUid: x.authorUid,
      authorName: x.authorName,
      authorRole: x.authorRole,
      body: x.body,
      createdAt: x.createdAt?.toDate?.() ?? null,
      likedBy: Array.isArray(x.likedBy) ? x.likedBy : [],
    } as CommunityReply;
  });
}

export function subscribeReplies(
  farmId: string,
  postId: string,
  cb: (replies: CommunityReply[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(db(), 'farms', farmId, 'community', postId, 'replies'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const replies = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          authorUid: x.authorUid,
          authorName: x.authorName,
          authorRole: x.authorRole,
          body: x.body,
          createdAt: x.createdAt?.toDate?.() ?? null,
          likedBy: Array.isArray(x.likedBy) ? x.likedBy : [],
        } as CommunityReply;
      });
      cb(replies);
    },
    (error) => {
      onError?.(error);
    },
  );
}
