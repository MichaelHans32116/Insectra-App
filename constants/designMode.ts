// Design / prototype mode — this is the UI-only "clickable interface" copy of
// InsecTra for the design team. When DESIGN_MODE is true:
//   - login is bypassed (a mock session is returned)
//   - the app opens straight to the dashboard
//   - the Firebase backend is disabled, so every screen renders its
//     empty/placeholder state with no account, network, or real data.
// Buttons intentionally do not perform real actions — this is a shell to restyle.
export const DESIGN_MODE = true;
