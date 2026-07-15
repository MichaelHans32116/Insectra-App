# Insectra Mobile — Smoke Test Report

Tested via Chromium against `http://localhost:8081` (Expo Web build, Metro --clear).
Firebase project: `insectra-ccb58` (real Auth, email verification required).

## Summary

| Area | Status | Notes |
|---|---|---|
| Compile (entire `app/`, `components/`, `services/`) | ✅ PASS | 0 TypeScript errors |
| Metro bundler | ✅ PASS | Bundles clean after JSX fix in `app/analytics/[id].tsx` |
| Login screen UI | ✅ PASS | No distortion |
| Register screen UI | ✅ PASS | Fixed broken icon `email-send-outline` → `email-fast-outline` |
| Settings / Language picker | ✅ PASS | New `app/settings.tsx`, EN ↔ TL toggle persists & re-renders all `useT()` consumers live |
| Quick-toggle pill (header) | ✅ PASS | Wired in `dashboard.tsx`; sits next to the new cog icon |
| Cog icon → /settings | ✅ PASS | Added to dashboard group header |
| Auth-gated screens | ⚠ DEFERRED | No verified test credentials available; see "Pending verification" |

## What was added this turn

1. **`app/settings.tsx`** — proper Settings screen with a discoverable language picker (radio rows + flag emoji + EN/TL labels + native names). Persists via `services/i18n.ts` (`AsyncStorage` key `insectra.locale`).
2. **`app/_layout.tsx`** — registered `<Stack.Screen name="settings" />` so `router.push('/settings')` resolves.
3. **`app/(tabs)/dashboard.tsx`** — added a cog icon next to the existing language pill that routes to `/settings`. The pill stays as a 1-tap shortcut; the cog is the discoverable "option".
4. **`app/register.tsx`** — replaced invalid icon `email-send-outline` with `email-fast-outline` (was logging a console warning + showing a "?" placeholder).

## Verified visually (screenshots taken)

- `/login` — logo, sign-in form, register link, footer text all aligned.
- `/register` — clean form; submit button now shows a real envelope icon.
- `/settings` —
  - In Filipino: heading "Settings", section "WIKA", labels "Ingles" / "Filipino", hint "Magbabago kaagad ang wika ng buong app."
  - After tapping English row: section flips to "LANGUAGE", labels become "English" / "Filipino", hint "The whole app updates immediately." — all live without reload.
- `/dashboard` (unauthenticated) — falls through to "No farm selected" empty state with a "Get started" CTA. Bottom tab bar (Dashboard / My Devices / Community) renders correctly.

## Pending verification (need verified Firebase account)

Cannot proceed without real credentials because:
- Firebase Auth is in production mode (not the Auth emulator).
- Email verification gate (`emailVerified === true`) blocks all writes.

Once a Farm Owner / Member / Agronomist account is supplied, the following needs a manual pass:

1. **Dashboard (with active farm)**
   - Group switcher dropdown opens (lang pill + cog stay clickable inside the header)
   - RiskMap card renders OSM iframe with markers per device (web only)
   - AlertsBell shows unread count
   - Per-device tiles show today's catch + risk
2. **Devices tab** — list, register-device flow, per-device drilldown
3. **Analytics `/analytics/[id]`** — line charts, anomaly card, **CSV export**, **PDF export** (opens print window on web)
4. **Alerts `/alerts`** — inbox list, mark-as-read
5. **OfflineBanner** — toggle network in DevTools, banner should appear above Stack
6. **Multi-role**
   - Owner: can register devices, invite members, see all analytics
   - Member: read-only on shared farm
   - Agronomist/Expert (if implemented): cross-farm read access
7. **i18n on logged-in screens** — flip language and verify strings on dashboard / devices / analytics (anything not yet wrapped in `t()` will stay English; consider this a follow-up if you find untranslated labels)

## Known minor warnings (non-blocking)

- Console: `props.pointerEvents is deprecated. Use style.pointerEvents` — RN-Web 0.21 deprecation in some third-party component, harmless.
- Native fallback for `RiskMap` is a list view (Leaflet only loads on web).
- Push notifications + Weekly digest Cloud Function are stubs — see the comment block at the bottom of `services/push.ts` and `functions/src/sendWeeklyDigest.ts` for activation steps.

## How to resume the smoke test

```powershell
cd "App/insectra-iot-firebase"
npx expo start --web --port 8081 --clear
# then sign in with a verified account at http://localhost:8081/login
```
