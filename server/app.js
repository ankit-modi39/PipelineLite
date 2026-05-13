// Application entry point.
// Wires middleware, routes, error handlers, then starts listening.
// Keep this file thin — real logic lives in services/.

import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import webhookRoutes from './routes/webhook.routes.js';
import buildRoutes   from './routes/build.routes.js';
import { buildQueue } from './services/buildQueue.js';
import { runBuild }   from './services/buildRunner.js';
import { attachSocketIO } from './socket/io.js';
import { basicAuth, logoutHandler } from './middleware/basicAuth.js';

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
// (Open: GitHub authenticates via HMAC, not Basic Auth.)
app.use('/webhook', webhookRoutes);

// ── Everything below this line requires Basic Auth (when enabled) ──
// Order matters: /health and /webhook must be exempt; this line is the gate.
app.use(basicAuth);

// Logout — sits AFTER basicAuth so only authenticated clients can trigger it.
app.get('/logout', logoutHandler);

// Build API — GET /api/builds, GET /api/builds/:id
app.use('/api/builds', buildRoutes);

// Wire the queue to the runner. Done here (not inside buildQueue.js) so
// tests can inject a fake runner without touching the queue module.
buildQueue.setRunner(runBuild);

// Static dashboard. Must come AFTER the API routes (so /api/builds isn't
// shadowed) but BEFORE the 404 handler. Serves client/index.html at '/'.
app.use(express.static(path.resolve('client')));

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

// Create an explicit http.Server so Express and Socket.io can share a port.
// `app.listen()` would create one implicitly — we need the handle to attach io.
const httpServer = http.createServer(app);
attachSocketIO(httpServer);

httpServer.listen(config.port, () => {
  logger.info(`PipelineLite listening on http://localhost:${config.port}`);
  logger.info('Routes:');
  logger.info('  GET  /health');
  logger.info('  POST /webhook');
  logger.info('  GET  /api/builds');
  logger.info('  GET  /api/builds/:id');
  logger.info('  GET  /            (dashboard)');
  logger.info('  WS   /socket.io  (events: subscribe, unsubscribe, log, status, snapshot)');
  logger.info(`  auth: ${config.authEnabled ? 'enabled' : 'DISABLED (dev)'}`);
});
