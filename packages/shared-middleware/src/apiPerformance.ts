import { Request, Response, NextFunction } from 'express';
import { startTransaction } from './sentry';

/**
 * Middleware to track API performance
 * Wraps each request in a Sentry transaction for performance monitoring
 */
export function apiPerformanceMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip performance tracking in development
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    const transaction = startTransaction(
      `${req.method} ${req.path}`,
      'http.server',
    );

    if (!transaction) {
      return next();
    }

    // Add request metadata to transaction
    transaction.setData('http.method', req.method);
    transaction.setData('http.url', req.path);
    transaction.setData('http.query', JSON.stringify(req.query));
    transaction.setData('service', serviceName);

    // Track response time
    const startTime = Date.now();

    // Override res.json to track response
    const originalJson = res.json;
    res.json = function (body: any) {
      const duration = Date.now() - startTime;
      transaction.setData('http.response_time_ms', duration);
      transaction.setData('http.status_code', res.statusCode);
      
      // Log slow requests (> 1 second)
      if (duration > 1000) {
        console.warn(
          `[${serviceName}] Slow request: ${req.method} ${req.path} took ${duration}ms`,
        );
      }

      transaction.finish();
      return originalJson.call(this, body);
    };

    // Handle errors
    res.on('finish', () => {
      if (!res.headersSent) {
        transaction.finish();
      }
    });

    next();
  };
}

/**
 * Middleware to log API response times to console
 * Useful for development and basic monitoring
 */
export function logResponseTime(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const status = res.statusCode;
      const method = req.method;
      const path = req.path;

      // Color code based on status
      const statusColor = status >= 500 ? '\x1b[31m' : // Red
                            status >= 400 ? '\x1b[33m' : // Yellow
                            status >= 300 ? '\x1b[36m' : // Cyan
                            '\x1b[32m'; // Green

      const reset = '\x1b[0m';

      console.log(
        `[${serviceName}] ${method} ${path} ${statusColor}${status}${reset} ${duration}ms`,
      );
    });

    next();
  };
}

/**
 * Track database query performance
 * Call this before and after database operations
 */
export class DatabasePerformanceTracker {
  private queryCount = 0;
  private totalQueryTime = 0;
  private slowQueries: Array<{ query: string; time: number }> = [];

  trackQuery(query: string, timeMs: number) {
    this.queryCount++;
    this.totalQueryTime += timeMs;

    if (timeMs > 100) {
      this.slowQueries.push({ query, time: timeMs });
    }
  }

  getStats() {
    return {
      queryCount: this.queryCount,
      totalQueryTime: this.totalQueryTime,
      averageQueryTime: this.queryCount > 0 ? this.totalQueryTime / this.queryCount : 0,
      slowQueries: this.slowQueries,
    };
  }

  reset() {
    this.queryCount = 0;
    this.totalQueryTime = 0;
    this.slowQueries = [];
  }
}

/**
 * Create a performance tracker for a request
 */
export function createRequestTracker() {
  const tracker = new DatabasePerformanceTracker();
  return tracker;
}
