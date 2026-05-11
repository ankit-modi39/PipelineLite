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

export const config = Object.freeze({
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  githubWebhookSecret: required('GITHUB_WEBHOOK_SECRET'),
});
