# Socket.IO Events Reference

## Overview

The PetCare IoT platform uses Socket.IO for real-time bidirectional communication between clients (web/mobile) and the Telemetry Service. This document lists all Socket.IO events used in the system.

## Connection

### Authentication
Clients authenticate using JWT tokens when establishing the Socket.IO connection:

```typescript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Connection Events

```typescript
// Connection established
socket.on('connect', () => {
  console.log('Connected to telemetry service');
});

// Connection error
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});

// Disconnected
socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

// Authentication error
socket.on('auth_error', (error) => {
  console.error('Authentication failed:', error);
});
```

## Command Events (Client → Server)

### Feed Command
Send a feeding command to a device:

```typescript
socket.emit('command:feed', {
  petId: 'pet-123',
  amount: 50,        // grams
  foodType: 'dry'    // 'dry' | 'wet' | 'mixed'
});

// Acknowledgement
socket.on('command:ack', (data) => {
  console.log('Feed command queued:', data.commandId);
});
```

### Find Pet Command
Activate GPS tracking to locate a pet:

```typescript
socket.emit('command:find_pet', {
  petId: 'pet-123'
});

// Acknowledgement
socket.on('command:ack', (data) => {
  console.log('Find pet command queued:', data.commandId);
});
```

### Water Refill Command
Trigger water refill on a station:

```typescript
socket.emit('command:water_refill', {
  deviceId: 'station-001'
});

// Acknowledgement
socket.on('command:ack', (data) => {
  console.log('Water refill command queued:', data.commandId);
});
```

## Update Events (Server → Client)

### Feeding Updates

```typescript
// Feeding completed successfully
socket.on('feeding:complete', (data) => {
  console.log('Feeding completed:', {
    petId: data.petId,
    amount: data.amount,
    duration: data.duration
  });
});

// Feeding error
socket.on('feeding:error', (data) => {
  console.error('Feeding error:', {
    petId: data.petId,
    error: data.error,
    code: data.errorCode
  });
});
```

### Find Pet Updates

```typescript
// Location update during tracking
socket.on('device:find_pet_update', (data) => {
  console.log('Pet location updated:', {
    petId: data.petId,
    lat: data.location.lat,
    lng: data.location.lng,
    accuracy: data.location.accuracy,
    timestamp: data.timestamp
  });
});

// Tracking completed
socket.on('device:find_pet_completed', (data) => {
  console.log('Find pet completed:', {
    petId: data.petId,
    finalLocation: data.location
  });
});
```

### Water Level Updates

```typescript
// Water level changed
socket.on('device:water_level_update', (data) => {
  console.log('Water level:', {
    deviceId: data.deviceId,
    level: data.level,        // percentage
    estimatedRemaining: data.estimatedRemaining  // hours
  });
});

// Low water alert
socket.on('device:water_alert', (data) => {
  console.warn('Water alert:', {
    deviceId: data.deviceId,
    level: data.level,
    message: data.message
  });
});

// Water refill update
socket.on('device:water_refill_update', (data) => {
  console.log('Water refilling:', {
    deviceId: data.deviceId,
    progress: data.progress    // percentage
  });
});
```

### Admin Events

```typescript
// Device status update (admin dashboard)
socket.on('admin:device:status', (data) => {
  console.log('Device status:', data);
});

// New alert created (admin dashboard)
socket.on('admin:alert:created', (data) => {
  console.log('New alert:', data);
});
```

## Room-Based Events

Clients can join rooms to receive specific updates:

```typescript
// Join pet-specific room
socket.emit('join:pet', { petId: 'pet-123' });

// Leave pet room
socket.emit('leave:pet', { petId: 'pet-123' });

// Join device room
socket.emit('join:device', { deviceId: 'collar-001' });
```

## Error Handling

```typescript
// Command rejected
socket.on('command:reject', (data) => {
  console.error('Command rejected:', {
    commandId: data.commandId,
    reason: data.reason,
    code: data.errorCode
  });
});

// Rate limit exceeded
socket.on('rate_limit', (data) => {
  console.warn('Rate limit:', {
    event: data.event,
    retryAfter: data.retryAfter  // milliseconds
  });
});
```

## Event Payload Types

### Command Acknowledgement
```typescript
interface CommandAck {
  commandId: string;
  status: 'queued' | 'processing';
  timestamp: string;
}
```

### Feeding Complete
```typescript
interface FeedingComplete {
  petId: string;
  deviceId: string;
  amount: number;
  duration: number;  // seconds
  timestamp: string;
}
```

### Location Update
```typescript
interface LocationUpdate {
  petId: string;
  deviceId: string;
  location: {
    lat: number;
    lng: number;
    accuracy: number;
  };
  timestamp: string;
  battery: number;
}
```

### Water Level
```typescript
interface WaterLevel {
  deviceId: string;
  level: number;        // 0-100 percentage
  estimatedRemaining: number;  // hours
  lastRefill: string;
  timestamp: string;
}
```

## Testing Socket.IO

### Using the Browser Console
```javascript
// Connect
const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});

// Send command
socket.emit('command:feed', { petId: 'pet-123', amount: 50 });

// Listen for responses
socket.on('command:ack', (data) => console.log('Ack:', data));
socket.on('feeding:complete', (data) => console.log('Complete:', data));
```

### Using Socket.IO Client CLI
```bash
# Install
npm install -g socket.io-client-cli

# Connect and emit
sioc connect http://localhost:3000 --auth.token=your-jwt-token
sioc emit command:feed '{"petId":"pet-123","amount":50}'