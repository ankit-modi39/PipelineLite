// Application entry point.
// Wires middleware, routes, error handlers, then starts listening.
// Keep this file thin — real logic lives in services/.

import express from 'express';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import webhookRoutes from './routes/webhook.routes.js';

const app = express();

// We deliberately do NOT mount express.json() globally.
// The webhook route uses express.raw() to keep the byte-exact body for HMAC.
// Future routes that need JSON parsing should mount express.json() locally
// on their own router (see routes/webhook.routes.js for the pattern).

// Health check — handy for uptime probes and confirming the server is alive.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Webhook endpoint — POST /webhook
app.use('/webhook', webhookRoutes);

// 404 fallback (must come after all routes).
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// Centralized error handler. Any `next(err)` or thrown async error funnels here.
// Express recognises this as an error handler because it has 4 arguments.
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { msg: err.message });
  if (config.nodeEnv !== 'production') {
    logger.error(err.stack);
  }
  res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, () => {
  logger.info(`mini-cicd listening on http://localhost:${config.port}`);
  logger.info('Routes:');
  logger.info('  GET  /health');
  logger.info('  POST /webhook');
});
