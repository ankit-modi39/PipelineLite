// HMAC-SHA256 verification for GitHub webhook deliveries.
//
// GitHub sends:  X-Hub-Signature-256: sha256=<hex(hmac(secret, raw_body))>
//
// Two security invariants this file enforces:
//  1. We hash the *raw* body bytes, never the re-stringified JSON.
//  2. We compare with crypto.timingSafeEqual — a constant-time check.
//     '===' would leak the signature byte-by-byte via response-time
//     side channels.

import crypto from 'node:crypto';

/**
 * @param {Buffer} rawBody    - request body as raw bytes (from express.raw())
 * @param {string} headerSig  - value of the X-Hub-Signature-256 header
 * @param {string} secret     - shared HMAC secret (from .env)
 * @returns {boolean}
 */
export const verifyGithubSignature = (rawBody, headerSig, secret) => {
  if (typeof headerSig !== 'string' || !headerSig.startsWith('sha256=')) {
    return false;
  }
  if (!Buffer.isBuffer(rawBody)) {
    return false;
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // timingSafeEqual requires equal-length buffers — otherwise it throws.
  const a = Buffer.from(headerSig, 'utf8');
  const b = Buffer.from(expected,  'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};
