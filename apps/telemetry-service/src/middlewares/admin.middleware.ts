import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@petcare/shared-middleware';

/**
 * Middleware to ensure the authenticated user has admin role.
 * This should be used after requireAuth middleware.
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      throw new ApiError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
    const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

    const response = await fetch(`${AUTH_SERVICE_URL}/internal/users/${userId}`, {
      headers: { 'x-internal-key': INTERNAL_KEY },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new ApiError('Unable to verify admin role', 503, 'AUTH_SERVICE_UNAVAILABLE');
    }

    const payload = await response.json() as { data?: { role?: string } };
    const role = payload?.data?.role;
    if (role !== 'admin') {
      throw new ApiError('Admin access required', 403, 'ADMIN_REQUIRED');
    }

    next();
  } catch (error) {
    next(error);
  }
};
