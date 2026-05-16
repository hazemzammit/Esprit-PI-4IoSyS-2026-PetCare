import { Request, Response, NextFunction } from 'express';
import { ApiError } from './ApiError';
import { logger } from './logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, code: err.code },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: err.message },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (err.name === 'ZodError') {
    // Handle Zod schema validation errors (used by auth-service and others)
    const zodIssues = (err as any).issues;
    const details = Array.isArray(zodIssues)
      ? zodIssues.map((i: any) => `${i.path?.join('.')}: ${i.message}`).join('; ')
      : err.message;
    res.status(400).json({
      success: false,
      error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: { message: 'Invalid or expired token', code: 'TOKEN_INVALID' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  logger.error(`Unexpected error: ${err.message}`);
  logger.error(err.stack ?? '');
  res.status(500).json({
    success: false,
    error: { message: 'Internal server error', code: 'SERVER_ERROR' },
    timestamp: new Date().toISOString(),
  });
};
