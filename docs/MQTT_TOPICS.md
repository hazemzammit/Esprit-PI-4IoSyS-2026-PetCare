# MQTT Topics Reference

## Overview

The PetCare IoT platform uses MQTT (Mosquitto broker) for device-to-cloud communication and cross-service event propagation. This document lists all MQTT topics used in the system.

## Topic Structure

Topics follow a hierarchical structure:
```
{domain}/{entity}/{action}
```

Example: `telemetry/collar-001/data`

## Device Telemetry Topics

### Ingestion (Device → Cloud)

| Topic | Description | Payload |
|-------|-------------|---------|
| `telemetry/{deviceId}/data` | Sensor data from device | TelemetryData JSON |
| `telemetry/{deviceId}/heartbeat` | Device heartbeat | `{ status: "ok", battery: number }` |
| `telemetry/{deviceId}/gps` | GPS location update | `{ lat, lng, accuracy, timestamp }` |

### Notifications (Cloud → Subscribers)

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `telemetry/{deviceId}/ingested` | Telemetry Service | Community Service | Confirms data ingestion |
| `telemetry/{deviceId}/alert` | Telemetry Service | Notification Service | Anomaly detected |

## Device Command Topics

### Commands (Cloud → Device)

| Topic | Publisher | Description | Payload |
|-------|-----------|-------------|---------|
| `device/{serial}/command` | Feeding/Telemetry Service | Send command to device | `{ command, params, callbackTopic }` |
| `device/{serial}/ota` | Pet Service | OTA firmware update | `{ version, url, checksum }` |

### Command Responses (Device → Cloud)

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `device/{serial}/response` | Device | Telemetry Service | Command execution result |
| `device/{serial}/status` | Device | Pet Service | Device status update |

## Feeding Topics

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `feeding/{deviceId}/manual` | Feeding UI | Feeding Service | Manual feed request |
| `feeding/{deviceId}/completed` | Feeding Service | Community Service | Feeding cycle completed |
| `feeding/{deviceId}/error` | Feeding Service | Notification Service | Feeding error occurred |
| `device/{deviceId}/water/refill` | Station | Feeding Service | Water refill completed |

## Alert Topics

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `alert/created` | Any Service | Notification Service | New alert generated |
| `alert/{alertId}/acknowledged` | Notification Service | All | Alert acknowledged |
| `alert/emit-to-client` | Notification Service | Gateway | Forward to WebSocket clients |

## User Lifecycle Topics

| Topic | Publisher | Subscribers | Description |
|-------|-----------|-------------|-------------|
| `user/created` | Auth Service | Notification, downstream | New user registered |
| `user/updated` | Auth Service | Downstream consumers | User profile updated |
| `user/deleted` | Auth Service | All services | User account deleted (cleanup) |

## Payload Examples

### Telemetry Data
```json
{
  "deviceId": "collar-001",
  "petId": "pet-123",
  "timestamp": "2026-05-16T00:00:00.000Z",
  "heartRate": 85,
  "activity": 42,
  "temperature": 38.5,
  "battery": 78
}
```

### Device Command
```json
{
  "command": "feed",
  "params": {
    "amount": 50,
    "foodType": "dry"
  },
  "callbackTopic": "device/collar-001/response",
  "timeout": 30000
}
```

### Alert
```json
{
  "alertId": "alert-456",
  "petId": "pet-123",
  "type": "health",
  "severity": "warning",
  "title": "Elevated Heart Rate",
  "message": "Heart rate exceeded normal threshold",
  "timestamp": "2026-05-16T00:00:00.000Z",
  "data": {
    "heartRate": 150,
    "threshold": 120
  }
}
```

## Testing MQTT

### Subscribe to a topic
```bash
mosquitto_sub -h localhost -p 1883 -t "telemetry/+/data" -v
```

### Publish to a topic
```bash
mosquitto_pub -h localhost -p 1883 -t "telemetry/collar-001/data" \
  -m '{"deviceId":"collar-001","petId":"pet-123","heartRate":85}'
```

### With authentication
```bash
mosquitto_sub -h localhost -p 1883 -u petcare -P petcare_mqtt_2024 \
  -t "telemetry/+/data" -v