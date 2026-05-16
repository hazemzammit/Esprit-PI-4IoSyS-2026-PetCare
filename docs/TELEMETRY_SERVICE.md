# Telemetry Service Documentation

## Overview

The Telemetry Service is the real-time heart of the PetCare IoT platform. It handles sensor data ingestion, MQTT bridging, Socket.IO real-time communication, and device command routing.

## Architecture

```
┌─────────────┐    MQTT    ┌───────────────────┐    Socket.IO    ┌─────────────┐
│ ESP32       │───────────▶│                   │◀───────────────▶│ Web Client  │
│ Devices     │            │   Telemetry       │                 │             │
└─────────────┘            │   Service         │                 └─────────────┘
                           │   (:3003)         │
┌─────────────┐    HTTP    │                   │    Socket.IO    ┌─────────────┐
│ Mobile      │───────────▶│                   │◀───────────────▶│ Admin       │
│ Client      │            │  • Express        │                 │ Dashboard   │
└─────────────┘            │  • Socket.IO      │                 └─────────────┘
                           │  • MQTT Bridge    │
                           │  • Redis Cache    │◀─── Redis
                           │                   │
                           └───────────────────┘
                                    │
                                    ▼
                           ┌───────────────┐
                           │   MongoDB     │
                           │ (Time-series) │
                           └───────────────┘
```

## Key Components

### 1. HTTP API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/v1/telemetry` | POST | Device telemetry ingestion |
| `/api/v1/pet/health` | GET | Pet health data |
| `/api/v1/pet/weight` | GET | Pet weight history |
| `/api/v1/admin/*` | Various | Admin operations |
| `/internal/*` | Various | Internal service calls |

### 2. Socket.IO Events

#### Client → Server (Commands)
```typescript
// Feed command
socket.emit('command:feed', { petId: string, amount: number });

// Find pet command (GPS tracking)
socket.emit('command:find_pet', { petId: string });

// Water refill command
socket.emit('command:water_refill', { deviceId: string });
```

#### Server → Client (Updates)
```typescript
// Command acknowledgement
socket.on('command:ack', (data) => { /* queued */ });

// Feeding completion
socket.on('feeding:complete', (data) => { /* done */ });

// Feeding error
socket.on('feeding:error', (data) => { /* error */ });

// Find pet updates
socket.on('device:find_pet_update', (data) => { /* location */ });
socket.on('device:find_pet_completed', (data) => { /* done */ });

// Water level updates
socket.on('device:water_level_update', (data) => { /* level */ });
socket.on('device:water_alert', (data) => { /* low water */ });
```

### 3. MQTT Topics

#### Subscribed Topics
```
# Device telemetry ingestion
telemetry/+/data

# Device command responses
device/+/response

# Feeding events
feeding/+/completed
```

#### Published Topics
```
# Telemetry ingested notification
telemetry/+/ingested

# Command to device
device/{serial}/command
```

## Data Models

### Telemetry Data
```typescript
interface TelemetryData {
  deviceId: string;
  petId: string;
  timestamp: Date;
  heartRate?: number;
  activity?: number;
  temperature?: number;
  location?: {
    lat: number;
    lng: number;
    accuracy: number;
  };
}
```

### Health Data
```typescript
interface HealthData {
  petId: string;
  timestamp: Date;
  heartRate: number;
  activity: number;
  caloriesBurned: number;
  restTime: number;
  activeTime: number;
}
```

### Weight Data
```typescript
interface WeightData {
  petId: string;
  timestamp: Date;
  weight: number;
  trend: 'up' | 'down' | 'stable';
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | 3003 |
| `MONGODB_URI` | MongoDB connection string | Required |
| `REDIS_URL` | Redis connection URL | Required |
| `MQTT_URL` | MQTT broker URL | Required |
| `MQTT_USERNAME` | MQTT username | Optional |
| `MQTT_PASSWORD` | MQTT password | Optional |
| `JWT_SECRET` | JWT signing secret | Required |
| `DEVICE_API_KEY` | Device authentication key | Required |
| `INTERNAL_API_KEY` | Internal service key | Required |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:5173` |
| `ENABLE_SIMULATORS` | Enable device simulators | `false` |
| `ARCHIVAL_ENABLED` | Enable data archival | `false` |

## Running Locally

```bash
# Start infrastructure
docker compose up -d mongodb redis mosquitto

# Install dependencies
cd apps/telemetry-service
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run production server
npm start
```

## Health Check

```bash
curl http://localhost:3003/health

# Response:
{
  "status": "ok",
  "service": "telemetry-service",
  "uptime": 123.45,
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

## Testing Telemetry Ingestion

```bash
# Send telemetry data
curl -X POST http://localhost:3003/api/v1/telemetry \
  -H "X-Device-Key: your-device-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "collar-001",
    "petId": "pet-123",
    "heartRate": 85,
    "activity": 42,
    "temperature": 38.5
  }'