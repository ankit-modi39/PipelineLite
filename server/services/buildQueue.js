// Build queue.
//
// Tiny FIFO with a configurable concurrency cap. Default is 1 — strictly
// serial — which keeps our JSON store and dev environment simple. Bump it
// when you're ready to handle parallel builds.
//
// Design notes:
//  - We deliberately do NOT make enqueue() async. The HTTP path stays cheap;
//    actual build work runs on the next tick via Promise.resolve().then(...).
//  - tick() is idempotent: safe to call after every enqueue and every finish.

import { logger } from '../utils/logger.js';

class BuildQueue {
  constructor({ concurrency = 1 } = {}) {
    this.queue = [];
    this.concurrency = concurrency;
    this.active = 0;
    this.runner = null;
  }

  setRunner(fn) {
    this.runner = fn;
  }

  enqueue(buildId) {
    this.queue.push(buildId);
    logger.info(`Build queued: ${buildId}`, {
      depth: this.queue.length,
      active: this.active,
    });
    this.tick();
  }

  tick() {
    if (!this.runner) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.runner(id))
        .catch((err) =>
          logger.error('Build crashed in queue', { id, err: err.message }))
        .finally(() => {
          this.active--;
          this.tick();
        });
    }
  }

  status() {
    return { depth: this.queue.length, active: this.active };
  }
}

export const buildQueue = new BuildQueue({ concurrency: 1 });
