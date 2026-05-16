import { Request, Response } from 'express';
import { asyncHandler, ApiResponse, ApiError, cacheGet, cacheSet } from '@petcare/shared-middleware';
import mongoose from 'mongoose';
import { ITelemetry, TelemetryModel } from '../models/telemetry.model';
import { recordAuditEvent } from '../services/audit.service';

const THRESHOLDS_CACHE_KEY = 'admin:telemetry:thresholds';
const SIMULATORS_CACHE_KEY = 'admin:telemetry:simulators';
const MQTT_STATUS_CACHE_KEY = 'admin:mqtt:status';
const MQTT_SUBSCRIPTIONS_CACHE_KEY = 'admin:mqtt:subscriptions';
const MQTT_MESSAGES_CACHE_KEY = 'admin:mqtt:messages';
const CONFIG_TTL_SECONDS = 60 * 60 * 24 * 365;
const MQTT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MQTT_MESSAGES_LIMIT = 200;

const defaultThresholds = {
  temperature: { highMin: 37.5, highMax: 39.5, criticalMin: 36.0, criticalMax: 40.5 },
  heart_rate: { highMin: 50, highMax: 180, criticalMin: 40, criticalMax: 220 },
  spo2: { highMin: 95, highMax: 100, criticalMin: 92, criticalMax: 100 },
};

function telemetryToJson(telemetry: any) {
  return {
    _id: telemetry._id.toString(),
    id: telemetry._id.toString(),
    timestamp: telemetry.timestamp,
    pet_id: telemetry.pet_id?.toString(),
    device_id: telemetry.device_id?.toString(),
    type: telemetry.type,
    value: telemetry.value,
    metadata: telemetry.metadata,
  };
}

type AdminMqttStatus = {
  connected: boolean;
  broker: string;
  port: number;
  clientId: string;
  connectedAt: string;
  messagesReceived: number;
  messagesSent: number;
  subscriptions: string[];
  lastMessage?: {
    topic: string;
    receivedAt: string;
    size: number;
  };
};

type AdminMqttSubscription = {
  topic: string;
  qos: number;
  subscribedAt: string;
  messagesReceived: number;
};

type AdminMqttMessage = {
  id: string;
  topic: string;
  payload: unknown;
  qos: number;
  retain: boolean;
  timestamp: string;
  size: number;
  direction: 'sent' | 'received';
};

function getDefaultMqttSubscriptions(): AdminMqttSubscription[] {
  const now = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return [
    { topic: 'devices/+/telemetry', qos: 1, subscribedAt: now, messagesReceived: 0 },
    { topic: 'devices/+/status', qos: 0, subscribedAt: now, messagesReceived: 0 },
    { topic: 'pets/+/location', qos: 1, subscribedAt: now, messagesReceived: 0 },
  ];
}

async function getMqttSubscriptionsState(): Promise<AdminMqttSubscription[]> {
  const cached = await cacheGet<AdminMqttSubscription[]>(MQTT_SUBSCRIPTIONS_CACHE_KEY);
  if (Array.isArray(cached)) return cached;
  const defaults = getDefaultMqttSubscriptions();
  await cacheSet(MQTT_SUBSCRIPTIONS_CACHE_KEY, defaults, MQTT_TTL_SECONDS);
  return defaults;
}

async function setMqttSubscriptionsState(subscriptions: AdminMqttSubscription[]) {
  await cacheSet(MQTT_SUBSCRIPTIONS_CACHE_KEY, subscriptions, MQTT_TTL_SECONDS);
}

async function getMqttMessagesState(): Promise<AdminMqttMessage[]> {
  const cached = await cacheGet<AdminMqttMessage[]>(MQTT_MESSAGES_CACHE_KEY);
  return Array.isArray(cached) ? cached : [];
}

async function setMqttMessagesState(messages: AdminMqttMessage[]) {
  await cacheSet(MQTT_MESSAGES_CACHE_KEY, messages.slice(0, MQTT_MESSAGES_LIMIT), MQTT_TTL_SECONDS);
}

async function getMqttStatusState(): Promise<AdminMqttStatus> {
  const cached = await cacheGet<AdminMqttStatus>(MQTT_STATUS_CACHE_KEY);
  if (cached) return cached;

  const subscriptions = await getMqttSubscriptionsState();
  const initial: AdminMqttStatus = {
    connected: true,
    broker: process.env.MQTT_BROKER || 'mosquitto',
    port: Number(process.env.MQTT_PORT || 1883),
    clientId: `telemetry-service-${process.env.HOSTNAME || 'local'}`,
    connectedAt: new Date().toISOString(),
    messagesReceived: 0,
    messagesSent: 0,
    subscriptions: subscriptions.map((sub) => sub.topic),
  };

  await cacheSet(MQTT_STATUS_CACHE_KEY, initial, MQTT_TTL_SECONDS);
  return initial;
}

async function setMqttStatusState(status: AdminMqttStatus) {
  await cacheSet(MQTT_STATUS_CACHE_KEY, status, MQTT_TTL_SECONDS);
}

function topicMatchesFilter(filter: string, topic: string): boolean {
  if (!filter) return true;
  if (filter === topic) return true;

  const escaped = filter
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\+/g, '[^/]+')
    .replace(/#/g, '.*');

  return new RegExp(`^${escaped}$`).test(topic);
}

/**
 * GET /api/v1/admin/telemetry — List telemetry data (paginated)
 */
export const listTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  const skip = (page - 1) * limit;

  const { 
    pet_id, 
    device_id, 
    type, 
    start_date, 
    end_date,
    sort = 'timestamp' 
  } = req.query;

  // Build filter
  const filter: any = {};
  if (pet_id) filter.pet_id = pet_id;
  if (device_id) filter.device_id = device_id;
  if (type) filter.type = type;
  
  // Date range filter
  if (start_date || end_date) {
    filter.timestamp = {};
    if (start_date) filter.timestamp.$gte = new Date(start_date as string);
    if (end_date) filter.timestamp.$lte = new Date(end_date as string);
  }

  // Build sort
  const sortOptions: any = {};
  const sortField = sort as string;
  const sortOrder = req.query.order === 'asc' ? 1 : -1;
  sortOptions[sortField] = sortOrder;

  const [telemetry, total] = await Promise.all([
    TelemetryModel.find(filter)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean(),
    TelemetryModel.countDocuments(filter),
  ]);

  ApiResponse.ok(res, {
    telemetry: telemetry.map(telemetryToJson),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/admin/telemetry/:telemetryId — Get single telemetry entry
 */
export const getTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { telemetryId } = req.params;

  const telemetry = await TelemetryModel.findById(telemetryId).lean();

  if (!telemetry) throw new ApiError('Telemetry not found', 404, 'TELEMETRY_NOT_FOUND');

  ApiResponse.ok(res, telemetryToJson(telemetry), 'Telemetry retrieved');
});

/**
 * DELETE /api/v1/admin/telemetry/:telemetryId — Delete telemetry entry
 */
export const deleteTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { telemetryId } = req.params;

  const telemetry = await TelemetryModel.findByIdAndDelete(telemetryId);
  if (!telemetry) throw new ApiError('Telemetry not found', 404, 'TELEMETRY_NOT_FOUND');

  ApiResponse.ok(res, null, 'Telemetry deleted');
});

/**
 * DELETE /api/v1/admin/telemetry/bulk — Bulk delete telemetry data
 */
export const bulkDeleteTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { filter } = req.body;

  if (!filter || Object.keys(filter).length === 0) {
    throw new ApiError('Filter is required for bulk delete', 400, 'FILTER_REQUIRED');
  }

  const result = await TelemetryModel.deleteMany(filter);

  ApiResponse.ok(res, {
    deletedCount: result.deletedCount,
    filter,
  }, 'Telemetry data deleted');
});

/**
 * GET /api/v1/admin/telemetry/stats — Telemetry statistics
 */
export const getTelemetryStats = asyncHandler(async (req: Request, res: Response) => {
  const { period = '7d', pet_id, device_id } = req.query;

  // Calculate date range
  const now = new Date();
  const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Build filter for stats
  const filter: any = {
    timestamp: { $gte: startDate },
  };
  if (pet_id) filter.pet_id = pet_id;
  if (device_id) filter.device_id = device_id;

  const [
    totalReadings,
    readingsByType,
    activeDevices,
    activePets,
    latestReading,
  ] = await Promise.all([
    TelemetryModel.countDocuments(filter),
    TelemetryModel.aggregate([
      { $match: filter },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    TelemetryModel.distinct('device_id', filter),
    TelemetryModel.distinct('pet_id', filter),
    TelemetryModel.findOne(filter).sort({ timestamp: -1 }).lean(),
  ]);

  ApiResponse.ok(res, {
    period,
    totalReadings,
    readingsByType: readingsByType.reduce((acc: any, item: any) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    activeDevices: activeDevices.length,
    activePets: activePets.length,
    latestReading: latestReading ? telemetryToJson(latestReading) : null,
  });
});

/**
 * GET /api/v1/admin/telemetry/aggregate — Aggregate telemetry data
 */
export const getAggregatedTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { 
    pet_id, 
    device_id, 
    type, 
    interval = '1h',
    start_date,
    end_date,
    aggregation = 'avg'
  } = req.query;

  if (!type) {
    throw new ApiError('Type is required for aggregation', 400, 'TYPE_REQUIRED');
  }

  if (!start_date || !end_date) {
    throw new ApiError('Start and end dates are required', 400, 'DATES_REQUIRED');
  }

  // Build match filter
  const matchFilter: any = {
    type,
    timestamp: {
      $gte: new Date(start_date as string),
      $lte: new Date(end_date as string),
    },
  };
  if (pet_id) matchFilter.pet_id = new mongoose.Types.ObjectId(pet_id as string);
  if (device_id) matchFilter.device_id = new mongoose.Types.ObjectId(device_id as string);

  // Build aggregation pipeline
  const aggregationPipeline: any[] = [
    { $match: matchFilter },
  ];

  // Add date grouping based on interval
  let groupFormat;
  switch (interval) {
    case '1m':
      groupFormat = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        hour: { $hour: '$timestamp' },
        minute: { $minute: '$timestamp' },
      };
      break;
    case '1h':
      groupFormat = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        hour: { $hour: '$timestamp' },
      };
      break;
    case '1d':
      groupFormat = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
      };
      break;
    default:
      groupFormat = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        hour: { $hour: '$timestamp' },
      };
  }

  // Add aggregation based on type
  const aggregationField = aggregation === 'min' ? '$min' : 
                          aggregation === 'max' ? '$max' : 
                          aggregation === 'sum' ? '$sum' : '$avg';

  aggregationPipeline.push(
    {
      $group: {
        _id: groupFormat,
        value: { [aggregationField]: '$value' },
        count: { $sum: 1 },
        min: { $min: '$value' },
        max: { $max: '$value' },
        avg: { $avg: '$value' },
      },
    },
    { $sort: { '_id': 1 } }
  );

  const results = await TelemetryModel.aggregate(aggregationPipeline);

  ApiResponse.ok(res, {
    aggregation,
    interval,
    type,
    results,
    count: results.length,
  });
});

/**
 * POST /api/v1/admin/telemetry/cleanup — Cleanup old telemetry data
 */
export const cleanupTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { days = 90, pet_id, device_id, type } = req.body;

  if (days < 1) {
    throw new ApiError('Days must be at least 1', 400, 'INVALID_DAYS');
  }

  // Calculate cutoff date
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Build filter for cleanup
  const filter: any = {
    timestamp: { $lt: cutoffDate },
  };
  if (pet_id) filter.pet_id = pet_id;
  if (device_id) filter.device_id = device_id;
  if (type) filter.type = type;

  const result = await TelemetryModel.deleteMany(filter);

  ApiResponse.ok(res, {
    deletedCount: result.deletedCount,
    cutoffDate,
    filter,
  }, 'Telemetry cleanup completed');
});

/**
 * POST /api/v1/admin/telemetry/simulate — Generate simulated telemetry data
 */
export const simulateTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const { 
    pet_id, 
    device_id, 
    type, 
    count = 10,
    interval_minutes = 5,
    base_value,
    variance = 10
  } = req.body;

  if (!pet_id || !type) {
    throw new ApiError('Pet ID and type are required', 400, 'MISSING_FIELDS');
  }

  if (count < 1 || count > 1000) {
    throw new ApiError('Count must be between 1 and 1000', 400, 'INVALID_COUNT');
  }

  const now = new Date();
  const telemetryData = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now.getTime() - (i * interval_minutes * 60 * 1000));
    
    // Generate realistic values based on type
    let value;
    switch (type) {
      case 'heart_rate':
        value = Math.floor((base_value || 80) + (Math.random() - 0.5) * variance * 2);
        break;
      case 'temperature':
        value = parseFloat(((base_value || 38.5) + (Math.random() - 0.5) * variance).toFixed(1));
        break;
      case 'spo2':
        value = Math.floor((base_value || 95) + (Math.random() - 0.5) * variance);
        break;
      case 'weight':
        value = parseFloat(((base_value || 25) + (Math.random() - 0.5) * variance).toFixed(1));
        break;
      case 'activity_steps':
        value = Math.floor(Math.random() * 1000);
        break;
      case 'activity_distance':
        value = parseFloat((Math.random() * 5).toFixed(2));
        break;
      default:
        value = Math.random() * 100;
    }

    telemetryData.push({
      timestamp,
      pet_id,
      device_id,
      type,
      value,
      metadata: {
        source: 'simulator',
        accuracy: 0.95,
        confidence: 0.9,
      },
    });
  }

  // Insert simulated data
  const result = await TelemetryModel.insertMany(telemetryData);

  ApiResponse.ok(res, {
    insertedCount: result.length,
    type,
    pet_id,
    device_id,
    count,
    interval_minutes,
  }, 'Simulated telemetry data generated');
});

/**
 * GET /api/v1/admin/telemetry/thresholds — current telemetry threshold config
 */
export const getTelemetryThresholds = asyncHandler(async (_req: Request, res: Response) => {
  const cached = await cacheGet<Record<string, unknown>>(THRESHOLDS_CACHE_KEY);
  ApiResponse.ok(res, {
    thresholds: cached ?? defaultThresholds,
  }, 'Telemetry thresholds retrieved');
});

/**
 * PATCH /api/v1/admin/telemetry/thresholds — update telemetry threshold config
 */
export const updateTelemetryThresholds = asyncHandler(async (req: Request, res: Response) => {
  const { thresholds } = req.body as { thresholds?: Record<string, unknown> };

  if (!thresholds || typeof thresholds !== 'object' || Object.keys(thresholds).length === 0) {
    throw new ApiError('Thresholds payload is required', 400, 'THRESHOLDS_REQUIRED');
  }

  await cacheSet(THRESHOLDS_CACHE_KEY, thresholds, CONFIG_TTL_SECONDS);

  await recordAuditEvent({
    actorUserId: req.user?.userId,
    actorRole: 'admin',
    action: 'admin.threshold_update',
    resourceType: 'system_config',
    metadata: { thresholds },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  ApiResponse.ok(res, {
    thresholds,
  }, 'Telemetry thresholds updated');
});

/**
 * GET /api/v1/admin/telemetry/simulators — simulator runtime status
 */
export const getSimulatorStatus = asyncHandler(async (_req: Request, res: Response) => {
  const cached = await cacheGet<{ enabled: boolean }>(SIMULATORS_CACHE_KEY);
  const enabled = cached?.enabled ?? (process.env.ENABLE_SIMULATORS === 'true');

  ApiResponse.ok(res, {
    enabled,
  }, 'Simulator status retrieved');
});

/**
 * PATCH /api/v1/admin/telemetry/simulators — toggle simulator runtime status
 */
export const toggleSimulators = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    throw new ApiError('Boolean "enabled" is required', 400, 'ENABLED_REQUIRED');
  }

  await cacheSet(SIMULATORS_CACHE_KEY, { enabled }, CONFIG_TTL_SECONDS);

  await recordAuditEvent({
    actorUserId: req.user?.userId,
    actorRole: 'admin',
    action: 'admin.simulator_toggle',
    resourceType: 'system_config',
    metadata: { enabled },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  ApiResponse.ok(res, {
    enabled,
  }, 'Simulator status updated');
});

/**
 * GET /api/v1/admin/mqtt/status — Get MQTT connection status
 */
export const getMqttStatus = asyncHandler(async (req: Request, res: Response) => {
  const [status, subscriptions] = await Promise.all([
    getMqttStatusState(),
    getMqttSubscriptionsState(),
  ]);

  const normalizedStatus = {
    ...status,
    subscriptions: subscriptions.map((sub) => sub.topic),
  };

  ApiResponse.ok(res, normalizedStatus, 'MQTT status retrieved');
});

/**
 * POST /api/v1/admin/mqtt/publish — Publish MQTT message
 */
export const publishMqttMessage = asyncHandler(async (req: Request, res: Response) => {
  const { topic, payload, qos = 1, retain = false } = req.body;

  if (!topic || !payload) {
    throw new ApiError('Topic and payload are required', 400, 'MISSING_FIELDS');
  }

  const nowIso = new Date().toISOString();
  const payloadText = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const size = Buffer.byteLength(payloadText, 'utf8');

  const [status, subscriptions, messages] = await Promise.all([
    getMqttStatusState(),
    getMqttSubscriptionsState(),
    getMqttMessagesState(),
  ]);

  const message: AdminMqttMessage = {
    id: Date.now().toString(),
    topic,
    payload,
    qos,
    retain,
    timestamp: nowIso,
    size,
    direction: 'sent',
  };

  const updatedStatus: AdminMqttStatus = {
    ...status,
    messagesSent: Number(status.messagesSent || 0) + 1,
    lastMessage: {
      topic,
      receivedAt: nowIso,
      size,
    },
  };

  const updatedSubscriptions = subscriptions.map((sub) => (
    topicMatchesFilter(sub.topic, topic)
      ? { ...sub, messagesReceived: Number(sub.messagesReceived || 0) + 1 }
      : sub
  ));

  await Promise.all([
    setMqttStatusState({
      ...updatedStatus,
      subscriptions: updatedSubscriptions.map((sub) => sub.topic),
    }),
    setMqttSubscriptionsState(updatedSubscriptions),
    setMqttMessagesState([message, ...messages]),
  ]);

  ApiResponse.ok(res, {
    ...message,
    published: true,
    messageId: message.id,
  }, 'MQTT message published');
});

/**
 * GET /api/v1/admin/mqtt/subscriptions — Get MQTT subscriptions
 */
export const getMqttSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  const subscriptions = await getMqttSubscriptionsState();

  ApiResponse.ok(res, {
    subscriptions,
    total: subscriptions.length,
  }, 'MQTT subscriptions retrieved');
});

/**
 * GET /api/v1/admin/mqtt/messages — Get published message history
 */
export const getMqttMessages = asyncHandler(async (req: Request, res: Response) => {
  const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const messages = await getMqttMessagesState();

  const filtered = topic
    ? messages.filter((message) => topicMatchesFilter(topic, message.topic))
    : messages;

  ApiResponse.ok(res, {
    messages: filtered.slice(0, limit),
    total: filtered.length,
    topic: topic || null,
  }, 'MQTT messages retrieved');
});

/**
 * GET /api/v1/admin/mqtt/clients — list MQTT clients inferred from runtime state
 */
export const getMqttClients = asyncHandler(async (_req: Request, res: Response) => {
  type DerivedClient = {
    clientId: string;
    petId: string;
    connectedSinceTs: number;
    lastMessageTs: number;
    topics: Set<string>;
  };

  const [status, subscriptions, messages] = await Promise.all([
    getMqttStatusState(),
    getMqttSubscriptionsState(),
    getMqttMessagesState(),
  ]);

  const clientsMap = new Map<string, DerivedClient>();

  const upsertClient = (clientId: string, petId: string, topic: string, timestamp: string) => {
    const ts = Date.parse(timestamp) || Date.now();
    const existing = clientsMap.get(clientId);

    if (existing) {
      existing.petId = existing.petId === 'unknown' ? petId : existing.petId;
      existing.topics.add(topic);
      existing.connectedSinceTs = Math.min(existing.connectedSinceTs, ts);
      existing.lastMessageTs = Math.max(existing.lastMessageTs, ts);
      return;
    }

    clientsMap.set(clientId, {
      clientId,
      petId,
      connectedSinceTs: ts,
      lastMessageTs: ts,
      topics: new Set([topic]),
    });
  };

  for (const message of messages) {
    const parts = message.topic.split('/');
    let inferredClientId = '';
    let inferredPetId = 'unknown';

    if (parts[0] === 'devices' && parts[1] && parts[1] !== '+' && parts[1] !== '#') {
      inferredClientId = parts[1];
    } else if (parts[0] === 'pets' && parts[1] && parts[1] !== '+' && parts[1] !== '#') {
      inferredClientId = `pet-${parts[1]}`;
      inferredPetId = parts[1];
    }

    const payload = typeof message.payload === 'object' && message.payload !== null
      ? message.payload as Record<string, unknown>
      : undefined;

    const payloadClientId = typeof payload?.clientId === 'string'
      ? payload.clientId
      : typeof payload?.deviceId === 'string'
        ? payload.deviceId
        : typeof payload?.device_id === 'string'
          ? payload.device_id
          : undefined;

    const payloadPetId = typeof payload?.petId === 'string'
      ? payload.petId
      : typeof payload?.pet_id === 'string'
        ? payload.pet_id
        : undefined;

    const clientId = payloadClientId || inferredClientId;
    if (!clientId) continue;

    upsertClient(clientId, payloadPetId || inferredPetId, message.topic, message.timestamp);
  }

  for (const subscription of subscriptions) {
    const parts = subscription.topic.split('/');
    if (parts[0] === 'devices' && parts[1] && !['+', '#'].includes(parts[1])) {
      upsertClient(parts[1], 'unknown', subscription.topic, subscription.subscribedAt);
    }
  }

  const clients = Array.from(clientsMap.values())
    .sort((a, b) => b.lastMessageTs - a.lastMessageTs)
    .map((client) => ({
      clientId: client.clientId,
      petId: client.petId,
      connectedSince: new Date(client.connectedSinceTs || Date.parse(status.connectedAt)).toISOString(),
      lastMessageAt: new Date(client.lastMessageTs || Date.parse(status.lastMessage?.receivedAt || status.connectedAt)).toISOString(),
      topicCount: client.topics.size,
    }));

  ApiResponse.ok(res, {
    clients,
    total: clients.length,
    source: 'cache-derived',
  }, 'MQTT clients retrieved');
});

/**
 * POST /api/v1/admin/mqtt/subscribe — Subscribe to MQTT topic
 */
export const subscribeToMqttTopic = asyncHandler(async (req: Request, res: Response) => {
  const { topic, qos = 1 } = req.body;

  if (!topic) {
    throw new ApiError('Topic is required', 400, 'TOPIC_REQUIRED');
  }

  const [subscriptions, status] = await Promise.all([
    getMqttSubscriptionsState(),
    getMqttStatusState(),
  ]);

  const existingIndex = subscriptions.findIndex((sub) => sub.topic === topic);
  let subscribedAt = new Date().toISOString();

  if (existingIndex >= 0) {
    subscriptions[existingIndex] = {
      ...subscriptions[existingIndex],
      qos,
    };
    subscribedAt = subscriptions[existingIndex].subscribedAt;
  } else {
    subscriptions.push({
      topic,
      qos,
      subscribedAt,
      messagesReceived: 0,
    });
  }

  await Promise.all([
    setMqttSubscriptionsState(subscriptions),
    setMqttStatusState({
      ...status,
      subscriptions: subscriptions.map((sub) => sub.topic),
    }),
  ]);

  ApiResponse.ok(res, {
    topic,
    qos,
    subscribed: true,
    subscribedAt: new Date().toISOString(),
  }, 'MQTT subscription created');
});

/**
 * DELETE /api/v1/admin/mqtt/unsubscribe — Unsubscribe from MQTT topic
 */
export const unsubscribeFromMqttTopic = asyncHandler(async (req: Request, res: Response) => {
  const { topic } = req.body;

  if (!topic) {
    throw new ApiError('Topic is required', 400, 'TOPIC_REQUIRED');
  }

  const [subscriptions, status] = await Promise.all([
    getMqttSubscriptionsState(),
    getMqttStatusState(),
  ]);

  const filtered = subscriptions.filter((sub) => sub.topic !== topic);

  await Promise.all([
    setMqttSubscriptionsState(filtered),
    setMqttStatusState({
      ...status,
      subscriptions: filtered.map((sub) => sub.topic),
    }),
  ]);

  ApiResponse.ok(res, {
    topic,
    unsubscribed: true,
    unsubscribedAt: new Date().toISOString(),
  }, 'MQTT subscription removed');
});
