// Webhook service — turns a trusted GitHub event into a queued build.
//
// Flow:
//   1. Parse the JSON body.
//   2. Handle handshake ('ping') and skip non-push events for now.
//   3. Create a build record (status: 'queued') and push its id onto the queue.
//   4. Return the build id so the caller can correlate logs.
//
// We deliberately don't await the build here — webhooks must respond fast.

import path from 'node:path';

import { logger } from '../utils/logger.js';
import { generateBuildId } from '../utils/buildId.js';
import { buildStore } from './buildStore.js';
import { buildQueue } from './buildQueue.js';

const DEFAULT_SCRIPT = path.resolve('scripts/build.sh');

export const processWebhook = async ({ event, delivery, rawBody }) => {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }

  if (event === 'ping') {
    logger.info('Ping received', { delivery, zen: payload.zen });
    return { kind: 'ping' };
  }

  if (event !== 'push') {
    logger.info(`Event ignored: ${event}`, { delivery });
    return { kind: 'ignored', reason: `event=${event}` };
  }

  const buildId = generateBuildId();
  const createdAt = new Date().toISOString();

  buildStore.create({
    id: buildId,
    status: 'queued',
    event,
    delivery,
    repo:    payload?.repository?.full_name ?? null,
    ref:     payload?.ref ?? null,
    commit:  payload?.head_commit?.id ?? null,
    script:  DEFAULT_SCRIPT,
    createdAt,
    startedAt: null,
    endedAt:   null,
    exitCode:  null,
    logPath:   `server/builds/${buildId}.log`,
  });

  buildQueue.enqueue(buildId);

  return { kind: 'queued', buildId, status: 'queued' };
};
