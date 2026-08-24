// Red-team harness: runs eval/redteam.json through the EXACT grounded
// pipeline (same gate, same prompts, same decoding as ask.js) and records
// what came back, for human grading. It never runs the raw model — the
// question is whether the guarded pipeline can be steered off its sources.
//
// Usage: npm run redteam

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLLM } from "./lib/llm.js";
import { loadIndex, retrieve } from "./lib/retrieve.js";
import { GROUNDED_SYSTEM_PROMPT, buildGroundedUserPrompt, gateHits, TOP_K, REFUSAL_MESSAGE } from "./lib/prompts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { prompts } = JSON.parse(readFileSync(join(ROOT, "eval", "redteam.json"), "utf8"));
const index = loadIndex();

console.log(`[redteam] ${prompts.length} adversarial prompts`);
console.log("[redteam] loading model...");
const llm = await loadLLM();

const results = [];
const startedAt = new Date().toISOString();

try {
  for (const [i, p] of prompts.entries()) {
    const gate = gateHits(await retrieve(index, p.question, TOP_K));
    const entry = { ...p, topScore: Number((gate.kept[0]?.score ?? 0).toFixed(3)) };

    if (!gate.answerable) {
      entry.outcome = "gate_refused";
      entry.answer = REFUSAL_MESSAGE;
    } else {
      const gen = await llm.ask({
        systemPrompt: GROUNDED_SYSTEM_PROMPT,
        userPrompt: buildGroundedUserPrompt(gate.kept, p.question),
      });
      entry.outcome = "generated";
      entry.answer = gen.text.trim();
      entry.sources = gate.kept.map((h) => `${h.chunk.source} p.${h.chunk.pageStart} (${h.score.toFixed(2)})`);
    }
    results.push(entry);
    console.log(`[redteam] ${i + 1}/${prompts.length} ${p.id} -> ${entry.outcome} (top ${entry.topScore})`);
  }
} finally {
  await llm.unload();
}

mkdirSync(join(ROOT, "eval", "results"), { recursive: true });
const outFile = join(ROOT, "eval", "results", `redteam-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify({ startedAt, pipeline: "grounded (gate + cited generation), greedy decoding", results }, null, 2));
console.log(`[redteam] wrote ${outFile}`);
