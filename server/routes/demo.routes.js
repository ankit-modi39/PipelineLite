// Demo-mode route. Mounted under /api/demo.
// The controller short-circuits to 404 when DEMO_MODE is off.

import { Router } from 'express';
import express from 'express';
import { triggerDemoBuild } from '../controllers/demo.controller.js';

const router = Router();
router.use(express.json());
router.post('/build', triggerDemoBuild);

export default router;
