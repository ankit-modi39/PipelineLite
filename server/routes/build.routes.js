// Build API routes.
// JSON parsing is mounted on this router (NOT globally — that would
// break webhook signature verification, see Step 2 notes).

import { Router } from 'express';
import express from 'express';
import { listBuilds, getBuild } from '../controllers/build.controller.js';

const router = Router();

router.use(express.json());

router.get('/',    listBuilds);
router.get('/:id', getBuild);

export default router;
