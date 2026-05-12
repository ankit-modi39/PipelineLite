#!/usr/bin/env node
// Dev CLI: tail a build's logs over Socket.io.
//
// Usage:
//   node scripts/dev-tail-build.mjs <buildId>
//   URL=http://localhost:4000 node scripts/dev-tail-build.mjs <buildId>
//
// Output convention:
//   - stdout = build script output (so you can pipe / grep it)
//   - stderr = our own progress messages (snapshot summary, status changes)

import { io as ioClient } from 'socket.io-client';

const buildId = process.argv[2];
if (!buildId) {
  console.error('Usage: node scripts/dev-tail-build.mjs <buildId>');
  process.exit(2);
}

const URL = process.env.URL ?? 'http://localhost:4000';
const socket = ioClient(URL, { reconnectionAttempts: 3 });

const TERMINAL = new Set(['success', 'failure']);

socket.on('connect', () => {
  console.error(`[tail] connected (${socket.id}), subscribing to ${buildId}`);
  socket.emit('subscribe', { buildId }, (resp) => {
    if (resp?.error) {
      console.error(`[tail] subscribe failed: ${resp.error}`);
      socket.close();
      process.exit(1);
    }
  });
});

socket.on('snapshot', ({ build, log }) => {
  console.error(`[tail] snapshot — status=${build.status}` +
                ` ref=${build.ref ?? '-'} exit=${build.exitCode ?? '-'}`);
  if (log) process.stdout.write(log);

  if (TERMINAL.has(build.status)) {
    console.error(`[tail] build already finished — exiting`);
    socket.close();
    process.exit(build.exitCode === 0 ? 0 : 1);
  }
});

socket.on('log', ({ chunk }) => {
  process.stdout.write(chunk);
});

socket.on('status', (evt) => {
  console.error(`[tail] status → ${evt.status}` +
                (evt.exitCode != null ? ` (exit ${evt.exitCode})` : ''));
  if (TERMINAL.has(evt.status)) {
    socket.close();
    process.exit(evt.exitCode === 0 ? 0 : 1);
  }
});

socket.on('connect_error', (err) => {
  console.error(`[tail] connection error: ${err.message}`);
});

socket.on('disconnect', (reason) => {
  console.error(`[tail] disconnected (${reason})`);
});
