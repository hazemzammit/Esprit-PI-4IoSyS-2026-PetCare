// ─── Shared Middleware — PetCare (Public) ───────────────────────────────────
// This package exports middleware shared between the telemetry service and clients.

// Core utilities
export { ApiError } from './ApiError';
export { ApiResponse, ok, created, noData } from './ApiResponse';
export { asyncHandler } from './asyncHandler';
export { errorHandler } from './errorHandler';
export { logger } from './logger';
export { validate } from './validate';

// MQTT
export { getMqttClient, connectMqtt, mqttPublish, publishToDevice } from './mqtt';
export type { MqttConnectOptions } from './mqtt';

// Redis / Cache
export {
  connectRedis,
  getRedis,
  safeRedisGet,
  safeRedisSetex,
  safeRedisDel,
  cacheGet,
  cacheSet,
  cacheDel,
} from './redis';

// Sanitization
export { mongoSanitize, xssSanitize } from './sanitize';

// Observability
export { requestId, requestLogger } from './requestId';

// ObjectId validation
export { validateObjectId } from './objectIdValidator';

// HTTP client with timeouts + retries
export { createServiceClient } from './httpClient';

// Circuit breaker
export { CircuitBreaker } from './circuitBreaker';
export type { CircuitBreakerOptions } from './circuitBreaker';

// Metrics / monitoring
export { metricsMiddleware, metricsEndpoint } from './metrics';

// Internal service authentication
export { requireInternalKey } from './internalAuth';