# PetCare IoT – Intelligent Pet Monitoring Platform

> **PIDEV – 4th Year iOSys Engineering Program**  
> **Esprit School of Engineering** | Academic Year 2025–2026  
> **Projet d'intégration IoT**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

---

## 🌟 Overview

PetCare IoT is a comprehensive intelligent pet care system developed as part of the PIDEV – 4th Year iOSys Engineering Program at **Esprit School of Engineering**. The platform combines IoT hardware (ESP32 collars, Raspberry Pi stations), real-time telemetry, AI-powered health predictions, social features, and cross-platform mobile/web applications to provide complete pet monitoring and care automation.

## 🏗️ Complete Platform Features

### Core IoT & Telemetry
- **Real-time Health Monitoring**: Continuous tracking of heart rate, activity, weight, and location
- **Smart Collar**: ESP32-based wearable with sensors and GPS
- **Feeding Station**: Automated food and water dispensing with Raspberry Pi 5
- **Camera Integration**: Live HLS streaming and snapshot capture
- **Device Management**: OTA updates, WiFi configuration, calibration

### AI & Machine Learning
- **Health Prediction**: Hybrid ML (OpenAI GPT-4o-mini + DistilBERT A/B testing)
- **Nutrition Optimization**: XGBoost models for calorie and food recommendations
- **Behavior Analysis**: Activity pattern recognition and anomaly detection
- **Face Recognition**: Pet identification using EfficientNet + FAISS

### User Applications
- **Web Dashboard**: Vue 3 + TypeScript real-time monitoring interface
- **Mobile App**: Flutter cross-platform app with offline-first architecture
- **Landing Page**: Next.js marketing site

### Social & Community
- **PetMeet**: Social discovery and matching for pets
- **Community Challenges**: Breed benchmarks and milestones
- **Public Profiles**: Shareable pet profiles and achievements

### Enterprise Features
- **Multi-tenant Architecture**: Service isolation and scalability
- **Real-time Notifications**: Push notifications, email alerts, daily summaries
- **Analytics & Reporting**: PDF reports, health trends, consumption analytics
- **Admin Dashboard**: System monitoring and user management

---

## 🏗️ System Architecture

### Microservices (10 Services)

| Service | Port | Purpose |
|---------|------|---------|
| **API Gateway** | 3000 | Single entry point, JWT verification, reverse proxy |
| **Auth Service** | 3001 | Authentication, profiles, 2FA, sessions |
| **Pet Service** | 3002 | Pet profiles, device pairing, geofence, camera |
| **Telemetry Service** | 3003 | Real-time data ingestion, MQTT bridge, Socket.IO |
| **Feeding Service** | 3004 | Feeding schedules, water tracking, cron automation |
| **Notification Service** | 3005 | Alerts, push notifications, email summaries |
| **Report Service** | 3006 | PDF generation, analytics aggregation |
| **Community Service** | 3008 | Breeds, benchmarks, challenges, public profiles |
| **Social Service** | 3009 | Pet discovery, matching, messaging, meetups |
| **AI Service** | 8000 | Health predictions, nutrition, behavior analysis |

### Infrastructure
- **Databases**: MongoDB (per-service), Redis (caching, sessions)
- **Message Broker**: Mosquitto MQTT for IoT events
- **Real-time**: Socket.IO for live updates
- **Containerization**: Docker Compose for local development
- **Reverse Proxy**: Nginx for production routing

### Hardware
- **ESP32 Microcontrollers**: Pet collar with sensors
- **Raspberry Pi 5**: Central station with camera
- **Sensors**: Heart rate, accelerometer, GPS, weight scale

---

## 📂 Project Structure

```
Esprit-PI-4IoSyS-2026-PetCare/
├── apps/
│   ├── telemetry-service/    # ✅ FULL CODE (Public)
│   ├── ai-service/           # 📁 Folder only (Code private)
│   ├── auth-service/         # 📁 Folder only (Code private)
│   ├── pet-service/          # 📁 Folder only (Code private)
│   ├── feeding-service/      # 📁 Folder only (Code private)
│   ├── notification-service/ # 📁 Folder only (Code private)
│   ├── report-service/       # 📁 Folder only (Code private)
│   ├── community-service/    # 📁 Folder only (Code private)
│   ├── social-service/       # 📁 Folder only (Code private)
│   ├── gateway/              # 📁 Folder only (Code private)
│   ├── web/                  # 📁 Folder only (Code private)
│   └── mobile/               # 📁 Folder only (Code private)
├── packages/
│   ├── shared-types/         # ✅ Telemetry types (Public)
│   └── shared-middleware/    # ✅ Core middleware (Public)
├── infra/
│   └── mosquitto/            # MQTT broker configuration
├── docs/                     # Complete documentation
├── .env.example              # Environment template
├── docker-compose.yml        # Full stack orchestration
├── package.json              # Root workspace
├── tsconfig.json             # TypeScript configuration
└── turbo.json                # Turborepo configuration
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 20+** and npm
- **Docker Desktop** (for containerized setup)
- **Git**

### Installation

#### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/hazemzammit/Esprit-PI-4IoSyS-2026-PetCare.git
cd Esprit-PI-4IoSyS-2026-PetCare

# Copy environment template
cp .env.example .env

# Start all services
docker compose up -d

# Check status
docker compose ps
```

#### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/hazemzammit/Esprit-PI-4IoSyS-2026-PetCare.git
cd Esprit-PI-4IoSyS-2026-PetCare

# Install dependencies
npm install

# Start infrastructure (MongoDB, Redis, MQTT)
docker compose up -d mongodb redis mosquitto

# Start Telemetry Service
cd apps/telemetry-service
npm run dev
```

### Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Telemetry Service | http://localhost:3003 | REST API + Health check |
| MongoDB UI | http://localhost:8081 | Database browser (admin/petcare123) |
| MQTT Broker | mqtt://localhost:1883 | IoT device communication |
| Redis | localhost:6379 | Cache and sessions |

### Testing the Setup

```bash
# Health check
curl http://localhost:3003/health

# Expected response:
# {"status":"ok","service":"telemetry-service","uptime":123.45,"timestamp":"2026-05-16T00:00:00.000Z"}
```

---

## 📖 Documentation

### Core Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/ARCHITECTURE.md) | System design, topology, and data flow |
| [Telemetry Service](docs/TELEMETRY_SERVICE.md) | Deep dive into real-time data handling |
| [MQTT Topics](docs/MQTT_TOPICS.md) | Complete topic schema for IoT devices |
| [Socket.IO Events](docs/SOCKET_EVENTS.md) | Real-time event reference |
| [API Reference](docs/API_REFERENCE.md) | All endpoints and schemas |

### Hardware Documentation

| Document | Description |
|----------|-------------|
| [Hardware Setup](docs/HARDWARE_SETUP.md) | ESP32 and Raspberry Pi configuration |
| [Device Firmware](docs/FIRMWARE.md) | Hardware prototype documentation |

### Deployment

| Document | Description |
|----------|-------------|
| [Deployment Guide](docs/DEPLOYMENT.md) | Production deployment instructions |
| [Docker Configuration](docker-compose.yml) | Full stack orchestration |

---

## 🔧 Tech Stack

### Backend
- **Node.js 20** + Express + TypeScript
- **Python 3.11** + FastAPI (AI Service)
- **MongoDB 7** (per-service databases)
- **Redis 7** (caching, sessions)
- **Mosquitto 2** (MQTT broker)
- **Socket.IO** (real-time communication)

### Frontend
- **Vue 3** + Vite + TypeScript (Web Dashboard)
- **Flutter 3.16** (Mobile App)
- **Next.js** (Landing Page)

### Infrastructure
- **Docker** & Docker Compose
- **Nginx** (reverse proxy)
- **Turborepo** (monorepo management)

### Hardware
- **ESP32** microcontrollers
- **Raspberry Pi 5**
- Various sensors (heart rate, GPS, weight)

---

## 🎓 Academic Context

**Developed at Esprit School of Engineering – Tunisia**

| Program | Details |
|---------|---------|
| **Program** | PIDEV – 4th Year iOSys |
| **Academic Year** | 2025–2026 |
| **Project Type** | IoT Integration Project |
| **School** | Esprit School of Engineering |

### Learning Outcomes
- IoT system architecture and real-time data handling
- Microservices design patterns and implementation
- MQTT protocol and device-to-cloud communication
- Socket.IO for live web applications
- Docker containerization and orchestration
- Full-stack development with modern frameworks
- Hardware-software integration

---

## 📄 License

MIT License – See [LICENSE](LICENSE) file for details.

---

> **Note**: This repository is part of an academic project at Esprit School of Engineering.