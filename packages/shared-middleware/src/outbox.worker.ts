import { logger } from './logger';
import { mqttPublish } from './mqtt';
import {
  getPendingEvents,
  removeFromOutbox,
  incrementRetryCount,
  acquireOutboxLock,
  releaseOutboxLock,
  type OutboxEvent,
} from './outbox';

/**
 * Outbox Background Worker
 * 
 * Processes pending MQTT events from the outbox and publishes them.
 * Should be run as a separate process or scheduled job.
 * 
 * Usage:
 *   import { startOutboxWorker } from '@petcare/shared-middleware';
 *   startOutboxWorker(); // Run every 5 seconds
 */

let isRunning = false;
let workerId: string;

export async function startOutboxWorker(intervalMs = 5000): Promise<void> {
  if (isRunning) {
    logger.warn('[Outbox Worker] Already running');
    return;
  }

  isRunning = true;
  workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info(`[Outbox Worker] Starting worker ${workerId} with interval ${intervalMs}ms`);

  const processOutbox = async () => {
    try {
      // Try to acquire lock
      const acquired = await acquireOutboxLock(workerId);
      if (!acquired) {
        logger.debug('[Outbox Worker] Another worker is processing, skipping');
        return;
      }

      logger.debug('[Outbox Worker] Acquired lock, processing outbox');

      const events = await getPendingEvents(50);
      if (events.length === 0) {
        logger.debug('[Outbox Worker] No pending events');
        await releaseOutboxLock(workerId);
        return;
      }

      logger.info(`[Outbox Worker] Processing ${events.length} pending events`);

      for (const event of events) {
        try {
          // Check if event has exceeded max retries
          if (event.retryCount >= event.maxRetries) {
            logger.error(
              `[Outbox Worker] Event ${event.id} exceeded max retries (${event.maxRetries}), removing`
            );
            await removeFromOutbox(event.id);
            continue;
          }

          // Attempt to publish
          await mqttPublish(event.topic, event.payload);
          logger.info(`[Outbox Worker] Published event ${event.id} to ${event.topic}`);

          // Remove from outbox on success
          await removeFromOutbox(event.id);
        } catch (err) {
          logger.error(`[Outbox Worker] Failed to publish event ${event.id}:`, err);
          
          // Increment retry count
          await incrementRetryCount(event.id);
        }
      }

      await releaseOutboxLock(workerId);
    } catch (err) {
      logger.error('[Outbox Worker] Error processing outbox:', err);
      // Release lock on error
      await releaseOutboxLock(workerId);
    }
  };

  // Run immediately, then on interval
  await processOutbox();
  const interval = setInterval(processOutbox, intervalMs);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[Outbox Worker] Shutting down...');
    clearInterval(interval);
    await releaseOutboxLock(workerId);
    isRunning = false;
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Stop the outbox worker
 */
export async function stopOutboxWorker(): Promise<void> {
  if (!isRunning) return;
  
  await releaseOutboxLock(workerId);
  isRunning = false;
  logger.info('[Outbox Worker] Stopped');
}
