/**
 * pdfReport.ts — generates a printable HTML report and triggers the browser
 * print dialog (which lets the user "Save as PDF").
 *
 * On WEB: opens the report in a hidden iframe and calls `print()` so the
 *         OS print dialog pops up. The dialog has "Save as PDF" on every
 *         major OS (Windows/macOS/Linux/iOS Safari/Android Chrome).
 * On NATIVE (Expo Go): falls back to CSV — Expo Go bundle doesn't include
 *         expo-print by default. Adding it later is a one-liner:
 *           npx expo install expo-print
 *         then `Print.printAsync({ html })`.
 *
 * The report layout intentionally avoids charts (a print-friendly summary
 * table is more useful for an agronomist's binder than tiny rasterized
 * charts).
 */
import { Alert, Platform } from 'react-native';
import type { Sample } from '@/services/samplesStore';
import type { AnomalySignal } from '@/services/anomaly';
import type { RiskLevel } from '@/services/riskScoring';

export interface PdfReportInput {
  deviceName: string;
  deviceId: string;
  farmName: string;
  rangeLabel: string;            // e.g. "Last 7 days"
  generatedAt: number;           // epoch ms
  samples: Sample[];             // already filtered to range
  anomalies: AnomalySignal[];
  risk: {
    level: RiskLevel;
    confidence: number;          // 0-1
    advice: string;
  } | null;
  recommendations: string[];
  projection3d?: number | null;
  projection7d?: number | null;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

function buildHtml(r: PdfReportInput): string {
  const summary = (() => {
    const counts = r.samples
      .map((s) => s.daily ?? 0)
      .filter((n) => Number.isFinite(n));
    const temps = r.samples
      .map((s) => s.temperature)
      .filter((n): n is number => typeof n === 'number');
    const hums = r.samples
      .map((s) => s.humidity)
      .filter((n): n is number => typeof n === 'number');
    const avg = (a: number[]) =>
      a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '—';
    const max = (a: number[]) => (a.length ? Math.max(...a) : '—');
    return {
      n: r.samples.length,
      avgCount: avg(counts),
      maxCount: max(counts),
      avgTemp: avg(temps),
      avgHum: avg(hums),
    };
  })();

  const riskColor = r.risk
    ? r.risk.level === 'critical' || r.risk.level === 'high'
      ? '#dc2626'
      : r.risk.level === 'moderate'
        ? '#d97706'
        : '#16a34a'
    : '#9ca3af';

  const tableRows = r.samples
    .slice(-50) // last 50 rows in printed form
    .map((s) => {
      return `<tr>
        <td>${fmtDate(s.t)}</td>
        <td style="text-align:right">${s.daily ?? '—'}</td>
        <td style="text-align:right">${s.count ?? '—'}</td>
        <td style="text-align:right">${s.temperature !== null ? (s.temperature as number).toFixed(1) : '—'}</td>
        <td style="text-align:right">${s.humidity !== null ? (s.humidity as number).toFixed(0) : '—'}</td>
        <td>${escapeHtml(s.status ?? '—')}</td>
      </tr>`;
    })
    .join('');

  const anomalyRows =
    r.anomalies.length === 0
      ? '<p style="color:#16a34a;margin:6px 0">No anomalies detected in this range.</p>'
      : `<table class="data">
          <thead><tr><th>Channel</th><th>Severity</th><th>z-score</th><th>Description</th></tr></thead>
          <tbody>${r.anomalies
            .map(
              (a) => `<tr>
              <td>${escapeHtml(a.channel)}</td>
              <td><span class="badge ${a.severity}">${a.severity}</span></td>
              <td style="text-align:right">${a.zScore.toFixed(2)}</td>
              <td>${escapeHtml(a.description)}</td>
            </tr>`,
            )
            .join('')}</tbody>
        </table>`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<title>Insectra report — ${escapeHtml(r.deviceName)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; }
  h1 { font-size: 22px; margin: 0 0 4px 0; color: #166534; }
  h2 { font-size: 14px; margin: 18px 0 6px 0; color: #166534; border-bottom: 1px solid #d1fae5; padding-bottom: 4px; }
  .meta { color: #475569; font-size: 11px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 8px 0 12px 0; }
  .stat { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 10px; }
  .stat .l { font-size: 9px; color: #065f46; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
  .stat .v { font-size: 18px; font-weight: 800; color: #065f46; margin-top: 2px; }
  .risk { padding: 10px 12px; border-radius: 8px; border-left: 4px solid ${riskColor}; background: #f8fafc; margin: 8px 0; }
  .risk .lvl { font-size: 14px; font-weight: 800; color: ${riskColor}; text-transform: uppercase; }
  .risk .adv { font-size: 12px; margin-top: 4px; }
  table.data { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.data th, table.data td { border: 1px solid #e2e8f0; padding: 4px 6px; }
  table.data th { background: #f1f5f9; text-align: left; font-weight: 700; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; text-transform: uppercase; }
  .badge.alert { background: #fee2e2; color: #991b1b; }
  .badge.watch { background: #fef3c7; color: #92400e; }
  .badge.normal { background: #dcfce7; color: #166534; }
  ul.rec { margin: 6px 0; padding-left: 18px; font-size: 12px; }
  ul.rec li { margin-bottom: 3px; }
  .foot { margin-top: 24px; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  @media print { .no-print { display: none; } }
</style>
</head><body>
<h1>Insectra IoT Pest Report</h1>
<div class="meta">
  <b>${escapeHtml(r.deviceName)}</b> · Farm: ${escapeHtml(r.farmName)} · Range: ${escapeHtml(r.rangeLabel)}<br/>
  Generated ${fmtDate(r.generatedAt)} · Device ID: <code>${escapeHtml(r.deviceId)}</code>
</div>

<div class="grid">
  <div class="stat"><div class="l">Samples</div><div class="v">${summary.n}</div></div>
  <div class="stat"><div class="l">Avg daily catch</div><div class="v">${summary.avgCount}</div></div>
  <div class="stat"><div class="l">Peak daily</div><div class="v">${summary.maxCount}</div></div>
  <div class="stat"><div class="l">Avg temp / hum</div><div class="v">${summary.avgTemp}°C · ${summary.avgHum}%</div></div>
</div>

${
  r.risk
    ? `<h2>Outbreak risk</h2>
       <div class="risk">
         <div class="lvl">${r.risk.level} · confidence ${(r.risk.confidence * 100).toFixed(0)}%</div>
         <div class="adv">${escapeHtml(r.risk.advice)}</div>
       </div>`
    : ''
}

${
  r.projection3d !== undefined || r.projection7d !== undefined
    ? `<h2>Projections</h2>
       <p style="font-size:12px;margin:4px 0">
         Expected daily catch in 3 days: <b>${r.projection3d ?? '—'}</b><br/>
         Expected daily catch in 7 days: <b>${r.projection7d ?? '—'}</b>
       </p>`
    : ''
}

${
  r.recommendations.length
    ? `<h2>Recommendations</h2>
       <ul class="rec">${r.recommendations.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    : ''
}

<h2>Anomaly detection (robust z-score, median + MAD)</h2>
${anomalyRows}

<h2>Recent samples (last 50 rows)</h2>
<table class="data">
  <thead><tr>
    <th>Time</th><th>Daily</th><th>Cumulative</th><th>°C</th><th>RH%</th><th>Status</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>

<div class="foot">
  Generated by Insectra v3 · Methodology: outbreak risk per Sec. 8 of the
  Insectra outbreak-research paper (median+MAD baseline, weighted env+catch
  composite). Data sourced from the device's local sample buffer mirrored to
  Firestore (5-min throttle).
</div>

<button class="no-print" onclick="window.print()" style="position:fixed;top:8px;right:8px;padding:8px 14px;background:#15803d;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer">Print / Save as PDF</button>
</body></html>`;
}

/** Generate the report and trigger the print dialog (web). */
export async function exportPdfReport(input: PdfReportInput): Promise<void> {
  const html = buildHtml(input);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Open in a new window so the user keeps the app open and can choose
    // "Save as PDF" from the print dialog.
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      Alert.alert(
        'Pop-up blocked',
        'Please allow pop-ups for this site to download the PDF report.',
      );
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Give the browser a tick to lay out before opening the print dialog.
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* user can still click the in-page Print button */
      }
    }, 400);
    return;
  }

  // Native fallback: tell the user to use the web app (or install expo-print).
  Alert.alert(
    'PDF export — web only',
    'PDF export currently runs in the web app (any browser → Save as PDF). On mobile, use the CSV export and open it in Excel / Google Sheets, or install expo-print to enable native PDF.',
  );
}
