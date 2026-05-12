// Build runner. Now multi-step:
//   1. git clone <clone_url> <workspace>
//   2. git checkout <commit>     (if commit is specified)
//   3. spawn pipeline.sh (from repo, if present) or scripts/build.sh (fallback)
//
// Every step streams stdout/stderr through:
//   - the per-build log file (server/builds/<id>.log)
//   - the buildEvents bus (which Socket.io forwards to the dashboard)
//
// Security choices preserved from Step 3:
//   - shell: false on every spawn (no shell interpretation)
//   - fixed argv arrays (no string concatenation of user input)
//   - user-supplied values reach the script only via env vars

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildStore } from './buildStore.js';
import { buildEvents } from './buildEvents.js';
import { logger } from '../utils/logger.js';

const BUILDS_DIR      = path.resolve('server/builds');
const FALLBACK_SCRIPT = path.resolve('scripts/build.sh');
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;   // 15 minutes for the whole pipeline

// ── helpers ──────────────────────────────────────────────────────────

const emitRunnerLine = (buildId, logStream, text) => {
  logStream.write(text);
  buildEvents.emit('log', {
    buildId, stream: 'runner', chunk: text, ts: Date.now(),
  });
};

// Spawn a single step, stream output, resolve on exit 0, reject otherwise.
// Returns the child object via the `onSpawn` callback so the caller can wire
// a timeout/cancel signal to it.
const spawnStep = ({ buildId, logStream, cmd, args, opts = {}, onSpawn }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    onSpawn?.(child);

    const onChunk = (stream) => (chunk) => {
      logStream.write(chunk);
      buildEvents.emit('log', {
        buildId, stream, chunk: chunk.toString('utf8'), ts: Date.now(),
      });
    };
    child.stdout.on('data', onChunk('stdout'));
    child.stderr.on('data', onChunk('stderr'));

    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (code === 0) return resolve(0);
      const msg = signal ? `killed by ${signal}` : `exit ${code}`;
      reject(new Error(`${cmd} ${args.join(' ')} → ${msg}`));
    });
  });

// ── main entry point ────────────────────────────────────────────────

export const runBuild = async (buildId) => {
  const build = buildStore.get(buildId);
  if (!build) {
    logger.error('runBuild: unknown buildId', { buildId });
    return { exitCode: -1 };
  }

  // queued → running
  const startedAt = new Date().toISOString();
  buildStore.update(buildId, { status: 'running', startedAt });
  buildEvents.emit('status', { buildId, status: 'running', startedAt });
  logger.info(`Build started: ${buildId}`, {
    repo: build.repo, branch: build.branch,
  });

  const logPath   = path.join(BUILDS_DIR, `${buildId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const workspace = path.join(BUILDS_DIR, buildId, 'workspace');

  // Timeout: keep a handle on whichever child is currently running so we
  // can kill it if we blow past the deadline.
  let currentChild = null;
  const timeout = setTimeout(() => {
    emitRunnerLine(buildId, logStream,
      `\n[runner] TIMEOUT after ${BUILD_TIMEOUT_MS / 1000}s — killing\n`);
    if (currentChild && !currentChild.killed) currentChild.kill('SIGKILL');
  }, BUILD_TIMEOUT_MS);

  let exitCode = 0;
  let errorMessage = null;

  try {
    // ── 1. clone ─────────────────────────────────────────────────
    if (!build.cloneUrl) {
      throw new Error('build has no cloneUrl (repository.clone_url missing in payload)');
    }
    emitRunnerLine(buildId, logStream,
      `\n[runner] git clone ${build.cloneUrl}\n`);
    await spawnStep({
      buildId, logStream,
      cmd: 'git',
      args: ['clone', '--progress', build.cloneUrl, workspace],
      onSpawn: (c) => { currentChild = c; },
    });

    // ── 2. checkout (only if a specific commit was named) ────────
    if (build.commit) {
      emitRunnerLine(buildId, logStream,
        `[runner] git checkout ${build.commit}\n`);
      await spawnStep({
        buildId, logStream,
        cmd: 'git',
        args: ['checkout', '--quiet', build.commit],
        opts: { cwd: workspace },
        onSpawn: (c) => { currentChild = c; },
      });
    }

    // ── 3. choose pipeline script ────────────────────────────────
    const repoScript = path.join(workspace, 'pipeline.sh');
    let scriptPath;
    if (fs.existsSync(repoScript)) {
      try { fs.chmodSync(repoScript, 0o755); } catch { /* ok */ }
      scriptPath = repoScript;
      emitRunnerLine(buildId, logStream,
        `[runner] using pipeline.sh from cloned repo\n`);
    } else {
      scriptPath = FALLBACK_SCRIPT;
      emitRunnerLine(buildId, logStream,
        `[runner] no pipeline.sh in repo, using PipelineLite default script\n`);
    }

    // ── 4. run the script (cwd = workspace, env carries metadata) ─
    emitRunnerLine(buildId, logStream, `[runner] $ ${scriptPath}\n\n`);
    await spawnStep({
      buildId, logStream,
      cmd: scriptPath,
      args: [],
      opts: {
        cwd: workspace,
        env: {
          ...process.env,
          BUILD_ID:     build.id,
          BUILD_REPO:   build.repo   ?? '',
          BUILD_REF:    build.ref    ?? '',
          BUILD_BRANCH: build.branch ?? '',
          BUILD_COMMIT: build.commit ?? '',
        },
      },
      onSpawn: (c) => { currentChild = c; },
    });
  } catch (err) {
    exitCode = 1;
    errorMessage = err.message;
    logger.warn(`Build step failed: ${buildId}`, { err: err.message });
  }

  clearTimeout(timeout);
  currentChild = null;

  // ── 5. finalize ─────────────────────────────────────────────────
  const endedAt = new Date().toISOString();
  const status  = exitCode === 0 ? 'success' : 'failure';
  const epilogue =
    `\n[runner] exit code: ${exitCode}` +
    (errorMessage ? ` — ${errorMessage}` : '') + '\n';
  logStream.end(epilogue);
  buildEvents.emit('log', {
    buildId, stream: 'runner', chunk: epilogue, ts: Date.now(),
  });

  buildStore.update(buildId, { status, endedAt, exitCode, errorMessage });
  buildEvents.emit('status', { buildId, status, endedAt, exitCode });
  logger.info(`Build ${status}: ${buildId}`, { exitCode });

  return { exitCode };
};
