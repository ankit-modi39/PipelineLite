// Single source of truth for environment configuration.
// Read process.env exactly once, validate, freeze, export.
// Anywhere else in the codebase imports `config` — never reads process.env directly.

import 'dotenv/config';

const required = (key) => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

// Parse a comma-separated list, trimming and dropping empties.
// Empty / unset → empty array → "allow all" semantics downstream.
const list = (key) =>
  (process.env[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Dashboard auth — both vars must be set together, or both unset (dev mode).
// Mismatched config (one set, one not) is almost always a deployment mistake
// and we fail loud so it can't slip through.
const dashboardUser     = process.env.DASHBOARD_USER     ?? '';
const dashboardPassword = process.env.DASHBOARD_PASSWORD ?? '';
const oneSetOneNot =
  (dashboardUser === '') !== (dashboardPassword === '');
if (oneSetOneNot) {
  throw new Error(
    'DASHBOARD_USER and DASHBOARD_PASSWORD must be set together (or both unset).',
  );
}
const authEnabled = dashboardUser !== '' && dashboardPassword !== '';

export const config = Object.freeze({
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  githubWebhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  // Branch allow-list. Empty = allow every branch (current behaviour).
  // Glob patterns: "main", "release/*", "*-prod"
  allowedBranches: list('ALLOWED_BRANCHES'),

  // Dashboard / API / socket auth. Both empty → auth disabled (dev only).
  authEnabled,
  dashboardUser,
  dashboardPassword,
});

if (!authEnabled && (process.env.NODE_ENV ?? 'development') !== 'development') {
  // In any non-dev environment, refuse to start without credentials.
  throw new Error(
    'Dashboard auth is disabled but NODE_ENV != development. ' +
    'Set DASHBOARD_USER and DASHBOARD_PASSWORD.',
  );
}
