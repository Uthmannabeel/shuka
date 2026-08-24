// Unit tests for the deterministic parts of the pipeline (chunking, the
// relevance gate, prompt assembly, vector math). Model-dependent behaviour
// is covered by the eval harness (npm run eval), not here.
//
// Usage: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPages } from "../src/lib/chunk.js";
import { gateHits, buildGroundedUserPrompt, ANSWER_FLOOR, INCLUDE_FLOOR } from "../src/lib/prompts.js";
import { dot } from "../src/lib/embedder.js";

// ---- chunking ----

test("chunkPages keeps page provenance and splits at page boundaries", () => {
  const long = "Maize spacing guidance for smallholder farmers in the savannah zone. ".repeat(10);
  const chunks = chunkPages([
    { num: 3, text: long },
    { num: 4, text: long },
  ]);
  assert.ok(chunks.length >= 2, "one chunk per substantial page");
  assert.equal(chunks[0].pageStart, 3);
  assert.equal(chunks[0].pageEnd, 3, "page-boundary flush must not merge topics");
  assert.equal(chunks.at(-1).pageEnd, 4);
});

test("chunkPages drops page furniture and non-text debris", () => {
  const chunks = chunkPages([
    { num: 1, text: "17\n" },
    { num: 2, text: "5 · 12 · 19 · 44 · 90 · 118 · 3 · 8 · 21 · 60 · 77 · 91 · 14 · 33 · 52 · 76 · 88 · 102 · 6 · 28 · 41 · 66 · 82 · 99 · 111 · 120 · 131 · 140" },
  ]);
  assert.equal(chunks.length, 0, "short fragments and number-heavy lines carry no signal");
});

test("chunkPages strips control characters from extracted text", () => {
  const payload = "Plant maize at the onset of rains.\x1b[31m malicious \x07 and keep rows weeded so the crop establishes well before the first top-dressing is applied.";
  const chunks = chunkPages([{ num: 1, text: payload }]);
  assert.equal(chunks.length, 1);
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(chunks[0].text), "no control chars survive");
});

test("chunkPages hard-flushes very long pages into multiple chunks", () => {
  const line = "Cassava field sanitation notes for extension workers, line item.";
  const text = Array.from({ length: 60 }, () => line).join("\n");
  const chunks = chunkPages([{ num: 1, text }]);
  assert.ok(chunks.length >= 2, "MAX_CHARS flush must apply within a page");
  for (const c of chunks) assert.ok(c.text.length <= 1700);
});

// ---- relevance gate ----

test("gateHits refuses when the best hit is below the answer floor", () => {
  const { answerable, kept } = gateHits([{ score: ANSWER_FLOOR - 0.03 }, { score: 0.4 }]);
  assert.equal(answerable, false);
  assert.ok(kept.length > 0, "kept chunks are reported even when refusing");
});

test("gateHits answers when the best hit clears the answer floor", () => {
  const { answerable, kept } = gateHits([{ score: 0.7 }, { score: 0.4 }, { score: 0.2 }]);
  assert.equal(answerable, true);
  assert.equal(kept.length, 2, "chunks below the include floor are dropped");
});

test("gateHits refuses on empty retrieval", () => {
  assert.equal(gateHits([]).answerable, false);
});

test("gate floors match the recorded eval separation", () => {
  // From eval-2026-08-21: max out-of-scope top score 0.476; min in-corpus 0.589.
  assert.ok(ANSWER_FLOOR > 0.476, "all recorded out-of-scope questions refuse");
  assert.ok(ANSWER_FLOOR < 0.589, "all recorded in-corpus questions answer");
  assert.ok(INCLUDE_FLOOR < ANSWER_FLOOR);
});

// ---- prompt assembly ----

test("buildGroundedUserPrompt numbers sources and appends the question", () => {
  const prompt = buildGroundedUserPrompt(
    [{ chunk: { text: "Plant two seeds per station." } }, { chunk: { text: "Weed at three weeks." } }],
    "How do I plant maize?"
  );
  assert.ok(prompt.startsWith("SOURCES:"));
  assert.ok(prompt.includes("[1] Plant two seeds per station."));
  assert.ok(prompt.includes("[2] Weed at three weeks."));
  assert.ok(prompt.endsWith("QUESTION: How do I plant maize?"));
});

// ---- vector math ----

test("dot is the cosine similarity for unit vectors", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  assert.equal(dot(a, a), 1);
  assert.equal(dot(a, b), 0);
  const c = new Float32Array([Math.SQRT1_2, Math.SQRT1_2, 0]);
  assert.ok(Math.abs(dot(a, c) - Math.SQRT1_2) < 1e-6);
});
