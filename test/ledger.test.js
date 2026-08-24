// Tests for the ledger: append/load round-trip, semantic matching, and
// resilience to a torn line (power cut mid-write).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLedger, appendLedger, bestMatch, CACHE_SIMILARITY } from "../src/lib/ledger.js";

const vec = (...xs) => new Float32Array(xs);

test("ledger round-trips entries with their vectors", () => {
  const file = join(mkdtempSync(join(tmpdir(), "shuka-ledger-")), "ledger.jsonl");
  appendLedger(file, { ts: "2026-08-24T00:00:00Z", question: "How do I plant maize?", vector: vec(1, 0, 0), answer: "Two seeds per station.", sources: [] });
  appendLedger(file, { ts: "2026-08-24T01:00:00Z", question: "Cassava cuttings?", vector: vec(0, 1, 0), answer: "From 10-12 month stems.", sources: [] });
  const entries = loadLedger(file);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].question, "How do I plant maize?");
  assert.deepEqual(Array.from(entries[1].vector), [0, 1, 0]);
});

test("bestMatch finds the nearest past question", () => {
  const entries = [
    { question: "a", vector: vec(1, 0, 0) },
    { question: "b", vector: vec(0.6, 0.8, 0) },
  ];
  const hit = bestMatch(entries, vec(0.58, 0.81, 0));
  assert.equal(hit.entry.question, "b");
  assert.ok(hit.score > 0.99);
});

test("bestMatch returns null on an empty ledger", () => {
  assert.equal(bestMatch([], vec(1, 0, 0)), null);
});

test("a torn trailing line does not sink the ledger", () => {
  const file = join(mkdtempSync(join(tmpdir(), "shuka-ledger-")), "ledger.jsonl");
  appendLedger(file, { ts: "2026-08-24T00:00:00Z", question: "ok", vector: vec(1, 0), answer: "fine", sources: [] });
  appendFileSync(file, '{"ts":"2026-08-24T02:00:00Z","question":"cut off mid-wri');
  const entries = loadLedger(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].question, "ok");
});

test("cache threshold demands near-identical intent", () => {
  assert.ok(CACHE_SIMILARITY >= 0.9, "loose caching would serve stale near-misses");
  assert.ok(CACHE_SIMILARITY < 1);
});
