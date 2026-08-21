// One-time online setup so every later run is fully offline:
// 1. warms the local cache of the embedding model (transformers.js downloads
//    it on first use — that must never happen during offline operation);
// 2. verifies the GGUF from download_model.sh is present and complete.
//
// Usage: npm run setup   (after `bash download_model.sh`)

import { existsSync, statSync } from "node:fs";
import { embedTexts, EMBED_MODEL } from "./lib/embedder.js";
import { modelPath } from "./lib/llm.js";

console.log(`[setup] warming embedding model cache (${EMBED_MODEL})...`);
await embedTexts(["warm-up"]);
console.log("[setup] embedding model cached locally");

const gguf = modelPath();
if (!existsSync(gguf)) {
  console.error(`[setup] MISSING: ${gguf} — run \`bash download_model.sh\` first`);
  process.exit(1);
}
const sizeMB = Math.round(statSync(gguf).size / 1024 / 1024);
if (sizeMB < 700) {
  console.error(`[setup] SUSPICIOUS: ${gguf} is only ${sizeMB} MB — likely a truncated download; delete it and re-run download_model.sh`);
  process.exit(1);
}
console.log(`[setup] inference model present (${sizeMB} MB)`);
console.log("[setup] done — the assistant now runs fully offline");
