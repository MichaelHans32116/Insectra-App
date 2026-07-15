import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig, hasFirebaseConfig } from './firebase';
import type { RiskResult } from './riskScoring';
import type { Sample } from './samplesStore';

export type ForecastAuditStatus = 'pending' | 'resolved';
export type ForecastVerdict =
  | 'pending'
  | 'within_tolerance'
  | 'over_predicted'
  | 'under_predicted'
  | 'insufficient_actual';

export interface ForecastAudit {
  id: string;
  farmId: string;
  deviceId: string;
  status: ForecastAuditStatus;
  verdict: ForecastVerdict;
  startMs: number;
  dueMs: number;
  horizonHours: number;
  dailyCountAtForecast: number | null;
  predictedDailyAtDue: number | null;
  riskScoreAtForecast: number;
  riskLevelAtForecast: RiskResult['level'];
  confidenceAtForecast: number;
  countScoreAtForecast: number;
  trendScoreAtForecast: number;
  tempScoreAtForecast: number;
  humidityScoreAtForecast: number;
  projectedRisk3dAtForecast: number | null;
  actualDailyAtDue: number | null;
  actualSampleMs: number | null;
  errorAbs: number | null;
  errorPct: number | null;
  notes: string[];
  createdAt?: Date | null;
  updatedAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface ForecastAuditDraftInput {
  farmId: string;
  deviceId: string;
  risk: RiskResult;
  dailyCount: number | null;
  countHistory: Array<number | null>;
  horizonHours?: number;
  nowMs?: number;
}

const DEFAULT_HORIZON_HOURS = 6;
const MIN_TOLERANCE_COUNT = 3;
const TOLERANCE_FRACTION = 0.35;

let cachedDb: Firestore | null = null;
function db(): Firestore {
  if (cachedDb) return cachedDb;
  if (!hasFirebaseConfig()) throw new Error('Firebase configuration missing.');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

export function buildForecastAuditDraft(input: ForecastAuditDraftInput): ForecastAudit {
  const horizonHours = input.horizonHours ?? DEFAULT_HORIZON_HOURS;
  const startMs = bucketStart(input.nowMs ?? Date.now(), horizonHours);
  const dueMs = startMs + horizonHours * 60 * 60_000;
  const slopePerDay = trendSlope(input.countHistory);
  const predictedDailyAtDue =
    input.dailyCount === null
      ? null
      : Math.max(0, Math.round(input.dailyCount + slopePerDay * (horizonHours / 24)));

  const notes = [
    input.risk.missing.length
      ? `Missing channels: ${input.risk.missing.join(', ')}.`
      : 'All core risk channels present.',
    slopePerDay > 0
      ? `Count trend rising by about ${slopePerDay.toFixed(1)} flies/day.`
      : slopePerDay < 0
        ? `Count trend falling by about ${Math.abs(slopePerDay).toFixed(1)} flies/day.`
        : 'Count trend is flat or insufficient.',
  ];

  const id = `${input.deviceId}_${startMs}_${horizonHours}h`;
  return {
    id,
    farmId: input.farmId,
    deviceId: input.deviceId,
    status: 'pending',
    verdict: 'pending',
    startMs,
    dueMs,
    horizonHours,
    dailyCountAtForecast: input.dailyCount,
    predictedDailyAtDue,
    riskScoreAtForecast: input.risk.score,
    riskLevelAtForecast: input.risk.level,
    confidenceAtForecast: input.risk.confidence,
    countScoreAtForecast: input.risk.countScore,
    trendScoreAtForecast: input.risk.trendScore,
    tempScoreAtForecast: input.risk.tempScore,
    humidityScoreAtForecast: input.risk.humidityScore,
    projectedRisk3dAtForecast: input.risk.projectedRisk3d,
    actualDailyAtDue: null,
    actualSampleMs: null,
    errorAbs: null,
    errorPct: null,
    notes,
    createdAt: null,
    updatedAt: null,
    resolvedAt: null,
  };
}

export async function upsertForecastAudit(input: ForecastAuditDraftInput): Promise<string | null> {
  if (!hasFirebaseConfig() || !input.farmId || !input.deviceId) return null;
  if (input.risk.confidence < 0.5 || input.dailyCount === null) return null;
  const draft = buildForecastAuditDraft(input);
  const ref = doc(
    db(),
    'farms',
    input.farmId,
    'devices',
    input.deviceId,
    'forecastAudits',
    draft.id,
  );
  await setDoc(
    ref,
    {
      ...toFirestoreAudit(draft),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return draft.id;
}

export function subscribeRecentForecastAudits(
  farmId: string,
  deviceId: string,
  onNext: (audits: ForecastAudit[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!hasFirebaseConfig() || !farmId || !deviceId) {
    onNext([]);
    return () => undefined;
  }
  const q = query(
    collection(db(), 'farms', farmId, 'devices', deviceId, 'forecastAudits'),
    orderBy('startMs', 'desc'),
    limit(8),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out = snap.docs.map((d) => fromFirestoreAudit(d.id, d.data() as any));
      onNext(out);
    },
    (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      onNext([]);
    },
  );
}

export async function resolveForecastAudit(
  audit: ForecastAudit,
  samples: Sample[],
  nowMs = Date.now(),
): Promise<ForecastAudit | null> {
  if (!hasFirebaseConfig()) return null;
  if (audit.status !== 'pending' || nowMs < audit.dueMs) return null;

  const result = evaluateForecastAudit(audit, samples);
  const ref = doc(
    db(),
    'farms',
    audit.farmId,
    'devices',
    audit.deviceId,
    'forecastAudits',
    audit.id,
  );
  await setDoc(
    ref,
    {
      status: 'resolved',
      verdict: result.verdict,
      actualDailyAtDue: result.actualDailyAtDue,
      actualSampleMs: result.actualSampleMs,
      errorAbs: result.errorAbs,
      errorPct: result.errorPct,
      notes: result.notes,
      resolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return {
    ...audit,
    status: 'resolved',
    verdict: result.verdict,
    actualDailyAtDue: result.actualDailyAtDue,
    actualSampleMs: result.actualSampleMs,
    errorAbs: result.errorAbs,
    errorPct: result.errorPct,
    notes: result.notes,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  };
}

export function evaluateForecastAudit(
  audit: ForecastAudit,
  samples: Sample[],
): Pick<
  ForecastAudit,
  'verdict' | 'actualDailyAtDue' | 'actualSampleMs' | 'errorAbs' | 'errorPct' | 'notes'
> {
  const actual = nearestDailySample(samples, audit.dueMs);
  if (!actual || audit.predictedDailyAtDue === null) {
    return {
      verdict: 'insufficient_actual',
      actualDailyAtDue: actual?.daily ?? null,
      actualSampleMs: actual?.t ?? null,
      errorAbs: null,
      errorPct: null,
      notes: [
        ...audit.notes,
        'Could not resolve accurately: no daily-count sample close to review time.',
      ],
    };
  }

  const errorAbs = actual.daily - audit.predictedDailyAtDue;
  const denom = Math.max(1, audit.predictedDailyAtDue);
  const errorPct = errorAbs / denom;
  const tolerance = Math.max(MIN_TOLERANCE_COUNT, audit.predictedDailyAtDue * TOLERANCE_FRACTION);
  const verdict: ForecastVerdict =
    Math.abs(errorAbs) <= tolerance
      ? 'within_tolerance'
      : errorAbs < 0
        ? 'over_predicted'
        : 'under_predicted';

  const reviewNote =
    verdict === 'within_tolerance'
      ? 'Forecast matched the actual count within tolerance.'
      : verdict === 'over_predicted'
        ? 'Forecast was higher than actual; reduce sensitivity for similar conditions during review.'
        : 'Forecast was lower than actual; investigate hidden drivers such as lure age, nearby host fruit, or missed weather spikes.';

  return {
    verdict,
    actualDailyAtDue: actual.daily,
    actualSampleMs: actual.t,
    errorAbs,
    errorPct,
    notes: [...audit.notes, reviewNote],
  };
}

function bucketStart(ms: number, horizonHours: number): number {
  const span = horizonHours * 60 * 60_000;
  return Math.floor(ms / span) * span;
}

function nearestDailySample(samples: Sample[], dueMs: number): { t: number; daily: number } | null {
  let best: { t: number; daily: number; distance: number } | null = null;
  const maxDistanceMs = 90 * 60_000;
  for (const sample of samples) {
    if (sample.daily === null) continue;
    const distance = Math.abs(sample.t - dueMs);
    if (distance > maxDistanceMs) continue;
    if (!best || distance < best.distance) best = { t: sample.t, daily: sample.daily, distance };
  }
  return best ? { t: best.t, daily: best.daily } : null;
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

function toFirestoreAudit(a: ForecastAudit) {
  return {
    id: a.id,
    farmId: a.farmId,
    deviceId: a.deviceId,
    status: a.status,
    verdict: a.verdict,
    startMs: a.startMs,
    dueMs: a.dueMs,
    horizonHours: a.horizonHours,
    dailyCountAtForecast: a.dailyCountAtForecast,
    predictedDailyAtDue: a.predictedDailyAtDue,
    riskScoreAtForecast: a.riskScoreAtForecast,
    riskLevelAtForecast: a.riskLevelAtForecast,
    confidenceAtForecast: a.confidenceAtForecast,
    countScoreAtForecast: a.countScoreAtForecast,
    trendScoreAtForecast: a.trendScoreAtForecast,
    tempScoreAtForecast: a.tempScoreAtForecast,
    humidityScoreAtForecast: a.humidityScoreAtForecast,
    projectedRisk3dAtForecast: a.projectedRisk3dAtForecast,
    actualDailyAtDue: a.actualDailyAtDue,
    actualSampleMs: a.actualSampleMs,
    errorAbs: a.errorAbs,
    errorPct: a.errorPct,
    notes: a.notes,
  };
}

function fromFirestoreAudit(id: string, x: any): ForecastAudit {
  return {
    id,
    farmId: x.farmId ?? '',
    deviceId: x.deviceId ?? '',
    status: x.status === 'resolved' ? 'resolved' : 'pending',
    verdict: x.verdict ?? 'pending',
    startMs: Number(x.startMs ?? 0),
    dueMs: Number(x.dueMs ?? 0),
    horizonHours: Number(x.horizonHours ?? DEFAULT_HORIZON_HOURS),
    dailyCountAtForecast: nullableNumber(x.dailyCountAtForecast),
    predictedDailyAtDue: nullableNumber(x.predictedDailyAtDue),
    riskScoreAtForecast: Number(x.riskScoreAtForecast ?? 0),
    riskLevelAtForecast: x.riskLevelAtForecast ?? 'low',
    confidenceAtForecast: Number(x.confidenceAtForecast ?? 0),
    countScoreAtForecast: Number(x.countScoreAtForecast ?? 0),
    trendScoreAtForecast: Number(x.trendScoreAtForecast ?? 0),
    tempScoreAtForecast: Number(x.tempScoreAtForecast ?? 0),
    humidityScoreAtForecast: Number(x.humidityScoreAtForecast ?? 0),
    projectedRisk3dAtForecast: nullableNumber(x.projectedRisk3dAtForecast),
    actualDailyAtDue: nullableNumber(x.actualDailyAtDue),
    actualSampleMs: nullableNumber(x.actualSampleMs),
    errorAbs: nullableNumber(x.errorAbs),
    errorPct: nullableNumber(x.errorPct),
    notes: Array.isArray(x.notes) ? x.notes.filter((n: unknown) => typeof n === 'string') : [],
    createdAt: x.createdAt?.toDate?.() ?? null,
    updatedAt: x.updatedAt?.toDate?.() ?? null,
    resolvedAt: x.resolvedAt?.toDate?.() ?? null,
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
