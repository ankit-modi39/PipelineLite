// Webhook route.
// CRITICAL: this route uses express.raw() so req.body is a Buffer.
// HMAC verification needs the byte-exact body GitHub signed —
// express.json() would parse + discard it and silently break verification.

import { Router } from 'express';
import express from 'express';
import { handleWebhook } from '../controllers/webhook.controller.js';

const router = Router();

router.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  handleWebhook,
);

export default router;
