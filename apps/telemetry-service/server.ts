import http from 'http';
import { logger, connectMqtt, connectRedis } from '@petcare/shared-middleware';
import { env } from './src/config/env';
import { connectDatabase } from './src/config/database';
import app from './src/app';
import { initSocket } from './src/services/socket.server';
import { subscribeMqttTopics } from './src/services/mqtt.bridge';
import { archiveTelemetry } from './src/services/telemetry.archival.service';

// Set SERVICE_NAME for internal service calls
process.env.SERVICE_NAME = 'telemetry-service';

async function bootstrap(): Promise<void> {
  logger.info('🚀 Starting Telemetry Service...');

  // Connect to MongoDB
  await connectDatabase();

  // Connect to Redis (graceful degradation)
  try {
    await connectRedis(env.REDIS_URL);
  } catch (err) {
    logger.warn('⚠️ Redis not available — running without cache');
  }

  // Connect to MQTT (graceful degradation)
  try {
    await connectMqtt(env.MQTT_URL, {
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clientId: `telemetry-service-${process.pid}`,
    });

    // Subscribe to device topics
    subscribeMqttTopics();
  } catch (err) {
    logger.warn('⚠️ MQTT not available — MQTT bridge disabled');
  }

  // Create HTTP server and attach Socket.IO
  const httpServer = http.createServer(app);
  initSocket(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`✅ Telemetry Service listening on port ${env.PORT}`);
    logger.info(`   Socket.IO ready on ws://localhost:${env.PORT}`);
    logger.info(`   Environment: ${env.NODE_ENV}`);
    logger.info(`   Simulators: ${env.ENABLE_SIMULATORS ? 'ENABLED' : 'disabled'}`);
    logger.info(`   Archival: ${env.ARCHIVAL_ENABLED === 'true' ? 'ENABLED' : 'disabled'}`);
  });

  // Start archival scheduled job if enabled (runs daily)
  if (env.ARCHIVAL_ENABLED === 'true') {
    const ARCHIVAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    logger.info('[Archival] Starting scheduled archival job (daily)');
    
    // Run once on startup, then on interval
    setTimeout(async () => {
      try {
        const result = await archiveTelemetry();
        logger.info(`[Archival] Initial run complete: ${result.archived} archived, ${result.errors} errors`);
      } catch (err) {
        logger.error('[Archival] Initial run failed:', err);
      }
    }, 60000); // Wait 1 minute after startup before first run

    setInterval(async () => {
      try {
        const result = await archiveTelemetry();
        logger.info(`[Archival] Scheduled run complete: ${result.archived} archived, ${result.errors} errors`);
      } catch (err) {
        logger.error('[Archival] Scheduled run failed:', err);
      }
    }, ARCHIVAL_INTERVAL_MS);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Telemetry Service...');
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error('Failed to start Telemetry Service:', err);
  process.exit(1);
});
