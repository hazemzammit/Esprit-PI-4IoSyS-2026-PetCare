import { Router } from 'express';
import * as controller from '../controllers/health.controller';
import { deviceAuth } from '../middlewares/device-auth.middleware';
import { validate } from '@petcare/shared-middleware';
import { ingestTelemetrySchema } from '../utils/validators';

const router = Router();

// ─── Telemetry Ingestion ────────────────────────────────────────────────────
// Mounted at /api/v1/telemetry — requires device API key via x-device-key header
// In dev mode (DEVICE_API_KEY not set), all requests are allowed

router.post('/', deviceAuth, validate(ingestTelemetrySchema), controller.ingestTelemetry);

// ─── Batch Ingestion (multiple metrics at once) ─────────────────────────────
// POST /api/v1/telemetry/batch
// Body: { pet_id, device_id?, sensors: { heart_rate?: n, temperature?: n, ... }, timestamp? }
router.post('/batch', deviceAuth, controller.ingestBatch);

// ─── Alert Creation via REST ────────────────────────────────────────────────
// POST /api/v1/telemetry/alert
// Body: { pet_id, user_id, type, severity, message, sub_message?, data? }
router.post('/alert', deviceAuth, controller.createAlert);

// ─── Location Ingestion ─────────────────────────────────────────────────────
// POST /api/v1/telemetry/location
// Body: { pet_id, device_id?, lat, lng, accuracy?, address? }
router.post('/location', deviceAuth, controller.ingestLocation);

// ─── Feeding Event Push ─────────────────────────────────────────────────────
// POST /api/v1/telemetry/feeding-event
// Body: { user_id, portion_grams?, source? }
router.post('/feeding-event', deviceAuth, controller.pushFeedingEvent);

// ─── Device Status Push ─────────────────────────────────────────────────────
// POST /api/v1/telemetry/device-status
// Body: { user_id, device_id, status, battery? }
router.post('/device-status', deviceAuth, controller.pushDeviceStatus);

export default router;
