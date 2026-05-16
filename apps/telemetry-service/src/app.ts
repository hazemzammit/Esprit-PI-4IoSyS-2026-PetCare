import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { errorHandler, logger, mongoSanitize, xssSanitize, requestId, requestLogger, metricsMiddleware, metricsEndpoint } from '@petcare/shared-middleware';
import { env } from './config/env';

import healthRoutes from './routes/health.routes';
import telemetryRoutes from './routes/telemetry.routes';
import weightRoutes from './routes/weight.routes';
import internalRoutes from './routes/internal.routes';
import adminRoutes from './routes/admin.routes';

const app = express();

// ─── Global Middleware ──────────────────────────────────────────────────────
app.use(requestId());
app.use(metricsMiddleware('telemetry-service'));
app.use(requestLogger(logger));
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (process.env.NODE_ENV === 'production') {
        if (!origin) return callback(null, true);
        const allowed = env.ALLOWED_ORIGINS.map((s: string) => s.trim());
        return allowed.includes(origin) ? callback(null, true) : callback(new Error(`CORS blocked: ${origin}`));
      }
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-device-key'],
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(mongoSanitize());
app.use(xssSanitize());

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'telemetry-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Public Routes ──────────────────────────────────────────────────────────
// Gateway proxies /api/v1/pet/health → TELEMETRY_SERVICE /api/v1/pet/health
app.use('/api/v1/pet/health', healthRoutes);

// Gateway proxies /api/v1/pet/weight → TELEMETRY_SERVICE /api/v1/pet/weight
app.use('/api/v1/pet/weight', weightRoutes);

// Gateway proxies /api/v1/telemetry → TELEMETRY_SERVICE /api/v1/telemetry (no auth)
app.use('/api/v1/telemetry', telemetryRoutes);

// ─── Admin Routes ───────────────────────────────────────────────────────────
app.use('/api/v1/admin', adminRoutes);

// ─── Internal Routes (service-to-service only) ─────────────────────────────
app.use('/internal', internalRoutes);

// ─── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Telemetry route not found' },
    timestamp: new Date().toISOString(),
  });
});

// ─── Metrics ────────────────────────────────────────────────────────────────
app.get('/metrics', metricsEndpoint());

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
