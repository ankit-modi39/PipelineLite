#!/usr/bin/env bash
# Demo pipeline script. Receives build context via environment variables
# (BUILD_ID, BUILD_REPO, BUILD_REF, BUILD_COMMIT) — never via shell-
# interpolated args, which would be a command-injection vector.
#
# To force a failure path for testing: push to ref "refs/heads/broken".

set -euo pipefail

echo "================ PipelineLite build ================"
echo "  build id: ${BUILD_ID:-unset}"
echo "  repo:     ${BUILD_REPO:-unset}"
echo "  ref:      ${BUILD_REF:-unset}"
echo "  commit:   ${BUILD_COMMIT:-unset}"
echo "================================================="
echo

echo "[1/3] install"
sleep 1
echo "  dependencies installed"

echo "[2/3] test"
sleep 1
echo "  12/12 tests passed"

if [[ "${BUILD_REF:-}" == "refs/heads/broken" ]]; then
  echo "[3/3] build"
  echo "  ERROR: linker step failed on broken branch"
  exit 1
fi

echo "[3/3] build"
sleep 1
echo "  artifact: dist/app-${BUILD_COMMIT:-snapshot}.tar.gz"

echo
echo "== build complete =="
