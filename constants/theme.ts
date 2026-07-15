/**
 * InsecTra IoT — Monochromatic Nature Green (matches CP app)
 */

export const Colors = {
  primary:       '#2D6A4F',
  primaryDark:   '#1B4332',
  primaryDarker: '#0B1F14',
  primaryMid:    '#40916C',
  primaryLight:  '#52B788',
  primaryPale:   '#74C69D',
  primaryTint:   '#D8F3DC',
  primaryFaint:  '#EDF5F0',

  background:    '#F4F7F5',
  surface:       '#FFFFFF',
  surfaceAlt:    '#F0F4F1',
  border:        '#D4DED7',
  borderLight:   '#E5EBE7',
  divider:       '#E8EDEA',

  textPrimary:   '#1A2B22',
  textSecondary: '#5E7668',
  textTertiary:  '#8FA99A',
  textOnPrimary: '#FFFFFF',
  textOnDanger:  '#FFFFFF',

  danger:        '#922B21',
  dangerBg:      '#F8ECEA',
  dangerLight:   '#C0392B',
  warning:       '#7C4A00',
  warningBg:     '#FDF4E2',
  info:          '#2D6A4F',

  // "Watch" / informational accent (outbreak-risk watch band). Kept inside the
  // existing green/neutral palette — these are aliases of palette colors, not
  // new brand colors.
  accent:        '#5E7668',
  accentBg:      '#EDF5F0',
  success:       '#2D6A4F',
  successBg:     '#D8F3DC',

  tabActive:     '#2D6A4F',
  tabInactive:   '#8FA99A',
  tabBarBg:      '#FFFFFF',
  tabBarBorder:  '#D4DED7',

  shadow:        '#0B1F14',
  overlay:       'rgba(11, 31, 20, 0.5)',
  transparent:   'transparent',
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

/**
 * Spacing scale (4-pt grid). Use these everywhere instead of magic numbers so
 * the visual rhythm is consistent across every screen and device size.
 */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

/**
 * Typography scale. One source of truth for font sizes/weights/line-heights.
 * Two weights only beyond regular: 600 (medium) and 800 (bold) — anything in
 * between reads muddy on small screens.
 */
export const Type = {
  display: { fontSize: 40, fontWeight: '800', lineHeight: 44 },
  h1:      { fontSize: 22, fontWeight: '800', lineHeight: 28 },
  h2:      { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  title:   { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  body:    { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodyStrong: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  label:   { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  micro:   { fontSize: 11, fontWeight: '700', lineHeight: 14, letterSpacing: 0.4 },
} as const;

/** Cross-platform elevation presets (iOS shadow + Android elevation). */
export const Elevation = {
  none: {},
  card: {
    shadowColor: Colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: Colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;
