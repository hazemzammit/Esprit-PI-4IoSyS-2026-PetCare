import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { getRedis } from './redis';
import { logger } from './logger';

export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 15 * 60 * 1000 = 15 min) */
  windowMs?: number;
  /** Max requests per window (default: 200) */
  max?: number;
  /** Custom error message body */
  message?: object;
  /** Optional Redis key prefix for namespacing */
  prefix?: string;
}

/**
 * Create an `express-rate-limit` rate limiter that uses a Redis store
 * when Redis is available, and silently falls back to the default in-memory
 * store otherwise. Import once per service, reuse for multiple limiters.
 *
 * @example
 * ```ts
 * const globalLimiter  = createRateLimiter({ max: 200 });
 * const authLimiter    = createRateLimiter({ max: 50, prefix: 'rl:auth:' });
 * const strictLimiter  = createRateLimiter({ max: 5,  prefix: 'rl:strict:' });
 * ```
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 200,
  message = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait.' } },
  prefix = 'rl:',
}: RateLimiterOptions = {}): RateLimitRequestHandler {
  const opts: Partial<Options> = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message,
  };

  // Lazily attempt to wire up the Redis store
  try {
    const redis = getRedis();
    if (redis) {
      // Dynamic import so services that don't have `rate-limit-redis` installed
      // still work (the package is in shared-middleware's own deps).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RedisStore } = require('rate-limit-redis') as typeof import('rate-limit-redis');
      opts.store = new RedisStore({
        prefix,
        // @ts-expect-error — ioredis is compatible but types differ
        sendCommand: (...args: string[]) => redis.call(...args),
      });
      logger.debug(`[rateLimiter] Redis store configured (prefix: ${prefix})`);
    }
  } catch (err: any) {
    logger.warn(`[rateLimiter] Could not create Redis store, falling back to in-memory: ${err?.message}`);
  }

  return rateLimit(opts);
}
