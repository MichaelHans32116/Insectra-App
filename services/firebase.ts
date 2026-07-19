export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

// DESIGN PREVIEW BUILD — this points at a project that does not exist.
// It is syntactically valid so Firebase can initialize locally and NOTHING
// throws; there is simply no backend, so every read fails quietly and the
// screens fall back to their empty states. No real InsecTra keys are here.
export const firebaseConfig: FirebaseConfig = {
  apiKey: 'AIzaSyDESIGNPREVIEWnoRealBackend0000000000',
  authDomain: 'insectra-design-preview.firebaseapp.com',
  projectId: 'insectra-design-preview',
  storageBucket: 'insectra-design-preview.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
};

export function getFirebaseConfig(): FirebaseConfig {
  return firebaseConfig;
}

export function hasFirebaseConfig(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}
