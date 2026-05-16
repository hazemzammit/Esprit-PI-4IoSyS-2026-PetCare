import { Request, Response, NextFunction } from 'express';
import { getRedis } from './redis';
import { logger } from './logger';

/**
 * Idempotency Middleware
 * 
 * Prevents duplicate processing of requests with the same idempotency key.
 * Uses Redis to store request results keyed by the idempotency key.
 * 
 * Usage:
 *   router.post('/api/v1/feeding/dispense', idempotency, controller.dispense);
 * 
 * Client must send: Idempotency-Key header (UUID recommended)
 * TTL: 24 hours by default
 */

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const IDEMPOTENCY_KEY_PREFIX = 'idempotency:';

export interface IdempotencyResult {
  status: number;
  body: any;
  headers: Record<string, string>;
}

/**
 * Middleware to handle idempotency for write operations
 */
export const idempotency = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  // Skip idempotency check if no key provided (optional - can make strict)
  if (!idempotencyKey) {
    logger.warn('[Idempotency] No Idempotency-Key header provided');
    return next();
  }

  // Validate idempotency key format (should be UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idempotencyKey)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be a valid UUID',
      },
    });
    return;
  }

  const redisKey = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
  const redis = getRedis();

  if (!redis) {
    logger.warn('[Idempotency] Redis unavailable - skipping idempotency check');
    return next();
  }

  try {
    // Check if this key was already used
    const existingResult = await redis.get(redisKey);

    if (existingResult) {
      // Return cached result
      logger.info(`[Idempotency] Returning cached result for key: ${idempotencyKey}`);
      const parsed: IdempotencyResult = JSON.parse(existingResult);
      
      // Set relevant headers from cached response
      Object.entries(parsed.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      
      res.status(parsed.status).json(parsed.body);
      return;
    }

    // Store original res.json to intercept the response
    const originalJson = res.json.bind(res);
    let responseBody: any;
    let responseStatus: number = res.statusCode;

    res.json = (body: any) => {
      responseBody = body;
      responseStatus = res.statusCode;
      return originalJson(body);
    };

    // Continue to next middleware/controller
    res.on('finish', async () => {
      // Only cache successful responses (2xx)
      if (responseStatus >= 200 && responseStatus < 300 && responseBody) {
        try {
          const result: IdempotencyResult = {
            status: responseStatus,
            body: responseBody,
            headers: {
              'content-type': res.getHeader('content-type') as string || 'application/json',
            },
          };

          await redis.setex(
            redisKey,
            IDEMPOTENCY_TTL_SECONDS,
            JSON.stringify(result)
          );
          logger.info(`[Idempotency] Cached result for key: ${idempotencyKey}`);
        } catch (error) {
          logger.error(`[Idempotency] Failed to cache result: ${error}`);
        }
      }
    });

    next();
  } catch (error) {
    logger.error(`[Idempotency] Error checking Redis: ${error}`);
    // On Redis error, allow request to proceed (fail-open)
    next();
  }
};

/**
 * Generate a UUID v4 for idempotency keys
 */
export function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
