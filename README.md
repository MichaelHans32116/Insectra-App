# InsecTra — App Design Preview (UI-only)

A **clickable, functions-disabled copy** of the InsecTra mobile app, for the design
team (Melani & Geline) to restyle and evaluate design tools/AI against.

## What this is
- All screens and components of the real app, with the **backend disabled**.
- `DESIGN_MODE = true` (see `constants/designMode.ts`): login is skipped, the app
  opens on the dashboard, and Firebase is off — screens render their
  empty/placeholder states. **Buttons navigate but do not perform real actions.**
- No real Firebase keys or data are included.

## Run it
```bash
npm install
npx expo start          # press w for web, or scan the QR with Expo Go
```

## To turn the real app back on
Set `DESIGN_MODE = false` in `constants/designMode.ts` and restore real Firebase
config in `services/firebase.ts`.
