// Webhook service — orchestrates what happens once a request is trusted.
// Step 2: parse JSON, log, branch on event type.
// Step 3: enqueue a build job here and return { buildId, status: 'queued' }.

import { logger } from '../utils/logger.js';

export const processWebhook = async ({ event, delivery, rawBody }) => {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }

  // GitHub sends a 'ping' event when the webhook is first installed —
  // a friendly handshake. We acknowledge and stop.
  if (event === 'ping') {
    logger.info('Ping received', { delivery, zen: payload.zen });
    return { kind: 'ping' };
  }

  // We'll branch on push / pull_request / etc. in Step 3.
  logger.info(`Event accepted: ${event}`, {
    delivery,
    repo: payload?.repository?.full_name,
    ref:  payload?.ref,
  });

  return { kind: 'accepted' };
};
