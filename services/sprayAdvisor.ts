/**
 * InsecTra: Spray Advisor (decision-support, cost-aware)
 * ======================================================
 *
 * Goal: tell the farmer ONE of three things at any moment:
 *
 *    SPRAY NOW     — cost-justified bait spray within next 48 h
 *    WAIT N DAYS   — population not yet at action threshold OR last spray
 *                    is still in residual window; spraying now wastes money
 *    NO ACTION     — pressure low and falling; routine monitoring only
 *
 * Decision combines four research-backed checks (all must align to spray):
 *
 *  1. Population check  : current FTD ≥ 5 (FAO/IAEA action threshold)
 *  2. Trend check       : recent count slope > 0 (still rising)
 *  3. Forecast check    : projected 3-day risk ≥ 50 %
 *  4. Residual check    : days_since_last_spray ≥ SPINOSAD_RESIDUAL_DAYS (7)
 *
 * Plus a peso cost guardrail: if estimated spray cost > estimated damage
 * avoided, "spray now" is downgraded to "wait" with an explicit reason.
 *
 * References:
 *   - Pedigo, L.P. & Higley, L.G. (1992). Economic injury level concept.
 *     American Entomologist 38(1): 12–21.
 *   - Vargas, R.I. et al. (2008). Cue-lure + spinosad bait field trials.
 *     Florida Entomologist 91. Residual 5–7 d under tropical RH.
 *   - Piñero, J.C. et al. (2009). J. Econ. Entomol. 102:1123–1132.
 *   - FAO/IAEA (2019). Trapping guidelines for fruit-fly programmes.
 *   - PCAARRD ISP for Cucurbits 2017–2022.
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from './firebase';
import type { RiskResult } from './riskScoring';
import { BIO_CONSTANTS } from './riskScoring';

// ── Constants ────────────────────────────────────────────────────────────

/** Spinosad bait residual under tropical PH conditions (Vargas 2008). */
export const SPINOSAD_RESIDUAL_DAYS = 7;
const FORECAST_MAX_DAYS = 14;

// ── Types ────────────────────────────────────────────────────────────────

export type SprayAction = 'spray_now' | 'wait' | 'no_action' | 'insufficient_data';

export interface SprayDecision {
  action: SprayAction;
  headline: string;
  reason: string;
  waitDays: number | null;
  costPhp: number | null;
  lossAvoidedPhp: number | null;
  netBenefitPhp: number | null;
  nextReviewAt: Date;
  downgradedForCost: boolean;
}

export interface SpraySettings {
  productName: string;
  pricePhpPerLiter: number;
  doseLitersPerHectare: number;
  areaHectares: number;
  cropName: string;
  yieldKgPerHectare: number;
  pricePhpPerKg: number;
  /** Expected fraction (0..1) of yield damaged at outbreak if NOT controlled. */
  expectedDamageFraction: number;
  updatedAt?: Date | null;
}

export const DEFAULT_SPRAY_SETTINGS: SpraySettings = {
  productName: 'GF-120 NF Naturalyte (spinosad bait)',
  pricePhpPerLiter: 1850,
  doseLitersPerHectare: 1.0,
  areaHectares: 0.25,
  cropName: 'Bitter gourd (ampalaya)',
  yieldKgPerHectare: 12000,
  pricePhpPerKg: 45,
  expectedDamageFraction: 0.30,
};

export interface SprayEvent {
  id: string;
  performedAt: Date;
  product: string;
  litersUsed: number;
  costPhp: number;
  byUid: string;
  byName: string;
  note?: string;
  deviceId?: string | null;
  riskScoreAtSpray?: number | null;
  riskLevelAtSpray?: RiskResult['level'] | null;
  dailyCountAtSpray?: number | null;
  forecast3dAtSpray?: number | null;
  decisionHeadline?: string | null;
  decisionReason?: string | null;
  reviewDueAtMs?: number | null;
}

// ── Firestore plumbing ───────────────────────────────────────────────────

let cachedDb: Firestore | null = null;
function db(): Firestore {
  if (cachedDb) return cachedDb;
  if (!hasFirebaseConfig()) throw new Error('Firebase configuration missing.');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

// ── Settings CRUD ────────────────────────────────────────────────────────

export async function loadSpraySettings(farmId: string): Promise<SpraySettings | null> {
  if (!farmId) return null;
  try {
    const ref = doc(db(), 'farms', farmId, 'settings', 'spray');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const x = snap.data() as any;
    return {
      productName: x.productName ?? DEFAULT_SPRAY_SETTINGS.productName,
      pricePhpPerLiter: Number(x.pricePhpPerLiter ?? DEFAULT_SPRAY_SETTINGS.pricePhpPerLiter),
      doseLitersPerHectare: Number(x.doseLitersPerHectare ?? DEFAULT_SPRAY_SETTINGS.doseLitersPerHectare),
      areaHectares: Number(x.areaHectares ?? DEFAULT_SPRAY_SETTINGS.areaHectares),
      cropName: x.cropName ?? DEFAULT_SPRAY_SETTINGS.cropName,
      yieldKgPerHectare: Number(x.yieldKgPerHectare ?? DEFAULT_SPRAY_SETTINGS.yieldKgPerHectare),
      pricePhpPerKg: Number(x.pricePhpPerKg ?? DEFAULT_SPRAY_SETTINGS.pricePhpPerKg),
      expectedDamageFraction: Number(x.expectedDamageFraction ?? DEFAULT_SPRAY_SETTINGS.expectedDamageFraction),
      updatedAt: x.updatedAt?.toDate?.() ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveSpraySettings(farmId: string, settings: SpraySettings): Promise<void> {
  if (!farmId) throw new Error('farmId required');
  const ref = doc(db(), 'farms', farmId, 'settings', 'spray');
  await setDoc(
    ref,
    {
      productName: settings.productName,
      pricePhpPerLiter: settings.pricePhpPerLiter,
      doseLitersPerHectare: settings.doseLitersPerHectare,
      areaHectares: settings.areaHectares,
      cropName: settings.cropName,
      yieldKgPerHectare: settings.yieldKgPerHectare,
      pricePhpPerKg: settings.pricePhpPerKg,
      expectedDamageFraction: settings.expectedDamageFraction,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ── Spray history ────────────────────────────────────────────────────────

export async function logSprayEvent(input: {
  farmId: string;
  byUid: string;
  byName: string;
  product: string;
  litersUsed: number;
  costPhp: number;
  note?: string;
  deviceId?: string | null;
  riskScoreAtSpray?: number | null;
  riskLevelAtSpray?: RiskResult['level'] | null;
  dailyCountAtSpray?: number | null;
  forecast3dAtSpray?: number | null;
  decisionHeadline?: string | null;
  decisionReason?: string | null;
  reviewDueAtMs?: number | null;
}): Promise<void> {
  if (!input.farmId) throw new Error('farmId required');
  await addDoc(collection(db(), 'farms', input.farmId, 'sprayEvents'), {
    performedAt: serverTimestamp(),
    product: input.product,
    litersUsed: input.litersUsed,
    costPhp: input.costPhp,
    byUid: input.byUid,
    byName: input.byName,
    note: input.note ?? '',
    deviceId: input.deviceId ?? null,
    riskScoreAtSpray: input.riskScoreAtSpray ?? null,
    riskLevelAtSpray: input.riskLevelAtSpray ?? null,
    dailyCountAtSpray: input.dailyCountAtSpray ?? null,
    forecast3dAtSpray: input.forecast3dAtSpray ?? null,
    decisionHeadline: input.decisionHeadline ?? null,
    decisionReason: input.decisionReason ?? null,
    reviewDueAtMs: input.reviewDueAtMs ?? null,
  });
}

export async function getLastSpray(farmId: string): Promise<SprayEvent | null> {
  if (!farmId) return null;
  try {
    const q = query(
      collection(db(), 'farms', farmId, 'sprayEvents'),
      orderBy('performedAt', 'desc'),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const x = d.data() as any;
    return {
      id: d.id,
      performedAt: x.performedAt?.toDate?.() ?? new Date(),
      product: x.product ?? 'spinosad bait',
      litersUsed: Number(x.litersUsed ?? 0),
      costPhp: Number(x.costPhp ?? 0),
      byUid: x.byUid ?? '',
      byName: x.byName ?? '',
      note: x.note ?? '',
      deviceId: x.deviceId ?? null,
      riskScoreAtSpray: nullableNumber(x.riskScoreAtSpray),
      riskLevelAtSpray: x.riskLevelAtSpray ?? null,
      dailyCountAtSpray: nullableNumber(x.dailyCountAtSpray),
      forecast3dAtSpray: nullableNumber(x.forecast3dAtSpray),
      decisionHeadline: x.decisionHeadline ?? null,
      decisionReason: x.decisionReason ?? null,
      reviewDueAtMs: nullableNumber(x.reviewDueAtMs),
    };
  } catch {
    return null;
  }
}

// ── Cost math ────────────────────────────────────────────────────────────

export function computeSprayCostPhp(s: SpraySettings): number {
  const liters = Math.max(0, s.areaHectares) * Math.max(0, s.doseLitersPerHectare);
  return Math.round(liters * Math.max(0, s.pricePhpPerLiter));
}

/**
 * Estimated peso loss avoided by a timely spray.
 *
 *   loss = expected_damage × yield_kg_per_ha × area_ha × price_php_per_kg
 *
 * Scaled by `outbreakConfidence` (0..1) so a 50%-confident forecast doesn't
 * claim full damage avoided.
 */
export function computeLossAvoidedPhp(s: SpraySettings, outbreakConfidence: number): number {
  const conf = Math.max(0, Math.min(1, outbreakConfidence));
  const peak = s.expectedDamageFraction * s.yieldKgPerHectare * s.areaHectares * s.pricePhpPerKg;
  return Math.round(peak * conf);
}

// ── Decision engine ──────────────────────────────────────────────────────

export interface AdvisorInput {
  risk: RiskResult;
  /** Last 7 days of catch counts, oldest first. Used for trend sign. */
  countHistory: Array<number | null>;
  /** Latest dailyCount the dashboard fed into the risk model. */
  dailyCount: number | null;
  settings: SpraySettings | null;
  lastSpray: SprayEvent | null;
  now?: Date;
}

export function buildSprayDecision(input: AdvisorInput): SprayDecision {
  const now = input.now ?? new Date();
  const { risk, countHistory, settings, lastSpray } = input;
  const dailyCount = input.dailyCount ?? 0;
  const costPhp = settings ? computeSprayCostPhp(settings) : null;

  // ── Insufficient data short-circuit ─────────────────────────────────
  if (risk.confidence < 0.3 || input.dailyCount === null) {
    return {
      action: 'insufficient_data',
      headline: 'Need more data',
      reason:
        'Not enough recent samples to recommend safely. Confirm the DHT11 and camera are reporting, then let the trap log at least one full day.',
      waitDays: null,
      costPhp,
      lossAvoidedPhp: null,
      netBenefitPhp: null,
      nextReviewAt: addDays(now, 1),
      downgradedForCost: false,
    };
  }

  const slope = trendSlope(countHistory);

  const daysSinceLastSpray = lastSpray
    ? Math.floor((now.getTime() - lastSpray.performedAt.getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY;
  const insideResidualWindow = daysSinceLastSpray < SPINOSAD_RESIDUAL_DAYS;
  const forecast3d = risk.projectedRisk3d ?? risk.score;

  const aboveAction = dailyCount >= BIO_CONSTANTS.FTD_HIGH;
  const aboveOutbreak = dailyCount >= BIO_CONSTANTS.FTD_OUTBREAK;

  // No action: low pressure, flat or falling.
  if (!aboveAction && slope <= 0) {
    return {
      action: 'no_action',
      headline: 'No spray needed',
      reason: `Catch is ${dailyCount}/day (below 5/trap/day FAO action threshold) and trend is flat or falling. Keep monitoring; sanitize fallen fruit.`,
      waitDays: null,
      costPhp,
      lossAvoidedPhp: null,
      netBenefitPhp: null,
      nextReviewAt: addDays(now, 2),
      downgradedForCost: false,
    };
  }

  // Wait: still inside residual window from previous spray.
  if (insideResidualWindow) {
    const wait = SPINOSAD_RESIDUAL_DAYS - daysSinceLastSpray;
    return {
      action: 'wait',
      headline: `Wait ${wait} day${wait === 1 ? '' : 's'}`,
      reason: `Last spray was ${daysSinceLastSpray}d ago. Spinosad bait residual lasts ~${SPINOSAD_RESIDUAL_DAYS}d (Vargas 2008). Re-spraying now wastes chemistry — let it work first.`,
      waitDays: wait,
      costPhp,
      lossAvoidedPhp: null,
      netBenefitPhp: null,
      nextReviewAt: addDays(now, wait),
      downgradedForCost: false,
    };
  }

  // Wait: rising but not yet at threshold AND forecast not severe.
  if (!aboveAction && forecast3d < 0.5) {
    const projDays = forecastDaysToThreshold(dailyCount, slope, BIO_CONSTANTS.FTD_HIGH);
    const wait = Math.max(1, Math.min(FORECAST_MAX_DAYS, projDays ?? 3));
    return {
      action: 'wait',
      headline: `Wait ~${wait} day${wait === 1 ? '' : 's'}`,
      reason: `Catch ${dailyCount}/day is below the 5/trap/day action threshold; projected outbreak risk ${(forecast3d * 100) | 0}%. Re-check in ${wait}d before spraying.`,
      waitDays: wait,
      costPhp,
      lossAvoidedPhp: null,
      netBenefitPhp: null,
      nextReviewAt: addDays(now, wait),
      downgradedForCost: false,
    };
  }

  // Candidate SPRAY NOW. Apply cost guardrail.
  const lossAvoided = settings ? computeLossAvoidedPhp(settings, forecast3d) : null;
  const net = lossAvoided !== null && costPhp !== null ? lossAvoided - costPhp : null;
  const downgrade = net !== null && net < 0;

  if (downgrade) {
    return {
      action: 'wait',
      headline: 'Hold off — cost > damage',
      reason: `Spray would cost ≈ ₱${(costPhp ?? 0).toLocaleString()} but projected damage avoided is only ≈ ₱${(lossAvoided ?? 0).toLocaleString()} at this outbreak size. Wait until pressure rises or scale up trap density first.`,
      waitDays: 2,
      costPhp,
      lossAvoidedPhp: lossAvoided,
      netBenefitPhp: net,
      nextReviewAt: addDays(now, 2),
      downgradedForCost: true,
    };
  }

  // SPRAY NOW.
  const headline = aboveOutbreak ? 'Spray within 24 hours' : 'Spray within 48 hours';
  const reason = aboveOutbreak
    ? `Catch ${dailyCount}/day is at outbreak level (≥15/trap/day, FAO/IAEA). Trend slope ${formatSlope(slope)}/day. Deploy bait spray (cue-lure + spinosad) in next 24 h.`
    : `Catch ${dailyCount}/day is at FAO/IAEA action threshold. Forecast 3-day outbreak risk ${(forecast3d * 100) | 0}%. Bait-spray within 48 h to break the rise.`;

  return {
    action: 'spray_now',
    headline,
    reason,
    waitDays: null,
    costPhp,
    lossAvoidedPhp: lossAvoided,
    netBenefitPhp: net,
    nextReviewAt: addDays(now, 2),
    downgradedForCost: false,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function trendSlope(series: Array<number | null | undefined>): number {
  const xs: Array<{ i: number; y: number }> = [];
  series.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) xs.push({ i, y: v });
  });
  if (xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b.i, 0) / n;
  const meanY = xs.reduce((a, b) => a + b.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of xs) {
    num += (p.i - meanX) * (p.y - meanY);
    den += (p.i - meanX) * (p.i - meanX);
  }
  return den === 0 ? 0 : num / den;
}

function forecastDaysToThreshold(current: number, slope: number, threshold: number): number | null {
  if (slope <= 0) return null;
  if (current >= threshold) return 0;
  return Math.ceil((threshold - current) / slope);
}

function formatSlope(s: number): string {
  if (!Number.isFinite(s)) return '0';
  const sign = s > 0 ? '+' : '';
  return `${sign}${s.toFixed(1)}`;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
