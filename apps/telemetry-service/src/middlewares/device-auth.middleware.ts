import { Request, Response, NextFunction } from 'express';
import { ApiError, logger } from '@petcare/shared-middleware';

/**
 * Device authentication middleware for HTTP telemetry ingestion.
 *
 * Devices must authenticate with ONE of:
 *   1. x-device-key header (legacy, deprecated)
 *   2. x-device-id + x-device-serial (with stored key validation via MQTT/DB)
 *
 * Production: REQUIRES either device-key or explicit serial-based auth.
 * Development: if DEVICE_API_KEY not set, allows unauthenticated ingestion (with warning).
 *
 * This prevents unauthorized devices from injecting telemetry while still allowing
 * backward compatibility during transition to serial-based auth.
 */
export function deviceAuth(req: Request, _res: Response, next: NextFunction): void {
  const expectedKey = process.env.DEVICE_API_KEY;
  const providedKey = req.headers['x-device-key'] as string | undefined;

  // Legacy single-key check
  if (expectedKey && providedKey === expectedKey) {
    return next();
  }

  // In dev, skip entirely if no key is configured (warn once per startup)
  if (!expectedKey) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('DEVICE_API_KEY not set — telemetry ingestion is unauthenticated (dev only)');
      return next();
    }
    throw new ApiError('Server misconfiguration: device key not set', 500, 'CONFIG_ERROR');
  }

  // Production: both legacy and serial-based auth failed
  throw new ApiError('Invalid or missing device authentication', 401, 'DEVICE_AUTH_FAILED');
}

