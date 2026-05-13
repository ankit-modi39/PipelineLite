// POST /api/demo/build  — public, demo-mode-only endpoint that triggers
// a real build using the bundled fallback script. No webhook, no clone,
// no git. The visitor watches a real Socket.io log stream.
//
// Anti-abuse: cap the queue + active count. With DEMO_MODE off the route
// returns 404, so it's invisible in production.

import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { generateBuildId } from '../utils/buildId.js';
import { buildStore } from '../services/buildStore.js';
import { buildQueue } from '../services/buildQueue.js';

const MAX_INFLIGHT = 5;

export const triggerDemoBuild = async (req, res) => {
  if (!config.demoMode) return res.status(404).json({ error: 'not_found' });

  const q = buildQueue.status();
  if (q.depth + q.active >= MAX_INFLIGHT) {
    return res.status(429).json({
      error: 'queue_full',
      message: 'Too many demo builds in flight. Try again in a moment.',
    });
  }

  const buildId   = generateBuildId();
  const createdAt = new Date().toISOString();
  const commit    = buildId.slice(-6);   // pseudo-sha, just for display

  buildStore.create({
    id: buildId,
    status: 'queued',
    kind: 'demo',
    event: 'demo',
    delivery: `demo-${buildId}`,
    repo:    'demo/pipelinelite',
    ref:     'refs/heads/main',
    branch:  'main',
    commit,
    cloneUrl: null,                       // signals "no clone" to the runner
    createdAt,
    startedAt: null,
    endedAt:   null,
    exitCode:  null,
    errorMessage: null,
    logPath: `server/builds/${buildId}.log`,
  });

  buildQueue.enqueue(buildId);
  logger.info('Demo build triggered', { buildId, ip: req.ip });

  return res.status(202).json({ buildId, status: 'queued' });
};
