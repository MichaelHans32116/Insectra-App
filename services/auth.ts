/**
 * Backwards-compatible auth shim — now backed by Firebase Auth.
 *
 * Existing screens import `loadSession`, `signIn`, `signOut`
 * from this module. We keep the signatures stable but delegate to Firebase.
 *
 * For the new role-aware flow, screens should use `services/firebaseAuth.ts`
 * directly (richer return types).
 */
import {
  getCurrentAppUser,
  signInWithFirebase,
  signOutFirebase,
  subscribeAuth,
  type AppUser,
} from './firebaseAuth';
import { DESIGN_MODE } from '@/constants/designMode';

export type AuthSession = {
  username: string;          // email
  fullName: string;
  uid: string;
  emailVerified: boolean;
  loggedInAt: string;
};

function toSession(u: AppUser): AuthSession {
  return {
    username: u.email,
    fullName: u.fullName || u.email,
    uid: u.uid,
    emailVerified: u.emailVerified,
    loggedInAt: new Date().toISOString(),
  };
}

/**
 * Resolve current session, waiting briefly for Firebase to restore from
 * persistence on web reload.
 */
export async function loadSession(): Promise<AuthSession | null> {
  if (DESIGN_MODE) {
    return {
      username: 'designer@insectra.app',
      fullName: 'Design Preview',
      uid: 'design-user',
      emailVerified: true,
      loggedInAt: new Date().toISOString(),
    };
  }
  const immediate = getCurrentAppUser();
  if (immediate) return toSession(immediate);

  // Wait once for the auth state to settle (Firebase restores from persistence asynchronously).
  return new Promise<AuthSession | null>((resolve) => {
    const unsub = subscribeAuth((user) => {
      unsub();
      resolve(user ? toSession(user) : null);
    });
    // Safety timeout — never hang the splash screen forever.
    setTimeout(() => {
      unsub();
      const u = getCurrentAppUser();
      resolve(u ? toSession(u) : null);
    }, 3000);
  });
}

export async function signIn(username: string, password: string): Promise<AuthSession> {
  const user = await signInWithFirebase({ email: username, password });
  return toSession(user);
}

export async function signOut(): Promise<void> {
  await signOutFirebase();
}
