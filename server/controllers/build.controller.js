// Build API controllers.
// Read-only for now — POST endpoints (retry, manual trigger) land in later steps.

import { buildStore } from '../services/buildStore.js';
import { buildQueue } from '../services/buildQueue.js';
import { config } from '../config/env.js';

export const listBuilds = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const builds = buildStore.list({ limit });
  res.json({
    builds,
    queue: buildQueue.status(),
    meta:  { demoMode: config.demoMode },
  });
};

export const getBuild = async (req, res) => {
  const build = buildStore.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'not_found' });
  res.json(build);
};
