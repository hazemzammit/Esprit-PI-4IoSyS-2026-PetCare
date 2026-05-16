import { Router } from 'express';
import * as controller from '../controllers/health.controller';
import { validateObjectId, requireInternalKey } from '@petcare/shared-middleware';

const router = Router();
router.use(requireInternalKey);

// ─── Internal Service-to-Service Endpoints ──────────────────────────────────
// Protected by requireInternalKey. NOT exposed via API Gateway.

// Latest health readings by petId
router.get('/telemetry/latest/:petId', validateObjectId('petId'), controller.getLatestByPetId);

// Health history by petId (with ?type=, ?from=, ?to=, ?limit=)
router.get('/telemetry/history/:petId', validateObjectId('petId'), controller.getHistoryByPetId);

// Weight history by petId
router.get('/telemetry/weight-history/:petId', validateObjectId('petId'), controller.getWeightHistoryByPetId);

export default router;
