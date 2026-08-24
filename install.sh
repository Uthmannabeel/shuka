#!/usr/bin/env bash
# One-command setup: checks prerequisites, installs dependencies, fetches
# the model, and pre-caches everything for offline use.
#   bash install.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed. Install Node 20+ from https://nodejs.org, then re-run." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found $(node -v))." >&2
  exit 1
fi

echo "[install] installing dependencies..."
npm install
echo "[install] fetching the model (~0.8 GB)..."
bash download_model.sh
echo "[install] pre-caching for offline use..."
npm run setup
echo
echo "[install] Done. Start Shuka with:  npm run serve"
echo "[install] Then open http://localhost:4180 — no internet needed from now on."
