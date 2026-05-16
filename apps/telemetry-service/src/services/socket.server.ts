import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger, mqttPublish, createServiceClient } from '@petcare/shared-middleware';
import { env } from '../config/env';

const petClient = createServiceClient(env.PET_SERVICE_URL);

export let io: SocketIOServer;

/**
 * Initialize Socket.IO server with JWT auth middleware.
 * Clients connect via the gateway (or directly in dev).
 */
export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.ALLOWED_ORIGINS,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,     // 60 seconds - client must respond within this time
    pingInterval: 25000,     // 25 seconds - send ping every 25 seconds
    connectTimeout: 45000,   // 45 seconds - max time for initial connection
    maxHttpBufferSize: 1e6, // 1MB - max HTTP buffer size
  });

  // ─── Auth Middleware ─────────────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ??
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, env.JWT_SECRET) as {
        userId: string;
        email: string;
        role?: string;
      };

      (socket as any).userId = payload.userId;
      (socket as any).role = payload.role || 'user';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ─── Connection Handler ──────────────────────────────────────────────
  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    const role = (socket as any).role as string;
    logger.info(`Socket connected: ${socket.id} (user: ${userId}, role: ${role})`);

    // Join personal room
    socket.join(`user:${userId}`);

    // Join admin room if user is admin
    if (role === 'admin') {
      socket.join('admin');
      logger.info(`Socket ${socket.id} joined admin room`);
    }

    // ── Client → Server Commands ────────────────────────────────────
    socket.on('command:feed', async (data: { portion_grams?: number }) => {
      logger.info(`[Socket] Feed command from user ${userId}, portion: ${data.portion_grams ?? 'default'}`);

      try {
        // Resolve pet via pet-service
        const petRes = await petClient.get(`/internal/pets/by-user/${userId}`);
        const pet = petRes.data?.data;
        if (!pet) return;

        const portion = data.portion_grams ?? 200;

        // Forward feed command to feeding-service via MQTT
        mqttPublish('events/feeding/manual', {
          pet_id: pet._id,
          user_id: userId,
          portion_grams: portion,
          timestamp: new Date().toISOString(),
        });

        socket.emit('feeding:complete', {
          scheduled_at: new Date().toISOString(),
          portion_planned: portion,
          portion_actual: portion,
          consumed_estimate: portion * 0.9,
          success: true,
        });
      } catch (err) {
        logger.error('[Socket] Feed command failed:', err);
        socket.emit('feeding:error', { message: 'Feed command failed' });
      }
    });

    socket.on('command:find_pet', async (data: { duration_seconds?: number }) => {
      logger.info(`[Socket] Find pet command from user ${userId}`);

      try {
        const petRes = await petClient.get(`/internal/pets/by-user/${userId}`);
        const pet = petRes.data?.data;
        if (!pet) return;

        // Get devices for the pet
        const devicesRes = await petClient.get(`/internal/devices/by-pet/${pet._id}`);
        const devices = devicesRes.data?.data ?? [];

        for (const device of devices) {
          mqttPublish(`device/${device.serial}/command`, {
            type: 'find_pet',
            params: { duration: data.duration_seconds ?? 30 },
          });
        }

        socket.emit('command:ack', { command: 'find_pet', queued: true });
      } catch (err) {
        logger.warn('[Socket] find_pet failed:', err);
      }
    });

    socket.on('command:water_refill', async () => {
      logger.info(`[Socket] Water refill command from user ${userId}`);

      try {
        const petRes = await petClient.get(`/internal/pets/by-user/${userId}`);
        const pet = petRes.data?.data;
        if (!pet) return;

        const devicesRes = await petClient.get(`/internal/devices/by-pet/${pet._id}`);
        const devices = devicesRes.data?.data ?? [];

        for (const device of devices) {
          mqttPublish(`device/${device.serial}/command`, {
            type: 'water_refill',
            params: {},
          });
        }

        socket.emit('command:ack', { command: 'water_refill', queued: true });
      } catch (err) {
        logger.warn('[Socket] water_refill failed:', err);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (reason: ${reason})`);
    });
  });

  // Start dev simulators if enabled
  if (env.ENABLE_SIMULATORS) {
    startFakeTelemetrySimulator();
    startFakeLocationSimulator();
    startFakeMotionSimulator();
    startFakeHealthAlertSimulator();
    startFakeLocationAlertSimulator();
  }

  logger.info('✅ Socket.IO initialized');
  return io;
}

/**
 * Helper to emit to a specific user
 */

export function emitToUser(userId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Helper to emit to admin room
 */
export function emitToAdmin(event: string, data: unknown): void {
  if (!io) return;
  io.to('admin').emit(event, data);
  logger.info(`[Admin Room] Emitted ${event}`);
}

/**
 * Emit device:updated event when device is edited (name, type, config)
 */
export function emitDeviceUpdated(userId: string, device: any): void {
  emitToUser(userId, 'device:updated', {
    deviceId: device._id?.toString() || device.id,
    name: device.name,
    type: device.type,
    status: device.status,
    battery: device.battery_level,
    lastSeen: device.last_seen,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit wifi:networks event when device completes WiFi scan
 */
export function emitWifiNetworks(userId: string, deviceId: string, networks: any[]): void {
  emitToUser(userId, 'wifi:networks', {
    deviceId,
    networks: networks.map(n => ({
      ssid: n.ssid,
      signal: n.signal_strength || n.rssi,
      security: n.security || 'unknown',
    })),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit device:wifi_scan_result event when WiFi scan completes (Phase 1 updated)
 */
export function emitWifiScanResult(userId: string, data: {
  deviceId: string;
  commandId: string;
  networks: Array<{
    ssid: string | null;
    bssid: string;
    signalDbm: number;
    signalBars: number;
    security: string;
    channel: number;
    frequency: number;
  }>;
  timestamp: string;
}): void {
  emitToUser(userId, 'device:wifi_scan_result', data);
}

/**
 * Emit ota:progress event during firmware update (deprecated — use emitOtaProgress instead)
 */
export function emitOtaProgress(userId: string, deviceId: string, progress: number, status: 'pending' | 'downloading' | 'flashing' | 'complete' | 'failed'): void {
  emitToUser(userId, 'ota:progress', {
    deviceId,
    progress,
    status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit device:ota_progress event during firmware update (Phase 1 updated)
 */
export function emitOtaProgressUpdated(userId: string, data: {
  deviceId: string;
  otaId: string;
  status: 'idle' | 'downloading' | 'validating' | 'installing' | 'complete' | 'error';
  progress: number;
  message: string;
  version?: string;
  timestamp: string;
}): void {
  emitToUser(userId, 'device:ota_progress', data);
}

/**
 * Emit command:ack event when device acknowledges a command
 */
export function emitCommandAck(userId: string, data: {
  deviceId: string;
  commandId: string;
  commandType?: string;
  status: 'success' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}): void {
  emitToUser(userId, 'command:ack', data);
}

// ─── Dev Simulators ─────────────────────────────────────────────────────────

/**
 * Helper: get all distinct connected userIds to emit per-user instead
 * of broadcasting globally (which leaks data across users).
 */
async function getConnectedUserIds(): Promise<string[]> {
  if (!io) return [];
  const sockets = await io.fetchSockets();
  const ids = new Set<string>();
  for (const s of sockets) {
    const uid = (s as any).userId as string | undefined;
    if (uid) ids.add(uid);
  }
  return [...ids];
}

/** Emits fake sensor data every 15 seconds to each connected user's room */
function startFakeTelemetrySimulator(): void {
  const metrics = [
    { type: 'heart_rate', min: 72, max: 105 },
    { type: 'temperature', min: 38.0, max: 39.3 },
    { type: 'spo2', min: 95, max: 99 },
  ];

  setInterval(async () => {
    const userIds = await getConnectedUserIds();
    if (userIds.length === 0) return;

    const metric = metrics[Math.floor(Math.random() * metrics.length)];
    const value = metric.min + Math.random() * (metric.max - metric.min);
    const roundedValue =
      metric.type === 'temperature'
        ? parseFloat(value.toFixed(1))
        : Math.round(value);

    const payload = {
      device_id: 'collar_simulator',
      sensors: { [metric.type]: roundedValue },
      timestamp: new Date().toISOString(),
    };

    for (const userId of userIds) {
      emitToUser(userId, 'telemetry:update', payload);
    }
    logger.debug(`[Simulator] ${metric.type}: ${roundedValue}`);
  }, 15_000);
}

/** Emits fake GPS ping every 30 seconds to each connected user's room */
function startFakeLocationSimulator(): void {
  setInterval(async () => {
    const userIds = await getConnectedUserIds();
    if (userIds.length === 0) return;

    const payload = {
      device_id: 'collar_demo',
      _id: `ping_live_${Date.now()}`,
      lat: 36.8065 + (Math.random() - 0.5) * 0.005,
      lng: 10.1815 + (Math.random() - 0.5) * 0.005,
      accuracy: 3 + Math.random() * 4,
      altitude: null,
      speed: null,
      battery_level: 72,
      address: 'Cité El Khadra, Tunis',
      timestamp: new Date().toISOString(),
    };

    for (const userId of userIds) {
      emitToUser(userId, 'location:update', payload);
    }
    logger.debug('[Simulator] location:update emitted');
  }, 30_000);
}

/** Emits camera:motion events every 30 seconds to each connected user's room */
function startFakeMotionSimulator(): void {
  const motionEvents = [
    { type: 'eating', severity: 'normal', description: 'Animal mange', confidence_score: 0.93 },
    { type: 'drinking', severity: 'normal', description: 'Animal boit', confidence_score: 0.88 },
    { type: 'motion', severity: 'normal', description: 'Mouvement détecté', confidence_score: 0.72 },
    { type: 'sleeping', severity: 'normal', description: 'Animal se repose', confidence_score: 0.95 },
    { type: 'scratching', severity: 'alert', description: 'Grattage excessif', confidence_score: 0.81 },
  ];

  setInterval(async () => {
    const userIds = await getConnectedUserIds();
    if (userIds.length === 0) return;

    const ev = motionEvents[Math.floor(Math.random() * motionEvents.length)];
    const payload = {
      id: `evt_live_${Date.now()}`,
      type: ev.type,
      severity: ev.severity,
      detected_at: new Date().toISOString(),
      confidence_score: ev.confidence_score,
      description: ev.description,
      thumbnail_url: null,
      clip_url: null,
    };

    for (const userId of userIds) {
      emitToUser(userId, 'camera:motion', payload);
    }
  }, 30_000);
}

/** Emits alert:health every 45 seconds to each connected user's room */
function startFakeHealthAlertSimulator(): void {
  const healthAlerts = [
    {
      type: 'health',
      severity: 'high',
      message: 'Fréquence cardiaque élevée: 178 BPM',
      sub_message: 'Activité intense détectée',
    },
    {
      type: 'health',
      severity: 'medium',
      message: 'Température corporelle: 39.4°C',
      sub_message: 'Légèrement au-dessus de la normale',
    },
  ];

  setInterval(async () => {
    const userIds = await getConnectedUserIds();
    if (userIds.length === 0) return;

    const picked = healthAlerts[Math.floor(Math.random() * healthAlerts.length)];
    const payload = {
      _id: `alert_health_${Date.now()}`,
      ...picked,
      read: false,
      resolved: false,
      createdAt: new Date().toISOString(),
    };

    for (const userId of userIds) {
      emitToUser(userId, 'alert:health', payload);
    }
    logger.debug(`[Simulator] alert:health — ${picked.message}`);
  }, 45_000);
}

/** Emits alert:location every 60 seconds to each connected user's room */
function startFakeLocationAlertSimulator(): void {
  setInterval(async () => {
    const userIds = await getConnectedUserIds();
    if (userIds.length === 0) return;

    const payload = {
      _id: `alert_loc_${Date.now()}`,
      type: 'location',
      severity: 'high',
      message: 'Animal proche de la limite de la zone de sécurité',
      sub_message: 'À 50m de la frontière',
      read: false,
      resolved: false,
      data: {
        lat: 36.8065 + (Math.random() - 0.5) * 0.01,
        lng: 10.1815 + (Math.random() - 0.5) * 0.01,
      },
      createdAt: new Date().toISOString(),
    };

    for (const userId of userIds) {
      emitToUser(userId, 'alert:location', payload);
    }
    logger.debug('[Simulator] alert:location emitted');
  }, 60_000);
}
