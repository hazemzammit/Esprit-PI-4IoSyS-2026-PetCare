import {
  logger,
  getMqttClient,
  mqttPublish,
  cacheGet,
  cacheSet,
  cacheDel,
  haversineDistance,
  createServiceClient,
  getRedis,
  setRequestResult,
} from '@petcare/shared-middleware';
import { TelemetryModel, TelemetryType } from '../models/telemetry.model';
import { emitToUser } from './socket.server';
import { env } from '../config/env';
import type {
  TelemetryPayload,
  LocationPayload,
  DeviceStatusPayload,
  DeviceAlertPayload,
  CachedDevice,
} from '../types/mqtt.types';

const petClient = createServiceClient(env.PET_SERVICE_URL);

// ─── MQTT Subscription Topics ──────────────────────────────────────────────
const TOPICS = [
  'device/+/telemetry',
  'device/+/status',
  'device/+/alert',
  'device/+/location',
  'device/+/ota_progress',
  'device/+/ota_status_result',
  'device/+/wifi_scan_result',
  'device/+/calibration_result',
  'device/+/command_ack',
  'device/+/water/level',  // water level readings from device
  'device/+/camera/event',  // camera motion detection events
  'events/alert/emit-to-client',
  'events/water/refill/+',  // water refill events from feeding service
  'events/social/match',  // PetMeet: new match created
  'events/social/message',  // PetMeet: new message sent
  'events/social/meetup_confirmed',  // PetMeet: meetup confirmed
];

/**
 * Subscribe to all device topics and route messages to processors.
 */
export function subscribeMqttTopics(): void {
  const client = getMqttClient();
  if (!client) {
    logger.warn('MQTT not available — skipping telemetry subscriptions');
    return;
  }

  for (const topic of TOPICS) {
    client.subscribe(topic, (err: Error | null) => {
      if (err) logger.error(`MQTT subscribe failed: ${topic}`, err);
      else logger.info(`MQTT subscribed: ${topic}`);
    });
  }

  client.on('message', (topic: string, payload: Buffer) => {
    handleMqttMessage(topic, payload).catch((err) =>
      logger.error(`MQTT handler error for ${topic}:`, err)
    );
  });
}

/**
 * Handle incoming MQTT messages — route to the appropriate processor.
 * Supports both device serial (string) and MongoDB ObjectId (24 hex chars) in topic.
 */
async function handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    logger.warn(`Invalid JSON on topic ${topic}`);
    return;
  }

  // ── Handle alert-emit-to-client bridge (from notification-service REST) ──
  if (topic === 'events/alert/emit-to-client') {
    const alertData = data as any;
    if (alertData.user_id) {
      const eventMap: Record<string, string> = {
        health: 'alert:health',
        location: 'alert:location',
        feeding: 'alert:feeding',
        device: 'alert:device',
      };
      const eventName = eventMap[alertData.type as string] ?? 'alert:general';
      emitToUser(alertData.user_id, eventName, alertData);
      logger.info(`[MQTT Bridge] Emitted ${eventName} to user ${alertData.user_id}`);
    }
    return;
  }

  // ── Handle water refill events from feeding service ──────────────────────
  const waterRefillMatch = topic.match(/^events\/water\/refill\/(.+)$/);
  if (waterRefillMatch) {
    const petId = waterRefillMatch[1];
    const refillData = data as any;
    if (refillData.userId) {
      emitToUser(refillData.userId, 'water-refill:updated', refillData);
      logger.info(`[MQTT Bridge] Emitted water-refill:updated to user ${refillData.userId}`);
    }
    return;
  }

  // ── Handle PetMeet social events ─────────────────────────────────────────
  if (topic === 'events/social/match') {
    const matchData = data as any;
    if (matchData.user_a_id && matchData.user_b_id) {
      emitToUser(matchData.user_a_id, 'social:match', matchData);
      emitToUser(matchData.user_b_id, 'social:match', matchData);
      logger.info(`[MQTT Bridge] Emitted social:match to users ${matchData.user_a_id} and ${matchData.user_b_id}`);
    }
    return;
  }

  if (topic === 'events/social/message') {
    const messageData = data as any;
    if (messageData.match_id) {
      // Get match to find both users
      // For now, emit to sender only - match lookup would require social-service integration
      if (messageData.sender_user_id) {
        emitToUser(messageData.sender_user_id, 'social:message', messageData);
        logger.info(`[MQTT Bridge] Emitted social:message to user ${messageData.sender_user_id}`);
      }
    }
    return;
  }

  if (topic === 'events/social/meetup_confirmed') {
    const meetupData = data as any;
    if (meetupData.user_a_id && meetupData.user_b_id) {
      emitToUser(meetupData.user_a_id, 'social:meetup_confirmed', meetupData);
      emitToUser(meetupData.user_b_id, 'social:meetup_confirmed', meetupData);
      logger.info(`[MQTT Bridge] Emitted social:meetup_confirmed to users ${meetupData.user_a_id} and ${meetupData.user_b_id}`);
    }
    return;
  }

  const [, deviceIdOrSerial, messageType] = topic.split('/');

  const isRevoked = await getRedis()?.get(`device_revoked:${deviceIdOrSerial}`);
  if (isRevoked) {
    logger.warn(`Ignoring message from revoked device: ${deviceIdOrSerial}`);
    return;
  }

  // Resolve device info from either serial or ObjectId
  let deviceInfo = await resolveDevice(deviceIdOrSerial);
  if (!deviceInfo) {
    logger.warn(`Unknown device: ${deviceIdOrSerial}`);
    return;
  }

  const isRevokedId = await getRedis()?.get(`device_revoked:${deviceInfo.serial}`);
  if (isRevokedId) {
    logger.warn(`Ignoring message from revoked device: ${deviceInfo.serial}`);
    return;
  }

  switch (messageType) {
    case 'telemetry':
      await processTelemetry(deviceInfo, data as unknown as TelemetryPayload);
      break;
    case 'status':
      await processDeviceStatus(deviceIdOrSerial, deviceInfo, data as unknown as DeviceStatusPayload);
      break;
    case 'location':
      await processLocation(deviceInfo, data as unknown as LocationPayload);
      break;
    case 'alert':
      logger.info(`[Device Alert] Device ${deviceInfo.deviceId}: ${JSON.stringify(data)}`);
      break;
    case 'ota_progress':
      await processOtaProgress(deviceInfo, data as unknown as OtaProgressPayload);
      break;
    case 'ota_status_result':
      await processOtaStatusResult(deviceInfo, data as unknown as OtaStatusResultPayload);
      break;
    case 'wifi_scan_result':
      await processWifiScanResult(deviceInfo, data as unknown as WifiScanResultPayload);
      break;
    case 'calibration_result':
      await processCalibrationResult(deviceInfo, data as unknown as CalibrationResultPayload);
      break;
    case 'command_ack':
      await processCommandAck(deviceInfo, data as unknown as CommandAckPayload);
      break;
    case 'water':
      // Handle water subtopics: device/{id}/water/level
      const waterSubtopic = (data as any).subtopic || 'level';
      if (waterSubtopic === 'level') {
        await processWaterLevel(deviceInfo, data);
      }
      break;
    case 'camera':
      // Handle camera subtopics: device/{id}/camera/event
      await processCameraEvent(deviceInfo, data);
      break;
    default:
      logger.warn(`Unknown MQTT message type: ${messageType}`);
  }
}

// ─── Device Resolution ─────────────────────────────────────────────────────

/**
 * Check if string is a 24-character hex MongoDB ObjectId
 */
function isMongoObjectId(str: string): boolean {
  return /^[0-9a-f]{24}$/i.test(str);
}

/**
 * Resolve device from either serial string or MongoDB ObjectId.
 * Handles backward compatibility for both old (serial) and new (ObjectId) formats.
 */
async function resolveDevice(deviceIdOrSerial: string): Promise<CachedDevice | null> {
  const cacheKey = `device_info:${deviceIdOrSerial}`;

  // Check cache first
  const cached = await cacheGet<CachedDevice>(cacheKey);
  if (cached) {
    return cached;
  }

  let deviceInfo: CachedDevice | null = null;

  if (isMongoObjectId(deviceIdOrSerial)) {
    // Topic uses ObjectId directly — fetch device by ID
    deviceInfo = await resolveDeviceById(deviceIdOrSerial);
  } else {
    // Topic uses serial string — resolve via pet-service
    deviceInfo = await resolveDeviceBySerial(deviceIdOrSerial);
  }

  if (deviceInfo) {
    // Cache for 1 hour
    await cacheSet(cacheKey, deviceInfo, 3600);
  }

  return deviceInfo;
}

async function getCachedDevice(serial: string): Promise<CachedDevice | null> {
  return cacheGet<CachedDevice>(`device_info:${serial}`);
}

/**
 * Resolve device by MongoDB ObjectId
 */
async function resolveDeviceById(deviceId: string): Promise<CachedDevice | null> {
  try {
    const res = await petClient.get(`/internal/devices/${deviceId}`);
    if (!res.data?.data) {
      logger.warn(`Device ${deviceId} not found in pet-service`);
      return null;
    }

    const device = res.data.data;

    // Get pet to find user
    const petRes = await petClient.get(`/internal/pets/${device.pet_id}`);
    if (!petRes.data?.data) {
      logger.warn(`Pet ${device.pet_id} not found for device ${deviceId}`);
      return null;
    }

    logger.info(`[Device Resolution] Resolved by ObjectId: ${deviceId} → pet ${device.pet_id}`);

    return {
      deviceId: device._id,
      petId: device.pet_id.toString(),
      userId: petRes.data.data.user_id.toString(),
      type: device.type,
      serial: device.serial,
    };
  } catch (err: any) {
    logger.error(`Failed to resolve device by ID ${deviceId}:`, err.message);
    return null;
  }
}

/**
 * Resolve device → pet → user via Pet Service internal API by serial number
 */
async function resolveDeviceBySerial(serial: string): Promise<CachedDevice | null> {
  try {
    const res = await petClient.get(`/internal/devices/by-serial/${serial}`);
    if (!res.data?.data) {
      logger.warn(`Device serial ${serial} not found in pet-service`);
      return null;
    }

    const device = res.data.data;

    // Get pet to find user
    const petRes = await petClient.get(`/internal/pets/${device.pet_id}`);
    if (!petRes.data?.data) {
      logger.warn(`Pet ${device.pet_id} not found for device ${serial}`);
      return null;
    }

    logger.info(`[Device Resolution] Resolved by serial: ${serial} → ${device._id} → pet ${device.pet_id}`);

    return {
      deviceId: device._id,
      petId: device.pet_id.toString(),
      userId: petRes.data.data.user_id.toString(),
      type: device.type,
      serial: device.serial,
    };
  } catch (err: any) {
    logger.error(`Failed to resolve device serial ${serial} from pet-service:`, err.message);
    return null;
  }
}

/**
 * Resolve device from serial (cached in Redis)
 */
async function resolveDeviceFromPetService(serial: string): Promise<CachedDevice | null> {
  return resolveDeviceBySerial(serial);
}

// ─── Telemetry Processor ───────────────────────────────────────────────────

async function processTelemetry(device: CachedDevice, data: TelemetryPayload): Promise<void> {
  const sensors = data.sensors;
  if (!sensors) return;

  const timestamp = data.timestamp
    ? new Date(Number(data.timestamp) * 1000)
    : new Date();

  // Build telemetry docs for each sensor type (exclude battery — not a health metric)
  const insertOps = Object.entries(sensors)
    .filter(([key]) => key !== 'battery')
    .map(([type, value]) => ({
      timestamp,
      pet_id: device.petId,
      device_id: device.deviceId,
      type: type as TelemetryType,
      value,
      metadata: { source: 'edge' as const },
    }));

  if (insertOps.length > 0) {
    await TelemetryModel.insertMany(insertOps, { ordered: false }).catch((err) =>
      logger.error('Telemetry insertMany failed:', err.message)
    );
  }

  // Run threshold checks
  for (const [type, value] of Object.entries(sensors)) {
    if (typeof value === 'number') {
      await checkThresholds(device, type, value);
    }
  }

  // Update weight_current on pet via pet-service internal API
  if (sensors.weight !== undefined) {
    petClient
      .patch(`/internal/pets/${device.petId}`, {
        weight_current: sensors.weight,
      })
      .catch((err) => logger.warn('Failed to update pet weight:', err.message));
  }

  // Update battery on device via pet-service internal API
  if (sensors.battery !== undefined) {
    petClient
      .patch(`/internal/devices/${device.deviceId}`, {
        battery_level: sensors.battery,
        last_seen: new Date(),
      })
      .catch((err) => logger.warn('Failed to update device battery:', err.message));
  }

  // Emit to connected clients via Socket.IO
  emitToUser(device.userId, 'telemetry:update', {
    device_id: device.deviceId,
    sensors,
    timestamp: timestamp.toISOString(),
  });

  // Invalidate health cache
  await cacheDel(`pet_latest_health:${device.petId}`);
}

// ─── Location Processor ────────────────────────────────────────────────────

async function processLocation(device: CachedDevice, data: LocationPayload): Promise<void> {
  const { lat, lng, accuracy } = data;

  await TelemetryModel.create({
    timestamp: new Date(),
    pet_id: device.petId,
    device_id: device.deviceId,
    type: 'location',
    value: { lat, lng, accuracy },
    metadata: { source: 'edge' },
  });

  // Geofence check via pet-service
  try {
    const petRes = await petClient.get(`/internal/pets/${device.petId}`);
    const pet = petRes.data?.data;

    if (pet?.geofence?.enabled && pet.geofence.center) {
      const distance = haversineDistance(pet.geofence.center, { lat, lng });
      const radiusMeters = pet.geofence.radius_meters || 500;

      if (distance > radiusMeters) {
        await forwardAlert(device, {
          type: 'location',
          severity: 'high',
          message: `Animal sorti de la zone de sécurité (${Math.round(distance)}m)`,
          data: { lat, lng, distance, radius: radiusMeters },
        });
      }
    }
  } catch (err: any) {
    logger.warn('Geofence check failed:', err.message);
  }

  emitToUser(device.userId, 'location:update', {
    lat,
    lng,
    accuracy,
    timestamp: new Date().toISOString(),
    device_id: device.deviceId,
  });
}

// ─── Device Status Processor ───────────────────────────────────────────────

/**
 * Process device status updates (online/offline).
 * Extracts reason field from payload (LWT: connection_lost, graceful shutdown, or OTA reboot).
 */
async function processDeviceStatus(
  deviceIdOrSerial: string,
  device: CachedDevice,
  data: DeviceStatusPayload
): Promise<void> {
  // Update device via pet-service internal API
  const updateObj: Record<string, unknown> = {
    status: data.status,
    last_seen: new Date(),
  };
  if (data.battery !== undefined) updateObj.battery_level = data.battery;
  if (data.firmware_version) updateObj.firmware_version = data.firmware_version;

  petClient
    .patch(`/internal/devices/${device.deviceId}`, updateObj)
    .catch((err) => logger.warn('Failed to update device status:', err.message));

  // Invalidate device cache (works for both serial and ObjectId)
  await cacheDel(`device_info:${deviceIdOrSerial}`);

  // Determine reason for offline status
  let reason: 'graceful' | 'connection_lost' | 'ota_reboot' = 'graceful';
  
  if (data.status === 'offline') {
    // Check if OTA is in progress
    const otaInProgress = await cacheGet(`ota_progress:${device.deviceId}`);
    if (otaInProgress) {
      reason = 'ota_reboot';
    } else if ((data as any).reason === 'connection_lost') {
      reason = 'connection_lost';
    }
  }

  emitToUser(device.userId, 'device:status', {
    deviceId: device.deviceId,
    status: data.status,
    battery: data.battery,
    reason,
    timestamp: new Date().toISOString(),
  });

  // Alert on low battery
  if (data.battery !== undefined && data.battery < 20) {
    await forwardAlert(device, {
      type: 'device',
      severity: data.battery < 10 ? 'high' : 'medium',
      message: `Batterie collier faible: ${data.battery}%`,
      sub_message: 'Recharger dans les prochaines heures',
      data: { battery: data.battery },
    });
  }
}

// ─── Threshold Detection ───────────────────────────────────────────────────

async function checkThresholds(device: CachedDevice, type: string, value: number): Promise<void> {
  const thresholds: Record<string, { warn: [number, number]; critical: [number, number] }> = {
    temperature: { warn: [37.5, 39.5], critical: [36.0, 40.5] },
    heart_rate: { warn: [50, 180], critical: [40, 220] },
    spo2: { warn: [95, 100], critical: [92, 100] },
  };

  const rule = thresholds[type];
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
    await forwardAlert(device, {
      type: 'health',
      severity,
      message,
      sub_message: subMessage,
      data: { [type]: value },
    });
  }
}

// ─── Alert Forwarding ──────────────────────────────────────────────────────

/**
 * Forward alerts to the Notification Service via MQTT event bus.
 * The notification-service handles deduplication, persistence, FCM, email, etc.
 */
async function forwardAlert(device: CachedDevice, alert: DeviceAlertPayload): Promise<void> {
  const payload = {
    pet_id: device.petId,
    device_id: device.deviceId,
    user_id: device.userId,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    sub_message: alert.sub_message,
    data: alert.data,
    timestamp: new Date().toISOString(),
  };

  // Publish to MQTT event bus for notification-service
  mqttPublish('events/alert/created', payload);

  // Also emit immediately to user's Socket.IO room for instant UI update
  const eventMap: Record<string, string> = {
    health: 'alert:health',
    location: 'alert:location',
    feeding: 'alert:feeding',
    device: 'alert:device',
  };
  emitToUser(device.userId, eventMap[alert.type] ?? 'alert:general', {
    _id: `alert_${Date.now()}`,
    ...payload,
    read: false,
    resolved: false,
    createdAt: payload.timestamp,
  });
}

// ─── WiFi Scan Result Processor ────────────────────────────────────────────

/**
 * Calculate signal strength bars from dBm value.
 * -30 dBm → 5 bars (excellent), -90 dBm → 1 bar (bad)
 */
function calculateSignalBars(signalDbm: number): number {
  if (signalDbm > -30) return 5;
  if (signalDbm > -67) return 4;
  if (signalDbm > -70) return 3;
  if (signalDbm > -80) return 2;
  return 1;
}

/**
 * Handle WiFi scan results from device.
 * Device publishes scan results after receiving wifi_scan command.
 * 
 * Payload structure:
 * {
 *   command_id: string,
 *   networks: [
 *     { ssid: string, signal: number (dBm), security?: string, channel?: number, bssid?: string, frequency?: number }
 *   ],
 *   timestamp: number
 * }
 */
async function processWifiScanResult(device: CachedDevice, data: WifiScanResultPayload): Promise<void> {
  if (!data.networks || !Array.isArray(data.networks)) {
    logger.warn(`[WiFi Scan] Invalid networks array from device ${device.deviceId}`);
    return;
  }

  // Transform networks: add signalBars, normalize ssid
  const transformedNetworks = data.networks.map((net) => ({
    ssid: net.ssid?.trim() ? net.ssid : null,  // null for hidden networks
    bssid: net.bssid || '',
    signalDbm: net.signal,  // Rename from "signal" to avoid confusion
    signalBars: calculateSignalBars(net.signal),
    security: net.security || 'unknown',
    channel: net.channel || 0,
    frequency: net.frequency || 0,
  }));

  const scanResult = {
    deviceId: device.deviceId,
    commandId: data.command_id,
    networks: transformedNetworks,
    timestamp: new Date().toISOString(),
  };

  // Write to Redis response queue for HTTP handler to poll
  await setRequestResult(device.deviceId, 'wifi_scan', scanResult, 30).catch((err) =>
    logger.warn('[WiFi Scan] Redis response queue write failed:', err.message)
  );

  // Also cache scan results in Redis for backward compatibility (30-second TTL)
  await cacheSet(
    `wifi_scan:${device.deviceId}`,
    { networks: transformedNetworks, timestamp: new Date().toISOString() },
    30
  ).catch((err) => logger.warn('[WiFi Scan] Redis cache failed:', err.message));

  // Emit to user via Socket.IO using dedicated emitter
  const { emitWifiScanResult } = await import('./socket.server');
  emitWifiScanResult(device.userId, scanResult);

  logger.info(`[WiFi Scan] Device ${device.deviceId} scanned ${data.networks.length} networks`);
}

// ─── OTA Progress Processor ────────────────────────────────────────────────

/**
 * Handle OTA firmware update progress from device.
 * Device publishes progress updates during download, validation, installation.
 * 
 * Payload structure:
 * {
 *   ota_id: string,
 *   status: "downloading" | "validating" | "installing" | "complete" | "error",
 *   progress: number (0-100),
 *   message: string,
 *   timestamp: number
 * }
 */
async function processOtaProgress(device: CachedDevice, data: OtaProgressPayload): Promise<void> {
  const { ota_id, status, progress, message } = data;

  if (typeof progress !== 'number' || progress < 0 || progress > 100) {
    logger.warn(`[OTA] Invalid progress value from device ${device.deviceId}: ${progress}`);
    return;
  }

  // Cache OTA progress in Redis (1800 seconds = 30 min, matches max OTA window)
  if (status !== 'complete' && status !== 'error') {
    await cacheSet(
      `ota_progress:${device.deviceId}`,
      { ota_id, status, progress, message, timestamp: new Date().toISOString() },
      1800
    ).catch((err) => logger.warn('[OTA] Redis cache failed:', err.message));
  } else {
    // Clear cache when OTA finishes
    await cacheDel(`ota_progress:${device.deviceId}`).catch((err) =>
      logger.warn('[OTA] Redis delete failed:', err.message)
    );
  }

  // Emit progress to user via Socket.IO using dedicated emitter
  const { emitOtaProgressUpdated } = await import('./socket.server');
  emitOtaProgressUpdated(device.userId, {
    deviceId: device.deviceId,
    otaId: ota_id,
    status: status as 'downloading' | 'validating' | 'installing' | 'complete' | 'error',
    progress,
    message,
    timestamp: new Date().toISOString(),
  });

  logger.info(`[OTA] Device ${device.deviceId}: ${status} ${progress}% - ${message}`);

  // On completion or error, create alert notification
  if (status === 'complete') {
    emitToUser(device.userId, 'notification:new', {
      id: `ota_complete_${Date.now()}`,
      title: 'Firmware Update Complete',
      body: message,
      severity: 'info',
      createdAt: new Date().toISOString(),
    });
  } else if (status === 'error') {
    await forwardAlert(device, {
      type: 'device',
      severity: 'high',
      message: 'Firmware update failed',
      sub_message: message,
      data: { ota_id, status },
    });
  }
}

// ─── OTA Status Result Processor ─────────────────────────────────────────────

/**
 * Handle OTA status query result from device.
 * Device publishes current OTA status in response to status query command.
 * 
 * Payload structure:
 * {
 *   ota_id: string,
 *   status: "idle" | "downloading" | "validating" | "installing" | "complete" | "error",
 *   progress: number (0-100),
 *   version: string,
 *   message: string,
 *   timestamp: number
 * }
 */
async function processOtaStatusResult(device: CachedDevice, data: OtaStatusResultPayload): Promise<void> {
  const { ota_id, status, progress, version, message } = data;

  if (typeof progress !== 'number' || progress < 0 || progress > 100) {
    logger.warn(`[OTA Status] Invalid progress value from device ${device.deviceId}: ${progress}`);
    return;
  }

  const statusResult = {
    deviceId: device.deviceId,
    otaId: ota_id,
    status,
    progress,
    version,
    message,
    timestamp: new Date().toISOString(),
  };

  // Write to Redis response queue for HTTP handler to poll
  await setRequestResult(device.deviceId, 'ota_status', statusResult, 30).catch((err) =>
    logger.warn('[OTA Status] Redis response queue write failed:', err.message)
  );

  // Emit to user via Socket.IO for real-time updates
  const { emitOtaProgressUpdated } = await import('./socket.server');
  emitOtaProgressUpdated(device.userId, statusResult);

  logger.info(`[OTA Status] Device ${device.deviceId}: ${status} ${progress}% - ${version}`);
}

// ─── Calibration Result Processor ─────────────────────────────────────────────

/**
 * Handle calibration result from device.
 * Device publishes calibration status/result in response to calibration status query.
 * 
 * Payload structure:
 * {
 *   calibration_id: string,
 *   calibration_type: "weight" | "temperature" | "all",
 *   status: "idle" | "in_progress" | "complete" | "error",
 *   results: {
 *     weight_offset?: number,
 *     temperature_offset?: number
 *   },
 *   message: string,
 *   timestamp: number
 * }
 */
async function processCalibrationResult(device: CachedDevice, data: CalibrationResultPayload): Promise<void> {
  const { calibration_id, calibration_type, status, results, message } = data;

  const calibrationResult = {
    deviceId: device.deviceId,
    calibrationId: calibration_id,
    calibrationType: calibration_type,
    status,
    results,
    message,
    timestamp: new Date().toISOString(),
  };

  // Write to Redis response queue for HTTP handler to poll
  await setRequestResult(device.deviceId, 'calibration', calibrationResult, 30).catch((err) =>
    logger.warn('[Calibration] Redis response queue write failed:', err.message)
  );

  // Emit to user via Socket.IO for real-time updates
  emitToUser(device.userId, 'device:calibration_result', calibrationResult);

  logger.info(`[Calibration] Device ${device.deviceId}: ${calibration_type} - ${status}`);
}

// ─── Command ACK Processor ─────────────────────────────────────────────────

/**
 * Handle command acknowledgments from device.
 * Device publishes ACK for every received command within 15 seconds.
 * 
 * Payload structure:
 * {
 *   command_id: string,
 *   status: "success" | "error",
 *   message: string,
 *   details?: Record<string, any>,
 *   timestamp: number
 * }
 */
async function processCommandAck(device: CachedDevice, data: CommandAckPayload): Promise<void> {
  const { command_id, status, message, details } = data;

  if (!command_id || !status) {
    logger.warn(`[Command ACK] Missing required fields from device ${device.deviceId}`);
    return;
  }

  // Try to get cached command info (for context)
  let commandType: string | undefined;
  const cachedCommand = await cacheGet(`command:${command_id}`).catch(() => null);
  if (cachedCommand && typeof cachedCommand === 'object') {
    commandType = (cachedCommand as any).type;
  }

  // Clear any pending timeout for this command
  await cacheDel(`command_timeout:${command_id}`).catch(() => null);

  // Emit ACK to user via Socket.IO using dedicated emitter
  const { emitCommandAck } = await import('./socket.server');
  emitCommandAck(device.userId, {
    deviceId: device.deviceId,
    commandId: command_id,
    commandType,
    status,
    message,
    details,
    timestamp: new Date().toISOString(),
  });

  logger.info(`[Command ACK] Device ${device.deviceId}: ${command_id} → ${status}`);

  // If command failed, create alert notification
  if (status === 'error') {
    await forwardAlert(device, {
      type: 'device',
      severity: 'high',
      message: 'Device command failed',
      sub_message: message,
      data: { command_id, commandType },
    });
  }
}

// ─── Water Level Processor ────────────────────────────────────────────────

/**
 * Handle water level readings from device.
 * Device publishes water level data periodically.
 * 
 * Payload structure:
 * {
 *   level_percentage: number (0-100),
 *   volume_ml: number,
 *   timestamp?: number
 * }
 */
async function processWaterLevel(device: CachedDevice, data: any): Promise<void> {
  const { level_percentage, volume_ml } = data;

  if (level_percentage === undefined || volume_ml === undefined) {
    logger.warn(`[Water Level] Missing fields from device ${device.deviceId}`);
    return;
  }

  if (typeof level_percentage !== 'number' || level_percentage < 0 || level_percentage > 100) {
    logger.warn(`[Water Level] Invalid percentage from device ${device.deviceId}: ${level_percentage}`);
    return;
  }

  try {
    // Forward to feeding-service for ingestion
    const feedingClient = createServiceClient(env.FEEDING_SERVICE_URL);
    await feedingClient.post('/internal/water-level/ingest', {
      device_id: device.deviceId,
      level_percentage,
      volume_ml,
      timestamp: new Date().toISOString(),
    });

    logger.info(`[Water Level] Ingested level ${level_percentage}% from device ${device.deviceId}`);
  } catch (err: any) {
    logger.error(`[Water Level] Failed to ingest from device ${device.deviceId}:`, err.message);
    return;
  }

  // Emit to user via Socket.IO for real-time updates
  emitToUser(device.userId, 'device:water_level_update', {
    deviceId: device.deviceId,
    levelPercentage: level_percentage,
    volumeMl: volume_ml,
    timestamp: new Date().toISOString(),
  });
}

// ─── Camera Event Processor ─────────────────────────────────────────────────

/**
 * Handle camera motion detection events from device.
 * Device publishes camera events when motion is detected.
 * 
 * Payload structure:
 * {
 *   type: 'motion' | 'eating' | 'drinking' | 'sleeping' | 'playing' | 'scratching' | 'vomiting',
 *   confidence_score: number (0-1),
 *   description: string,
 *   thumbnail_url?: string,
 *   clip_url?: string,
 *   timestamp?: number
 * }
 */
async function processCameraEvent(device: CachedDevice, data: any): Promise<void> {
  const { type, confidence_score, description, thumbnail_url, clip_url } = data;

  if (!type || confidence_score === undefined) {
    logger.warn(`[Camera Event] Missing required fields from device ${device.deviceId}`);
    return;
  }

  if (typeof confidence_score !== 'number' || confidence_score < 0 || confidence_score > 1) {
    logger.warn(`[Camera Event] Invalid confidence score from device ${device.deviceId}: ${confidence_score}`);
    return;
  }

  try {
    // Forward to pet-service for storage in cameraevents collection
    await petClient.post('/internal/camera-events', {
      pet_id: device.petId,
      device_serial: device.serial,
      type,
      severity: type === 'vomiting' || type === 'scratching' ? 'alert' : 'normal',
      confidence_score,
      description: description || `${type} detected`,
      thumbnail_url,
      clip_url,
      detected_at: new Date().toISOString(),
    });

    logger.info(`[Camera Event] Stored ${type} event from device ${device.deviceId} (confidence: ${confidence_score})`);
  } catch (err: any) {
    logger.error(`[Camera Event] Failed to store event from device ${device.deviceId}:`, err.message);
    return;
  }

  // Emit to user via Socket.IO for real-time updates
  emitToUser(device.userId, 'camera:motion', {
    deviceId: device.deviceId,
    type,
    confidenceScore: confidence_score,
    description: description || `${type} detected`,
    thumbnailUrl: thumbnail_url,
    clipUrl: clip_url,
    timestamp: new Date().toISOString(),
  });
}

// ─── Type Interfaces ───────────────────────────────────────────────────────

/**
 * WiFi network scan result from device
 */
interface WifiScanResultPayload {
  command_id: string;
  networks: Array<{
    ssid: string;
    signal: number;  // dBm
    bssid?: string;
    security?: string;
    channel?: number;
    frequency?: number;
  }>;
  timestamp?: number;
}

/**
 * WiFi network transformed for Socket.IO emit
 */
interface WifiNetwork {
  ssid: string | null;
  bssid: string;
  signalDbm: number;
  signalBars: number;
  security: string;
  channel: number;
  frequency: number;
}

/**
 * OTA progress update from device
 */
interface OtaProgressPayload {
  ota_id: string;
  status: 'downloading' | 'validating' | 'installing' | 'complete' | 'error';
  progress: number;  // 0-100
  message: string;
  timestamp?: number;
}

/**
 * OTA status query result from device
 */
interface OtaStatusResultPayload {
  ota_id: string;
  status: 'idle' | 'downloading' | 'validating' | 'installing' | 'complete' | 'error';
  progress: number;  // 0-100
  version: string;
  message: string;
  timestamp?: number;
}

/**
 * Calibration result from device
 */
interface CalibrationResultPayload {
  calibration_id: string;
  calibration_type: 'weight' | 'temperature' | 'all';
  status: 'idle' | 'in_progress' | 'complete' | 'error';
  results?: {
    weight_offset?: number;
    temperature_offset?: number;
  };
  message: string;
  timestamp?: number;
}

/**
 * Command acknowledgment from device
 */
interface CommandAckPayload {
  command_id: string;
  status: 'success' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}
