// Build metadata persistence.
//
// Storage: a single JSON file (server/builds/builds.json) holding all builds
// keyed by id. Atomic writes via tmpfile + rename — guarantees a reader never
// sees a half-written file.
//
// Why JSON and not SQLite (yet):
//  - zero dependencies, easy to inspect (`cat builds.json | jq`)
//  - fine until ~10k builds; swap to SQLite if we outgrow it
//  - this module is the *only* place that touches the file, so the swap is one-file
//
// Concurrency: with queue concurrency = 1 there are no concurrent writers.
// If we raise it, we'll add a write-serialization mutex here.

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

const STORE_PATH = path.resolve('server/builds/builds.json');

let cache = new Map();
let loaded = false;

const load = () => {
  try {
    const data = fs.readFileSync(STORE_PATH, 'utf8');
    cache = new Map(Object.entries(JSON.parse(data)));
    logger.info(`buildStore: loaded ${cache.size} builds`);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.warn('buildStore: load failed, starting empty', { err: e.message });
    }
    cache = new Map();
  }
  loaded = true;
};

const persist = () => {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache), null, 2));
  fs.renameSync(tmp, STORE_PATH);   // atomic on POSIX filesystems
};

const ensureLoaded = () => { if (!loaded) load(); };

export const buildStore = {
  create(record) {
    ensureLoaded();
    cache.set(record.id, record);
    persist();
    return record;
  },

  update(id, patch) {
    ensureLoaded();
    const current = cache.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    cache.set(id, next);
    persist();
    return next;
  },

  get(id) {
    ensureLoaded();
    return cache.get(id) ?? null;
  },

  list({ limit = 50 } = {}) {
    ensureLoaded();
    return Array.from(cache.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
};
