import { Router } from 'express';
import * as controller from '../controllers/health.controller';

const router = Router();

// ─── Public Health Endpoints ────────────────────────────────────────────────
// Mounted at /api/v1/pet/health (auth handled by gateway)

router.get('/latest', controller.getLatestHealth);
router.get('/aggregated', controller.getAggregated);
router.get('/', controller.getHealthHistory);
router.get('/weight', controller.getWeightHistory);

export default router;
