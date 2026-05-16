import { Router } from 'express';
import { requireAuth } from '@petcare/shared-middleware';
import { requireAdmin } from '../middlewares/admin.middleware';
import {
  listTelemetry,
  getTelemetry,
  deleteTelemetry,
  bulkDeleteTelemetry,
  getTelemetryStats,
  getAggregatedTelemetry,
  cleanupTelemetry,
  simulateTelemetry,
  getTelemetryThresholds,
  updateTelemetryThresholds,
  getSimulatorStatus,
  toggleSimulators,
  getMqttStatus,
  getMqttClients,
  publishMqttMessage,
  getMqttSubscriptions,
  getMqttMessages,
  subscribeToMqttTopic,
  unsubscribeFromMqttTopic,
} from '../controllers/admin.controller';

const router = Router();

// ─── Authentication & Admin Middleware ─────────────────────────────────────
router.use(requireAuth);
router.use(requireAdmin);

// ─── Telemetry Data Management ─────────────────────────────────────────────
router.get('/telemetry', listTelemetry);
router.delete('/telemetry/bulk', bulkDeleteTelemetry);

// ─── Telemetry Analytics ───────────────────────────────────────────────────
router.get('/telemetry/stats', getTelemetryStats);
router.get('/telemetry/aggregate', getAggregatedTelemetry);
router.get('/telemetry/thresholds', getTelemetryThresholds);
router.patch('/telemetry/thresholds', updateTelemetryThresholds);
router.get('/telemetry/simulators', getSimulatorStatus);
router.patch('/telemetry/simulators', toggleSimulators);

// ─── Data Maintenance ───────────────────────────────────────────────────────
router.post('/telemetry/cleanup', cleanupTelemetry);
router.post('/telemetry/simulate', simulateTelemetry);

// ─── Dynamic ID Routes (Must be last to prevent shadowing) ───────────────
router.get('/telemetry/:telemetryId', getTelemetry);
router.delete('/telemetry/:telemetryId', deleteTelemetry);

// ─── MQTT Management ───────────────────────────────────────────────────────
router.get('/mqtt/status', getMqttStatus);
router.get('/mqtt/clients', getMqttClients);
router.post('/mqtt/publish', publishMqttMessage);
router.get('/mqtt/subscriptions', getMqttSubscriptions);
router.get('/mqtt/messages', getMqttMessages);
router.post('/mqtt/subscribe', subscribeToMqttTopic);
router.delete('/mqtt/unsubscribe', unsubscribeFromMqttTopic);

export default router;
