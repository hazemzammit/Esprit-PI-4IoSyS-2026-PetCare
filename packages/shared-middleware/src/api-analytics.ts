import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

interface ApiAnalyticsData {
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  userId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
  service?: string;
}

/**
 * API Analytics Middleware
 * 
 * Tracks API usage metrics including request counts, response times,
 * error rates, and user activity. Data is logged and can be sent to
 * analytics services for monitoring and reporting.
 */
class ApiAnalytics {
  private metrics: Map<string, ApiAnalyticsData[]> = new Map();
  private maxMetricsPerKey = 1000;
  private flushInterval?: NodeJS.Timeout;

  /**
   * Middleware to track API requests
   */
  middleware(serviceName?: string) {
    const self = this;
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();

      // Store original end function
      const originalEnd = res.end.bind(res);

      // Override end to capture response time
      res.end = function (chunk?: any, encoding?: any) {
        const responseTime = Date.now() - startTime;
        
        const analyticsData: ApiAnalyticsData = {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          responseTime,
          userId: (req as any).user?.userId || req.headers['x-user-id'] as string,
          ip: req.ip,
          userAgent: req.headers['user-agent'] as string,
          timestamp: new Date(),
          service: serviceName,
        };

        // Log the analytics data
        self.logAnalytics(analyticsData);

        // Call original end
        return originalEnd(chunk, encoding);
      };

      next();
    };
  }

  /**
   * Log analytics data
   */
  private logAnalytics(data: ApiAnalyticsData) {
    const key = `${data.method}:${data.path}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metrics = this.metrics.get(key)!;
    metrics.push(data);

    // Keep only recent metrics
    if (metrics.length > this.maxMetricsPerKey) {
      metrics.shift();
    }

    // Log to logger for Loki integration
    logger.info('[api-analytics]', {
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      responseTime: data.responseTime,
      userId: data.userId,
      service: data.service,
    });
  }

  /**
   * Get analytics summary for a specific endpoint
   */
  getEndpointStats(method: string, path: string) {
    const key = `${method}:${path}`;
    const metrics = this.metrics.get(key) || [];

    if (metrics.length === 0) {
      return null;
    }

    const totalRequests = metrics.length;
    const successRequests = metrics.filter(m => m.statusCode < 400).length;
    const errorRequests = metrics.filter(m => m.statusCode >= 400).length;
    const avgResponseTime = metrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;
    const p50ResponseTime = this.getPercentile(metrics.map(m => m.responseTime), 50);
    const p95ResponseTime = this.getPercentile(metrics.map(m => m.responseTime), 95);
    const p99ResponseTime = this.getPercentile(metrics.map(m => m.responseTime), 99);

    return {
      method,
      path,
      totalRequests,
      successRequests,
      errorRequests,
      errorRate: ((errorRequests / totalRequests) * 100).toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(2),
      p50ResponseTime: p50ResponseTime.toFixed(2),
      p95ResponseTime: p95ResponseTime.toFixed(2),
      p99ResponseTime: p99ResponseTime.toFixed(2),
    };
  }

  /**
   * Get overall analytics summary
   */
  getOverallStats() {
    const allMetrics = Array.from(this.metrics.values()).flat();

    if (allMetrics.length === 0) {
      return null;
    }

    const totalRequests = allMetrics.length;
    const successRequests = allMetrics.filter(m => m.statusCode < 400).length;
    const errorRequests = allMetrics.filter(m => m.statusCode >= 400).length;
    const avgResponseTime = allMetrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;

    // Group by method
    const byMethod = allMetrics.reduce((acc, m) => {
      acc[m.method] = (acc[m.method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Group by status code
    const byStatusCode = allMetrics.reduce((acc, m) => {
      acc[m.statusCode] = (acc[m.statusCode] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Top endpoints by request count
    const endpointCounts = Array.from(this.metrics.entries()).map(([key, metrics]) => ({
      endpoint: key,
      count: metrics.length,
    })).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      totalRequests,
      successRequests,
      errorRequests,
      errorRate: ((errorRequests / totalRequests) * 100).toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(2),
      byMethod,
      byStatusCode,
      topEndpoints: endpointCounts,
    };
  }

  /**
   * Get user activity stats
   */
  getUserActivityStats(userId: string) {
    const allMetrics = Array.from(this.metrics.values()).flat();
    const userMetrics = allMetrics.filter(m => m.userId === userId);

    if (userMetrics.length === 0) {
      return null;
    }

    const totalRequests = userMetrics.length;
    const uniqueEndpoints = new Set(userMetrics.map(m => `${m.method}:${m.path}`)).size;
    const avgResponseTime = userMetrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;

    // Recent activity (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentActivity = userMetrics.filter(m => m.timestamp >= oneHourAgo);

    return {
      userId,
      totalRequests,
      uniqueEndpoints,
      avgResponseTime: avgResponseTime.toFixed(2),
      recentActivityCount: recentActivity.length,
    };
  }

  /**
   * Clear metrics for a specific endpoint
   */
  clearEndpointMetrics(method: string, path: string) {
    const key = `${method}:${path}`;
    this.metrics.delete(key);
  }

  /**
   * Clear all metrics
   */
  clearAllMetrics() {
    this.metrics.clear();
  }

  /**
   * Start periodic flush (e.g., to external analytics service)
   */
  startFlush(intervalMs = 60000) {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(() => {
      this.flushMetrics();
    }, intervalMs);
  }

  /**
   * Stop periodic flush
   */
  stopFlush() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }
  }

  /**
   * Flush metrics to external service (placeholder)
   */
  private flushMetrics() {
    // TODO: Send to external analytics service (e.g., Prometheus, DataDog, etc.)
    logger.info('[api-analytics] Flushing metrics', {
      metricsCount: Array.from(this.metrics.values()).flat().length,
    });
  }

  /**
   * Calculate percentile
   */
  private getPercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }
}

export const apiAnalytics = new ApiAnalytics();
