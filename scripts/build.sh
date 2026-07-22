#!/usr/bin/env bash
set -euo pipefail

# TEMPORARY FIX: suppress sending tokenId to auth header
# yarn patch-assembly-node-sdk

echo "👷 Running build script for environment: ${VERCEL_ENV:-unknown}"

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "[1/3] Running copilot-node-sdk patch 🧑🏻‍🔧"
  yarn patch-copilot-node-sdk
else
  echo "[1/3] Skipping copilot-node-sdk patch (production)"
fi

echo "[2/3] Running db:migrate"
yarn db:migrate

echo "[3/3] Running next build"
next build

echo "🥳 Build completed! 🎉🎉"
