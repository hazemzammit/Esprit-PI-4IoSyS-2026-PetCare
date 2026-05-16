import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  asyncHandler,
  ApiResponse,
  ApiError,
  cacheGet,
  cacheSet,
  cacheDel,
  mqttPublish,
  createServiceClient,
  logger,
} from '@petcare/shared-middleware';
import { TelemetryModel, TelemetryType } from '../models/telemetry.model';
import { emitToUser } from '../services/socket.server';
import { env } from '../config/env';

const petClient = createServiceClient(env.PET_SERVICE_URL, { timeout: 5000 });

/** Returns the value only if it's a valid MongoDB ObjectId — silently drops friendly names like 'postman_collar'. */
const toObjectId = (id?: string) => (id && mongoose.isValidObjectId(id) ? id : undefined);

/**
 * GET /api/v1/pet/health/latest
 * Returns the latest reading of each health metric for the user's pet.
 */
export const getLatestHealth = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');

  // Resolve pet from pet-service
  const pet = await resolvePet(userId);
  if (!pet) throw new ApiError('Pet not found', 404, 'PET_NOT_FOUND');

  const petId = pet._id;

  // Check cache first
  const cacheKey = `pet_latest_health:${petId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return ApiResponse.ok(res, cached);
  }

  // Get latest reading of each type
  const types: TelemetryType[] = ['heart_rate', 'temperature', 'spo2', 'weight', 'activity_steps', 'activity_distance'];
  const results = await Promise.all(
    types.map((type) =>
      TelemetryModel.findOne({ pet_id: petId, type })
        .sort({ timestamp: -1 })
        .lean()
    )
  );

  // Resolve collar device for battery
  let collar: any = null;
  try {
    const devicesRes = await petClient.get(`/internal/devices/by-pet/${petId}`);
    const devices = devicesRes.data?.data ?? [];
    collar = devices.find((d: any) => d.type === 'collar');
  } catch {
    // graceful: collar info not critical
  }

  // Build value map
  const valueMap: Record<string, number | null> = {
    heart_rate: null,
    temperature: null,
    spo2: null,
    weight: null,
    activity_steps: null,
    activity_distance: null,
  };
  let latestTimestamp = new Date();
  let deviceId: string | null = collar?._id ?? null;

  types.forEach((type, i) => {
    if (results[i]) {
      valueMap[type] = results[i]!.value as number;
      if (results[i]!.timestamp > latestTimestamp) {
        latestTimestamp = results[i]!.timestamp;
      }
      if (!deviceId && results[i]!.device_id) {
        deviceId = results[i]!.device_id!.toString();
      }
    }
  });

  const data = {
    _id: `latest_${petId}`,
    petId: petId.toString(),
    deviceId: deviceId ?? '',
    timestamp: latestTimestamp.toISOString(),
    value: valueMap,
    metadata: {
      source: 'sensor',
      battery_level: collar?.battery_level ?? null,
    },
  };

  // Cache for 2 minutes
  await cacheSet(cacheKey, data, 120);

  ApiResponse.ok(res, data);
});

/**
 * GET /api/v1/pet/health
 * Returns health history for a given metric type within a time range.
 */
export const getHealthHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');

  const pet = await resolvePet(userId);
  if (!pet) throw new ApiError('Pet not found', 404, 'PET_NOT_FOUND');

  const type = (req.query.type as TelemetryType) ?? 'heart_rate';
  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(req.query.to as string) : new Date();
  const limit = Math.min(Number(req.query.limit ?? 500), 1000);

  const data = await TelemetryModel.find({
    pet_id: pet._id,
    type,
    timestamp: { $gte: from, $lte: to },
  })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();

  ApiResponse.ok(
    res,
    data.map((d) => ({
      timestamp: d.timestamp,
      type: d.type,
      value: d.value,
      metadata: d.metadata,
    }))
  );
});

/**
 * GET /api/v1/pet/weight (or /api/v1/pet/health/weight)
 * Returns weight history for the user's pet.
 */
export const getWeightHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');

  const pet = await resolvePet(userId);
  if (!pet) throw new ApiError('Pet not found', 404, 'PET_NOT_FOUND');

  const limit = Math.min(Number(req.query.limit ?? 90), 365);
  const from = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  const data = await TelemetryModel.find({
    pet_id: pet._id,
    type: 'weight',
    timestamp: { $gte: from },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  ApiResponse.ok(
    res,
    data.map((d) => ({
      _id: d._id.toString(),
      petId: pet._id.toString(),
      deviceId: d.device_id?.toString() ?? '',
      timestamp: d.timestamp.toISOString(),
      value: d.value,
      metadata: { source: d.metadata?.source ?? 'station' },
    }))
  );
});

/**
 * GET /api/v1/pet/health/aggregated
 * Returns aggregated telemetry data (avg/min/max) grouped by period.
 * Query: type, period (hour|day|week|month), from, to
 */
export const getAggregated = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) throw new ApiError('Unauthorized', 401, 'UNAUTHORIZED');

  const pet = await resolvePet(userId);
  if (!pet) throw new ApiError('Pet not found', 404, 'PET_NOT_FOUND');

  const type = (req.query.type as TelemetryType) ?? 'heart_rate';
  const period = (req.query.period as string) ?? 'day';
  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(req.query.to as string) : new Date();

  // Build date truncation based on period
  const truncMap: Record<string, string> = {
    hour: '%Y-%m-%dT%H:00:00Z',
    day: '%Y-%m-%dT00:00:00Z',
    week: '%Y-%m-%dT00:00:00Z', // group by day, post-process
    month: '%Y-%m-01T00:00:00Z',
  };
  const dateFormat = truncMap[period] ?? truncMap.day;

  const pipeline = [
    {
      $match: {
        pet_id: pet._id,
        type,
        timestamp: { $gte: from, $lte: to },
        value: { $type: 'number' },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
        avg: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 as const } },
    { $limit: 500 },
  ];

  const results = await TelemetryModel.aggregate(pipeline);

  const data = results.map((r) => ({
    timestamp: r._id,
    avg: Math.round(r.avg * 100) / 100,
    min: r.min,
    max: r.max,
    count: r.count,
  }));

  ApiResponse.ok(res, { period, type, data });
});

/**
 * POST /api/v1/telemetry
 * Direct HTTP telemetry ingestion — works from Postman, IoT devices, or any HTTP client.
 * Saves to DB + emits Socket.IO for real-time sync to web/mobile + runs health thresholds.
 *
 * Body: { pet_id, device_id?, type, value, timestamp? }
 * Types: heart_rate | temperature | spo2 | weight | activity | location
 *
 * For location type, value should be: { lat, lng, accuracy? }
 */
export const ingestTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { pet_id, device_id, type, value, timestamp } = req.body;

  const ts = timestamp ? new Date(timestamp) : new Date();
  const isoTimestamp = ts.toISOString();

  const doc = await TelemetryModel.create({
    pet_id,
    device_id: toObjectId(device_id),
    type,
    value,
    timestamp: ts,
    metadata: { source: 'http' },
  });

  // Resolve the pet owner's userId so we can emit Socket.IO to the right room
  let userId: string | null = null;
  try {
    const petRes = await petClient.get(`/internal/pets/${pet_id}`);
    const pet = petRes.data?.data;
    if (pet) {
      userId = pet.user_id?.toString() ?? null;
    }
  } catch {
    // If pet resolution fails, we still saved the telemetry — just can't emit real-time
    logger.warn(`[ingestTelemetry] Could not resolve pet ${pet_id} for Socket.IO emit`);
  }

  // Update pet weight if that's the type
  if (type === 'weight' && typeof value === 'number') {
    petClient
      .patch(`/internal/pets/${pet_id}`, { weight_current: value })
      .catch(() => {});
  }

  // ── Socket.IO real-time emit ──────────────────────────────────────────
  if (userId) {
    if (type === 'location' && typeof value === 'object' && value !== null) {
      // Emit location:update event
      emitToUser(userId, 'location:update', {
        device_id: device_id ?? 'http_client',
        _id: doc._id.toString(),
        lat: value.lat,
        lng: value.lng,
        accuracy: value.accuracy ?? 5,
        altitude: value.altitude ?? null,
        speed: value.speed ?? null,
        battery_level: null,
        address: value.address ?? null,
        source: 'gps',
        timestamp: isoTimestamp,
      });
    } else if (typeof value === 'number') {
      // Emit telemetry:update — send BOTH formats for web + mobile compatibility
      // Format 1: sensors object (mobile expects this)
      emitToUser(userId, 'telemetry:update', {
        device_id: device_id ?? 'http_client',
        sensors: { [type]: value },
        timestamp: isoTimestamp,
      });

      // Run health threshold checks → may trigger alerts
      await checkHealthThresholds(pet_id, userId, device_id ?? 'http_client', type, value);
    }

    // Invalidate health cache so next GET /pet/health/latest returns fresh data
    await cacheDel(`pet_latest_health:${pet_id}`);
  }

  ApiResponse.ok(res, { id: doc._id.toString() }, 'Telemetry ingested and broadcast');
});

/**
 * POST /api/v1/telemetry/batch
 * Ingest multiple metrics at once (e.g., HR + temp + SpO2 in one call).
 * Emits individual Socket.IO events for each metric.
 *
 * Body: { pet_id, device_id?, sensors: { heart_rate?: number, temperature?: number, ... }, timestamp? }
 */
export const ingestBatch = asyncHandler(async (req: Request, res: Response) => {
  const { pet_id, device_id, sensors, timestamp } = req.body;

  if (!sensors || typeof sensors !== 'object') {
    throw new ApiError('sensors object is required', 400, 'VALIDATION_ERROR');
  }

  const ts = timestamp ? new Date(timestamp) : new Date();
  const isoTimestamp = ts.toISOString();

  // Build telemetry docs for each sensor type
  const entries = Object.entries(sensors).filter(
    ([, v]) => v !== null && v !== undefined
  );

  if (entries.length === 0) {
    throw new ApiError('At least one sensor value is required', 400, 'VALIDATION_ERROR');
  }

  const docs = entries.map(([sensorType, sensorValue]) => ({
    pet_id,
    device_id: toObjectId(device_id),
    type: sensorType as TelemetryType,
    value: sensorValue,
    timestamp: ts,
    metadata: { source: 'http' as const },
  }));

  await TelemetryModel.insertMany(docs, { ordered: false });

  // Resolve userId for Socket.IO
  let userId: string | null = null;
  try {
    const petRes = await petClient.get(`/internal/pets/${pet_id}`);
    userId = petRes.data?.data?.user_id?.toString() ?? null;
  } catch {
    logger.warn(`[ingestBatch] Could not resolve pet ${pet_id}`);
  }

  if (userId) {
    // Emit telemetry:update with all sensors at once (mobile-compatible)
    emitToUser(userId, 'telemetry:update', {
      device_id: device_id ?? 'http_client',
      sensors,
      timestamp: isoTimestamp,
    });

    // Update weight if present
    if (sensors.weight !== undefined) {
      petClient
        .patch(`/internal/pets/${pet_id}`, { weight_current: sensors.weight })
        .catch(() => {});
    }

    // Run threshold checks for numeric values
    for (const [sensorType, sensorValue] of entries) {
      if (typeof sensorValue === 'number') {
        await checkHealthThresholds(
          pet_id, userId, device_id ?? 'http_client', sensorType, sensorValue
        );
      }
    }

    await cacheDel(`pet_latest_health:${pet_id}`);
  }

  ApiResponse.ok(res, { count: entries.length }, 'Batch telemetry ingested and broadcast');
});

/**
 * POST /api/v1/telemetry/alert
 * Create an alert via REST and push it to web/mobile via Socket.IO in real-time.
 * Also persists to notification-service DB via MQTT.
 *
 * Body: { pet_id, user_id, type, severity, message, sub_message?, data? }
 */
export const createAlert = asyncHandler(async (req: Request, res: Response) => {
  const { pet_id, user_id, type, severity, message, sub_message, data } = req.body;

  if (!pet_id || !user_id || !type || !severity || !message) {
    throw new ApiError('pet_id, user_id, type, severity, message are required', 400, 'VALIDATION_ERROR');
  }

  const alertPayload = {
    pet_id,
    user_id,
    device_id: req.body.device_id ?? 'manual',
    type,
    severity,
    message,
    sub_message: sub_message ?? '',
    data: data ?? {},
    timestamp: new Date().toISOString(),
  };

  // Publish to MQTT for notification-service to persist + send FCM push
  mqttPublish('events/alert/created', alertPayload);

  // Emit Socket.IO immediately for instant UI update
  const eventMap: Record<string, string> = {
    health: 'alert:health',
    location: 'alert:location',
    feeding: 'alert:feeding',
    device: 'alert:device',
  };
  emitToUser(user_id, eventMap[type] ?? 'alert:general', {
    _id: `alert_${Date.now()}`,
    ...alertPayload,
    read: false,
    resolved: false,
    createdAt: alertPayload.timestamp,
  });

  ApiResponse.ok(res, { queued: true }, 'Alert created and broadcast');
});

/**
 * POST /api/v1/telemetry/location
 * Convenience endpoint to send location data.
 * Saves to DB + emits location:update Socket.IO event.
 *
 * Body: { pet_id, device_id?, lat, lng, accuracy?, address? }
 */
export const ingestLocation = asyncHandler(async (req: Request, res: Response) => {
  const { pet_id, device_id, lat, lng, accuracy, address } = req.body;

  if (!pet_id || lat === undefined || lng === undefined) {
    throw new ApiError('pet_id, lat, lng are required', 400, 'VALIDATION_ERROR');
  }

  const ts = new Date();
  const isoTimestamp = ts.toISOString();

  const doc = await TelemetryModel.create({
    pet_id,
    device_id: toObjectId(device_id),
    type: 'location',
    value: { lat, lng, accuracy: accuracy ?? 5 },
    timestamp: ts,
    metadata: { source: 'http' },
  });

  // Resolve userId
  let userId: string | null = null;
  try {
    const petRes = await petClient.get(`/internal/pets/${pet_id}`);
    userId = petRes.data?.data?.user_id?.toString() ?? null;
  } catch {
    logger.warn(`[ingestLocation] Could not resolve pet ${pet_id}`);
  }

  if (userId) {
    emitToUser(userId, 'location:update', {
      device_id: device_id ?? 'http_client',
      _id: doc._id.toString(),
      lat,
      lng,
      accuracy: accuracy ?? 5,
      altitude: null,
      speed: null,
      battery_level: null,
      address: address ?? null,
      source: 'gps',
      timestamp: isoTimestamp,
    });
  }

  ApiResponse.ok(res, { id: doc._id.toString() }, 'Location ingested and broadcast');
});

/**
 * POST /api/v1/telemetry/feeding-event
 * Push a feeding completion event to web/mobile via Socket.IO.
 * This is for Postman testing — simulates a feeding event.
 *
 * Body: { user_id, portion_grams?, source? }
 */
export const pushFeedingEvent = asyncHandler(async (req: Request, res: Response) => {
  const { user_id, portion_grams, source } = req.body;

  if (!user_id) {
    throw new ApiError('user_id is required', 400, 'VALIDATION_ERROR');
  }

  const portion = portion_grams ?? 200;

  emitToUser(user_id, 'feeding:complete', {
    scheduled_at: new Date().toISOString(),
    portion_planned: portion,
    portion_actual: portion,
    consumed_estimate: Math.round(portion * 0.9),
    duration_seconds: 45,
    source: source ?? 'manual',
    success: true,
  });

  ApiResponse.ok(res, { emitted: true }, 'Feeding event broadcast');
});

/**
 * POST /api/v1/telemetry/device-status
 * Push a device status event to web/mobile via Socket.IO.
 *
 * Body: { user_id, device_id, status, battery? }
 */
export const pushDeviceStatus = asyncHandler(async (req: Request, res: Response) => {
  const { user_id, device_id, status, battery } = req.body;

  if (!user_id || !device_id || !status) {
    throw new ApiError('user_id, device_id, status are required', 400, 'VALIDATION_ERROR');
  }

  emitToUser(user_id, 'device:status', {
    device_id,
    deviceId: device_id,
    status,
    battery: battery ?? null,
    lastSeen: new Date().toISOString(),
  });

  ApiResponse.ok(res, { emitted: true }, 'Device status broadcast');
});

// ─── Health Threshold Checks ────────────────────────────────────────────────

const THRESHOLDS: Record<string, { warn: [number, number]; critical: [number, number] }> = {
  temperature: { warn: [37.5, 39.5], critical: [36.0, 40.5] },
  heart_rate: { warn: [50, 180], critical: [40, 220] },
  spo2: { warn: [95, 100], critical: [92, 100] },
};

async function checkHealthThresholds(
  petId: string,
  userId: string,
  deviceId: string,
  type: string,
  value: number,
): Promise<void> {
  const rule = THRESHOLDS[type];
  if (!rule) return;

  let severity: 'high' | 'critical' | null = null;
  let message = '';
  let subMessage = '';

  if (value < rule.critical[0] || value > rule.critical[1]) {
    severity = 'critical';
    message = `🚨 CRITIQUE: ${type.replace('_', ' ')} = ${value}`;
    subMessage = 'Consulter un vétérinaire immédiatement';
  } else if (value < rule.warn[0] || value > rule.warn[1]) {
    severity = 'high';
    message = `⚠️ Alerte: ${type.replace('_', ' ')} = ${value}`;
    subMessage = 'Surveiller de près';
  }

  if (severity) {
    const alertPayload = {
      pet_id: petId,
      device_id: deviceId,
      user_id: userId,
      type: 'health',
      severity,
      message,
      sub_message: subMessage,
      data: { [type]: value },
      timestamp: new Date().toISOString(),
    };

    // Publish to MQTT for notification-service to persist
    mqttPublish('events/alert/created', alertPayload);

    // Emit Socket.IO immediately
    emitToUser(userId, 'alert:health', {
      _id: `alert_${Date.now()}`,
      ...alertPayload,
      read: false,
      resolved: false,
      createdAt: alertPayload.timestamp,
    });
  }
}

// ─── Internal Endpoints (service-to-service) ───────────────────────────────

/**
 * GET /internal/telemetry/latest/:petId
 * Used by report-service and feeding-service.
 */
export const getLatestByPetId = asyncHandler(async (req: Request, res: Response) => {
  const { petId } = req.params;

  const types: TelemetryType[] = ['heart_rate', 'temperature', 'spo2', 'weight', 'activity'];
  const results = await Promise.all(
    types.map((type) =>
      TelemetryModel.findOne({ pet_id: petId, type })
        .sort({ timestamp: -1 })
        .lean()
    )
  );

  const data: Record<string, any> = {};
  types.forEach((type, i) => {
    if (results[i]) {
      data[type] = {
        value: results[i]!.value,
        timestamp: results[i]!.timestamp,
      };
    }
  });

  ApiResponse.ok(res, data);
});

/**
 * GET /internal/telemetry/history/:petId
 * Used by report-service for generating reports.
 */
export const getHistoryByPetId = asyncHandler(async (req: Request, res: Response) => {
  const { petId } = req.params;
  const type = (req.query.type as TelemetryType) ?? 'heart_rate';
  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(req.query.to as string) : new Date();
  const limit = Math.min(Number(req.query.limit ?? 1000), 5000);
  const sortDir = req.query.sort === 'desc' ? -1 : 1;

  const data = await TelemetryModel.find({
    pet_id: petId,
    type,
    timestamp: { $gte: from, $lte: to },
  })
    .sort({ timestamp: sortDir })
    .limit(limit)
    .lean();

  ApiResponse.ok(res, data);
});

/**
 * GET /internal/telemetry/weight-history/:petId
 * Used by report-service.
 */
export const getWeightHistoryByPetId = asyncHandler(async (req: Request, res: Response) => {
  const { petId } = req.params;
  const limit = Math.min(Number(req.query.limit ?? 90), 365);
  const from = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  const data = await TelemetryModel.find({
    pet_id: petId,
    type: 'weight',
    timestamp: { $gte: from },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  ApiResponse.ok(res, data);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolvePet(userId: string): Promise<any | null> {
  try {
    const res = await petClient.get(`/internal/pets/by-user/${userId}`);
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}
