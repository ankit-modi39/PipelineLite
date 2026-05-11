// Webhook controller.
// Order of operations matters:
//   1. Verify signature against the *raw* body — bail with 401 if it fails.
//   2. Only then hand off to the service layer for processing.
//   3. Respond fast (GitHub aborts at ~10s) — do heavy work async.

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { verifyGithubSignature } from '../utils/verifySignature.js';
import { processWebhook } from '../services/webhook.service.js';

export const handleWebhook = async (req, res, next) => {
  try {
    const event     = req.headers['x-github-event']      ?? 'unknown';
    const delivery  = req.headers['x-github-delivery']   ?? 'no-delivery-id';
    const signature = req.headers['x-hub-signature-256'] ?? '';

    // req.body is a Buffer because the route mounts express.raw().
    const rawBody = req.body;

    if (!verifyGithubSignature(rawBody, signature, config.githubWebhookSecret)) {
      logger.warn('Webhook signature mismatch', { event, delivery });
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const result = await processWebhook({ event, delivery, rawBody });

    return res.status(202).json({ received: true, event, delivery, ...result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
};
