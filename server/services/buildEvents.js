// Internal pub/sub bus for build lifecycle events.
//
// Two event types:
//   'log'    → { buildId, stream: 'stdout'|'stderr', chunk: string, ts: number }
//   'status' → { buildId, status, startedAt?, endedAt?, exitCode? }
//
// The runner emits here; the Socket.io layer (Step 4) will subscribe and
// forward events to the right room. Keeping this in-process for now is fine —
// when we need multi-process, swap the emitter for Redis pub/sub. Same interface.

import { EventEmitter } from 'node:events';

export const buildEvents = new EventEmitter();
// Avoid Node's default 10-listener warning when many sockets subscribe.
buildEvents.setMaxListeners(100);
