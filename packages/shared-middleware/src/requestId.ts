import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Adds a unique `x-request-id` header to each request for distributed tracing.
 * If the incoming request already has one (set by gateway), it is preserved.
 *
 * Usage: `app.use(requestId());`
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  };
}

/**
 * Request logging middleware that emits structured JSON logs with timing.
 * Use this in place of morgan for production-grade logging.
 *
 * Usage: `app.use(requestLogger(logger));`
 */
export function requestLogger(logger: { info: (msg: string, meta?: Record<string, unknown>) => void }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.url === '/health') return next();

    const start = Date.now();
    const reqId = req.headers['x-request-id'] as string;

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('request', {
        requestId: reqId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration,
        userId: req.headers['x-user-id'] || undefined,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
    });

    next();
  };
}
