/**
 * i18n.ts — minimal English/Tagalog translation service.
 *
 * We deliberately avoid heavy frameworks (react-i18next adds ~30 kB and a
 * Provider). Instead we keep:
 *   - a flat key→{en,tl} dictionary,
 *   - a global locale stored in AsyncStorage (`insectra.locale`),
 *   - a tiny `useT()` hook that re-renders on language change.
 *
 * To translate a string:
 *     const t = useT();
 *     <Text>{t('dashboard.activeFarm')}</Text>
 *
 * To switch language:
 *     setLocale('tl');   // or 'en'
 *
 * Strings missing a translation fall back to English; missing keys fall back
 * to the key itself, surfaced as `[key]` so they're visible in QA.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type Locale = 'en' | 'tl';

const STORAGE_KEY = 'insectra.locale';

const DICT: Record<string, { en: string; tl: string }> = {
  // Common
  'common.online':           { en: 'Online',           tl: 'Online' },
  'common.offline':          { en: 'Offline',          tl: 'Walang koneksyon' },
  'common.refresh':          { en: 'Refresh',          tl: 'I-refresh' },
  'common.cancel':           { en: 'Cancel',           tl: 'Kanselahin' },
  'common.ok':               { en: 'OK',               tl: 'Sige' },
  'common.loading':          { en: 'Loading...',       tl: 'Naglo-load...' },
  'common.error':            { en: 'Error',            tl: 'May error' },
  'common.markAllRead':      { en: 'Mark all read',    tl: 'Markahang lahat nabasa' },
  'common.export':           { en: 'Export',           tl: 'I-export' },
  'common.exportCsv':        { en: 'Export CSV',       tl: 'I-export ang CSV' },
  'common.exportPdf':        { en: 'Export PDF',       tl: 'I-export ang PDF' },
  'common.lastUpdated':      { en: 'Last updated',     tl: 'Huling update' },

  // Risk / outbreak
  'risk.level.low':          { en: 'Low risk',         tl: 'Mababang panganib' },
  'risk.level.moderate':     { en: 'Moderate risk',    tl: 'Katamtamang panganib' },
  'risk.level.high':         { en: 'High risk',        tl: 'Mataas na panganib' },
  'risk.title':              { en: 'Outbreak risk',    tl: 'Panganib ng pagdami' },
  'risk.confidence':         { en: 'Confidence',       tl: 'Tiyak na pagkalkula' },
  'risk.recommendation':     { en: 'Recommendation',   tl: 'Rekomendasyon' },

  // Dashboard
  'dashboard.activeFarm':    { en: 'ACTIVE FARM',      tl: 'AKTIBONG SAKAHAN' },
  'dashboard.youAre':        { en: 'You are',          tl: 'Ikaw ay' },
  'dashboard.totalCatch':    { en: 'Total catch',      tl: 'Kabuuang nahuli' },
  'dashboard.today':         { en: 'Today',            tl: 'Ngayon' },
  'dashboard.devicesOnline': { en: 'Devices online',   tl: 'Mga device na online' },
  'dashboard.noDevices':     { en: 'No devices yet',   tl: 'Walang device pa' },
  'dashboard.addDevice':     { en: 'Add device',       tl: 'Magdagdag ng device' },
  'dashboard.farmMap':       { en: 'Farm map',         tl: 'Mapa ng sakahan' },
  'dashboard.mapHint':       { en: 'Each marker shows a trap. Color = current outbreak risk.', tl: 'Bawat marker ay isang bitag. Kulay = kasalukuyang panganib.' },

  // Analytics
  'analytics.title':              { en: 'Analytics',           tl: 'Analytics' },
  'analytics.timeRange':          { en: 'Time range',          tl: 'Saklaw ng oras' },
  'analytics.anomalies':          { en: 'Anomalies detected',  tl: 'Mga anomalya na natukoy' },
  'analytics.noAnomalies':        { en: 'No anomalies detected', tl: 'Walang anomalya na natukoy' },
  'analytics.buildingBaseline':   { en: 'Building baseline...', tl: 'Bumubuo ng baseline...' },
  'analytics.summary':            { en: 'Summary',             tl: 'Buod' },
  'analytics.recommendations':    { en: 'Recommendations',     tl: 'Mga rekomendasyon' },
  'analytics.projection3d':       { en: '3-day projection',    tl: 'Proyeksyon (3 araw)' },
  'analytics.projection7d':       { en: '7-day projection',    tl: 'Proyeksyon (7 araw)' },
  'analytics.exportReport':       { en: 'Export PDF report',   tl: 'I-export ang PDF report' },

  // Alerts
  'alerts.title':            { en: 'Alerts',              tl: 'Mga abiso' },
  'alerts.empty':            { en: "You're all caught up.", tl: 'Wala nang bago.' },
  'alerts.emptyBody':        { en: 'Outbreak warnings and unusual sensor readings will appear here.', tl: 'Lalabas dito ang mga babala sa pagdami at hindi pangkaraniwang sensor reading.' },
  'alerts.clearHistory':     { en: 'Clear alert history',   tl: 'Burahin ang kasaysayan' },
  'alerts.justNow':          { en: 'just now',              tl: 'kanina lang' },

  // Settings
  'settings.language':       { en: 'Language',           tl: 'Wika' },
  'settings.english':        { en: 'English',            tl: 'Ingles' },
  'settings.filipino':       { en: 'Filipino',           tl: 'Filipino' },
};

let currentLocale: Locale = 'en';
const subs = new Set<(l: Locale) => void>();

(async () => {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'tl') {
      currentLocale = v;
      subs.forEach((cb) => cb(currentLocale));
    }
  } catch {
    /* ignore */
  }
})();

export function getLocale(): Locale {
  return currentLocale;
}

export async function setLocale(l: Locale): Promise<void> {
  currentLocale = l;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
  subs.forEach((cb) => cb(l));
}

export function t(key: string, locale: Locale = currentLocale): string {
  const entry = DICT[key];
  if (!entry) return `[${key}]`;
  return entry[locale] || entry.en;
}

export function pickLocale(en: string, tl: string, locale: Locale = currentLocale): string {
  return locale === 'tl' ? tl : en;
}

export function useT(): (key: string) => string {
  const [loc, setLoc] = useState<Locale>(currentLocale);
  useEffect(() => {
    const cb = (l: Locale) => setLoc(l);
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, []);
  return (key: string) => t(key, loc);
}

export function useLocale(): [Locale, (l: Locale) => Promise<void>] {
  const [loc, setLoc] = useState<Locale>(currentLocale);
  useEffect(() => {
    const cb = (l: Locale) => setLoc(l);
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, []);
  return [loc, setLocale];
}

export function useLocalText(): (en: string, tl: string) => string {
  const [loc] = useLocale();
  return (en: string, tl: string) => pickLocale(en, tl, loc);
}
