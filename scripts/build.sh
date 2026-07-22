#!/usr/bin/env bash
set -euo pipefail

echo "👷 Running build script for environment: ${VERCEL_ENV:-unknown}"

# The @assembly-js/node-sdk (v4) needs no patching — it is per-request scoped
# and carries no client-side token-expiry logic, so no SDK file swap here.

echo "[1/2] Running db:migrate"
yarn db:migrate

echo "[2/2] Running next build"
next build

echo "🥳 Build completed! 🎉🎉"
