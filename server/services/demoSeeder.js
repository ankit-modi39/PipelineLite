// Demo seeder — runs once at boot if DEMO_MODE=true AND the store is empty.
//
// What it does:
//   1. Inserts 6 mock build records spanning the last few days
//   2. Writes a realistic log file per build (the same path the runner uses,
//      so the dashboard's "snapshot" replay works without any special case)
//
// On Render's free tier the filesystem is ephemeral, so this re-seeds on
// every cold start. That's fine — the seeds are deterministic and cheap.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildStore } from './buildStore.js';
import { logger } from '../utils/logger.js';

const BUILDS_DIR = path.resolve('server/builds');

// ── helpers ────────────────────────────────────────────────────────

const idAt = (date) => {
  const ts = date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return `b_${ts}_${crypto.randomBytes(3).toString('hex')}`;
};

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

const fakeCommit = () => crypto.randomBytes(7).toString('hex');

const SUCCESS_LOG = ({ id, repo, branch, commit }) => `[runner] git clone https://github.com/${repo}.git
Cloning into '/srv/builds/${id}/workspace'...
remote: Enumerating objects: 142, done.
remote: Counting objects: 100% (142/142), done.
done.
[runner] git checkout ${commit}
[runner] using pipeline.sh from cloned repo
[runner] $ /srv/builds/${id}/workspace/pipeline.sh

================ PipelineLite build ================
  build id: ${id}
  repo:     ${repo}
  ref:      refs/heads/${branch}
  commit:   ${commit}
=================================================

[1/3] install
  npm install...
  added 256 packages, audited 257 packages in 3s
  dependencies installed
[2/3] test
  > test
  > jest

  PASS  src/utils/format.test.js
  PASS  src/api/auth.test.js
  PASS  src/models/user.test.js

  Test Suites: 3 passed, 3 total
  Tests:       42 passed, 42 total
  Time:        4.218 s
[3/3] build
  building dist/...
  artifact: dist/app-${commit}.tar.gz

== build complete ==

[runner] exit code: 0
`;

const FAILURE_TEST_LOG = ({ id, repo, branch, commit }) => `[runner] git clone https://github.com/${repo}.git
Cloning into '/srv/builds/${id}/workspace'...
done.
[runner] git checkout ${commit}
[runner] using pipeline.sh from cloned repo
[runner] $ /srv/builds/${id}/workspace/pipeline.sh

================ PipelineLite build ================
  build id: ${id}
  repo:     ${repo}
  ref:      refs/heads/${branch}
  commit:   ${commit}
=================================================

[1/3] install
  added 256 packages
[2/3] test
  > jest

  PASS  src/utils/format.test.js
  FAIL  src/api/auth.test.js
    × should reject expired tokens
      Expected: 401
      Received: 500

      at Object.<anonymous> (src/api/auth.test.js:42:18)

  Test Suites: 1 failed, 2 passed, 3 total
  Tests:       1 failed, 41 passed, 42 total
  Time:        4.911 s

[runner] exit code: 1 — pipeline.sh → exit 1
`;

const FAILURE_BUILD_LOG = ({ id, repo, branch, commit }) => `[runner] git clone https://github.com/${repo}.git
Cloning into '/srv/builds/${id}/workspace'...
done.
[runner] git checkout ${commit}
[runner] using pipeline.sh from cloned repo
[runner] $ /srv/builds/${id}/workspace/pipeline.sh

[1/3] install
  dependencies installed
[2/3] test
  12/12 tests passed
[3/3] build
  src/api/handler.ts:88:14 - error TS2339:
    Property 'session' does not exist on type 'Request'.

  88   const u = req.session.user;
                    ~~~~~~~

  Found 1 error.

[runner] exit code: 1 — pipeline.sh → exit 2
`;

// ── seed plan ─────────────────────────────────────────────────────

// [ minutesAgo, branch, status, durationSec, logFn ]
const PLAN = [
  [    5, 'main',          'success', 12, SUCCESS_LOG       ],
  [   45, 'release/v1.2',  'success', 14, SUCCESS_LOG       ],
  [  120, 'main',          'failure',  8, FAILURE_TEST_LOG  ],
  [  300, 'feature/login', 'success', 11, SUCCESS_LOG       ],
  [ 1440, 'main',          'failure',  6, FAILURE_BUILD_LOG ],
  [ 7200, 'main',          'success', 10, SUCCESS_LOG       ],
];

export const seedDemoBuilds = () => {
  // Only seed if the store is empty — don't pollute existing data.
  if (buildStore.list({ limit: 1 }).length > 0) {
    logger.info('demoSeeder: store non-empty, skipping');
    return;
  }

  fs.mkdirSync(BUILDS_DIR, { recursive: true });

  for (const [ago, branch, status, durSec, logFn] of PLAN) {
    const createdAt = minutesAgo(ago + durSec / 60);
    const startedAt = new Date(createdAt.getTime() + 500);
    const endedAt   = new Date(startedAt.getTime() + durSec * 1000);
    const id        = idAt(createdAt);
    const commit    = fakeCommit();
    const repo      = 'octocat/demo-app';

    const record = {
      id,
      status,
      kind: 'webhook',
      event: 'push',
      delivery: `seed-${id}`,
      repo,
      ref: `refs/heads/${branch}`,
      branch,
      commit,
      cloneUrl: `https://github.com/${repo}.git`,
      createdAt: createdAt.toISOString(),
      startedAt: startedAt.toISOString(),
      endedAt:   endedAt.toISOString(),
      exitCode:  status === 'success' ? 0 : 1,
      errorMessage: null,
      logPath: `server/builds/${id}.log`,
    };
    buildStore.create(record);

    const logPath = path.join(BUILDS_DIR, `${id}.log`);
    fs.writeFileSync(logPath, logFn({ id, repo, branch, commit }));
  }

  logger.info(`demoSeeder: seeded ${PLAN.length} builds`);
};
