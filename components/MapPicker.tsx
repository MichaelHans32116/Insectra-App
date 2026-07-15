/**
 * MapPicker — embeds a Leaflet (OpenStreetMap) map for picking a coordinate.
 *
 * - Zero API keys required (free OSM tiles via openstreetmap.org).
 * - Web uses an iframe; native Android/iOS uses react-native-webview.
 * - Search + current-location flows work on both web and native builds.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import { Colors, Radius } from '@/constants/theme';
import { useLocalText } from '@/services/i18n';
import { useThemeStyles } from '@/services/theme';

interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  /**
   * Optional — called when the user picks a search result. The display name
   * Nominatim returns ("Brgy. San Vicente, Pulilan, Bulacan, ...") is a much
   * better default for the human-readable location label than free-text
   * the farmer types in. Edit-device wires this into setLocLabel.
   */
  onLabelChange?: (label: string) => void;
  defaultCenter?: { lat: number; lng: number };
  height?: number;
}

interface SearchHit {
  name: string;
  lat: number;
  lng: number;
}

const DEFAULT_CENTER = { lat: 14.5995, lng: 120.9842 }; // Manila, PH

function formatCoordinateInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function leafletHtml(center: { lat: number; lng: number }, marker: { lat: number; lng: number } | null): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #m { margin:0; padding:0; height:100%; width:100%; }
  body { font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('m', { attributionControl: false }).setView([${center.lat}, ${center.lng}], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
  let marker = ${marker ? `L.marker([${marker.lat}, ${marker.lng}], { draggable: true }).addTo(map)` : 'null'};
  function emit(lat, lng) {
    const payload = JSON.stringify({ type: 'mapPicker:set', lat, lng });
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(payload);
      return;
    }
    parent.postMessage({ type: 'mapPicker:set', lat, lng }, '*');
  }
  map.on('click', (e) => {
    if (marker) { marker.setLatLng(e.latlng); }
    else {
      marker = L.marker(e.latlng, { draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); emit(p.lat, p.lng); });
    }
    emit(e.latlng.lat, e.latlng.lng);
  });
  if (marker) {
    marker.on('dragend', () => { const p = marker.getLatLng(); emit(p.lat, p.lng); });
  }
</script>
</body>
</html>`;
}

export default function MapPicker(props: MapPickerProps) {
  const { latitude, longitude, onChange, onLabelChange, defaultCenter = DEFAULT_CENTER, height = 280 } = props;
  const text = useLocalText();
  const styles = useThemeStyles(createStyles);
  const center = latitude !== null && longitude !== null
    ? { lat: latitude, lng: longitude }
    : defaultCenter;
  const marker = latitude !== null && longitude !== null
    ? { lat: latitude, lng: longitude }
    : null;

  // Build srcDoc once per render where coords actually changed externally.
  const html = useMemo(() => leafletHtml(center, marker), [center.lat, center.lng, marker?.lat, marker?.lng]);

  // ── Search (OpenStreetMap Nominatim, no API key) ────────────────────
  // Nominatim's usage policy asks for a referrer/user-agent and "no more
  // than 1 request per second". Browser fetch cannot set User-Agent, but
  // the Referer is sent automatically by the browser, which satisfies the
  // identification requirement for a low-traffic capstone project.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [latDraft, setLatDraft] = useState(() => formatCoordinateInput(latitude));
  const [lngDraft, setLngDraft] = useState(() => formatCoordinateInput(longitude));

  useEffect(() => {
    setLatDraft(formatCoordinateInput(latitude));
  }, [latitude]);

  useEffect(() => {
    setLngDraft(formatCoordinateInput(longitude));
  }, [longitude]);

  function applyCoordinates(nextLat: number, nextLng: number, nextLabel?: string) {
    onChange(nextLat, nextLng);
    setLatDraft(formatCoordinateInput(nextLat));
    setLngDraft(formatCoordinateInput(nextLng));
    if (nextLabel) {
      onLabelChange?.(nextLabel);
    }
  }

  async function reverseLookup(lat: number, lng: number): Promise<string | null> {
    try {
      const url =
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=' +
        encodeURIComponent(String(lat)) +
        '&lon=' +
        encodeURIComponent(String(lng));
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) return null;
      const data = (await res.json()) as { display_name?: string };
      return data.display_name?.trim() || null;
    } catch {
      return null;
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setStatusText(null);
    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>;
      const hits: SearchHit[] = (data || [])
        .map((r) => ({
          name: r.display_name ?? '',
          lat: parseFloat(r.lat ?? ''),
          lng: parseFloat(r.lon ?? ''),
        }))
        .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
      setResults(hits);
      if (hits.length === 0) setStatusText(text('No matching places found.', 'Walang nahanap na tugmang lugar.'));
    } catch {
      setStatusText(text('Search failed. Check your connection and try again.', 'Hindi nagtagumpay ang paghahanap. Suriin ang koneksyon at subukan ulit.'));
    } finally {
      setSearching(false);
    }
  }

  function pickResult(hit: SearchHit) {
    applyCoordinates(hit.lat, hit.lng, hit.name);
    setResults([]);
    setQuery(hit.name);
  }

  async function useMyGps() {
    setGpsBusy(true);
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        setGpsBusy(false);
        setStatusText(text('GPS is not available on this device. Please tap the map instead.', 'Walang GPS sa device na ito. Pindutin na lang ang mapa.'));
        return;
      }

      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setGpsBusy(false);
        setStatusText(
          text(
            'GPS only works on https:// or http://localhost. Open this page on the same laptop running the dev server, or build a production https URL.',
            'Gagana lang ang GPS sa https:// o http://localhost. Buksan ito sa parehong laptop na nagpapatakbo ng dev server, o gumawa ng production https URL.',
          ),
        );
        return;
      }

      try {
        // @ts-ignore
        if (navigator.permissions?.query) {
          // @ts-ignore
          const permission = await navigator.permissions.query({ name: 'geolocation' });
          if (permission.state === 'denied') {
            setGpsBusy(false);
            setStatusText(
              text(
                'Location is blocked for this site. Click the lock icon → Site settings → Location → Allow, then refresh.',
                'Naka-block ang location para sa site na ito. I-click ang lock icon → Site settings → Location → Allow, tapos i-refresh.',
              ),
            );
            return;
          }
        }
      } catch {
        // Permissions API is optional on web.
      }

      setStatusText(text('Asking your browser for location… please tap "Allow" if a prompt appears.', 'Humihingi ng location sa browser… pindutin ang "Allow" kapag may prompt.'));
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const nextLat = pos.coords.latitude;
          const nextLng = pos.coords.longitude;
          const label = await reverseLookup(nextLat, nextLng);
          applyCoordinates(nextLat, nextLng, label ?? undefined);
          setGpsBusy(false);
          setStatusText(text(
            `Pin set to your current location (±${Math.round(pos.coords.accuracy)} m).`,
            `Na-set ang pin sa kasalukuyan mong lokasyon (±${Math.round(pos.coords.accuracy)} m).`,
          ));
        },
        (err) => {
          setGpsBusy(false);
          let reason: string;
          if (err.code === err.PERMISSION_DENIED) {
            reason = text('Location permission denied. Click the lock icon in the address bar → Site settings → Location → Allow, then try again.', 'Tinanggihan ang location permission. I-click ang lock icon sa address bar → Site settings → Location → Allow, tapos subukan ulit.');
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            reason = text('Your device could not determine its location. Make sure Wi-Fi or GPS is on, then retry.', 'Hindi matukoy ng device ang lokasyon nito. Tiyaking naka-on ang Wi-Fi o GPS, tapos subukan ulit.');
          } else if (err.code === err.TIMEOUT) {
            reason = text('GPS timed out. Step outside or near a window and try again.', 'Nag-time out ang GPS. Lumabas o pumunta malapit sa bintana at subukan ulit.');
          } else {
            reason = err.message || text('Could not read GPS.', 'Hindi mabasa ang GPS.');
          }
          setStatusText(reason);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
      return;
    }

    setStatusText(text('Requesting location permission from your phone…', 'Humihingi ng location permission sa phone mo…'));
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatusText(text('Location permission denied. Allow location access in Android settings, then try again.', 'Tinanggihan ang location permission. Payagan ang location access sa Android settings, tapos subukan ulit.'));
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      });
      const nextLat = position.coords.latitude;
      const nextLng = position.coords.longitude;
      const label = await reverseLookup(nextLat, nextLng);
      applyCoordinates(nextLat, nextLng, label ?? undefined);
      setStatusText(text(
        `Pin set to your current location (±${Math.round(position.coords.accuracy ?? 0)} m).`,
        `Na-set ang pin sa kasalukuyan mong lokasyon (±${Math.round(position.coords.accuracy ?? 0)} m).`,
      ));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : text('Could not read GPS.', 'Hindi mabasa ang GPS.'));
    } finally {
      setGpsBusy(false);
    }
  }

  function handleIncomingMessage(payload: unknown) {
    let data: any = payload;
    if (typeof payload === 'string') {
      try {
        data = JSON.parse(payload);
      } catch {
        return;
      }
    }
    if (!data || data.type !== 'mapPicker:set') return;
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      applyCoordinates(data.lat, data.lng);
    }
  }

  function commitManualCoordinate(kind: 'lat' | 'lng', raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatusText(text('Both latitude and longitude are required.', 'Kailangan ang parehong latitude at longitude.'));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setStatusText(text(
        `${kind === 'lat' ? 'Latitude' : 'Longitude'} must be a valid number.`,
        `${kind === 'lat' ? 'Latitude' : 'Longitude'} ay dapat wastong numero.`,
      ));
      if (kind === 'lat') setLatDraft(formatCoordinateInput(latitude));
      else setLngDraft(formatCoordinateInput(longitude));
      return;
    }

    const nextLat = kind === 'lat' ? parsed : (latitude ?? defaultCenter.lat);
    const nextLng = kind === 'lng' ? parsed : (longitude ?? defaultCenter.lng);
    applyCoordinates(nextLat, nextLng);
    setStatusText(text('Coordinates updated manually.', 'Na-update nang mano-mano ang coordinates.'));
  }

  // Listen for messages from the iframe.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      handleIncomingMessage(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [latitude, longitude, onChange]);

  return (
    <View style={{ gap: 10 }}>
      <TouchableOpacity
        style={[styles.gpsCta, gpsBusy && { opacity: 0.7 }]}
        onPress={useMyGps}
        disabled={gpsBusy}
        activeOpacity={0.85}
      >
        {gpsBusy ? (
          <ActivityIndicator color={Colors.textOnPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={Colors.textOnPrimary} />
            <Text style={styles.gpsCtaText}>{text('Use my current location', 'Gamitin ang kasalukuyan kong lokasyon')}</Text>
          </>
        )}
      </TouchableOpacity>
      <Text style={styles.gpsHint}>
        {text('Stand beside the trap and tap above, or search a nearby barangay and adjust the pin on the map.', 'Tumayo sa tabi ng trap at pindutin ang nasa itaas, o maghanap ng kalapit na barangay at ayusin ang pin sa mapa.')}
      </Text>

      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              if (statusText) setStatusText(null);
            }}
            onSubmitEditing={runSearch}
            placeholder={text('Search a barangay / town', 'Maghanap ng barangay / bayan')}
            placeholderTextColor={Colors.textTertiary}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => { setQuery(''); setResults([]); }}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={text('Clear search', 'I-clear ang paghahanap')}
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={Colors.textTertiary} />
            </Pressable>
          )}
        </View>
        <TouchableOpacity
          style={[styles.toolBtn, searching && { opacity: 0.6 }]}
          onPress={runSearch}
          disabled={searching}
          activeOpacity={0.85}
        >
          {searching ? (
            <ActivityIndicator color={Colors.textOnPrimary} size="small" />
          ) : (
            <Text style={styles.toolBtnText}>{text('Search', 'Maghanap')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {results.length > 0 && (
        <View style={styles.results}>
          {results.map((r, i) => (
            <TouchableOpacity
              key={`${r.lat},${r.lng},${i}`}
              style={[styles.resultRow, i > 0 && styles.resultRowDivider]}
              activeOpacity={0.85}
              onPress={() => pickResult(r)}
            >
              <MaterialCommunityIcons name="map-marker-outline" size={16} color={Colors.primaryDark} />
              <Text style={styles.resultText} numberOfLines={2}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {statusText && (
        <View style={styles.statusBanner}>
          <MaterialCommunityIcons name="information-outline" size={16} color={Colors.primaryDark} />
          <Text style={styles.statusBannerText}>{statusText}</Text>
        </View>
      )}

      <View style={[styles.wrap, { height }]}>
        {Platform.OS === 'web' ? (
          // eslint-disable-next-line react/no-unknown-property
          <iframe
            srcDoc={html}
            style={{ border: 'none', width: '100%', height: '100%' }}
            title="Insectra location picker"
            // @ts-ignore — sandbox is allowed in DOM
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            onMessage={(event) => handleIncomingMessage(event.nativeEvent.data)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.mapLoading}>
                <ActivityIndicator color={Colors.primary} />
                <Text style={styles.mapLoadingText}>{text('Loading map…', 'Naglo-load ang mapa…')}</Text>
              </View>
            )}
          />
        )}
        <View style={styles.coordPill}>
          <Text style={styles.coordPillText}>
            {latitude !== null && longitude !== null
              ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
              : text('Tap on the map to drop a pin', 'Pindutin ang mapa para maglagay ng pin')}
          </Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{text('Latitude', 'Latitude')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            value={latDraft}
            onChangeText={setLatDraft}
            onBlur={() => commitManualCoordinate('lat', latDraft)}
            onSubmitEditing={() => commitManualCoordinate('lat', latDraft)}
            placeholder="14.20422"
            placeholderTextColor={Colors.textTertiary}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{text('Longitude', 'Longitude')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            value={lngDraft}
            onChangeText={setLngDraft}
            onBlur={() => commitManualCoordinate('lng', lngDraft)}
            onSubmitEditing={() => commitManualCoordinate('lng', lngDraft)}
            placeholder="120.83873"
            placeholderTextColor={Colors.textTertiary}
          />
        </View>
      </View>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    position: 'relative',
  },
  coordPill: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(11,31,20,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  coordPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  gpsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primaryDark,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
  },
  gpsCtaText: { color: Colors.textOnPrimary, fontWeight: '800', fontSize: 15 },
  gpsHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16, textAlign: 'center' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    paddingVertical: 4,
    minWidth: 0,
  },
  toolBtn: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.md,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 12 },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.primaryTint,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statusBannerText: { flex: 1, fontSize: 12, color: Colors.primaryDark, lineHeight: 16, fontWeight: '600' },
  results: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  resultRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderLight },
  resultText: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },
  statusText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },
  tipText: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: Colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.textPrimary,
    backgroundColor: Colors.surfaceAlt,
  },
  mapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
  },
  mapLoadingText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
});
