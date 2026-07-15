# InsecTra Firestore Contract — Pi-to-App Data Flow

> Minimal Firestore schema for production IoT monitoring.
> This document serves as the single source of truth for data contracts
> between the Raspberry Pi device service and the Expo mobile app.

---

## Collection Schema

### `devices/{deviceId}`

Tracks the current state of each IoT device. Updated by the Pi via Admin SDK.

```json
{
  "deviceId": "trap-001",
  "totalCount": 47,
  "status": "online",
  "lastSeen": "<SERVER_TIMESTAMP>",
  "temperature": 29.4,
  "humidity": 73.0,
  "signal": {
    "rssi": 18,
    "signal_percent": 58
  },
  "farmId": "farm-001"
}
```

| Field | Type | Writer | Notes |
|---|---|---|---|
| `deviceId` | string | Pi | Matches document ID |
| `totalCount` | number | Pi | Uses `Increment(n)` — atomic, idempotent |
| `status` | string | Pi | `"online"` or `"offline"` |
| `lastSeen` | timestamp | Pi | `SERVER_TIMESTAMP` |
| `temperature` | number? | Pi | From SHT30 (null if sensor not connected) |
| `humidity` | number? | Pi | From SHT30 (null if sensor not connected) |
| `signal` | map? | Pi | Cellular signal info |
| `farmId` | string | Pi | Farm grouping key |

**App reads via:** `onSnapshot(doc(db, 'devices', deviceId))`

---

### `detections/{deviceId}/events/{eventId}`

Individual detection events. Each positive YOLO inference creates one document.

```json
{
  "flyCount": 3,
  "confidence": 0.847,
  "timestamp": "<SERVER_TIMESTAMP>",
  "deviceId": "trap-001",
  "imageUrl": "https://storage.googleapis.com/.../20260408_113000.jpg",
  "temperature": 29.4,
  "humidity": 73.0
}
```

| Field | Type | Writer | Notes |
|---|---|---|---|
| `flyCount` | number | Pi | Count from this detection event |
| `confidence` | number | Pi | Average confidence (0.0–1.0) |
| `timestamp` | timestamp | Pi | Detection time (UTC) |
| `deviceId` | string | Pi | Redundant for query flexibility |
| `imageUrl` | string? | Pi | Firebase Storage URL (optional) |
| `temperature` | number? | Pi | Ambient at time of detection |
| `humidity` | number? | Pi | Ambient at time of detection |

**App reads via:** Paginated `getDocs()` query, NOT `onSnapshot` (too many docs).

---

### `deviceCommands/{deviceId}`

Latest command from the Expo app to the Raspberry Pi. Overwritten on each send.

```json
{
  "command": "start_detection",
  "source": "expo-app",
  "createdAt": "<SERVER_TIMESTAMP>",
  "targetDeviceId": "trap-001",
  "ack": false,
  "ackAt": null
}
```

| Field | Type | Writer | Notes |
|---|---|---|---|
| `command` | string | App | `start_detection`, `stop_detection`, `capture_snapshot` |
| `source` | string | App | Always `"expo-app"` |
| `createdAt` | timestamp | App | `serverTimestamp()` |
| `targetDeviceId` | string | App | Target device |
| `ack` | boolean | Pi | Set `true` after execution |
| `ackAt` | timestamp? | Pi | Acknowledgment timestamp |

**App writes via:** `setDoc(ref, data, { merge: true })`
**Pi reads via:** `on_snapshot` listener or periodic poll

---

### `analytics/{farmId}/daily/{YYYY-MM-DD}`

Daily aggregated catch count per device, pushed at midnight rollover.

```json
{
  "date": "2026-04-08",
  "deviceId": "trap-001",
  "totalCatch": 47,
  "updatedAt": "<SERVER_TIMESTAMP>"
}
```

---

## Idempotent Write Strategy

| Operation | Method | Safe on retry? |
|---|---|---|
| Increment totalCount | `firestore.Increment(n)` | ✅ Atomic |
| Create detection event | `doc().set(data)` (auto-ID) | ⚠️ Creates duplicate |
| Update device status | `set(data, merge=True)` | ✅ Last-write-wins |
| Write command | `setDoc(data, merge)` | ✅ Overwrites |

> **Production fix for duplicates:** Use deterministic doc ID based on
> `{deviceId}_{timestamp}_{hash}` instead of auto-generated ID.

---

## Recommended Indexes

Firestore auto-indexes single-field queries. Composite indexes needed:

| Collection | Fields | Order | Purpose |
|---|---|---|---|
| `detections/{deviceId}/events` | `timestamp` | DESC | Recent events |
| `analytics/{farmId}/daily` | `date` | DESC | Recent summaries |

---

## Offline Queue (Pi-side)

When the Pi has no internet, detection events are saved to:
```
IoT/offline_queue/event_{YYYYMMDD_HHMMSS_ffffff}.json
```

Queue is flushed every 2 minutes when connectivity returns.
Each event creates a new Firestore document (auto-ID).

---

## Anti-Race-Condition Notes

1. **Concurrent increments**: `Increment(n)` is atomic — no race condition.
2. **Command overwrite**: Latest command wins by design (`setDoc` with merge).
3. **Stale online status**: App should compare `lastSeen` to current time.
   If `> 5 minutes ago`, display as `"offline (last seen X min ago)"`.
4. **Listener cleanup**: Always return `unsubscribe()` from `useEffect`.
