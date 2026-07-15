/**
 * RiskMap — embeds a Leaflet (OpenStreetMap) map showing every device in the
 * active farm as a colored marker. Color = current outbreak-risk level for
 * that trap.
 *
 *   green  → low
 *   amber  → moderate
 *   red    → high
 *   grey   → unknown / no env data yet
 *
 * On WEB: rendered with an <iframe srcDoc=...> (same pattern as MapPicker).
 *         No API key, no install — plain OSM tiles.
 * On NATIVE: shows a textual fallback ("View on web for the full map") and
 *         a list of devices grouped by risk. Adding react-native-webview
 *         in the future would give the same map natively.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors, Radius } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';

export interface RiskMapDevice {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  riskLevel: 'low' | 'moderate' | 'high' | null;
  dailyCount: number | null;
}

const COLORS = {
  low: '#16a34a',
  moderate: '#d97706',
  high: '#dc2626',
  unknown: '#9ca3af',
};

function colorFor(level: RiskMapDevice['riskLevel']): string {
  if (!level) return COLORS.unknown;
  return COLORS[level];
}

function leafletHtml(devices: RiskMapDevice[]): string {
  // Pre-filter to devices with valid coords so the map auto-bounds tightly.
  const placed = devices.filter(
    (d) => typeof d.latitude === 'number' && typeof d.longitude === 'number',
  );
  const center =
    placed.length > 0
      ? {
          lat: placed.reduce((a, d) => a + (d.latitude as number), 0) / placed.length,
          lng: placed.reduce((a, d) => a + (d.longitude as number), 0) / placed.length,
        }
      : { lat: 14.5995, lng: 120.9842 };

  const markersJs = placed
    .map((d) => {
      const c = colorFor(d.riskLevel);
      const popup = `<b>${escapeHtml(d.name)}</b><br/>` +
        `Risk: <span style="color:${c};font-weight:700">${d.riskLevel ?? 'unknown'}</span><br/>` +
        (d.dailyCount !== null ? `Today's catch: ${d.dailyCount}` : 'No data today');
      return `L.circleMarker([${d.latitude}, ${d.longitude}], {
        radius: 10, color: '${c}', fillColor: '${c}', fillOpacity: 0.75, weight: 2
      }).addTo(map).bindPopup(${JSON.stringify(popup)});`;
    })
    .join('\n');

  const boundsJs =
    placed.length > 1
      ? `map.fitBounds([${placed
          .map((d) => `[${d.latitude}, ${d.longitude}]`)
          .join(',')}], { padding: [30, 30], maxZoom: 16 });`
      : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#m{margin:0;padding:0;height:100%;width:100%;}</style>
</head><body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('m', { attributionControl: false }).setView([${center.lat}, ${center.lng}], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
  ${markersJs}
  ${boundsJs}
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

export default function RiskMap({
  devices,
  height = 280,
}: {
  devices: RiskMapDevice[];
  height?: number;
}) {
  const styles = useThemeStyles(makeStyles);
  const placedCount = useMemo(
    () => devices.filter((d) => typeof d.latitude === 'number' && typeof d.longitude === 'number').length,
    [devices],
  );

  if (Platform.OS !== 'web') {
    // Native fallback: list devices grouped by risk.
    return (
      <View style={[styles.nativeFallback, { minHeight: height }]}>
        <MaterialCommunityIcons name="map-marker-radius-outline" size={28} color={Colors.primaryDark} />
        <Text style={styles.nativeTitle}>Farm map (web only for now)</Text>
        <Text style={styles.nativeBody}>
          {placedCount} of {devices.length} devices have coordinates set. Open the web app to see the heatmap.
        </Text>
        <View style={styles.legend}>
          <Legend color={COLORS.high} label="High risk" />
          <Legend color={COLORS.moderate} label="Moderate" />
          <Legend color={COLORS.low} label="Low" />
          <Legend color={COLORS.unknown} label="No data" />
        </View>
      </View>
    );
  }

  if (placedCount === 0) {
    return (
      <View style={[styles.nativeFallback, { minHeight: height }]}>
        <MaterialCommunityIcons name="map-marker-off-outline" size={28} color={Colors.textTertiary} />
        <Text style={styles.nativeTitle}>No device coordinates</Text>
        <Text style={styles.nativeBody}>
          Pin each trap on the map when registering it (My Devices → Edit → set location)
          to see it here.
        </Text>
      </View>
    );
  }

  // Web: drop in an iframe with the Leaflet HTML.
  const html = leafletHtml(devices);
  // We render an inline iframe via a forwarded view. React Native Web supports
  // dangerouslySetInnerHTML through a `<div>` mapped from `<View>` only in raw
  // HTML, so we reach into react-native-web by rendering an actual iframe via
  // a tiny inline component.
  return (
    <View style={[styles.webWrap, { height }]}>
      {/* @ts-ignore — RNW passes through unknown DOM elements */}
      <iframe
        srcDoc={html}
        style={{
          border: '0',
          width: '100%',
          height: '100%',
          borderRadius: Radius.lg,
        }}
        title="Insectra farm map"
      />
      <View style={styles.legendOverlay}>
        <Legend color={COLORS.high} label="High" />
        <Legend color={COLORS.moderate} label="Moderate" />
        <Legend color={COLORS.low} label="Low" />
        <Legend color={COLORS.unknown} label="No data" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  webWrap: {
    width: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  legendOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    gap: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 10, fontWeight: '700', color: Colors.textPrimary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  nativeFallback: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  nativeTitle: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  nativeBody: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});
