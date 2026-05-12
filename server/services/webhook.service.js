// Webhook service — turns a trusted GitHub event into a queued build.
//
// Flow:
//   1. Parse JSON.
//   2. Handshake 'ping' is acknowledged; non-push events ignored.
//   3. Extract branch (from "refs/heads/<branch>") and clone_url.
//   4. Apply branch allow-list (no record created if filtered out).
//   5. Persist a build record; enqueue.

import { logger } from '../utils/logger.js';
import { generateBuildId } from '../utils/buildId.js';
import { branchAllowed } from '../utils/branchFilter.js';
import { config } from '../config/env.js';
import { buildStore } from './buildStore.js';
import { buildQueue } from './buildQueue.js';

const REFS_HEADS = 'refs/heads/';

const extractBranch = (ref) =>
  typeof ref === 'string' && ref.startsWith(REFS_HEADS)
    ? ref.slice(REFS_HEADS.length)
    : null;

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

  const ref      = payload?.ref ?? null;
  const branch   = extractBranch(ref);
  const cloneUrl = payload?.repository?.clone_url ?? null;
  const repo     = payload?.repository?.full_name ?? null;
  const commit   = payload?.head_commit?.id ?? null;

  // Branch filter — drop the request before paying the cost of a build.
  if (!branchAllowed(branch, config.allowedBranches)) {
    logger.info(`Branch ignored: ${branch}`, {
      delivery,
      allowed: config.allowedBranches,
    });
    return { kind: 'ignored', reason: `branch=${branch}` };
  }

  const buildId   = generateBuildId();
  const createdAt = new Date().toISOString();

  buildStore.create({
    id: buildId,
    status: 'queued',
    event,
    delivery,
    repo,
    ref,
    branch,
    commit,
    cloneUrl,
    createdAt,
    startedAt: null,
    endedAt:   null,
    exitCode:  null,
    errorMessage: null,
    logPath: `server/builds/${buildId}.log`,
  });

  buildQueue.enqueue(buildId);

  return { kind: 'queued', buildId, status: 'queued' };
};
