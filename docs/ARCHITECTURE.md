# Architecture Overview

## System Topology

PetCare IoT uses a microservices architecture with a single public API Gateway and independently deployable services behind it. The system is designed for scalability, fault tolerance, and real-time data processing.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Internet                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Gateway (:3000)                              │
│  • JWT Verification  • Rate Limiting  • Reverse Proxy  • Socket Proxy  │
└─────────────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Auth Svc    │ │ Pet Svc     │ │Telemetry Svc│ │ Feeding Svc │
│  (:3001)    │ │  (:3002)    │ │  (:3003)    │ │  (:3004)    │
│             │ │             │ │             │ │             │
│ • JWT       │ │ • Pets      │ │ • MQTT      │ │ • Schedules │
│ • Users     │ │ • Devices   │ │ • Socket.IO │ │ • Water     │
│ • 2FA       │ │ • Camera    │ │ • Realtime  │ │ • Cron      │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           MongoDB Cluster                                 │
│  petcare_auth | petcare_pets | petcare_telemetry | petcare_feeding     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Redis                                        │
│                    Cache | Sessions | Rate Limiting                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Mosquitto MQTT                                  │
│              Device Events | Cross-Service Communication                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## Trust Boundaries

| Boundary | What Crosses It | Control Mechanism |
|----------|-----------------|-------------------|
| Internet → Gateway | User requests, Socket.IO | JWT verification, CORS, rate limiting |
| Gateway → Services | Routed HTTP requests | Path-based proxying |
| Service → Internal | Cross-service calls | INTERNAL_API_KEY middleware |
| Device → Telemetry | Telemetry ingest | DEVICE_API_KEY middleware |
| Service → MQTT | Async events | Topic-based pub/sub |

## Data Flow

### Real-time Telemetry Flow
```
ESP32 Device → MQTT Broker → Telemetry Service → Socket.IO → Web/Mobile Client
                                                              ↓
                                                          MongoDB
```

### Command Flow
```
Web/Mobile Client → Socket.IO → Telemetry Service → MQTT → Device
```

## Service Dependencies

| Service | Depends On |
|---------|------------|
| Gateway | All services |
| Auth | MongoDB, Redis |
| Pet | MongoDB, MQTT |
| Telemetry | MongoDB, Redis, MQTT |
| Feeding | MongoDB, MQTT, Pet, Telemetry |
| Notification | MongoDB, MQTT |
| Report | All services (read-only) |
| Community | MongoDB, MQTT, Telemetry |
| Social | MongoDB, Auth, Pet |
| AI | MongoDB, Pet, Telemetry, Feeding |