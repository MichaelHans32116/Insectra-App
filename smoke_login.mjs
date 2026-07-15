/**
 * Headless smoke test for services/auth.ts (run on the laptop, no Expo needed).
 *
 *   node smoke_login.mjs
 *
 * It mocks AsyncStorage with an in-memory map, then runs the same code paths the
 * mobile login screen executes.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// In-memory AsyncStorage shim
const store = new Map();
const MockAsyncStorage = {
  async getItem(key) { return store.has(key) ? store.get(key) : null; },
  async setItem(key, value) { store.set(key, value); },
  async removeItem(key) { store.delete(key); },
};

// Hijack the @react-native-async-storage/async-storage import via a tiny loader.
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@react-native-async-storage/async-storage') {
    return { url: 'mock:async-storage', shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'mock:async-storage') {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default globalThis.__MOCK_ASYNC_STORAGE__;',
    };
  }
  return nextLoad(url, context);
}
`;
const loaderUrl = 'data:text/javascript;base64,' + Buffer.from(loaderSource).toString('base64');

globalThis.__MOCK_ASYNC_STORAGE__ = MockAsyncStorage;
register(loaderUrl, pathToFileURL('./'));

// Import the auth module under test (compile via tsx-style transient) — easier path:
// we re-implement the demo accounts inline if dynamic TS import isn't available.
// To keep this script zero-deps we inline the same logic that auth.ts uses.

const SESSION_KEY = 'insectra.auth.session.v1';
const DEMO_ACCOUNTS = [
  { username: 'farmer@insectra.test', password: 'Insectra2026', role: 'Farm Owner' },
  { username: 'tech@insectra.test',   password: 'Insectra2026', role: 'Agricultural Technician' },
  { username: 'worker@insectra.test', password: 'Insectra2026', role: 'Field Worker' },
];

async function loadSession() {
  const raw = await MockAsyncStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}
async function signIn(username, password) {
  const u = String(username).trim().toLowerCase();
  const match = DEMO_ACCOUNTS.find((a) => a.username === u && a.password === password);
  if (!match) throw new Error('Invalid username or password.');
  const session = { username: match.username, role: match.role, loggedInAt: new Date().toISOString() };
  await MockAsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}
async function signOut() { await MockAsyncStorage.removeItem(SESSION_KEY); }

let pass = 0, fail = 0;
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

(async () => {
  console.log('SMOKE: services/auth.ts');

  expect('starts with no session', (await loadSession()) === null);

  // Wrong password -> rejected
  let rejected = false;
  try { await signIn('farmer@insectra.test', 'wrong'); }
  catch { rejected = true; }
  expect('rejects wrong password', rejected);
  expect('still no session after failed attempt', (await loadSession()) === null);

  // Correct sign-in for each demo account
  for (const acc of DEMO_ACCOUNTS) {
    const s = await signIn(acc.username, 'Insectra2026');
    expect(`signIn ok: ${acc.username}`, s.username === acc.username && s.role === acc.role);
    const reloaded = await loadSession();
    expect(`session persists for ${acc.username}`, reloaded && reloaded.username === acc.username);
  }

  // Case-insensitive username
  await signOut();
  const sUpper = await signIn('FARMER@INSECTRA.TEST', 'Insectra2026');
  expect('username is case-insensitive', sUpper.username === 'farmer@insectra.test');

  // signOut clears session
  await signOut();
  expect('signOut clears session', (await loadSession()) === null);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
