import Redis from 'ioredis';
import { logger } from './logger';

let redisClient: Redis | null = null;

export const connectRedis = async (url?: string): Promise<Redis | null> => {
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) {
          logger.error('Redis: max retries reached');
          return null;
        }
        return Math.min(times * 200, 3000);
      },
    });

    redisClient.on('error', (err: Error) => logger.error('Redis error:', err.message));
    redisClient.on('connect', () => logger.info('✅ Redis connected'));
    redisClient.on('close', () => logger.warn('Redis connection closed'));

    await redisClient.ping();
    return redisClient;
  } catch (err) {
    logger.warn('Redis connection failed — running without caching');
    redisClient = null;
    return null;
  }
};

export const getRedis = (): Redis | null => redisClient;

export const safeRedisGet = async (key: string): Promise<string | null> => {
  if (!redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
};

export const safeRedisSetex = async (key: string, ttl: number, value: string): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttl, value);
  } catch { /* ignore */ }
};

export const safeRedisDel = async (...keys: string[]): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.del(...keys);
  } catch { /* ignore */ }
};

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!redisClient) return null;
  try {
    const val = await redisClient.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
};

export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
  } catch { /* ignore */ }
};

export const cacheDel = async (key: string): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.del(key);
  } catch { /* ignore */ }
};

// ─── Redis Response Queue for Request-Response MQTT Flows ─────────────────────

/**
 * Set a pending request in Redis with TTL
 * @param requestId Unique identifier for the request (e.g., deviceId)
 * @param operation Type of operation (e.g., 'wifi_scan', 'ota_status', 'calibration')
 * @param ttlSeconds Time-to-live in seconds (default: 30)
 */
export const setPendingRequest = async (requestId: string, operation: string, ttlSeconds = 30): Promise<void> => {
  if (!redisClient) {
    logger.warn('[Redis Queue] Redis unavailable - skipping pending request');
    return;
  }

  const key = `${operation}_pending:${requestId}`;
  await redisClient.setex(key, ttlSeconds, '1');
  logger.info(`[Redis Queue] Set pending: ${key} (TTL: ${ttlSeconds}s)`);
};

/**
 * Write operation result to Redis
 * @param requestId Unique identifier for the request
 * @param operation Type of operation
 * @param result Result data to store
 * @param ttlSeconds Time-to-live in seconds (default: 30)
 */
export const setRequestResult = async (requestId: string, operation: string, result: unknown, ttlSeconds = 30): Promise<void> => {
  if (!redisClient) {
    logger.warn('[Redis Queue] Redis unavailable - skipping result write');
    return;
  }

  const key = `${operation}_result:${requestId}`;
  await redisClient.setex(key, ttlSeconds, JSON.stringify(result));
  logger.info(`[Redis Queue] Set result: ${key} (TTL: ${ttlSeconds}s)`);
};

/**
 * Poll Redis for operation result with timeout
 * @param requestId Unique identifier for the request
 * @param operation Type of operation
 * @param timeoutMs Timeout in milliseconds (default: 15000)
 * @param pollIntervalMs Polling interval in milliseconds (default: 200)
 */
export const waitForResult = async <T = unknown>(
  requestId: string,
  operation: string,
  timeoutMs = 15000,
  pollIntervalMs = 200
): Promise<T | null> => {
  if (!redisClient) {
    logger.warn('[Redis Queue] Redis unavailable - cannot wait for result');
    return null;
  }

  const key = `${operation}_result:${requestId}`;
  const startTime = Date.now();
  const endTime = startTime + timeoutMs;

  logger.info(`[Redis Queue] Waiting for result: ${key} (timeout: ${timeoutMs}ms)`);

  while (Date.now() < endTime) {
    const result = await redisClient.get(key);
    if (result) {
      try {
        const parsed = JSON.parse(result);
        logger.info(`[Redis Queue] Result found: ${key}`);
        return parsed as T;
      } catch (err) {
        logger.error(`[Redis Queue] Failed to parse result from ${key}:`, err);
        return null;
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  logger.warn(`[Redis Queue] Timeout waiting for result: ${key}`);
  return null;
};

/**
 * Check if a request is still pending
 * @param requestId Unique identifier for the request
 * @param operation Type of operation
 */
export const isRequestPending = async (requestId: string, operation: string): Promise<boolean> => {
  if (!redisClient) return false;

  const key = `${operation}_pending:${requestId}`;
  const pending = await redisClient.get(key);
  return pending === '1';
};
