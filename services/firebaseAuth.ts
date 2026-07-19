/**
 * Real Firebase Authentication wrapper.
 * - Email/password registration with sendEmailVerification
 * - Persistent sessions on web (localStorage) and native (AsyncStorage)
 * - Sign-in / sign-out / current user observer
 * - Forces verified-email gate before allowing entry into the app
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, getApp } from 'firebase/app';
import * as FirebaseAuthModule from 'firebase/auth';
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  setPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  reload,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword as fbUpdatePassword,
  type ActionCodeSettings,
  type Auth,
  type Persistence,
  type User,
} from 'firebase/auth';
import { firebaseConfig, hasFirebaseConfig } from './firebase';
import { DESIGN_MODE } from '@/constants/designMode';

/** Fake signed-in user for the UI-only design preview (no backend). */
const DESIGN_USER: AppUser = {
  uid: 'design-user',
  email: 'designer@insectra.app',
  fullName: 'Design Preview',
  emailVerified: true,
};

let cachedAuth: Auth | null = null;

const AUTH_ACTION_CONTINUE_URL = 'https://insectra-ccb58.web.app/auth/continue';
const IOS_BUNDLE_ID = 'com.insectra.iot';
const ANDROID_PACKAGE = 'com.insectra.iot';

type AuthActionScreen = 'verify-email' | 'login';
type ReactNativePersistenceFactory = (storage: typeof AsyncStorage) => Persistence;

function getReactNativePersistenceFactory(): ReactNativePersistenceFactory | null {
  const factory = (FirebaseAuthModule as typeof FirebaseAuthModule & {
    getReactNativePersistence?: ReactNativePersistenceFactory;
  }).getReactNativePersistence;

  return typeof factory === 'function' ? factory : null;
}

// The email-handler page URL is controlled in Firebase project config.
// These settings only carry safe return-state so the hosted page can send
// the user back to the right app screen after the action succeeds.
function buildActionCodeSettings(screen: AuthActionScreen, source: string): ActionCodeSettings {
  const continueUrl =
    `${AUTH_ACTION_CONTINUE_URL}?screen=${encodeURIComponent(screen)}` +
    `&source=${encodeURIComponent(source)}`;

  return {
    url: continueUrl,
    handleCodeInApp: false,
    iOS: { bundleId: IOS_BUNDLE_ID },
    android: {
      packageName: ANDROID_PACKAGE,
      installApp: false,
    },
  };
}

function ensureApp() {
  if (!hasFirebaseConfig()) {
    throw new Error('Firebase configuration is missing. Cannot initialize auth.');
  }
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app = ensureApp();

  if (Platform.OS === 'web') {
    const auth = getAuth(app);
    // Fire-and-forget: persist to localStorage on web.
    setPersistence(auth, browserLocalPersistence).catch(() => {
      // Fallback silently — sign-in still works without persistence.
    });
    cachedAuth = auth;
    return auth;
  }

  // Native — persist the signed-in session across app restarts.
  try {
    const getReactNativePersistence = getReactNativePersistenceFactory();
    if (!getReactNativePersistence) {
      throw new Error('React Native auth persistence is unavailable.');
    }
    const auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    cachedAuth = auth;
    return auth;
  } catch {
    const auth = getAuth(app);
    cachedAuth = auth;
    return auth;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  fullName: string;
  password: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AppUser {
  uid: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  /** Set when registration succeeded but the verification-email send failed. */
  verificationEmailError?: string;
}

function toAppUser(u: User, fallbackName?: string): AppUser {
  return {
    uid: u.uid,
    email: u.email ?? '',
    fullName: u.displayName ?? fallbackName ?? '',
    emailVerified: u.emailVerified,
  };
}

/**
 * Register a new account with Firebase Auth and send an email-verification link.
 * Throws on duplicate email or weak password.
 */
export async function registerWithFirebase(input: RegisterInput): Promise<AppUser> {
  if (DESIGN_MODE) return DESIGN_USER;
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email || !fullName || !input.password) throw new Error('All fields are required.');
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');

  const auth = getFirebaseAuth();
  const cred = await createUserWithEmailAndPassword(auth, email, input.password);
  // Best-effort displayName + verification email
  try {
    await updateProfile(cred.user, { displayName: fullName });
  } catch {
    /* ignore */
  }
  let verificationEmailError: string | undefined;
  try {
    await sendEmailVerification(cred.user, buildActionCodeSettings('verify-email', 'register'));
    // eslint-disable-next-line no-console
    console.log('[auth] verification email sent to', email);
  } catch (err) {
    verificationEmailError = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[auth] sendEmailVerification failed:', verificationEmailError);
  }
  const out = toAppUser(cred.user, fullName);
  if (verificationEmailError) out.verificationEmailError = verificationEmailError;
  return out;
}

/**
 * Sign in. Throws if credentials are wrong OR if the email has not been verified.
 */
export async function signInWithFirebase(input: SignInInput): Promise<AppUser> {
  if (DESIGN_MODE) return DESIGN_USER;
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) throw new Error('Enter both email and password.');
  const auth = getFirebaseAuth();
  const cred = await signInWithEmailAndPassword(auth, email, input.password);
  // Always reload + force-refresh the ID token so email_verified is current.
  // Firebase returns a stale token if the user verified between sessions.
  try {
    await reload(cred.user);
    await cred.user.getIdToken(true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[auth] post-signin reload/refresh failed:', err);
  }
  if (!cred.user.emailVerified) {
    throw new EmailNotVerifiedError(toAppUser(cred.user));
  }
  return toAppUser(cred.user);
}

/** Special error subclass so the UI can offer "resend verification". */
export class EmailNotVerifiedError extends Error {
  user: AppUser;
  constructor(user: AppUser) {
    super('Email not verified yet. Check your inbox and click the verification link.');
    this.name = 'EmailNotVerifiedError';
    this.user = user;
  }
}

export async function resendVerificationEmail(): Promise<void> {
  if (DESIGN_MODE) return;
  const auth = getFirebaseAuth();
  if (!auth.currentUser) throw new Error('No active session. Please sign in again.');
  await sendEmailVerification(
    auth.currentUser,
    buildActionCodeSettings('verify-email', 'resend-verification'),
  );
}

/** Reload the user's record from the server to pick up email verification changes. */
export async function refreshVerificationStatus(): Promise<boolean> {
  if (DESIGN_MODE) return true;
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return false;
  await reload(u);
  if (u.emailVerified) {
    // CRITICAL: force a new ID token so the email_verified custom claim flips
    // from false → true in subsequent Firestore requests. Without this, all
    // writes get "permission-denied" because the cached token is stale.
    try {
      await u.getIdToken(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[auth] forced token refresh failed:', err);
    }
  }
  return u.emailVerified;
}

export async function signOutFirebase(): Promise<void> {
  if (DESIGN_MODE) return;
  await fbSignOut(getFirebaseAuth());
}

/** Send a password-reset email to the given address. */
export async function sendPasswordReset(email: string): Promise<void> {
  if (DESIGN_MODE) return;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) throw new Error('Enter the email address for the account.');
  await sendPasswordResetEmail(
    getFirebaseAuth(),
    trimmed,
    buildActionCodeSettings('login', 'password-reset'),
  );
}

export function getCurrentAppUser(): AppUser | null {
  if (DESIGN_MODE) return DESIGN_USER;
  const u = getFirebaseAuth().currentUser;
  return u ? toAppUser(u) : null;
}

/** Subscribe to auth state changes. Returns unsubscribe. */
export function subscribeAuth(cb: (user: AppUser | null) => void): () => void {
  if (DESIGN_MODE) {
    cb(DESIGN_USER);
    return () => {};
  }
  return onAuthStateChanged(getFirebaseAuth(), (u) => {
    cb(u ? toAppUser(u) : null);
  });
}

/**
 * Update the displayed full name for the signed-in user.
 * Writes both Firebase Auth `displayName` and the Firestore mirror at
 * `users/{uid}.fullName` so the dashboard greeting reflects the change.
 */
export async function updateUserFullName(newName: string): Promise<AppUser> {
  if (DESIGN_MODE) return { ...DESIGN_USER, fullName: newName.trim() || DESIGN_USER.fullName };
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Name cannot be empty.');
  const u = getFirebaseAuth().currentUser;
  if (!u) throw new Error('No signed-in user.');
  await updateProfile(u, { displayName: trimmed });
  // Best-effort Firestore mirror — failures here should not block the UI.
  try {
    const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(
      doc(getFirestore(), 'users', u.uid),
      { fullName: trimmed, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch {
    /* non-fatal */
  }
  return toAppUser(u, trimmed);
}

/**
 * Change the signed-in user's password. Requires the current password for
 * Firebase reauthentication (so a stolen session token cannot rotate the
 * password without proving knowledge of the old one).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (DESIGN_MODE) return;
  if (!currentPassword) throw new Error('Enter your current password.');
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }
  const u = getFirebaseAuth().currentUser;
  if (!u || !u.email) throw new Error('No signed-in user.');
  const cred = EmailAuthProvider.credential(u.email, currentPassword);
  await reauthenticateWithCredential(u, cred);
  await fbUpdatePassword(u, newPassword);
}
