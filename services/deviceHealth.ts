import { Colors } from '@/constants/theme';
import type { DeviceState } from '@/services/iotRealtime';

export type StatusTone = 'good' | 'watch' | 'warning' | 'critical' | 'unknown';

export interface BatteryHealth {
  percent: number | null;
  voltage: number | null;
  level: StatusTone;
  label: string;
  detail: string;
  color: string;
  bgColor: string;
}

export interface TrapCapacity {
  percent: number;
  capacity: number;
  countSinceService: number;
  level: StatusTone;
  label: string;
  detail: string;
  color: string;
  bgColor: string;
}

const DEFAULT_TRAP_CAPACITY = 120;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Battery pack is 2S Li-ion (~8.4V full / 7.4V nominal / 6.4V low) — see
// Documents/insectra-hardware-reference.md. Crude linear voltage->% gauge, only
// used as a fallback when the Pi does not report a numeric batteryPercent.
// NOTE: anchors are the 2S PACK range, not a single 1S cell — a 1S curve
// (>=4.15V => 100) would pin every real pack voltage at 100% and defeat the
// low/critical thresholds below.
const BATTERY_FULL_V = 8.4; // 2S full (~4.2V/cell)
const BATTERY_EMPTY_V = 6.0; // 2S practically empty (~3.0V/cell)

function estimatePercentFromVoltage(voltage: number): number {
  if (voltage >= BATTERY_FULL_V) return 100;
  if (voltage <= BATTERY_EMPTY_V) return 0;
  return ((voltage - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100;
}

function toneColors(level: StatusTone): { color: string; bgColor: string } {
  if (level === 'good') return { color: Colors.primaryDark, bgColor: Colors.primaryTint };
  if (level === 'watch') return { color: Colors.primary, bgColor: Colors.primaryFaint };
  if (level === 'warning') return { color: Colors.warning, bgColor: Colors.warningBg };
  if (level === 'critical') return { color: Colors.danger, bgColor: Colors.dangerBg };
  return { color: Colors.textSecondary, bgColor: Colors.surfaceAlt };
}

export function computeBatteryHealth(state: DeviceState | null): BatteryHealth {
  const rawPercent = state?.batteryPercent ?? null;
  const voltage = state?.batteryVoltage ?? null;
  const percent = rawPercent !== null
    ? clamp(rawPercent)
    : voltage !== null
      ? clamp(estimatePercentFromVoltage(voltage))
      : null;

  if (percent === null) {
    return {
      percent,
      voltage,
      level: 'unknown',
      label: 'Waiting',
      detail: 'Battery sensor not reporting yet',
      ...toneColors('unknown'),
    };
  }

  let level: StatusTone = 'good';
  let label = 'Good';
  let detail = 'Enough charge for field monitoring';

  if (percent <= 15) {
    level = 'critical';
    label = 'Critical';
    detail = 'Charge or replace power source';
  } else if (percent <= 30) {
    level = 'warning';
    label = 'Low';
    detail = 'Schedule charging soon';
  } else if (percent <= 55) {
    level = 'watch';
    label = 'Watch';
    detail = 'Monitor during long deployment';
  }

  return {
    percent: round(percent),
    voltage,
    level,
    label,
    detail,
    ...toneColors(level),
  };
}

export function computeTrapCapacity(state: DeviceState | null): TrapCapacity {
  const capacity = Math.max(1, Math.round(state?.trapCapacity ?? DEFAULT_TRAP_CAPACITY));
  // Use ONLY the explicit countSinceService field. Do NOT fall back to totalCount —
  // totalCount is the cumulative lifetime count and would falsely fill the trap meter
  // with old test data the moment the device first connects.
  const rawCount = state?.countSinceService;
  const hasCount = rawCount !== null && rawCount !== undefined;
  const countSinceService = hasCount ? Math.max(0, Math.round(rawCount as number)) : 0;
  const reportedPercent = state?.trapFullnessPercent ?? null;
  const percent = reportedPercent !== null
    ? clamp(reportedPercent)
    : hasCount
      ? clamp((countSinceService / capacity) * 100)
      : 0;

  let level: StatusTone = hasCount ? 'good' : 'unknown';
  let label = hasCount ? 'Open' : 'Waiting';
  let detail = hasCount ? 'Trap has capacity remaining' : 'No service-cycle count reported yet';

  if (hasCount) {
    if (percent >= 90) {
      level = 'critical';
      label = 'Full';
      detail = 'Service trap and reset count';
    } else if (percent >= 75) {
      level = 'warning';
      label = 'Service Soon';
      detail = 'Plan collection before overflow';
    } else if (percent >= 50) {
      level = 'watch';
      label = 'Filling';
      detail = 'Check trap on next field visit';
    }
  }

  return {
    percent: round(percent),
    capacity,
    countSinceService,
    level,
    label,
    detail,
    ...toneColors(level),
  };
}