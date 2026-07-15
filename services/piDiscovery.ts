/**
 * Pi Auto-Discovery Service
 * ==========================
 * Automatically finds the Raspberry Pi on the local network by scanning
 * known IPs, mDNS hostname, and the local subnet for the /health endpoint.
 *
 * Flow:
 *   1. Try last known working IP (cached)
 *   2. Try hardcoded known IPs
 *   3. Try mDNS hostname (insectra.local)
 *   4. Scan the local subnet (x.x.x.1-254) for Pi's /health endpoint
 *
 * Multiple phones can connect simultaneously — the Pi HTTP API is stateless.
 */

import Constants from 'expo-constants';

const PI_API_PORT = 8080;
const HEALTH_TIMEOUT_MS = 1500;  // Per-host timeout
const SCAN_BATCH_SIZE = 20;      // Parallel requests per batch during subnet scan
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// Known IPs to try first (fast path)
const KNOWN_HOSTS = [
  '192.168.1.132',
  '192.168.1.100',
  '192.168.1.1',
  'insectra.local',
];

// ── State ──────────────────────────────────────────────
let _cachedHost: string | null = null;
let _discovering = false;
let _listeners: Array<(host: string | null, status: string) => void> = [];

// Remote (Cloudflare Tunnel / ngrok / etc.) public base URL — pushed via
// services/remotePi.ts when Firestore devices/{id}.publicApiUrl changes.
// Used as a fallback when the LAN Pi cannot be reached (e.g. user is on
// mobile data or in another country).
let _remoteBase: string | null = null;
let _remoteReachable = false;
let _lanReachable = false; // updated by probeHost()

export function getCachedPiHost(): string | null {
  return _lanReachable ? _cachedHost : null;
}

/**
 * Set or clear the remote public API base URL (Cloudflare Tunnel, etc.).
 * Pass full URL with scheme, e.g. "https://insectra.example.trycloudflare.com".
 * Trailing slash is stripped.
 */
function normalizeRemoteBase(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  let trimmed = String(url).trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, '');
}

export function setRemotePiBase(url: string | null | undefined) {
  const normalized = normalizeRemoteBase(url);
  if (_remoteBase === normalized) {
    return;
  }
  _remoteBase = normalized;
  _remoteReachable = false;
}

export function getRemotePiBase(): string | null {
  return _remoteBase;
}

export function isRemotePiReachable(): boolean {
  return Boolean(_remoteBase && _remoteReachable);
}

export function recordRemotePiProbe(url: string | null | undefined, reachable: boolean) {
  const normalized = normalizeRemoteBase(url);
  if (_remoteBase && normalized === _remoteBase) {
    _remoteReachable = reachable;
  }
}

/**
 * Returns the best available API base.
 *   1. LAN Pi (preferred — low latency, no bandwidth cost)
 *   2. Remote tunnel URL (fallback — works from anywhere)
 *   3. null (offline)
 */
export function getPiApiBase(): string | null {
  if (_cachedHost && _lanReachable) return `http://${_cachedHost}:${PI_API_PORT}`;
  if (_remoteBase && _remoteReachable) return _remoteBase;
  return null;
}

export function isDiscovering(): boolean {
  return _discovering;
}

/** Subscribe to discovery status updates */
export function onDiscoveryStatus(cb: (host: string | null, status: string) => void): () => void {
  _listeners.push(cb);
  return () => {
    _listeners = _listeners.filter((l) => l !== cb);
  };
}

function notify(host: string | null, status: string) {
  _listeners.forEach((cb) => cb(host, status));
}

/**
 * Check if a host has the InsecTra API running.
 * Returns the host string if reachable, null otherwise.
 */
async function probeHost(host: string): Promise<string | null> {
  try {
    const url = `http://${host}:${PI_API_PORT}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.ok === true) return host;
    }
  } catch {
    // not reachable
  }
  return null;
}

/**
 * Probe a fully-qualified base URL (Cloudflare Tunnel etc.).
 * Returns true when /health responds with {ok:true}.
 */
async function probeRemoteBase(base: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS * 3);
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      return data.ok === true;
    }
  } catch {
    // not reachable
  }
  return false;
}

/**
 * Generate all IPs in a /24 subnet given one IP.
 * E.g. "192.168.1.50" → ["192.168.1.1", ..., "192.168.1.254"]
 */
function getSubnetIPs(sampleIP: string): string[] {
  const parts = sampleIP.split('.');
  if (parts.length !== 4) return [];
  const prefix = parts.slice(0, 3).join('.');
  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    ips.push(`${prefix}.${i}`);
  }
  return ips;
}

function extractIPv4Host(value: string | null | undefined): string | null {
  if (!value) return null;

  const host = value
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^\/+/, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0];

  return IPV4_HOST_PATTERN.test(host) ? host : null;
}

function getDiscoverySubnetSamples(): string[] {
  const samples: string[] = [];
  const seen = new Set<string>();

  const addSample = (value: string | null | undefined) => {
    const host = extractIPv4Host(value);
    if (!host || seen.has(host)) return;
    seen.add(host);
    samples.push(host);
  };

  addSample(_cachedHost);
  addSample(Constants.linkingUri);

  for (const host of KNOWN_HOSTS) {
    addSample(host);
  }

  return samples;
}

/**
 * Scan a list of IPs in parallel batches.
 */
async function scanBatch(ips: string[]): Promise<string | null> {
  for (let i = 0; i < ips.length; i += SCAN_BATCH_SIZE) {
    const batch = ips.slice(i, i + SCAN_BATCH_SIZE);
    const results = await Promise.all(batch.map(probeHost));
    const found = results.find((r) => r !== null);
    if (found) return found;
  }
  return null;
}

/**
 * Main discovery function. Call this to find the Pi.
 * Returns the working host IP/hostname, or null if not found.
 */
export async function discoverPi(): Promise<string | null> {
  if (_discovering) {
    // Already running, wait for result
    return new Promise((resolve) => {
      const unsub = onDiscoveryStatus((host) => {
        unsub();
        resolve(host);
      });
    });
  }

  _discovering = true;
  _lanReachable = false;

  // Step 1: Try cached host
  if (_cachedHost) {
    notify(null, `Trying last known Pi at ${_cachedHost}...`);
    const result = await probeHost(_cachedHost);
    if (result) {
      _lanReachable = true;
      _discovering = false;
      notify(result, `Connected to Pi at ${result}`);
      return result;
    }
    _lanReachable = false;
  }

  // Step 2: Try known hosts
  notify(null, 'Searching for Pi on known addresses...');
  for (const host of KNOWN_HOSTS) {
    const result = await probeHost(host);
    if (result) {
      _cachedHost = result;
      _lanReachable = true;
      _discovering = false;
      notify(result, `Found Pi at ${result}`);
      return result;
    }
  }

  // Step 3: Subnet scan
  const triedHosts = new Set<string>(KNOWN_HOSTS.filter((host) => extractIPv4Host(host) !== null));
  if (_cachedHost) {
    triedHosts.add(_cachedHost);
  }

  const subnetSamples = getDiscoverySubnetSamples();

  for (const sample of subnetSamples) {
    const subnetPrefix = sample.split('.').slice(0, 3).join('.');
    notify(null, `Scanning local network for Pi on ${subnetPrefix}.x...`);

    const subnet = getSubnetIPs(sample);
    const remaining = subnet.filter((ip) => !triedHosts.has(ip));
    const found = await scanBatch(remaining);

    if (found) {
      _cachedHost = found;
      _lanReachable = true;
      _discovering = false;
      notify(found, `Found Pi at ${found}`);
      return found;
    }

    subnet.forEach((ip) => triedHosts.add(ip));
  }

  // Step 4: Try remote (Cloudflare Tunnel) fallback. This works from
  // anywhere in the world if the Pi is running `cloudflared` and the
  // public URL is registered in Firestore (devices/{id}.publicApiUrl).
  if (_remoteBase) {
    notify(null, 'Trying remote tunnel (Cloudflare)...');
    const ok = await probeRemoteBase(_remoteBase);
    _remoteReachable = ok;
    if (ok) {
      _lanReachable = false;
      _discovering = false;
      // Use a sentinel "remote" indicator instead of a host string.
      notify('remote', `Connected to Pi via remote tunnel`);
      return 'remote';
    }

    notify(null, 'Saved Cloudflare tunnel is unreachable. Restart cloudflared on the Pi or save the latest tunnel URL.');
  }

  _lanReachable = false;
  _discovering = false;
  notify(null, 'Pi not found on network. Make sure Pi is on and connected to same WiFi (or set a Cloudflare Tunnel for remote access).');
  return null;
}

/**
 * Quick connectivity check — try the cached host.
 * Use this for periodic "still connected?" checks.
 */
export async function checkPiConnection(): Promise<boolean> {
  if (_cachedHost) {
    const result = await probeHost(_cachedHost);
    _lanReachable = result !== null;
    if (result) {
      return true;
    }
  }

  if (_remoteBase) {
    const ok = await probeRemoteBase(_remoteBase);
    _remoteReachable = ok;
    return ok;
  }

  return false;
}

/**
 * Force re-discovery (e.g., when user taps "Reconnect").
 */
export async function rediscoverPi(): Promise<string | null> {
  _cachedHost = null;
  return discoverPi();
}

/** Set a known host manually (e.g., from user input) */
export function setPiHost(host: string) {
  _cachedHost = host;
  _lanReachable = true;
  notify(host, `Manually set Pi at ${host}`);
}
