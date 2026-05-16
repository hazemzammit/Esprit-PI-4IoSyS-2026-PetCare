import { Request, Response, NextFunction } from 'express';
import { ApiError } from './ApiError';

function readInternalKeysMap(): Record<string, string> {
  const raw = process.env.INTERNAL_SERVICE_KEYS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * requireInternalKey — protects /internal/* routes.
 *
 * All inter-service HTTP clients must include the header:
 *   x-internal-key: <INTERNAL_API_KEY>
 *
 * Rationale: /internal/* routes are NOT exposed via the API Gateway.
 * They are reachable only within the Docker bridge network. This middleware
 * adds a second layer of protection (defence-in-depth) against accidental
 * exposure or SSRF attacks.
 *
 * In development (NODE_ENV !== 'production'), if INTERNAL_API_KEY is not
 * configured, the middleware is bypassed with a warning (so local dev without
 * .env still works). In production, missing key config fails hard.
 */
export function requireInternalKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const keysMap = readInternalKeysMap();
  const hasPerCallerConfig = Object.keys(keysMap).length > 0;

  const providedKey = req.headers['x-internal-key'] as string | undefined;
  const caller = (req.headers['x-internal-caller'] as string | undefined)?.trim();

  if (hasPerCallerConfig) {
    if (!caller) {
      return next(new ApiError('Missing internal caller identity', 403, 'INTERNAL_CALLER_REQUIRED'));
    }
    const expected = keysMap[caller];
    if (!expected) {
      return next(new ApiError('Unknown internal caller', 403, 'INTERNAL_CALLER_UNKNOWN'));
    }
    if (!providedKey || providedKey !== expected) {
      return next(new ApiError('Forbidden', 403, 'INTERNAL_KEY_INVALID'));
    }
    return next();
  }

  const expectedKey = process.env.INTERNAL_API_KEY;

  // Skip enforcement in non-production if key is not set (local dev without .env)
  if (!expectedKey) {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }
    // Production: refuse if key not configured — config error
    return next(
      new ApiError('INTERNAL_API_KEY is not configured', 500, 'CONFIG_ERROR'),
    );
  }

  if (!providedKey || providedKey !== expectedKey) {
    return next(new ApiError('Forbidden', 403, 'INTERNAL_KEY_INVALID'));
  }

  next();
}
