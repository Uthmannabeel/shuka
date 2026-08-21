// Shuka: grounded question answering on-device.
//
// Usage:
//   npm run ask -- "How do I control fall armyworm in maize?"
//   npm run ask -- --raw "..."           (bypass retrieval — for honest comparison only)
//   npm run ask -- --show-context "..."  (print retrieved passages before the answer)
//
// Guardrail: if no retrieved passage clears SIMILARITY_FLOOR, the model is not
// called at all — the assistant says it lacks sources and points to the local
// extension office. A 1B model free-associating agronomy is dangerous
// (see docs/concept.md baseline findings); silence beats confident error.

import { loadLLM } from "./lib/llm.js";
import { loadIndex, retrieve } from "./lib/retrieve.js";
import { GROUNDED_SYSTEM_PROMPT, RAW_SYSTEM_PROMPT, buildGroundedUserPrompt, SIMILARITY_FLOOR, TOP_K, REFUSAL_MESSAGE } from "./lib/prompts.js";

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// --- arg parsing ---
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const question = args.filter((a) => !a.startsWith("--")).join(" ").trim();
if (!question) {
  console.error('usage: npm run ask -- [--raw] [--show-context] "your question"');
  process.exit(1);
}
const useRag = !flags.has("--raw");

// --- retrieval ---
let hits = [];
let retrievalMs = 0;
if (useRag) {
  const index = loadIndex();
  const t0 = Date.now();
  hits = (await retrieve(index, question, TOP_K)).filter((h) => h.score >= SIMILARITY_FLOOR);
  retrievalMs = Date.now() - t0; // includes query embedding

  if (hits.length === 0) {
    console.log(REFUSAL_MESSAGE);
    process.exit(0);
  }

  if (flags.has("--show-context")) {
    for (const [i, h] of hits.entries()) {
      console.log(`--- [${i + 1}] ${h.chunk.source} p.${h.chunk.pageStart} (score ${h.score.toFixed(3)}) ---`);
      console.log(h.chunk.text.slice(0, 400) + (h.chunk.text.length > 400 ? "…" : ""), "\n");
    }
  }
}

// --- generation ---
console.error("[shuka] loading model...");
const loadStart = Date.now();
const llm = await loadLLM();
console.error(`[shuka] model ready in ${((Date.now() - loadStart) / 1000).toFixed(1)}s\n`);

try {
  const result = await llm.ask({
    systemPrompt: useRag ? GROUNDED_SYSTEM_PROMPT : RAW_SYSTEM_PROMPT,
    userPrompt: useRag ? buildGroundedUserPrompt(hits, question) : question,
    onTextChunk: (t) => process.stdout.write(t.replace(CONTROL_CHARS, "")),
  });
  process.stdout.write("\n");

  if (useRag) {
    console.log("\nSources:");
    for (const [i, h] of hits.entries()) {
      const pages =
        h.chunk.pageStart === h.chunk.pageEnd
          ? `p.${h.chunk.pageStart}`
          : `pp.${h.chunk.pageStart}-${h.chunk.pageEnd}`;
      console.log(`  [${i + 1}] ${h.chunk.source}, ${pages} (relevance ${h.score.toFixed(2)})`);
    }
  }

  const tokPerSec =
    result.decodeSecs > 0 && result.tokens > 1 ? ((result.tokens - 1) / result.decodeSecs).toFixed(1) : "n/a";
  console.error(`\n[shuka] retrieval ${retrievalMs}ms | ttft ${result.ttftMs ?? "n/a"}ms | decode ${tokPerSec} tok/s`);
} finally {
  await llm.unload();
}
