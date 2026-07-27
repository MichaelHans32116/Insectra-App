const summaryCards = document.getElementById('summaryCards');
const geoList = document.getElementById('geoList');
const priorityQueue = document.getElementById('priorityQueue');
const sprayTimeline = document.getElementById('sprayTimeline');
const deviceTableBody = document.getElementById('deviceTableBody');
const notesList = document.getElementById('notesList');
const generatedAtLabel = document.getElementById('generatedAtLabel');
const dataModeLabel = document.getElementById('dataModeLabel');
const projectLabel = document.getElementById('projectLabel');
const analyticsChip = document.getElementById('analyticsChip');
const coverageNote = document.getElementById('coverageNote');
const mapBadge = document.getElementById('mapBadge');
const mapHint = document.getElementById('mapHint');
const refreshDataBtn = document.getElementById('refreshDataBtn');
const deviceFilter = document.getElementById('deviceFilter');
const deviceCountLabel = document.getElementById('deviceCountLabel');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));

let statusChart;
let map;
let markersLayer;
let latestSnapshot = null;
let activeFilter = 'all';
let visibleDevices = [];

function fmtDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function fmtNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('en-PH').format(value);
}

function fmtPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function fmtMoney(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Cost n/a';
  return `PHP ${fmtNumber(value)}`;
}

function formatMode(value) {
  const normalized = String(value || '').replace(/-/g, ' ').trim();
  if (!normalized) return 'Snapshot';
  if (/snapshot/i.test(normalized)) return 'Snapshot';
  if (/live|realtime|real time/i.test(normalized)) return 'Live';
  return labelize(normalized);
}

function summarizeAnalytics(value) {
  return /No analytics/i.test(value || '') ? 'Rollups pending' : 'Rollups ready';
}

function tunnelHost(url) {
  if (!url) return 'No tunnel';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

function compactText(value, maxLength = 70) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '-';
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}...` : clean;
}

function labelize(value) {
  const clean = String(value || '').replace(/-/g, ' ').trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : 'Unknown';
}

function fmtCoord(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toFixed(4);
}

function statusClass(status) {
  return (status || '').toLowerCase() === 'online' ? 'status-online' : 'status-offline';
}

function riskClass(level) {
  const map = {
    low: 'risk-low',
    watch: 'risk-watch',
    moderate: 'risk-watch',
    high: 'risk-high',
    critical: 'risk-critical',
    insufficient: 'risk-insufficient',
  };
  return map[level] || 'risk-insufficient';
}

function healthClass(level) {
  const map = {
    good: 'health-good',
    watch: 'health-warning',
    warning: 'health-warning',
    critical: 'health-critical',
  };
  return map[level] || 'health-warning';
}

function geoClass(value) {
  return value === 'good' ? 'geo-good' : 'geo-review';
}

function geoLabel(value) {
  return value === 'good' ? 'Mapped' : 'Needs geo';
}

function createSummaryCard({ label, value, footnote, icon, tone }) {
  return `
    <article class="summary-card ${tone ? `is-${tone}` : ''}">
      <div class="summary-icon"><i class="bi ${icon}"></i></div>
      <span class="summary-label">${label}</span>
      <strong class="summary-value">${value}</strong>
      <p class="summary-footnote">${footnote}</p>
    </article>
  `;
}

function renderSummary(snapshot) {
  const summary = snapshot.nationalSummary;
  summaryCards.innerHTML = [
    createSummaryCard({
      label: 'Live traps',
      value: `${summary.onlineDevices}/${summary.totalDevices}`,
      footnote: 'Currently reporting',
      icon: 'bi-broadcast-pin',
      tone: summary.offlineDevices > 0 ? 'warn' : 'good',
    }),
    createSummaryCard({
      label: 'Service queue',
      value: fmtNumber(summary.criticalOperations),
      footnote: 'Urgent actions',
      icon: 'bi-tools',
      tone: summary.criticalOperations > 0 ? 'danger' : 'good',
    }),
    createSummaryCard({
      label: 'Map-ready',
      value: `${summary.mappedDevices}/${summary.totalDevices}`,
      footnote: 'Verified coordinates',
      icon: 'bi-geo-alt',
      tone: summary.unmappedDevices > 0 ? 'warn' : 'good',
    }),
    createSummaryCard({
      label: 'Risk watch',
      value: fmtNumber(summary.highRiskDevices),
      footnote: 'High or critical traps',
      icon: 'bi-exclamation-triangle',
      tone: summary.highRiskDevices > 0 ? 'danger' : '',
    }),
  ].join('');

  generatedAtLabel.textContent = fmtDate(snapshot.generatedAt);
  dataModeLabel.textContent = formatMode(snapshot.dataMode);
  projectLabel.textContent = snapshot.project || '-';
  analyticsChip.textContent = summarizeAnalytics(summary.analyticsCoverage);
  coverageNote.textContent = summary.latestTunnelUrl
    ? tunnelHost(summary.latestTunnelUrl)
    : 'No tunnel';
}

function renderCharts(snapshot) {
  const summary = snapshot.nationalSummary;
  const ctx = document.getElementById('statusChart');
  const data = {
    labels: ['Online', 'Offline', 'Mapped', 'Needs geo', 'Service'],
    datasets: [{
      data: [
        summary.onlineDevices,
        summary.offlineDevices,
        summary.mappedDevices,
        summary.unmappedDevices,
        summary.criticalOperations,
      ],
      backgroundColor: ['#1f7a4d', '#94a3b8', '#2563eb', '#b7791f', '#b42318'],
      borderRadius: 4,
      borderSkipped: false,
      barThickness: 18,
    }],
  };

  if (statusChart) statusChart.destroy();
  statusChart = new Chart(ctx, {
    type: 'bar',
    data,
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.raw} device${item.raw === 1 ? '' : 's'}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, color: '#64748b' },
          grid: { color: '#e2e8f0' },
          border: { display: false },
        },
        y: {
          ticks: { color: '#334155', font: { weight: 700 } },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  });
}

function renderGeography(snapshot) {
  geoList.innerHTML = snapshot.geography.length
    ? snapshot.geography.map((row) => `
        <article class="list-card">
          <div class="list-card-top">
            <div>
              <h3>${row.name}</h3>
              <p class="helper-text">${row.deviceCount} traps, ${row.online} online</p>
            </div>
            <span class="chip chip-neutral">${fmtPercent(row.avgTrapFullnessPercent)} fill</span>
          </div>
          <div class="metric-row">
            <div class="metric">
              <span class="metric-label">Urgent</span>
              <strong class="metric-value">${fmtNumber(row.criticalOperations)}</strong>
            </div>
            <div class="metric">
              <span class="metric-label">Risk</span>
              <strong class="metric-value">${fmtNumber(row.highRisk)}</strong>
            </div>
          </div>
        </article>
      `).join('')
    : '<p class="empty-state">No province rollup yet.</p>';
}

function renderQueue(snapshot) {
  priorityQueue.innerHTML = snapshot.priorityQueue.length
    ? snapshot.priorityQueue.map((item) => `
        <article class="list-card queue-card severity-${item.severity}">
          <div class="list-card-top">
            <div>
              <h3>${compactText(item.title, 56)}</h3>
              <p class="queue-detail">${compactText(item.summary || item.detail, 88)}</p>
            </div>
            <div class="metric-row">
              <span class="chip chip-neutral">${item.farmName}</span>
              <span class="queue-tag">${labelize(item.severity)}</span>
            </div>
          </div>
        </article>
      `).join('')
    : '<p class="empty-state">No urgent queue items.</p>';
}

function renderTimeline(snapshot) {
  sprayTimeline.innerHTML = snapshot.recentSprayEvents.length
    ? snapshot.recentSprayEvents.map((event) => `
        <article class="list-card">
          <div class="list-card-top">
            <div>
              <h3>${compactText(event.product, 52)}</h3>
              <p class="timeline-detail">${fmtDate(event.performedAt)} - ${event.byName || 'Unknown'}</p>
            </div>
            <span class="chip chip-neutral">${fmtMoney(event.costPhp)}</span>
          </div>
          ${event.note ? `<p class="timeline-detail">${compactText(event.note, 72)}</p>` : ''}
        </article>
      `).join('')
    : '<p class="empty-state">No spray records in this snapshot.</p>';
}

function deviceMatchesQuery(entry, query) {
  if (!query) return true;
  const haystack = [
    entry.name,
    entry.piCode,
    entry.deviceId,
    entry.farmName,
    entry.farmId,
    entry.risk?.level,
    entry.risk?.headline,
    entry.health?.headline,
    entry.geoBucket,
  ].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function deviceMatchesActiveFilter(entry) {
  const riskLevel = (entry.risk?.level || '').toLowerCase();
  const healthLevel = (entry.health?.level || '').toLowerCase();
  switch (activeFilter) {
    case 'online':
      return (entry.status || '').toLowerCase() === 'online';
    case 'risk':
      return riskLevel === 'high' || riskLevel === 'critical';
    case 'geo':
      return entry.dataQuality?.location !== 'good';
    case 'service':
      return healthLevel === 'warning' || healthLevel === 'critical' || entry.trapFullnessPercent >= 80;
    default:
      return true;
  }
}

function visibleDeviceList(snapshot) {
  const query = deviceFilter.value.trim();
  return snapshot.devices.filter((entry) =>
    deviceMatchesQuery(entry, query) && deviceMatchesActiveFilter(entry),
  );
}

function renderTable(snapshot) {
  visibleDevices = visibleDeviceList(snapshot);
  deviceCountLabel.textContent = String(visibleDevices.length);

  deviceTableBody.innerHTML = visibleDevices.length
    ? visibleDevices.map((entry) => `
        <tr>
          <td data-label="Device">
            <div class="device-title">${entry.name}</div>
            <div class="device-meta">${entry.deviceId}</div>
            <div class="device-meta">${entry.piCode}</div>
            <span class="status-pill ${statusClass(entry.status)}">${entry.status || 'unknown'}</span>
          </td>
          <td data-label="Farm">
            <div class="device-title">${entry.farmName}</div>
            <div class="device-meta">${entry.cropType || 'Crop n/a'}</div>
            <div class="device-meta">Seen: ${fmtDate(entry.lastSeen)}</div>
          </td>
          <td data-label="Risk">
            <span class="risk-pill ${riskClass(entry.risk?.level)}">${entry.risk?.level || 'unknown'}</span>
            <div class="device-meta">${compactText(entry.risk?.headline, 54)}</div>
          </td>
          <td data-label="Health">
            <span class="health-pill ${healthClass(entry.health?.level)}">${entry.health?.level || 'unknown'}</span>
            <div class="device-meta">${compactText(entry.health?.headline, 54)}</div>
          </td>
          <td data-label="Count">
            <div class="device-title">${fmtNumber(entry.dailyCount)}/day</div>
            <div class="device-meta">Total ${fmtNumber(entry.totalCount)}</div>
            <div class="device-meta">Fill ${fmtPercent(entry.trapFullnessPercent)}</div>
          </td>
          <td data-label="Environment">
            <div class="device-title">${entry.temperature ?? '-'} C</div>
            <div class="device-meta">${entry.humidity ?? '-'}% RH</div>
            <div class="device-meta">Signal ${fmtPercent(entry.signalPercent)}</div>
          </td>
          <td data-label="Geo">
            <span class="geo-pill ${geoClass(entry.dataQuality?.location)}">${geoLabel(entry.dataQuality?.location)}</span>
            <div class="device-meta">${entry.geoBucket}</div>
            <div class="device-meta">${entry.coordinatesValid ? `${fmtCoord(entry.latitude)}, ${fmtCoord(entry.longitude)}` : 'Missing coordinates'}</div>
          </td>
          <td data-label="Link">
            ${entry.publicApiUrl
              ? `<a class="tunnel-link" href="${entry.publicApiUrl}" target="_blank" rel="noreferrer" title="${entry.publicApiUrl}"><i class="bi bi-box-arrow-up-right"></i>${tunnelHost(entry.publicApiUrl)}</a>`
              : '<span class="device-meta">No tunnel</span>'}
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="8" class="empty-state">No devices match this view.</td></tr>';
}

function renderNotes(snapshot) {
  notesList.innerHTML = snapshot.notes
    .slice(0, 4)
    .map((note) => `<li>${compactText(note, 120)}</li>`)
    .join('');
}

function ensureMap() {
  if (map) return;
  map = L.map('mapContainer', { zoomControl: true, attributionControl: true }).setView([12.8797, 121.774], 5);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function renderMap(snapshot) {
  ensureMap();
  markersLayer.clearLayers();

  const validDevices = snapshot.devices.filter((entry) => entry.coordinatesValid);
  if (!validDevices.length) {
    mapBadge.textContent = 'No map-ready traps';
    mapHint.textContent = 'Fix geotags before using province rollups.';
    map.setView([12.8797, 121.774], 5);
    return;
  }

  mapBadge.textContent = `${validDevices.length} map-ready`;
  mapHint.textContent = 'Markers show validated farm coordinates.';

  const bounds = [];
  validDevices.forEach((entry) => {
    const marker = L.circleMarker([entry.latitude, entry.longitude], {
      radius: 8,
      color: '#17202a',
      fillColor: entry.risk?.level === 'critical'
        ? '#b42318'
        : entry.risk?.level === 'high'
          ? '#b7791f'
          : '#1f7a4d',
      fillOpacity: 0.88,
      weight: 2,
    });
    marker.bindPopup(`
      <strong>${entry.name}</strong><br/>
      Farm: ${entry.farmName}<br/>
      Risk: ${entry.risk?.headline || 'Unknown'}<br/>
      Health: ${entry.health?.headline || 'Unknown'}<br/>
      Fill: ${fmtPercent(entry.trapFullnessPercent)}
    `);
    marker.addTo(markersLayer);
    bounds.push([entry.latitude, entry.longitude]);
  });
  map.fitBounds(bounds, { padding: [24, 24] });
}

function exportVisibleCsv() {
  if (!visibleDevices.length) return;
  const headers = [
    'deviceId',
    'piCode',
    'name',
    'farmName',
    'status',
    'risk',
    'health',
    'dailyCount',
    'totalCount',
    'temperature',
    'humidity',
    'trapFullnessPercent',
    'coordinatesValid',
    'latitude',
    'longitude',
    'publicApiUrl',
  ];
  const rows = visibleDevices.map((entry) => {
    const row = {
      deviceId: entry.deviceId,
      piCode: entry.piCode,
      name: entry.name,
      farmName: entry.farmName,
      status: entry.status,
      risk: `${entry.risk?.level ?? ''}: ${entry.risk?.headline ?? ''}`,
      health: `${entry.health?.level ?? ''}: ${entry.health?.headline ?? ''}`,
      dailyCount: entry.dailyCount,
      totalCount: entry.totalCount,
      temperature: entry.temperature,
      humidity: entry.humidity,
      trapFullnessPercent: entry.trapFullnessPercent,
      coordinatesValid: entry.coordinatesValid,
      latitude: entry.latitude,
      longitude: entry.longitude,
      publicApiUrl: entry.publicApiUrl,
    };
    return headers.map((key) => JSON.stringify(row[key] ?? '')).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `insectra-expert-visible-devices-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadSnapshot() {
  refreshDataBtn.disabled = true;
  refreshDataBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Loading';
  try {
    const response = await fetch('./data/public-snapshot.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    latestSnapshot = await response.json();
    renderSummary(latestSnapshot);
    renderCharts(latestSnapshot);
    renderGeography(latestSnapshot);
    renderQueue(latestSnapshot);
    renderTimeline(latestSnapshot);
    renderTable(latestSnapshot);
    renderNotes(latestSnapshot);
    renderMap(latestSnapshot);
  } catch (error) {
    summaryCards.innerHTML = `
      <article class="summary-card is-danger">
        <div class="summary-icon"><i class="bi bi-exclamation-circle"></i></div>
        <span class="summary-label">Snapshot error</span>
        <strong class="summary-value">No data</strong>
        <p class="summary-footnote">Generate data/expert-snapshot.json before deploy.</p>
      </article>
    `;
    console.error(error);
  } finally {
    refreshDataBtn.disabled = false;
    refreshDataBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
  }
}

refreshDataBtn.addEventListener('click', loadSnapshot);
deviceFilter.addEventListener('input', () => {
  if (latestSnapshot) renderTable(latestSnapshot);
});
exportCsvBtn.addEventListener('click', exportVisibleCsv);
filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter || 'all';
    filterButtons.forEach((item) => item.classList.toggle('active', item === button));
    if (latestSnapshot) renderTable(latestSnapshot);
  });
});

loadSnapshot();
