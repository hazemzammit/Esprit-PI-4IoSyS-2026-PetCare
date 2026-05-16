import { Request, Response, NextFunction, Router } from 'express';

/**
 * Lightweight Prometheus-compatible metrics middleware.
 * No external dependencies — serves basic HTTP request metrics at /metrics.
 *
 * Usage:
 *   import { metricsMiddleware, metricsEndpoint } from '@petcare/shared-middleware';
 *   app.use(metricsMiddleware('my-service'));
 *   app.get('/metrics', metricsEndpoint());
 */

interface Histogram {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

interface CounterMap {
  [key: string]: number;
}

interface HistogramMap {
  [key: string]: Histogram;
}

// Module-level state (singleton per process)
const httpRequestsTotal: CounterMap = {};
const httpRequestDuration: HistogramMap = {};
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
let serviceName = 'unknown';

function getKey(method: string, route: string, status: number): string {
  return `${method}|${route}|${status}`;
}

function normalisePath(req: Request): string {
  // Use matched route pattern if available (e.g., /api/v1/pets/:id)
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }
  // Fallback: collapse ObjectId-like segments
  return req.path.replace(/[0-9a-f]{24}/gi, ':id').replace(/\d+/g, ':n');
}

function observeDuration(key: string, durationSec: number): void {
  if (!httpRequestDuration[key]) {
    httpRequestDuration[key] = {
      count: 0,
      sum: 0,
      buckets: new Map(BUCKETS.map((b) => [b, 0])),
    };
  }
  const h = httpRequestDuration[key];
  h.count++;
  h.sum += durationSec;
  for (const b of BUCKETS) {
    if (durationSec <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
  }
}

/**
 * Express middleware that records request count + duration.
 */
export function metricsMiddleware(service: string) {
  serviceName = service;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip metrics endpoint itself
    if (req.path === '/metrics' || req.path === '/health') {
      return next();
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSec = durationNs / 1e9;

      const route = normalisePath(req);
      const method = req.method;
      const status = res.statusCode;
      const key = getKey(method, route, status);

      httpRequestsTotal[key] = (httpRequestsTotal[key] ?? 0) + 1;
      observeDuration(key, durationSec);
    });

    next();
  };
}

/**
 * Express handler that returns Prometheus-compatible /metrics text.
 */
export function metricsEndpoint() {
  return (_req: Request, res: Response): void => {
    const lines: string[] = [];

    // ── http_requests_total ──
    lines.push('# HELP http_requests_total Total number of HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, count] of Object.entries(httpRequestsTotal)) {
      const [method, route, status] = key.split('|');
      lines.push(
        `http_requests_total{service="${serviceName}",method="${method}",route="${route}",status="${status}"} ${count}`,
      );
    }

    // ── http_request_duration_seconds ──
    lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, h] of Object.entries(httpRequestDuration)) {
      const [method, route, status] = key.split('|');
      const labels = `service="${serviceName}",method="${method}",route="${route}",status="${status}"`;

      let cumulative = 0;
      for (const b of BUCKETS) {
        cumulative += h.buckets.get(b) ?? 0;
        lines.push(`http_request_duration_seconds_bucket{${labels},le="${b}"} ${cumulative}`);
      }
      lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${h.count}`);
    }

    // ── process metrics ──
    const memUsage = process.memoryUsage();
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes{service="${serviceName}"} ${memUsage.rss}`);

    lines.push('# HELP process_heap_bytes_used V8 heap used in bytes');
    lines.push('# TYPE process_heap_bytes_used gauge');
    lines.push(`process_heap_bytes_used{service="${serviceName}"} ${memUsage.heapUsed}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds{service="${serviceName}"} ${process.uptime().toFixed(1)}`);

    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  };
}
