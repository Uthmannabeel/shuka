// Accuracy eval: runs every question in eval/questions.json through BOTH
// modes — raw (bare model) and grounded (the exact pipeline ask.js uses) —
// and records answers, retrieval evidence, and timing for grading.
// Grading is done by humans against the corpus text (see eval/RUBRIC.md);
// this harness only produces the transcript, it does not score.
//
// Usage: npm run eval            (both modes, all questions)
//        npm run eval -- --grounded-only

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLLM } from "./lib/llm.js";
import { loadIndex, retrieve } from "./lib/retrieve.js";
import { GROUNDED_SYSTEM_PROMPT, RAW_SYSTEM_PROMPT, buildGroundedUserPrompt, gateHits, ANSWER_FLOOR, INCLUDE_FLOOR, TOP_K, REFUSAL_MESSAGE } from "./lib/prompts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const groundedOnly = process.argv.includes("--grounded-only");

const { questions } = JSON.parse(readFileSync(join(ROOT, "eval", "questions.json"), "utf8"));
const index = loadIndex();

console.log(`[eval] ${questions.length} questions, modes: ${groundedOnly ? "grounded" : "raw + grounded"}`);
console.log("[eval] loading model...");
const llm = await loadLLM();

const results = [];
const startedAt = new Date().toISOString();

try {
  for (const [i, q] of questions.entries()) {
    const entry = { ...q };

    if (!groundedOnly) {
      const t0 = Date.now();
      const raw = await llm.ask({ systemPrompt: RAW_SYSTEM_PROMPT, userPrompt: q.question });
      entry.raw = { answer: raw.text.trim(), tokens: raw.tokens, ttftMs: raw.ttftMs, secs: (Date.now() - t0) / 1000 };
    }

    const t1 = Date.now();
    const gate = gateHits(await retrieve(index, q.question, TOP_K));
    const hits = gate.kept;
    const retrievalMs = Date.now() - t1;
    if (!gate.answerable) {
      entry.grounded = { refused: true, answer: REFUSAL_MESSAGE, retrievalMs, hits: [] };
    } else {
      const gen = await llm.ask({
        systemPrompt: GROUNDED_SYSTEM_PROMPT,
        userPrompt: buildGroundedUserPrompt(hits, q.question),
      });
      entry.grounded = {
        refused: false,
        answer: gen.text.trim(),
        tokens: gen.tokens,
        ttftMs: gen.ttftMs,
        retrievalMs,
        hits: hits.map((h) => ({
          source: h.chunk.source,
          pageStart: h.chunk.pageStart,
          pageEnd: h.chunk.pageEnd,
          score: Number(h.score.toFixed(3)),
          text: h.chunk.text,
        })),
      };
    }

    results.push(entry);
    const refusedNote = entry.grounded.refused ? " [REFUSED]" : "";
    console.log(`[eval] ${i + 1}/${questions.length} ${q.id}${refusedNote}`);
  }
} finally {
  await llm.unload();
}

mkdirSync(join(ROOT, "eval", "results"), { recursive: true });
const outFile = join(ROOT, "eval", "results", `eval-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify({ startedAt, model: "Llama-3.2-1B-Instruct-Q4_K_M", topK: TOP_K, answerFloor: ANSWER_FLOOR, includeFloor: INCLUDE_FLOOR, results }, null, 2));

// Side-by-side markdown for human grading
const md = results
  .map((r) => {
    const lines = [`## ${r.id} (${r.crop}, ${r.category})`, "", `**Q:** ${r.question}`, ""];
    if (r.raw) lines.push("### Raw model", "", r.raw.answer, "");
    lines.push("### Grounded", "", r.grounded.answer, "");
    if (!r.grounded.refused) {
      lines.push(
        "Retrieved: " +
          r.grounded.hits.map((h) => `${h.source} p.${h.pageStart} (${h.score})`).join("; "),
        ""
      );
    }
    return lines.join("\n");
  })
  .join("\n---\n\n");
const mdFile = outFile.replace(/\.json$/, ".md");
writeFileSync(mdFile, `# Eval transcript ${startedAt}\n\n${md}`);
console.log(`[eval] wrote ${outFile}\n[eval] wrote ${mdFile}`);
