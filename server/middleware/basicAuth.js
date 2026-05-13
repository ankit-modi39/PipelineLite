// HTTP Basic Auth.
//
// Exposes two things:
//   - basicAuth        → Express middleware
//   - isAuthorizedReq  → reusable predicate (used by Socket.io's allowRequest)
//
// Both use the same constant-time check, so the dashboard fetch path and the
// websocket handshake path enforce identical credentials.
//
// Why we don't `===` the password:
//   '===' short-circuits on the first different byte. An attacker timing the
//   response can recover the password byte-by-byte. We HMAC both sides with
//   a fresh random key (guarantees equal-length digests) and then use
//   crypto.timingSafeEqual to compare. Same trick used by every reputable
//   auth library.

import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REALM = 'PipelineLite';

const constantTimeStringEq = (a, b) => {
  const key = crypto.randomBytes(16);
  const ha = crypto.createHmac('sha256', key).update(String(a)).digest();
  const hb = crypto.createHmac('sha256', key).update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const parseHeader = (header) => {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
};

export const isAuthorizedReq = (req) => {
  if (config.demoMode)    return true;             // public demo — no auth
  if (!config.authEnabled) return true;            // auth disabled in dev
  const creds = parseHeader(req.headers?.authorization);
  if (!creds) return false;
  return (
    constantTimeStringEq(creds.user, config.dashboardUser) &&
    constantTimeStringEq(creds.pass, config.dashboardPassword)
  );
};

export const basicAuth = (req, res, next) => {
  if (isAuthorizedReq(req)) return next();
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  logger.warn('Dashboard auth failed', {
    ip: req.ip, path: req.path, method: req.method,
  });
  return res.status(401).json({ error: 'unauthorized' });
};

// Logout for Basic Auth.
//
// There's no LOGOUT in the Basic Auth protocol, so we use the modern
// workaround: emit Clear-Site-Data + a 401. Chromium/Firefox treat
// Clear-Site-Data as "wipe the auth cache for this origin"; the next
// request to a protected route then triggers a fresh credential prompt.
//
// Must be mounted AFTER basicAuth — only an authenticated client may
// trigger their own logout (prevents drive-by CSRF-style logouts).
export const logoutHandler = (_req, res) => {
  if (!config.authEnabled) return res.status(204).end();
  res.set('Clear-Site-Data', '"cache", "cookies", "storage"');
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  return res.status(401).json({ error: 'logged_out' });
};
