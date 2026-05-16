import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from './ApiError';
import { getRedis } from './redis';

interface JwtPayload {
  userId: string;
  email?: string;
  jti?: string;
  iat: number;
  exp: number;
}

async function isTokenRevoked(payload: JwtPayload): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  if (payload.jti) {
    const revoked = await redis.get(`revoked_jti:${payload.jti}`);
    if (revoked) return true;
  }

  const invalidBefore = await redis.get(`user_token_invalid_before:${payload.userId}`);
  if (!invalidBefore) return false;

  const issuedAtMs = (payload.iat ?? 0) * 1000;
  return issuedAtMs <= Number(invalidBefore);
}

/**
 * Gateway-level JWT verification: verifies token and injects x-user-id header.
 */
export const gatewayAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    console.log(`[gatewayAuth] Authorization header: ${authHeader?.substring(0, 20)}...`);
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
      return;
    }

    const token = authHeader.slice(7);
    console.log(`[gatewayAuth] JWT_SECRET exists: ${!!process.env.JWT_SECRET}, length: ${process.env.JWT_SECRET?.length}`);
    console.log(`[gatewayAuth] Verifying token: ${token.substring(0, 30)}...`);
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    console.log(`[gatewayAuth] Token verified! userId: ${payload.userId}`);

    if (await isTokenRevoked(payload)) {
      res.status(401).json({ success: false, error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' } });
      return;
    }

    // Inject user info as headers for downstream services
    req.headers['x-user-id'] = payload.userId;
    req.headers['x-user-email'] = payload.email ?? '';
    if (payload.jti) req.headers['x-user-jti'] = payload.jti;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token' } });
  }
};

/**
 * Service-level auth: reads x-user-id from header (injected by gateway).
 * Also supports direct JWT verification as fallback.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // First check x-user-id header (set by gateway)
  const userId = req.headers['x-user-id'] as string;
  const email = req.headers['x-user-email'] as string;
  const jti = req.headers['x-user-jti'] as string;

  if (userId) {
    req.user = { userId, email: email ?? '', jti: jti ?? undefined };
    return next();
  }

  // Fallback: direct JWT verification (for direct service access / testing)
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new ApiError('No token provided', 401, 'NO_TOKEN');
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (await isTokenRevoked(payload)) {
      throw new ApiError('Token has been revoked', 401, 'TOKEN_REVOKED');
    }

    req.user = { userId: payload.userId, email: payload.email ?? '', jti: payload.jti };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError('Invalid or expired token', 401, 'TOKEN_INVALID'));
  }
};

// Alias for backward compatibility
export const authenticateJWT = requireAuth;
