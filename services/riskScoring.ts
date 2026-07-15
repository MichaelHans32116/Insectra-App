/**
 * InsecTra: Outbreak Risk Scoring v3 (population-gated)
 * ====================================================
 *
 * This module computes an outbreak-risk score for cucurbit fruit flies
 * (primarily *Zeugodacus / Bactrocera cucurbitae*) from on-trap signals.
 *
 * WHY v3 REPLACES v2
 * ------------------
 * v2 aggregated the four sub-scores (count, trend, temperature, humidity) as a
 * WEIGHTED AVERAGE in which temperature + humidity carried 50 % of the weight.
 * That let *weather alone* drive the score: a hot, humid day with ZERO flies
 * scored "moderate"/"high", and when `dailyCount` was null the weights
 * rebalanced so weather became 100 % of the score (up to 1.0 = "critical").
 * In other words, the trap shouted "outbreak" indoors at 34 °C with no melon
 * fly anywhere near it. That is biologically wrong and contradicted InsecTra's
 * own documented principle ("prefer Monitor when the count is low even if the
 * weather is favorable").
 *
 * THE CORRECT PRINCIPLE
 * ---------------------
 * A cue-lure trap measures ADULT MALE *activity/presence*. An outbreak requires
 * an actual population. Temperature and humidity describe how FAST a population
 * that is present can build up — they are a growth-rate / suitability MODIFIER,
 * not independent evidence that flies are there. So in v3:
 *
 *   - Actual catch (count + rising trend) = `populationPressure` (PP). This is
 *     the GATE. With no catch, there is no outbreak, full stop.
 *   - Temperature × humidity = `environmentalSuitability` (ES), 0..1. This only
 *     AMPLIFIES a present population, or raises a small, capped "watch"
 *     advisory ("conditions are favorable IF flies arrive — keep monitoring").
 *
 *   present population  ->  score = PP · (0.6 + 0.4 · ES)   (env amplifies)
 *   no catch / no data  ->  score = min(0.30, 0.30 · ES)    (capped "watch")
 *
 * Weather can therefore never on its own exceed the "watch" band. This mirrors
 * the (already-correct) expert-portal logic in
 * ExpertPortal/build_snapshot.py::risk_summary().
 *
 * Inputs the model uses (all optional except `dailyCount`):
 *   - dailyCount      : flies counted in the last 24 h (from YOLO on the Pi)
 *   - countHistory    : last 7 days of daily counts (for trend slope)
 *   - tempSeries      : recent ambient temperature samples (°C)
 *   - humSeries       : recent relative humidity samples (%)
 *   - baselineDaily   : expected baseline catch (default 3 flies/day)
 *
 * Sub-scores (the biological curves are UNCHANGED from v2 — only the way they
 * are combined changed):
 *   1. fCount     — saturating Hill curve, half-saturation at the FAO/IAEA
 *                   action threshold (5 FTD), so 5 flies/trap/day = 0.5 pressure
 *                   (Allwood et al. 1999; FAO/IAEA 2019).
 *   2. fTrend     — rising-slope momentum. FIXED in v3 so a flat / all-zero
 *                   history returns ~0 instead of a spurious 0.5, and momentum
 *                   only boosts pressure when a real population is present.
 *   3. fThermal   — degree-day suitability above the 11.4 °C lower threshold,
 *                   plateau 25–30 °C, declining to 0 by the 40 °C lethal point
 *                   (Vargas et al. 2000; Liu & Ye 2009; Kandakoor et al. 2019).
 *   4. fHumidity  — triangular peak around 60–70 % RH with desiccation and
 *                   fungal-mortality fall-offs (Barma & Jha 2021).
 *
 * Projections re-use the SAME gate, so a forecast can only rise if the trend
 * shows flies actually arriving — favorable weather over an empty trap forecasts
 * low risk, as it should.
 *
 * IMPORTANT: All inputs are nullable. Missing sub-scores are reported in
 * `result.missing` and lower `result.confidence` so the UI stays honest.
 *
 * References (full list in
 * Documents/Papers/Outbreak_Probability_Research_Backing.docx):
 *   - Dhillon et al. 2005, J. Insect Sci. 5:40
 *   - Vargas et al. 2000, Ann. Entomol. Soc. Am. 93:75
 *   - Kandakoor et al. 2019, J. Entomol. Res. 43:27
 *   - Barma & Jha 2021, J. Entomol. Zool. Stud. 9:1241
 *   - Liu & Ye 2009, Sci. Res. Essays 4:467
 *   - Allwood et al. 1999, Raffles Bull. Zool. Suppl. 7
 *   - FAO/IAEA 2019, Trapping guidelines for area-wide fruit fly programmes
 *   - PCAARRD 2017, ISP for Cucurbits 2017–2022
 *   - DA-BAR 2020, Field protocols for monitoring fruit fly populations
 *   - Sutherst & Maywald 1985 (CLIMEX) — multiplicative growth × stress indices
 */

export type RiskLevel = 'low' | 'watch' | 'moderate' | 'high' | 'critical';

export interface RiskResult {
  // Backwards-compatible fields (used by dashboard.tsx, analytics, forecastAudit):
  score: number;          // 0..1 composite risk
  level: RiskLevel;
  label: string;
  color: string;
  bgColor: string;
  tempScore: number;      // 0..1 — 0 if no data (fThermal)
  humidityScore: number;  // 0..1 — 0 if no data (fHumidity)
  countScore: number;     // 0..1 — 0 if no data (fCount)
  advice: string;

  // v2 fields (kept):
  trendScore: number;             // 0..1 — momentum (0.5 = flat)
  confidence: number;             // 0..1 — share of inputs that were real
  missing: Array<'count' | 'trend' | 'thermal' | 'humidity'>;
  generationTimeDays: number | null;  // egg→adult; null if no temp data
  projectedRisk3d: number | null;     // 0..1 — null if low confidence
  projectedRisk7d: number | null;
  projectedRisk14d: number | null;
  recommendations: string[];          // ordered IPM actions

  // NEW v3 fields:
  populationPressure: number;            // 0..1 — the gate (count + rising trend)
  environmentalSuitability: number | null; // 0..1 — thermal × humidity; null if no weather
  weatherOnly: boolean;                  // true when score is a capped "watch" from weather alone
}

// ── Biological constants (from references above) ─────────────────────────
const TEMP_LOWER_DEV = 11.4;   // °C — lower developmental threshold
const TEMP_OPTIMAL_LO = 25;    // °C — optimal lower
const TEMP_OPTIMAL_HI = 30;    // °C — optimal upper
const TEMP_UPPER_DEV = 33;     // °C — upper developmental threshold
const TEMP_LETHAL = 40;        // °C — sustained mortality

const RH_DESICCATE_BELOW = 20; // % — egg desiccation
const RH_OPTIMAL_LO = 60;      // %
const RH_OPTIMAL_HI = 70;      // %
const RH_FUNGAL_ABOVE = 95;    // % — fungal pupal mortality rises sharply

// FAO/IAEA action thresholds for B. cucurbitae (flies per trap per day, FTD):
const FTD_HIGH = 5;            // intervention recommended
const FTD_OUTBREAK = 15;       // outbreak-level

// ── v3 aggregation constants ─────────────────────────────────────────────
/** Hill half-saturation = FAO/IAEA action threshold ⇒ fCount(5) = 0.5. */
const COUNT_HALF_SATURATION = FTD_HIGH;
/** Below this daily catch we treat the trap as having NO current population. */
const POPULATION_FLOOR = 1;
/** Weather-only ("watch") risk can never exceed this, no matter how ideal. */
const WATCH_CAP = 0.30;
/** Environmental suitability ≥ this ⇒ a no-catch reading is a "watch", else "low". */
const WATCH_ES_THRESHOLD = 0.5;
/** Base share of risk from population even in hostile weather (ES = 0). */
const ENV_BASE = 0.6;
/** Extra share weather can add when ES = 1 (ENV_BASE + ENV_SPAN = 1.0). */
const ENV_SPAN = 0.4;
/** Assumed amplification when population is present but weather is unknown. */
const ENV_NEUTRAL = 0.8;
/** Slope (flies/day per day) that maps to full rising momentum. */
const MOMENTUM_FULL_SLOPE = 3.3;

// Band cut-offs on the composite score.
const BAND_LOW = 0.25;
const BAND_MODERATE = 0.45;
const BAND_HIGH = 0.75;

// Re-export biological constants so the analytics UI can shade optimal bands.
export const BIO_CONSTANTS = {
  TEMP_LOWER_DEV,
  TEMP_OPTIMAL_LO,
  TEMP_OPTIMAL_HI,
  TEMP_UPPER_DEV,
  TEMP_LETHAL,
  RH_DESICCATE_BELOW,
  RH_OPTIMAL_LO,
  RH_OPTIMAL_HI,
  RH_FUNGAL_ABOVE,
  FTD_HIGH,
  FTD_OUTBREAK,
} as const;

// ── Sub-score functions ──────────────────────────────────────────────────

/**
 * Saturating Hill curve on daily catch. Half-saturation at the FAO/IAEA action
 * threshold (5 FTD) so the action threshold itself maps to 0.5 "pressure":
 *   0→0, 3→0.38, 5→0.50, 6→0.55, 15→0.75 (outbreak), 20→0.80, 30→0.86.
 */
function fCount(dailyCount: number): number {
  if (!Number.isFinite(dailyCount) || dailyCount < 0) return 0;
  return dailyCount / (dailyCount + COUNT_HALF_SATURATION);
}

/**
 * Rising-momentum from a count series, in [-1, 1]:
 *   strong rise → +1, flat → 0, strong fall → -1.
 * v3 fix: a flat or all-zero history yields 0 (v2 returned a spurious +0.5),
 * and this momentum only BOOSTS pressure when a real population is present
 * (see populationPressure), so an empty trap can never trend its way to "high".
 */
function countMomentum(countHistory: number[]): number {
  if (countHistory.length < 3) return 0;
  const slope = trendSlope(countHistory);
  return Math.max(-1, Math.min(1, slope / MOMENTUM_FULL_SLOPE));
}

/** UI-facing trend score in 0..1 (0.5 = flat). Not weighted into the gate. */
function fTrend(countHistory: number[]): number {
  if (countHistory.length < 3) return 0;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * countMomentum(countHistory)));
}

/** Mean of a numeric array, ignoring null/undefined/NaN. Returns null if empty. */
function meanOrNull(arr: Array<number | null | undefined>): number | null {
  const xs = arr.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Thermal suitability from MEAN ambient temperature (°C).
 * Triangular: 0 at/below 11.4, ramps to 1 by 25, plateau 25–30, gentle decline
 * 30→33, rapid decline 33→40, then 0. (So 34 °C is past the developmental
 * optimum and already suppressed, not amplified.)
 */
function fThermal(tempC: number | null): number {
  if (tempC === null || !Number.isFinite(tempC)) return 0;
  if (tempC <= TEMP_LOWER_DEV) return 0;
  if (tempC >= TEMP_LETHAL) return 0;
  if (tempC >= TEMP_OPTIMAL_LO && tempC <= TEMP_OPTIMAL_HI) return 1;
  if (tempC < TEMP_OPTIMAL_LO) {
    return (tempC - TEMP_LOWER_DEV) / (TEMP_OPTIMAL_LO - TEMP_LOWER_DEV);
  }
  // 30–33: gentle decline; 33–40: rapid decline.
  if (tempC <= TEMP_UPPER_DEV) {
    return 1 - (tempC - TEMP_OPTIMAL_HI) / (TEMP_UPPER_DEV - TEMP_OPTIMAL_HI) * 0.3;
  }
  return 0.7 - (tempC - TEMP_UPPER_DEV) / (TEMP_LETHAL - TEMP_UPPER_DEV) * 0.7;
}

/** Humidity suitability (Barma & Jha 2021). */
function fHumidity(rh: number | null): number {
  if (rh === null || !Number.isFinite(rh)) return 0;
  if (rh <= RH_DESICCATE_BELOW) return 0;
  if (rh >= RH_OPTIMAL_LO && rh <= RH_OPTIMAL_HI) return 1;
  if (rh < RH_OPTIMAL_LO) {
    return (rh - RH_DESICCATE_BELOW) / (RH_OPTIMAL_LO - RH_DESICCATE_BELOW);
  }
  if (rh >= RH_FUNGAL_ABOVE) return 0.3;
  return 1 - (rh - RH_OPTIMAL_HI) / (RH_FUNGAL_ABOVE - RH_OPTIMAL_HI) * 0.7;
}

/**
 * Egg-to-adult generation time (days) as a function of mean temperature.
 * Reciprocal-of-degree-days approximation 240/(T-11.4), clamped 10..90 d.
 * (Vargas 2000 & Liu 2009: T=28 → ~14 d.)
 */
export function generationTimeDays(tempC: number | null): number | null {
  if (tempC === null || !Number.isFinite(tempC)) return null;
  if (tempC <= TEMP_LOWER_DEV) return 90;
  const dd = Math.max(1, tempC - TEMP_LOWER_DEV);
  const days = 240 / dd;
  return Math.max(10, Math.min(90, Math.round(days)));
}

// ── Core v3 aggregation helpers ──────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Environmental suitability ES = thermal × humidity (both must be favorable —
 * multiplicative, CLIMEX-style). If one channel is missing, fall back to the
 * present one; if both are missing, ES is null (unknown).
 */
function environmentalSuitability(
  thermal: number | null,
  humidity: number | null,
): number | null {
  if (thermal === null && humidity === null) return null;
  if (thermal === null) return humidity;
  if (humidity === null) return thermal;
  return thermal * humidity;
}

/**
 * Population pressure = saturating catch level, nudged up by rising momentum
 * (and only when a real population is present). Falling/flat counts add nothing.
 */
function populationPressure(dailyCount: number, momentum: number): number {
  const base = fCount(dailyCount);
  const rising = Math.max(0, momentum); // only positive slope boosts
  return clamp01(base + (1 - base) * rising * 0.3);
}

interface Scored {
  score: number;
  level: RiskLevel;
  weatherOnly: boolean;
}

/**
 * The gate. Actual catch decides whether weather amplifies a real population or
 * only raises a capped "watch". This is the heart of the v3 fix.
 */
function scoreFor(
  dailyCount: number | null,
  es: number | null,
  momentum: number,
): Scored {
  // No catch data at all → cannot claim an outbreak. Weather → capped watch.
  if (dailyCount === null) {
    if (es === null) return { score: 0, level: 'low', weatherOnly: true };
    const s = Math.min(WATCH_CAP, WATCH_CAP * es);
    return { score: s, level: es >= WATCH_ES_THRESHOLD ? 'watch' : 'low', weatherOnly: true };
  }
  // Real, confirmed (near-)zero catch → definitively no outbreak now.
  if (dailyCount < POPULATION_FLOOR) {
    if (es === null) return { score: 0.05, level: 'low', weatherOnly: true };
    const s = Math.min(WATCH_CAP, WATCH_CAP * es);
    return { score: s, level: es >= WATCH_ES_THRESHOLD ? 'watch' : 'low', weatherOnly: true };
  }
  // Population present → environment amplifies it.
  const pp = populationPressure(dailyCount, momentum);
  const envFactor = es === null ? ENV_NEUTRAL : ENV_BASE + ENV_SPAN * es;
  const score = clamp01(pp * envFactor);
  return { score, level: bandLevel(score), weatherOnly: false };
}

function bandLevel(score: number): RiskLevel {
  if (score <= BAND_LOW) return 'low';
  if (score <= BAND_MODERATE) return 'moderate';
  if (score <= BAND_HIGH) return 'high';
  return 'critical';
}

// ── Main entrypoint ──────────────────────────────────────────────────────

export interface RiskInput {
  // Required:
  dailyCount: number | null;
  // Optional richer context:
  countHistory?: Array<number | null>;     // last N daily counts, oldest first
  tempSeries?: Array<number | null>;       // recent temperature samples (°C)
  humSeries?: Array<number | null>;        // recent humidity samples (%)
  baselineDaily?: number;                  // default 3
  // Backwards-compat single-point inputs (used by old dashboard call sites):
  temperatureC?: number | null;
  humidityPct?: number | null;
  prevDayCount?: number;
}

export function computeRisk(input: RiskInput): RiskResult {
  const dailyCount = input.dailyCount ?? null;
  const tempMean = input.tempSeries
    ? meanOrNull(input.tempSeries)
    : (input.temperatureC ?? null);
  const humMean = input.humSeries
    ? meanOrNull(input.humSeries)
    : (input.humidityPct ?? null);
  const history =
    input.countHistory && input.countHistory.length
      ? input.countHistory.map((x) =>
          typeof x === 'number' && Number.isFinite(x) ? x : 0,
        )
      : typeof input.prevDayCount === 'number' && dailyCount !== null
        ? [input.prevDayCount, dailyCount]
        : [];

  // Track which channels are "missing" (no real data) for honest confidence.
  const missing: RiskResult['missing'] = [];
  if (dailyCount === null) missing.push('count');
  if (history.length < 3) missing.push('trend');
  if (tempMean === null) missing.push('thermal');
  if (humMean === null) missing.push('humidity');

  // Sub-scores (biological curves).
  const cs = dailyCount === null ? 0 : fCount(dailyCount);
  const ts = fTrend(history);
  const ths = fThermal(tempMean);
  const hs = fHumidity(humMean);
  const es = environmentalSuitability(
    tempMean === null ? null : ths,
    humMean === null ? null : hs,
  );
  const momentum = countMomentum(history);

  // Composite via the population gate.
  const scored = scoreFor(dailyCount, es, momentum);
  const score = clamp01(scored.score);
  const pp = dailyCount === null || dailyCount < POPULATION_FLOOR
    ? 0
    : populationPressure(dailyCount, momentum);

  // Confidence: how many of the four signal channels we actually have.
  const confidence = (4 - missing.length) / 4;

  // Generation time and projections (need temp + count history). Projections
  // route through the SAME gate, so favorable weather over an empty trap stays
  // low — only an actually-rising count can lift the forecast.
  const genDays = generationTimeDays(tempMean);
  let p3: number | null = null;
  let p7: number | null = null;
  let p14: number | null = null;
  if (confidence >= 0.5 && history.length >= 3 && genDays !== null && dailyCount !== null) {
    const slope = trendSlope(history);
    const today = history[history.length - 1];
    const project = (daysAhead: number) => {
      const projCount = Math.max(0, today + slope * daysAhead);
      return scoreFor(projCount, es, momentum).score;
    };
    p3 = project(3);
    p7 = project(7);
    // 14-day projection: each new generation can add ~5 % before saturation,
    // but only if a population is actually present to reproduce.
    const generations = 14 / genDays;
    const base14 = project(14);
    p14 = pp > 0 ? Math.min(1, base14 + generations * 0.05) : base14;
  }

  // Map to label / colour bands.
  const { level, label, color, bgColor, advice } = describe(
    scored.level,
    missing,
    scored.weatherOnly,
  );

  // Recommendations (ordered, plain Taglish-friendly English).
  const recommendations = buildRecommendations({
    score,
    level,
    dailyCount,
    tempMean,
    humMean,
    es,
    genDays,
    weatherOnly: scored.weatherOnly,
    missing,
  });

  return {
    score: round2(score),
    level,
    label,
    color,
    bgColor,
    tempScore: round2(ths),
    humidityScore: round2(hs),
    countScore: round2(cs),
    trendScore: round2(ts),
    confidence: round2(confidence),
    missing,
    generationTimeDays: genDays,
    projectedRisk3d: p3 === null ? null : round2(p3),
    projectedRisk7d: p7 === null ? null : round2(p7),
    projectedRisk14d: p14 === null ? null : round2(p14),
    advice,
    recommendations,
    populationPressure: round2(pp),
    environmentalSuitability: es === null ? null : round2(es),
    weatherOnly: scored.weatherOnly,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function trendSlope(series: number[]): number {
  if (series.length < 2) return 0;
  const n = series.length;
  const xs = series.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (series[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function describe(
  level: RiskLevel,
  missing: RiskResult['missing'],
  weatherOnly: boolean,
): { level: RiskLevel; label: string; color: string; bgColor: string; advice: string } {
  // Not enough signals to score at all.
  if (missing.length >= 3) {
    return {
      level: 'low',
      label: 'Insufficient data',
      color: '#5E7668',
      bgColor: '#EDF5F0',
      advice:
        'Not enough sensor signals yet to score outbreak risk. Wait for the Pi to report a daily catch AND temperature/humidity.',
    };
  }
  if (level === 'critical') {
    return {
      level,
      label: 'Critical',
      color: '#922B21',
      bgColor: '#F8ECEA',
      advice: 'Outbreak-level trap catch with favorable conditions. Immediate intervention recommended.',
    };
  }
  if (level === 'high') {
    return {
      level,
      label: 'High',
      color: '#C0392B',
      bgColor: '#FDECEA',
      advice: 'Trap catch is at the action threshold. Consider preventive IPM measures within 48 hours.',
    };
  }
  if (level === 'moderate') {
    return {
      level,
      label: 'Moderate',
      color: '#7C4A00',
      bgColor: '#FDF4E2',
      advice: 'Some real trap activity present. Increased vigilance recommended; sanitize fallen fruit.',
    };
  }
  if (level === 'watch') {
    return {
      level,
      label: 'Watch',
      color: '#5E7668',
      bgColor: '#EDF5F0',
      advice:
        'Conditions are favorable for melon fly buildup, but the trap has caught little or nothing yet. No spray needed on weather alone — keep monitoring.',
    };
  }
  // low
  return {
    level: 'low',
    label: 'Low',
    color: '#2D6A4F',
    bgColor: '#D8F3DC',
    advice: weatherOnly
      ? 'Trap catch is negligible and conditions are not strongly favorable. Routine monitoring is sufficient.'
      : 'Low trap activity and conditions not favorable for rapid buildup. Routine monitoring sufficient.',
  };
}

function buildRecommendations(args: {
  score: number;
  level: RiskLevel;
  dailyCount: number | null;
  tempMean: number | null;
  humMean: number | null;
  es: number | null;
  genDays: number | null;
  weatherOnly: boolean;
  missing: RiskResult['missing'];
}): string[] {
  const out: string[] = [];

  // Data hygiene first.
  if (args.missing.includes('thermal') || args.missing.includes('humidity')) {
    out.push(
      'Sensor gap: confirm the DHT11 (temp/humidity) is wired and the Pi service is running so risk uses real weather, not assumptions.',
    );
  }
  if (args.missing.includes('count')) {
    out.push(
      'No trap catch reported: confirm the camera/counter is running. Outbreak risk cannot be scored from weather alone.',
    );
  }

  // Weather-only "watch": be explicit that this is NOT a spray signal.
  if (args.weatherOnly && args.es !== null && args.es >= WATCH_ES_THRESHOLD) {
    out.push(
      'Conditions favor melon fly buildup, but the trap shows little/no catch. Do NOT spray on weather alone — keep monitoring and inspect fruit.',
    );
  }

  // FAO/IAEA action thresholds.
  if (args.dailyCount !== null) {
    if (args.dailyCount >= FTD_OUTBREAK) {
      out.push(
        `Trap catch ${args.dailyCount}/day exceeds the FAO/IAEA outbreak threshold (${FTD_OUTBREAK}/trap/day) for B. cucurbitae — deploy bait sprays (cue-lure + spinosad) within 48 hours.`,
      );
    } else if (args.dailyCount >= FTD_HIGH) {
      out.push(
        `Trap catch ${args.dailyCount}/day is at the FAO/IAEA action threshold (${FTD_HIGH}/trap/day) — increase trap density and inspect fallen fruit.`,
      );
    }
  }

  // Thermal advice.
  if (args.tempMean !== null) {
    if (args.tempMean >= TEMP_OPTIMAL_LO && args.tempMean <= TEMP_OPTIMAL_HI) {
      out.push(
        `Mean temp ${args.tempMean.toFixed(1)} °C sits inside the 25–30 °C dev. optimum — a present population doubles in ~${args.genDays ?? '–'} days.`,
      );
    } else if (args.tempMean < TEMP_OPTIMAL_LO) {
      out.push(
        `Mean temp ${args.tempMean.toFixed(1)} °C is below optimum — development slowed; preventive sanitation is cheaper now than treatment later.`,
      );
    } else if (args.tempMean > TEMP_UPPER_DEV) {
      out.push(
        `Mean temp ${args.tempMean.toFixed(1)} °C exceeds the 33 °C upper threshold — adult survival reduced; do not relax monitoring (heatwaves are followed by rebound).`,
      );
    }
  }

  // Humidity advice.
  if (args.humMean !== null) {
    if (args.humMean >= RH_OPTIMAL_LO && args.humMean <= RH_OPTIMAL_HI) {
      out.push(
        `Humidity ${args.humMean.toFixed(0)} % is in the 60–70 % oviposition optimum — bag host fruit if catch is rising.`,
      );
    } else if (args.humMean >= RH_FUNGAL_ABOVE) {
      out.push(
        `Humidity ${args.humMean.toFixed(0)} % is very high — natural fungal pupal mortality helps you, but check trap drainage.`,
      );
    }
  }

  // Score-driven action.
  if (args.level === 'critical') {
    out.push(
      'Critical: notify the farm group via Community feed, harvest mature ampalaya early, and rotate attractant lures.',
    );
  } else if (args.level === 'high') {
    out.push(
      'High: pre-mix bait spray, sanitize fallen fruit daily, and switch attractant light to a dawn/dusk schedule.',
    );
  } else if (args.level === 'moderate') {
    out.push('Moderate: keep a weekly bait-spray cadence and check trap counts every 48 hours.');
  } else if (args.level === 'low' && args.missing.length === 0 && !args.weatherOnly) {
    out.push('Low risk: maintain weekly trap inspection and field sanitation.');
  }

  return out;
}
