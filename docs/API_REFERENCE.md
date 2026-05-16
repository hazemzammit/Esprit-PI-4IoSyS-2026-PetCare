# API Reference

## Overview

The PetCare IoT API follows RESTful conventions with JSON request/response bodies. All API endpoints (except health checks) require authentication via JWT tokens or device API keys.

## Base URL

```
Production: https://api.petcare.io/api/v1
Development: http://localhost:3000/api/v1
```

## Authentication

### User Authentication (JWT)
```http
Authorization: Bearer <jwt-token>
```

### Device Authentication
```http
X-Device-Key: <device-api-key>
```

### Internal Service Authentication
```http
X-Internal-Key: <internal-api-key>
```

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  },
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

---

## Telemetry Service Endpoints

### Health Check

#### GET /health
Check service health status.

**Authentication:** None

**Response:**
```json
{
  "status": "ok",
  "service": "telemetry-service",
  "uptime": 123.45,
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

---

### Telemetry Data

#### POST /telemetry
Ingest telemetry data from devices.

**Authentication:** Device API Key

**Request Headers:**
```http
X-Device-Key: your-device-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "collar-001",
  "petId": "pet-123",
  "timestamp": "2026-05-16T00:00:00.000Z",
  "heartRate": 85,
  "activity": 42,
  "temperature": 38.5,
  "location": {
    "lat": 36.8065,
    "lng": 10.1815,
    "accuracy": 5.0
  },
  "battery": 78
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "telemetry-456",
    "ingested": true,
    "timestamp": "2026-05-16T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid or missing device API key
- `400 Bad Request` - Invalid payload format
- `429 Too Many Requests` - Rate limit exceeded

---

### Health Data

#### GET /pet/health
Retrieve pet health data.

**Authentication:** JWT

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `petId` | string | Pet identifier (required) |
| `from` | datetime | Start timestamp |
| `to` | datetime | End timestamp |
| `limit` | number | Maximum records (default: 100) |

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2026-05-16T00:00:00.000Z",
      "heartRate": 85,
      "activity": 42,
      "caloriesBurned": 150,
      "restTime": 360,
      "activeTime": 120
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "pages": 1
  }
}
```

---

### Weight Data

#### GET /pet/weight
Retrieve pet weight history.

**Authentication:** JWT

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `petId` | string | Pet identifier (required) |
| `from` | datetime | Start timestamp |
| `to` | datetime | End timestamp |

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2026-05-16T00:00:00.000Z",
      "weight": 12.5,
      "trend": "stable"
    }
  ]
}
```

---

### Admin Endpoints

#### GET /admin/devices
List all registered devices.

**Authentication:** Internal API Key

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "deviceId": "collar-001",
      "petId": "pet-123",
      "status": "online",
      "lastSeen": "2026-05-16T00:00:00.000Z",
      "battery": 78,
      "firmwareVersion": "1.2.3"
    }
  ]
}
```

#### GET /admin/metrics
Retrieve service metrics.

**Authentication:** Internal API Key

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "requestsPerMinute": 120,
    "activeConnections": 45,
    "mqttMessagesPerMinute": 200,
    "averageResponseTime": 15.5,
    "errorRate": 0.02
  }
}
```

---

### Internal Endpoints

#### GET /internal/health
Internal health check for service-to-service communication.

**Authentication:** Internal API Key

**Response (200 OK):**
```json
{
  "status": "healthy",
  "service": "telemetry-service",
  "dependencies": {
    "mongodb": "connected",
    "redis": "connected",
    "mqtt": "connected"
  },
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request format |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/v1/telemetry` | 100 requests | 1 minute per device |
| `/api/v1/pet/health` | 60 requests | 1 minute per user |
| `/api/v1/pet/weight` | 60 requests | 1 minute per user |
| `/api/v1/admin/*` | 30 requests | 1 minute per key |

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1621123200
```

---

## Testing

### Using cURL

```bash
# Health check
curl http://localhost:3003/health

# Telemetry ingestion
curl -X POST http://localhost:3003/api/v1/telemetry \
  -H "X-Device-Key: your-device-key" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "collar-001",
    "petId": "pet-123",
    "heartRate": 85,
    "activity": 42
  }'

# Health data (with JWT)
curl http://localhost:3003/api/v1/pet/health?petId=pet-123 \
  -H "Authorization: Bearer your-jwt-token"
```

### Using Postman

1. Import the API collection from `docs/petcare-api.postman_collection.json`
2. Set environment variables for your deployment
3. Use the pre-request script for automatic token refresh