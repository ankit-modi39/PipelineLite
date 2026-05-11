#!/usr/bin/env bash
# Dev tool: sign a sample payload with the same secret the server uses,
# then POST it to /webhook. Lets us test HMAC verification end-to-end
# without exposing the laptop to GitHub.
#
# Usage:
#   ./scripts/dev-send-webhook.sh                # signs with .env secret
#   SECRET=wrong ./scripts/dev-send-webhook.sh   # forces a mismatch (expect 401)

set -euo pipefail

# Run from project root regardless of where it's invoked from.
cd "$(dirname "$0")/.."

# Load .env into the shell environment.
set -a
# shellcheck disable=SC1091
source .env
set +a

PORT="${PORT:-4000}"
SECRET="${SECRET:-$GITHUB_WEBHOOK_SECRET}"

PAYLOAD='{"ref":"refs/heads/main","repository":{"full_name":"demo/repo"},"head_commit":{"id":"abc123"}}'

# Sign the *exact* bytes the server will see. printf '%s' avoids a trailing newline.
SIG=$(printf '%s' "$PAYLOAD" \
  | openssl dgst -sha256 -hmac "$SECRET" \
  | awk '{print $NF}')

echo "→ POST http://localhost:${PORT}/webhook"
echo "  signature: sha256=${SIG}"
echo

curl -sS -X POST "http://localhost:${PORT}/webhook" \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: push' \
  -H 'X-GitHub-Delivery: dev-test-001' \
  -H "X-Hub-Signature-256: sha256=${SIG}" \
  -d "$PAYLOAD" \
  -w '\n  http_status: %{http_code}\n'
