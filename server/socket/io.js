// Socket.io wiring.
//
// Responsibilities of this file:
//   1. Attach a Socket.io server to an existing http.Server.
//   2. Forward every emission on `buildEvents` to the matching build room.
//   3. Handle 'subscribe' / 'unsubscribe' from clients with input validation
//      and replay-on-subscribe via the build's log file.
//
// Why rooms (and not just one big channel):
//   - clients only receive chunks for the builds they care about
//   - the server doesn't need to track who-watches-what; Socket.io does
//   - tearing down (client disconnect) is automatic
//
// Why we read the log file synchronously on subscribe:
//   - reads are tiny (a few KB up to ~MB) compared to per-chunk emits
//   - keeps the subscribe handler atomic, avoiding interleaving bugs
//   - simpler to reason about than streaming reads + live events merging

import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';

import { logger } from '../utils/logger.js';
import { buildStore } from '../services/buildStore.js';
import { buildEvents } from '../services/buildEvents.js';

const BUILDS_DIR = path.resolve('server/builds');
const BUILD_ID_RE = /^b_[A-Za-z0-9_-]+$/;   // same shape generateBuildId() emits

const roomFor = (buildId) => `build:${buildId}`;

export const attachSocketIO = (httpServer) => {
  const io = new Server(httpServer, {
    // Step 5 will serve the client from this same origin (no CORS needed),
    // but for now '*' lets dev tools and tests connect from anywhere.
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // ── Server-side bus → Socket.io fan-out ────────────────────────────
  // One subscriber here, regardless of how many clients are connected.
  buildEvents.on('log', (evt) => {
    io.to(roomFor(evt.buildId)).emit('log', evt);
  });
  buildEvents.on('status', (evt) => {
    io.to(roomFor(evt.buildId)).emit('status', evt);
  });

  // ── Per-client lifecycle ───────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info('socket connected', { id: socket.id });

    socket.on('subscribe', ({ buildId } = {}, ack) => {
      if (typeof buildId !== 'string' || !BUILD_ID_RE.test(buildId)) {
        return ack?.({ error: 'invalid_buildId' });
      }
      const build = buildStore.get(buildId);
      if (!build) return ack?.({ error: 'not_found' });

      // CRITICAL: join the room BEFORE reading the file.
      // If we read first, a chunk emitted in between is lost.
      socket.join(roomFor(buildId));

      let log = '';
      try {
        log = fs.readFileSync(path.join(BUILDS_DIR, `${buildId}.log`), 'utf8');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;  // missing-log is fine
      }

      socket.emit('snapshot', { build, log });
      ack?.({ ok: true });
    });

    socket.on('unsubscribe', ({ buildId } = {}) => {
      if (typeof buildId === 'string' && BUILD_ID_RE.test(buildId)) {
        socket.leave(roomFor(buildId));
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('socket disconnected', { id: socket.id, reason });
    });
  });

  logger.info('Socket.io attached');
  return io;
};
