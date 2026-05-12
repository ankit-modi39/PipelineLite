// Build runner: spawns the build script as a child process, streams its
// output to a log file + the event bus, and updates the build's status.
//
// Security choices baked in:
//  - shell: false   → no shell interpretation of args (no injection)
//  - fixed script path from the build record, not from the webhook body
//  - user-supplied values (ref, commit, repo) passed only via env vars
//  - timeout via SIGKILL — a runaway build can't hold the queue forever

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildStore } from './buildStore.js';
import { buildEvents } from './buildEvents.js';
import { logger } from '../utils/logger.js';

const BUILDS_DIR = path.resolve('server/builds');
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;   // 10 minutes

export const runBuild = (buildId) => new Promise((resolve) => {
  const build = buildStore.get(buildId);
  if (!build) {
    logger.error('runBuild: unknown buildId', { buildId });
    return resolve({ exitCode: -1 });
  }

  // ── queued → running ────────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  buildStore.update(buildId, { status: 'running', startedAt });
  buildEvents.emit('status', { buildId, status: 'running', startedAt });
  logger.info(`Build started: ${buildId}`, { script: build.script });

  const logPath = path.join(BUILDS_DIR, `${buildId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // ── spawn ───────────────────────────────────────────────────────────
  const child = spawn(build.script, [], {
    cwd:   process.cwd(),
    shell: false,                          // critical — see security note
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BUILD_ID:     build.id,
      BUILD_REPO:   build.repo   ?? '',
      BUILD_REF:    build.ref    ?? '',
      BUILD_COMMIT: build.commit ?? '',
    },
  });

  // ── pipe output to log file + event bus ────────────────────────────
  const onChunk = (stream) => (chunk) => {
    logStream.write(chunk);
    buildEvents.emit('log', {
      buildId,
      stream,
      chunk: chunk.toString('utf8'),
      ts: Date.now(),
    });
  };
  child.stdout.on('data', onChunk('stdout'));
  child.stderr.on('data', onChunk('stderr'));

  // ── timeout guard ──────────────────────────────────────────────────
  const killTimer = setTimeout(() => {
    logger.warn(`Build timed out, killing: ${buildId}`);
    child.kill('SIGKILL');
  }, BUILD_TIMEOUT_MS);

  // Helper: keep the file and live stream byte-identical by writing the
  // runner's epilogue line through both paths.
  const writeEpilogue = (text) => {
    logStream.end(text);
    buildEvents.emit('log', {
      buildId, stream: 'runner', chunk: text, ts: Date.now(),
    });
  };

  // ── spawn-level failure (e.g. script not found, not executable) ────
  child.on('error', (err) => {
    clearTimeout(killTimer);
    writeEpilogue(`\n[runner] spawn error: ${err.message}\n`);
    const endedAt = new Date().toISOString();
    buildStore.update(buildId, {
      status: 'failure', endedAt, exitCode: -1, errorMessage: err.message,
    });
    buildEvents.emit('status', { buildId, status: 'failure', endedAt, exitCode: -1 });
    logger.error(`Build spawn-error: ${buildId}`, { err: err.message });
    resolve({ exitCode: -1 });
  });

  // ── normal exit ────────────────────────────────────────────────────
  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    writeEpilogue(`\n[runner] exit code: ${code}${signal ? ` (signal ${signal})` : ''}\n`);
    const endedAt = new Date().toISOString();
    const status  = code === 0 ? 'success' : 'failure';
    buildStore.update(buildId, { status, endedAt, exitCode: code });
    buildEvents.emit('status', { buildId, status, endedAt, exitCode: code });
    logger.info(`Build ${status}: ${buildId}`, { exitCode: code });
    resolve({ exitCode: code });
  });
});
