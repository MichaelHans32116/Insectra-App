import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { usePrimaryCloudDevice } from '@/services/activeDevice';
import { listenDeviceState, type DeviceState } from '@/services/iotRealtime';
import { getPiApiBase, getCachedPiHost, getRemotePiBase, isRemotePiReachable, discoverPi, onDiscoveryStatus, rediscoverPi } from '@/services/piDiscovery';
import { toast } from '@/services/eventBus';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useThemeStyles } from '@/services/theme';
import { Screen, Card, Button, Badge, StatTile } from '@/components/ui';

const LIVE_POLL_MS = 3000;
const ONLINE_WINDOW_MS = 6 * 60 * 1000;

type DetectMode = 'idle' | 'capture' | 'live';

interface Detection {
  label: string;
  confidence: number;
  /** Pixel box from Pi, mapped to percentage at render time */
  box: { x1: number; y1: number; x2: number; y2: number };
}

interface DetectionResult {
  imageUri: string;
  detections: Detection[];
  inferenceMs: number;
  timestamp: Date;
  frameWidth: number;
  frameHeight: number;
}

function formatTime(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function getRemoteHostLabel(base: string | null): string | null {
  if (!base) return null;
  try {
    return String(base)
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];
  } catch {
    return base.replace(/^https?:\/\//i, '');
  }
}

function getDisplayStatus(state: DeviceState | null): string {
  const rawStatus = state?.status ?? 'offline';
  const normalizedStatus = rawStatus.toLowerCase();
  const statusSaysOnline = normalizedStatus === 'online' || normalizedStatus === 'running';

  if (!statusSaysOnline) {
    return rawStatus;
  }

  if (!state?.lastSeen) {
    return 'offline';
  }

  return Date.now() - state.lastSeen.getTime() <= ONLINE_WINDOW_MS ? 'online' : 'offline';
}

function formatCameraReachabilityMessage(remoteBase: string | null, error: unknown): string {
  const host = getRemoteHostLabel(remoteBase);
  const raw = error instanceof Error ? error.message.trim() : '';
  const lower = raw.toLowerCase();

  if (remoteBase) {
    if (
      lower.includes('resolve')
      || lower.includes('dns')
      || lower.includes('name')
      || lower.includes('network request failed')
      || lower.includes('failed to fetch')
    ) {
      return host
        ? `Could not reach the Pi camera through ${host}. The saved tunnel URL may already be expired. Update it in Worldwide Camera, then reconnect.`
        : 'Could not reach the Pi camera. The saved tunnel URL may already be expired. Update it in Worldwide Camera, then reconnect.';
    }

    return host
      ? `Could not reach the Pi camera through ${host}. Check the tunnel URL or try reconnecting.`
      : 'Could not reach the Pi camera. Check the tunnel URL or try reconnecting.';
  }

  return 'Could not reach Pi camera. Check WiFi, Pi power, and that the Pi service was started with --api.';
}

export default function DetectScreen() {
  const styles = useThemeStyles(createStyles);
  const { device: targetDevice, cloudDeviceId: targetCloudDeviceId, loading: targetDeviceLoading } = usePrimaryCloudDevice();
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [mode, setMode] = useState<DetectMode>('idle');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState('');
  const [discoveryHost, setDiscoveryHost] = useState<string | null>(null);
  const liveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRegisteredDevice = Boolean(targetDevice && targetCloudDeviceId);
  const deviceLabel = targetDevice ? `${targetDevice.name} (${targetDevice.piCode})` : 'your registered Pi trap';

  useEffect(() => {
    if (!targetCloudDeviceId) {
      setDeviceState(null);
      return;
    }
    const unsub = listenDeviceState(targetCloudDeviceId, setDeviceState);
    return unsub;
  }, [targetCloudDeviceId]);

  useEffect(() => {
    const unsub = onDiscoveryStatus((host, statusText) => {
      setDiscoveryHost(host);
      setDiscoveryStatus(statusText);
    });
    return unsub;
  }, []);

  // Eagerly discover the Pi on the LAN as soon as the live-test screen
  // mounts. Without this, when Firebase is providing cloud telemetry the
  // app never runs piDiscovery, so getCachedPiHost() stays null and the
  // user sees "Pi Not Found" the first time they tap Capture or Live —
  // even though the Pi is healthy and on the same WiFi. Doing the scan
  // here makes the LAN-only endpoints (/capture, /snapshot) available
  // by the time the user actually presses a button.
  useEffect(() => {
    if (!targetCloudDeviceId) return;
    if (!getPiApiBase() || !getCachedPiHost()) {
      discoverPi().catch(() => { /* status surfaced in UI */ });
    }
  }, [targetCloudDeviceId]);

  // Cleanup live polling on unmount
  useEffect(() => {
    return () => {
      if (liveInterval.current) clearInterval(liveInterval.current);
    };
  }, []);

  const parseApiDetections = (data: any): Detection[] => {
    if (!data.detections || !Array.isArray(data.detections)) return [];
    return data.detections.map((d: any) => ({
      label: 'Melon Fruit Fly',
      confidence: Number(d.confidence ?? 0),
      box: { x1: Number(d.x1), y1: Number(d.y1), x2: Number(d.x2), y2: Number(d.y2) },
    }));
  };

  const requestPiJson = useCallback(async (path: string, timeoutMs: number, allowRediscovery = true) => {
    let piBase = getPiApiBase();
    if (!piBase) {
      await discoverPi();
      piBase = getPiApiBase();
    }
    if (!piBase) {
      throw new Error('Pi unavailable');
    }

    const fetchJson = async (base: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await fetchJson(piBase);
    } catch (error) {
      if (!allowRediscovery) {
        throw error;
      }

      await rediscoverPi();
      const retryBase = getPiApiBase();
      if (!retryBase) {
        throw error;
      }
      return await fetchJson(retryBase);
    }
  }, []);

  const fetchSnapshot = useCallback(async (): Promise<DetectionResult | null> => {
    try {
      const data = await requestPiJson('/snapshot', 8000, false);
      if (data.image) {
        return {
          imageUri: `data:image/jpeg;base64,${data.image}`,
          detections: parseApiDetections(data),
          inferenceMs: deviceState?.inferenceMs ?? 0,
          timestamp: new Date(),
          frameWidth: Number(data.frameWidth ?? 640),
          frameHeight: Number(data.frameHeight ?? 480),
        };
      }
    } catch {
      // silent
    }
    return null;
  }, [deviceState, requestPiJson]);

  const useSnapshotFallback = useCallback(async () => {
    const fallback = await fetchSnapshot();
    if (!fallback) return false;

    setResult(fallback);
    toast.info(
      'capture',
      'Fresh capture unavailable',
      'Showing the latest available frame from the Pi instead.',
    );
    return true;
  }, [fetchSnapshot]);

  const handleCapture = async () => {
    if (!hasRegisteredDevice) {
      Alert.alert('Register a device first', 'Open My Devices and register the Pi you want to use before starting live detection.');
      return;
    }
    setMode('capture');
    setLoading(true);
    const remoteBase = getRemotePiBase();
    if (!getPiApiBase()) {
      await discoverPi();
    }
    if (!getPiApiBase()) {
      setLoading(false);
      Alert.alert(
        'Pi Not Found',
        remoteBase
          ? 'Could not reach the Pi right now. Try Reconnect, or verify the remote tunnel URL in Remote Access.'
          : 'Could not reach the Pi on this WiFi. Make sure the Pi is powered on, the InsecTra service is running with --api, and the phone is on the same network.',
        [
          { text: 'Retry', onPress: () => rediscoverPi().then(() => handleCapture()) },
          { text: 'Cancel' },
        ],
      );
      return;
    }
    try {
      const data = await requestPiJson('/capture', 15000);
      if (data.image) {
        setResult({
          imageUri: `data:image/jpeg;base64,${data.image}`,
          detections: parseApiDetections(data),
          inferenceMs: Number(data.inferenceMs ?? 0),
          timestamp: new Date(),
          frameWidth: Number(data.frameWidth ?? 640),
          frameHeight: Number(data.frameHeight ?? 480),
        });
        const dCount = parseApiDetections(data).length;
        toast.ok('capture', 'Image captured', `${dCount} detection${dCount === 1 ? '' : 's'} • ${Number(data.inferenceMs ?? 0)} ms`);
      } else {
        const recovered = await useSnapshotFallback();
        if (!recovered) {
          setMode('idle');
          toast.err('capture', 'Capture failed', data.error ?? 'No image returned from Pi.');
          Alert.alert('Capture Failed', data.error ?? 'No image returned from Pi.');
        }
      }
    } catch (error) {
      const detail = formatCameraReachabilityMessage(remoteBase, error);
      const recovered = await useSnapshotFallback();
      if (!recovered) {
        setMode('idle');
        toast.err('capture', 'Capture failed', detail);
        Alert.alert('Capture Failed', detail);
      }
    }
    setLoading(false);
  };

  const handleLiveStart = async () => {
    if (!hasRegisteredDevice) {
      Alert.alert('Register a device first', 'Open My Devices and register the Pi you want to use before starting the live camera.');
      return;
    }
    setMode('live');
    setLoading(true);
    const remoteBase = getRemotePiBase();
    if (!getPiApiBase()) {
      await discoverPi();
    }
    if (!getPiApiBase()) {
      setLoading(false);
      setMode('idle');
      Alert.alert(
        'Pi Not Found',
        remoteBase
          ? 'Pi is not reachable at the moment. Try Reconnect, or verify the remote tunnel URL in Remote Access.'
          : 'Pi not yet reachable on this WiFi. Try Reconnect, or check that the Pi is powered on and running the local API service.',
      );
      return;
    }

    const poll = async () => {
      try {
        const data = await requestPiJson('/snapshot', 6000, false);
        if (data.image) {
          setLiveFrame(`data:image/jpeg;base64,${data.image}`);
          setResult({
            imageUri: `data:image/jpeg;base64,${data.image}`,
            detections: parseApiDetections(data),
            inferenceMs: deviceState?.inferenceMs ?? 0,
            timestamp: new Date(),
            frameWidth: Number(data.frameWidth ?? 640),
            frameHeight: Number(data.frameHeight ?? 480),
          });
        }
      } catch (error) {
        setDiscoveryStatus(formatCameraReachabilityMessage(remoteBase, error));
      }
      setLoading(false);
    };

    poll();
    liveInterval.current = setInterval(poll, LIVE_POLL_MS);
    toast.ok('liveCamera', 'Live camera ON', 'Polling Pi every 3 s');
  };

  const handleLiveStop = () => {
    const hadLiveSession = Boolean(liveInterval.current) || mode === 'live';
    if (liveInterval.current) {
      clearInterval(liveInterval.current);
      liveInterval.current = null;
    }
    setMode('idle');
    if (hadLiveSession) {
      toast.info('liveCamera', 'Live camera OFF');
    }
  };

  const handleReset = () => {
    handleLiveStop();
    setResult(null);
    setLiveFrame(null);
    setMode('idle');
  };

  const rawStatus = deviceState?.status ?? 'offline';
  const status = getDisplayStatus(deviceState);
  const isOnline = status === 'online';
  const isSearching = rawStatus.toLowerCase().includes('search') || rawStatus.toLowerCase().includes('connecting') || rawStatus.toLowerCase().includes('scanning');
  const piHost = getCachedPiHost();
  const remoteBase = getRemotePiBase();
  const activeBase = getPiApiBase();
  const remoteHost = getRemoteHostLabel(remoteBase);
  const remoteReachable = isRemotePiReachable();
  const usingRemote = Boolean(remoteReachable && remoteBase && activeBase === remoteBase);
  const discoveryBusy = /trying|searching|scanning|connecting/i.test(discoveryStatus);
  const connectionReady = hasRegisteredDevice && (Boolean(piHost) || usingRemote);
  const cameraReady = connectionReady;
  const totalCount = deviceState?.totalCount ?? 0;
  const dailyCount = deviceState?.dailyCount ?? 0;
  const statusHealthy = hasRegisteredDevice && cameraReady && isOnline;
  const statusHeadline = !hasRegisteredDevice
    ? (targetDeviceLoading ? 'Loading your registered IoT device…' : 'No registered IoT device yet')
    : cameraReady
      ? (isOnline ? 'Pi online — camera ready' : 'Camera reachable, waiting for a fresh device heartbeat')
      : (isOnline ? 'Pi heartbeat is online, but the camera is not reachable yet' : `Device ${status}`);
  const statusDetail = !hasRegisteredDevice
    ? (targetDeviceLoading
      ? 'Checking which registered Pi this farm should use for live detection.'
      : 'Open My Devices first so live detection and Cloudflare know which Pi should receive commands.')
    : cameraReady
      ? (usingRemote
        ? `Remote tunnel verified${remoteHost ? ` (${remoteHost})` : ''}.`
        : (piHost ? `LAN camera is reachable at ${piHost}.` : null))
      : (remoteBase
        ? 'A tunnel URL is saved, but the Pi did not answer /health. Update it in Worldwide Camera or restart cloudflared on the Pi.'
        : 'Camera is not reachable yet. Check WiFi, Pi power, and the local API service.');
  const unavailableMessage = !hasRegisteredDevice
    ? (targetDeviceLoading
      ? 'Loading registered IoT device…'
      : 'No registered IoT device for this farm yet — open My Devices first.')
    : discoveryBusy
      ? discoveryStatus
      : (isSearching
        ? status
        : (discoveryStatus || (remoteBase
          ? 'Saved Cloudflare tunnel is not reachable — tap to retry.'
          : 'Pi not found — tap to scan network')));

  const handleReconnect = async () => {
    if (!hasRegisteredDevice) {
      Alert.alert('Register a device first', 'Open My Devices and register the Pi before retrying Cloudflare or camera discovery.');
      return;
    }
    const host = await rediscoverPi();
    if (host === 'remote') {
      Alert.alert('Pi Found', `Connected to Pi via remote tunnel${remoteHost ? ` (${remoteHost})` : ''}.`);
    } else if (host) {
      Alert.alert('Pi Found', `Connected to Pi at ${host}`);
    } else {
      Alert.alert(
        'Not Found',
        remoteBase
          ? 'Pi is not reachable on LAN or through the saved Cloudflare tunnel. Update the saved URL or restart cloudflared on the Pi.'
          : 'Pi not found on network. Check Pi power and WiFi.',
      );
    }
  };

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Live Detection</Text>
        <Text style={styles.subtitle}>
          Capture a single shot or run a live test from {deviceLabel}.
        </Text>
      </View>

      {/* Pi Connection Info */}
      {connectionReady ? (
        <Card variant="accent" padded={false} style={styles.connectionBanner}>
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name={usingRemote ? 'cloud-check-outline' : 'raspberry-pi'} size={16} color={Colors.primaryDark} />
            <Text style={styles.connectionText}>
              {usingRemote
                ? `Connected through remote tunnel${remoteHost ? ` (${remoteHost})` : ''}`
                : `Connected to Pi at ${piHost}`}
            </Text>
          </View>
        </Card>
      ) : (
      <TouchableOpacity
          style={[styles.connectionBanner, styles.connectionBannerWarn]}
          onPress={handleReconnect}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Reconnect camera"
          accessibilityHint="Searches for the Pi camera again."
        >
          <View style={styles.statusRow}>
            {isSearching ? (
              <ActivityIndicator size="small" color={Colors.warning} style={{ marginRight: 6 }} />
            ) : (
              <MaterialCommunityIcons name="wifi-off" size={16} color={Colors.warning} />
            )}
            <Text style={styles.connectionWarnText}>
              {unavailableMessage}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Status Banner */}
      <Card
        padded={false}
        style={[styles.statusBanner, {
          borderColor: statusHealthy ? Colors.primaryPale : Colors.danger + '55',
          backgroundColor: statusHealthy ? Colors.primaryTint : Colors.dangerBg,
        }]}
      >
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusHealthy ? Colors.primaryLight : Colors.danger }]} />
          <View style={styles.statusCopy}>
            <Text style={[styles.statusText, { color: statusHealthy ? Colors.primaryDark : Colors.danger }]}>
              {statusHeadline}
            </Text>
            {!!statusDetail && (
              <Text style={[styles.statusMeta, { color: statusHealthy ? Colors.primaryDark : Colors.danger }]}>
                {statusDetail}
              </Text>
            )}
          </View>
          {!statusHealthy && (
            <Button label="Reconnect" icon="refresh" variant="danger" size="sm" onPress={handleReconnect} />
          )}
        </View>
      </Card>

      {/* Action Buttons */}
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={[styles.actionBtn, mode === 'capture' && styles.actionBtnActive, (!hasRegisteredDevice || loading) && styles.actionBtnDisabled]}
          onPress={handleCapture}
          disabled={mode === 'live' || !hasRegisteredDevice || loading}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Take a camera photo"
          accessibilityHint="Captures one frame from the Pi camera."
          accessibilityState={{ disabled: mode === 'live' || !hasRegisteredDevice || loading }}
        >
          <View style={[styles.actionIcon, { backgroundColor: Colors.primaryTint }]}>
            <MaterialCommunityIcons name="camera" size={20} color={Colors.primary} />
          </View>
          <Text style={styles.actionLabel}>Take Photo</Text>
          <Text style={styles.actionDesc}>One frame</Text>
        </TouchableOpacity>

        {mode !== 'live' ? (
          <TouchableOpacity
            style={[styles.actionBtn, !hasRegisteredDevice && styles.actionBtnDisabled]}
            onPress={handleLiveStart}
            disabled={!hasRegisteredDevice}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Start live camera test"
            accessibilityHint="Starts a repeating camera preview from the Pi."
            accessibilityState={{ disabled: !hasRegisteredDevice }}
          >
            <View style={[styles.actionIcon, { backgroundColor: Colors.primaryTint }]}>
              <MaterialCommunityIcons name="play-circle-outline" size={20} color={Colors.primary} />
            </View>
            <Text style={styles.actionLabel}>Start Live</Text>
            <Text style={styles.actionDesc}>Camera test</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: Colors.danger }]}
            onPress={handleLiveStop}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Stop live camera"
          >
            <View style={[styles.actionIcon, { backgroundColor: Colors.dangerBg }]}>
              <MaterialCommunityIcons name="stop-circle-outline" size={20} color={Colors.danger} />
            </View>
            <Text style={[styles.actionLabel, { color: Colors.danger }]}>Stop Live</Text>
            <Text style={styles.actionDesc}>End stream</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionBtn]}
          onPress={handleReset}
          disabled={mode === 'live'}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Clear camera view"
          accessibilityHint="Clears the current camera image and detection overlay."
          accessibilityState={{ disabled: mode === 'live' }}
        >
          <View style={[styles.actionIcon, { backgroundColor: Colors.primaryTint }]}>
            <MaterialCommunityIcons name="refresh" size={20} color={Colors.primary} />
          </View>
          <Text style={styles.actionLabel}>Clear View</Text>
          <Text style={styles.actionDesc}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Live Indicator */}
      {mode === 'live' && (
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE — polling every {LIVE_POLL_MS / 1000}s</Text>
        </View>
      )}

      {/* Camera Viewport + Detection Overlay */}
      <Card style={styles.cameraCard}>
        <View style={styles.cameraHeaderRow}>
          <View style={styles.cameraHeaderLeft}>
            <MaterialCommunityIcons name="camera-outline" size={16} color={Colors.textPrimary} />
            <Text style={styles.cameraLabel}>
              {mode === 'live' ? 'Live Feed' : mode === 'capture' ? 'Captured Image' : 'Camera Preview'}
            </Text>
          </View>
          {result && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={handleReset}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear current camera image"
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="close" size={14} color={Colors.textSecondary} />
              <Text style={styles.resetBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.cameraViewport}>
          {loading && !result ? (
            <View style={styles.cameraPlaceholder}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.placeholderText}>
                {mode === 'live' ? 'Starting live feed…' : 'Capturing…'}
              </Text>
            </View>
          ) : result ? (
            <View style={{ width: '100%', height: '100%' }}>
              <Image
                source={{ uri: result.imageUri }}
                style={styles.cameraImage}
                resizeMode="cover"
                accessible
                accessibilityLabel={`${mode === 'live' ? 'Live feed frame' : 'Captured trap image'}, ${result.detections.length} detection${result.detections.length === 1 ? '' : 's'}`}
              />
              {/* Green bounding box overlays from real Pi coordinates */}
              {result.detections.map((det, i) => {
                const fw = result.frameWidth || 640;
                const fh = result.frameHeight || 480;
                const leftPct = (det.box.x1 / fw) * 100;
                const topPct = (det.box.y1 / fh) * 100;
                const widthPct = ((det.box.x2 - det.box.x1) / fw) * 100;
                const heightPct = ((det.box.y2 - det.box.y1) / fh) * 100;
                return (
                <View
                  key={i}
                  style={[styles.boundingBox, {
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                  }]}
                >
                  <View style={styles.boxLabelContainer}>
                    <Text style={styles.boxLabel}>
                      Fly {(det.confidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.cameraPlaceholder}>
              <MaterialCommunityIcons name="camera-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.placeholderText}>
                Take a photo or start live camera to check the trap view
              </Text>
            </View>
          )}
        </View>

        {result && (
          <View style={styles.cameraFooter}>
            <Text style={styles.cameraMeta}>
              {formatTime(result.timestamp)} {'·'} {result.inferenceMs > 0 ? `${result.inferenceMs}ms inference` : 'inference N/A'}
            </Text>
            {mode !== 'live' && (
              <Button
                label="Retry Capture"
                icon="camera-retake-outline"
                variant="secondary"
                size="sm"
                loading={loading}
                disabled={loading}
                onPress={handleCapture}
              />
            )}
          </View>
        )}
      </Card>

      {/* Detection Results Card */}
      {result && result.detections.length > 0 && (
        <Card style={styles.resultsCard}>
          <View style={styles.resultsHeader}>
            <MaterialCommunityIcons name="bug-check-outline" size={16} color={Colors.primaryDark} />
            <Text style={styles.resultsTitle}>Detection Results</Text>
            <Badge label={`${result.detections.length} found`} tone="success" />
          </View>

          {result.detections.map((det, i) => (
            <View key={i} style={styles.detRow}>
              <View style={styles.detIndex}>
                <Text style={styles.detIndexText}>#{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detLabel}>{det.label}</Text>
                <Text style={styles.detSub}>Bactrocera cucurbitae</Text>
              </View>
              <View style={styles.confBadge}>
                <Text style={styles.confText}>{(det.confidence * 100).toFixed(1)}%</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {result && result.detections.length === 0 && (
        <Card style={[styles.resultsCard, { borderColor: Colors.primaryPale }]}>
          <View style={styles.resultsHeader}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={Colors.primaryLight} />
            <Text style={[styles.resultsTitle, { color: Colors.primaryLight }]}>No Detections</Text>
          </View>
          <Text style={styles.noDetText}>No melon fruit flies detected in this frame.</Text>
        </Card>
      )}

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <StatTile label="Total" value={totalCount} icon="bug-outline" tone="success" style={styles.statTile} />
        <StatTile label="Today" value={dailyCount} icon="counter" tone="success" style={styles.statTile} />
        <StatTile label="Speed" value={`${result?.inferenceMs || deviceState?.inferenceMs || 0}`} unit="ms" icon="chip" tone="success" style={styles.statTile} />
      </View>

      {/* Device Info */}
      <Card padded={false} style={styles.infoCard}>
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="chip" size={14} color={Colors.textSecondary} />
          <Text style={styles.infoKey}>Model</Text>
          <Text style={styles.infoVal}>YOLO11n TFLite INT8</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="raspberry-pi" size={14} color={Colors.textSecondary} />
          <Text style={styles.infoKey}>Device</Text>
          <Text style={styles.infoVal}>Pi Zero 2W {'·'} IMX219</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="wifi" size={14} color={Colors.textSecondary} />
          <Text style={styles.infoKey}>Connection</Text>
          <Text style={styles.infoVal}>
            {usingRemote
              ? `Cloudflare Tunnel${remoteHost ? ` (${remoteHost})` : ''}`
              : connectionReady
                ? 'HTTP Direct (LAN)'
                : 'No camera connection'}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const createStyles = () => StyleSheet.create({
  header: { marginBottom: Spacing.xs },
  title: { ...Type.h1, color: Colors.textPrimary },
  subtitle: { ...Type.caption, color: Colors.textSecondary, marginTop: 3 },

  statusBanner: { padding: Spacing.md },
  connectionBanner: { padding: Spacing.md },
  connectionBannerWarn: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.warning, backgroundColor: Colors.warningBg },
  connectionText: { color: Colors.primaryDark, ...Type.label, marginLeft: Spacing.xs, flex: 1 },
  connectionWarnText: { color: Colors.warning, ...Type.label, marginLeft: Spacing.xs, flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusCopy: { flex: 1, gap: 3 },
  statusText: { ...Type.label, fontWeight: '700' },
  statusMeta: { ...Type.caption, opacity: 0.9 },

  actionsGrid: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs, minWidth: 0,
  },
  actionBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFaint },
  actionBtnDisabled: { opacity: 0.55 },
  actionIcon: { width: 40, height: 40, borderRadius: Radius.sm, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { ...Type.caption, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  actionDesc: { ...Type.caption, color: Colors.textTertiary, textAlign: 'center' },

  liveIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.danger },
  liveText: { ...Type.micro, color: Colors.danger },

  cameraCard: { gap: Spacing.sm },
  cameraHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cameraHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1, minWidth: 0 },
  cameraLabel: { ...Type.label, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
  },
  resetBtnText: { ...Type.caption, color: Colors.textSecondary },

  cameraViewport: {
    borderRadius: Radius.md, overflow: 'hidden', aspectRatio: 4 / 3,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.borderLight,
  },
  cameraImage: { width: '100%', height: '100%' },
  cameraPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  placeholderText: { color: Colors.textTertiary, ...Type.caption },
  cameraFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cameraMeta: { color: Colors.textTertiary, fontSize: 10, fontFamily: 'monospace', flex: 1, lineHeight: 14 },

  /* Green bounding box */
  boundingBox: {
    position: 'absolute',
    borderWidth: 2, borderColor: Colors.primaryLight,
    borderRadius: 2,
  },
  boxLabelContainer: {
    position: 'absolute', top: -18, left: -1,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2,
  },
  boxLabel: { fontSize: 8, fontWeight: '700', color: Colors.textOnPrimary },

  /* Results */
  resultsCard: { gap: Spacing.sm },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultsTitle: { ...Type.title, color: Colors.textPrimary, flex: 1 },

  detRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  detIndex: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primaryTint,
    justifyContent: 'center', alignItems: 'center',
  },
  detIndexText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  detLabel: { ...Type.caption, fontWeight: '600', color: Colors.textPrimary, fontStyle: 'italic' },
  detSub: { fontSize: 10, color: Colors.textSecondary },
  confBadge: {
    backgroundColor: Colors.primaryTint, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: Radius.sm,
  },
  confText: { ...Type.label, fontWeight: '800', color: Colors.primaryDark },
  noDetText: { ...Type.caption, color: Colors.textSecondary },

  /* Stats */
  statsGrid: { flexDirection: 'row', gap: Spacing.sm },
  statTile: { flex: 1, alignItems: 'center' },

  /* Info */
  infoCard: { padding: Spacing.xs },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  infoKey: { color: Colors.textSecondary, ...Type.caption, fontWeight: '600', width: 80 },
  infoVal: { flex: 1, color: Colors.textPrimary, ...Type.caption, fontWeight: '600' },
  infoDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: Spacing.md },
});
