# InsecTra — App Design Preview (UI-only)

A **clickable, functions-disabled copy** of the InsecTra mobile app, for the design
team (Melani & Geline) to restyle and evaluate design tools/AI against.

## What this is
- All screens and components of the real app, with the **backend disabled**.
- `DESIGN_MODE = true` (see `constants/designMode.ts`): login is skipped, the app
  opens on the dashboard, and Firebase is off — screens render their
  empty/placeholder states. **Buttons navigate but do not perform real actions.**
- No real Firebase keys or data are included.

## What's inside
| Preview | What it is |
|---|---|
| **Mobile app** | Every screen of the farmer app (`app/`, built into `dist/`) |
| **Expert Portal website** | The web dashboard experts open (`expert-portal/`) |

Both are UI-only with invented sample data.

## Run it (nothing to install)

1. Download this project: green **Code** button → **Download ZIP**, then unzip it.
2. Double-click **`Start_Design_Preview.bat`**.
3. Your browser opens a menu — pick **Mobile app** or **Website**.
   Keep the black window open while you preview.

That's it — no Node.js, no npm, no downloads. The launcher serves the prebuilt
files using the PowerShell already built into Windows.

> To see the app at phone size: press **F12** in the browser, then click the
> little phone/tablet icon.

### View it on a real phone
Right-click `Start_Design_Preview.bat` → **Run as administrator**. The window
then prints a `http://192.168.x.x:8080/` address — type that into your phone's
browser while on the same Wi-Fi. (Windows only allows other devices to connect
when the launcher is elevated, hence the extra step.)

### Developer mode / Expo Go (only if you are editing the code)
Double-click **`Start_Dev_Mode_Advanced.bat`** for live reload and the **Expo Go**
QR code. This one *does* need [Node.js](https://nodejs.org) installed — Expo Go
loads the app from a live Metro dev server, so it cannot work from the
no-install launcher above.

After changing app code, rebuild the preview others use with:

```bash
npx expo export -p web   # regenerates dist/, then commit it
```

The website needs no build step — edit `expert-portal/` directly and refresh.
Its sample data lives in `expert-portal/data/public-snapshot.json`.

## To turn the real app back on
Set `DESIGN_MODE = false` in `constants/designMode.ts` and restore real Firebase
config in `services/firebase.ts`.
