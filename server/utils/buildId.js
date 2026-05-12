// Build IDs.
// Format: b_<utc-timestamp>_<random>
// e.g.    b_20260511T143052_a3f9c1
//
// Why this shape:
//  - lexicographic sort == chronological sort (newest first via reverse-sort)
//  - filename-safe (no ':' or '.')
//  - random suffix prevents collisions if two webhooks land in the same second
//  - 3 random bytes = 16.7M values; collision risk negligible at our scale

import crypto from 'node:crypto';

export const generateBuildId = () => {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')   // 20260511T143052.123Z
    .replace(/\..+/, '');   // 20260511T143052
  const rand = crypto.randomBytes(3).toString('hex');
  return `b_${ts}_${rand}`;
};
