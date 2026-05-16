import { getRedis } from './redis';
import { logger } from './logger';

/**
 * Outbox Pattern for MQTT Events
 * 
 * Ensures at-least-once delivery of MQTT events by storing them in Redis
 * before publishing. A background worker processes the outbox and retries
 * failed publishes.
 * 
 * This prevents event loss when a service crashes between DB commit and MQTT publish.
 */

const OUTBOX_KEY_PREFIX = 'outbox:';
const OUTBOX_TTL_SECONDS = 3600; // 1 hour
const OUTBOX_PROCESS_LOCK_TTL = 30; // 30 seconds lock for processing

export interface OutboxEvent {
  id: string;
  topic: string;
  payload: any;
  createdAt: string;
  retryCount: number;
  maxRetries: number;
}

/**
 * Add an event to the outbox
 */
export const addToOutbox = async (
  topic: string,
  payload: any,
  maxRetries = 3
): Promise<string> => {
  const redis = getRedis();
  if (!redis) {
    logger.warn('[Outbox] Redis unavailable - skipping outbox, publishing directly');
    // Fail-open: if Redis is down, we can't use outbox pattern
    // The caller should handle direct publish
    throw new Error('Redis unavailable for outbox');
  }

  const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const event: OutboxEvent = {
    id: eventId,
    topic,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries,
  };

  const key = `${OUTBOX_KEY_PREFIX}${eventId}`;
  await redis.setex(key, OUTBOX_TTL_SECONDS, JSON.stringify(event));
  
  logger.info(`[Outbox] Added event ${eventId} to topic ${topic}`);
  return eventId;
};

/**
 * Get an event from the outbox
 */
export const getFromOutbox = async (eventId: string): Promise<OutboxEvent | null> => {
  const redis = getRedis();
  if (!redis) return null;

  const key = `${OUTBOX_KEY_PREFIX}${eventId}`;
  const data = await redis.get(key);
  
  if (!data) return null;
  
  try {
    return JSON.parse(data) as OutboxEvent;
  } catch (err) {
    logger.error(`[Outbox] Failed to parse event ${eventId}:`, err);
    return null;
  }
};

/**
 * Remove an event from the outbox (after successful publish)
 */
export const removeFromOutbox = async (eventId: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;

  const key = `${OUTBOX_KEY_PREFIX}${eventId}`;
  await redis.del(key);
  logger.info(`[Outbox] Removed event ${eventId}`);
};

/**
 * Update retry count for an event
 */
export const incrementRetryCount = async (eventId: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;

  const event = await getFromOutbox(eventId);
  if (!event) return;

  event.retryCount += 1;
  const key = `${OUTBOX_KEY_PREFIX}${eventId}`;
  await redis.setex(key, OUTBOX_TTL_SECONDS, JSON.stringify(event));
  
  logger.info(`[Outbox] Incremented retry count for ${eventId} to ${event.retryCount}`);
};

/**
 * Get all pending events from outbox (for background worker)
 * Note: This is a simplified version. In production, you'd want
 * to use Redis streams or a more sophisticated queue system.
 */
export const getPendingEvents = async (limit = 100): Promise<OutboxEvent[]> => {
  const redis = getRedis();
  if (!redis) return [];

  const keys = await redis.keys(`${OUTBOX_KEY_PREFIX}*`);
  if (keys.length === 0) return [];

  const events: OutboxEvent[] = [];
  const sampleKeys = keys.slice(0, limit);

  for (const key of sampleKeys) {
    const data = await redis.get(key);
    if (data) {
      try {
        const event = JSON.parse(data) as OutboxEvent;
        events.push(event);
      } catch (err) {
        logger.error(`[Outbox] Failed to parse event from ${key}:`, err);
      }
    }
  }

  return events.sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
};

/**
 * Acquire a lock for processing outbox events
 * Prevents multiple workers from processing the same events
 */
export const acquireOutboxLock = async (workerId: string): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return false;

  const lockKey = 'outbox:processing_lock';
  const result = await redis.set(lockKey, workerId, 'PX', OUTBOX_PROCESS_LOCK_TTL * 1000, 'NX');
  return result === 'OK';
};

/**
 * Release the outbox processing lock
 */
export const releaseOutboxLock = async (workerId: string): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;

  const lockKey = 'outbox:processing_lock';
  const currentLock = await redis.get(lockKey);
  
  if (currentLock === workerId) {
    await redis.del(lockKey);
    logger.info(`[Outbox] Released lock by worker ${workerId}`);
  }
};
