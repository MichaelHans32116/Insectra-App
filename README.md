# InsecTra — App Design Preview (UI-only)

A **clickable, functions-disabled copy** of the InsecTra mobile app, for the design
team (Melani & Geline) to restyle and evaluate design tools/AI against.

## What this is
- All screens and components of the real app, with the **backend disabled**.
- `DESIGN_MODE = true` (see `constants/designMode.ts`): login is skipped, the app
  opens on the dashboard, and Firebase is off — screens render their
  empty/placeholder states. **Buttons navigate but do not perform real actions.**
- No real Firebase keys or data are included.

## Run it (nothing to install)

1. Download this project: green **Code** button → **Download ZIP**, then unzip it.
2. Double-click **`Start_Design_Preview.bat`**.
3. Your browser opens the app. Keep the black window open while you preview.

That's it — no Node.js, no npm, no downloads. The launcher serves the prebuilt
`dist/` folder using the PowerShell already built into Windows.

> To see it at phone size: press **F12** in the browser, then click the little
> phone/tablet icon.

### Developer mode (only if you are editing the code)
Double-click **`Start_Dev_Mode_Advanced.bat`** for live reload. This one *does*
need [Node.js](https://nodejs.org) installed. After changing code, rebuild the
preview others use with:

```bash
npx expo export -p web   # regenerates dist/, then commit it
```

## To turn the real app back on
Set `DESIGN_MODE = false` in `constants/designMode.ts` and restore real Firebase
config in `services/firebase.ts`.
