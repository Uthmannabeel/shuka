#!/usr/bin/env bash
# Downloads the inference model into model/ (required ADTC submission layout).
# Idempotent: skips the download when the file is already complete.
set -euo pipefail

MODEL_DIR="$(cd "$(dirname "$0")" && pwd)/model"
MODEL_FILE="Llama-3.2-1B-Instruct-Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/${MODEL_FILE}"

mkdir -p "$MODEL_DIR"
DEST="$MODEL_DIR/$MODEL_FILE"

if [ -f "$DEST" ]; then
  echo "[download_model] $MODEL_FILE already present — nothing to do"
  exit 0
fi

echo "[download_model] fetching $MODEL_FILE (~0.8 GB)..."
if command -v curl >/dev/null 2>&1; then
  curl -L --fail --retry 3 -o "$DEST.partial" "$MODEL_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$DEST.partial" "$MODEL_URL"
else
  echo "[download_model] ERROR: need curl or wget" >&2
  exit 1
fi
mv "$DEST.partial" "$DEST"
echo "[download_model] done: $DEST"
