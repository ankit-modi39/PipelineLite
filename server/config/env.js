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

export const config = Object.freeze({
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  githubWebhookSecret: required('GITHUB_WEBHOOK_SECRET'),

  // Branch allow-list. Empty = allow every branch (current behaviour).
  // Glob patterns: "main", "release/*", "*-prod"
  allowedBranches: list('ALLOWED_BRANCHES'),
});
