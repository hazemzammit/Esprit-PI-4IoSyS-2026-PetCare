import { Router } from 'express';
import * as controller from '../controllers/health.controller';

const router = Router();

// ─── Weight Endpoint ────────────────────────────────────────────────────────
// Mounted at /api/v1/pet/weight (Flutter uses this path directly)

router.get('/', controller.getWeightHistory);

export default router;
