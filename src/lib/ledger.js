// The ledger: the laptop's own record of questions it has answered.
// Two jobs: (1) a semantic cache — market day brings the same questions
// all morning, and a repeat within CACHE_SIMILARITY is served instantly
// from the ledger instead of re-generating; (2) institutional memory the
// cooperative can scroll. Everything stays in one local JSONL file;
// nothing ever leaves the machine.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dot } from "./embedder.js";

// Tuned conservatively: 0.92 cosine means near-identical phrasing intent.
// Below it, the full pipeline runs — a stale near-miss is worse than a
// fresh answer.
export const CACHE_SIMILARITY = 0.92;

/** @param {string} file @returns {Array<object>} entries with vectors decoded */
export function loadLedger(file) {
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      const buf = Buffer.from(e.v, "base64");
      e.vector = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      delete e.v;
      entries.push(e);
    } catch {} // a torn last line (power cut mid-write) must not sink the ledger
  }
  return entries;
}

/**
 * @param {string} file
 * @param {{ts: string, question: string, vector: Float32Array, answer: string, sources: Array<object>}} entry
 * @returns {object} the entry as stored (vector re-decoded), for in-memory use
 */
export function appendLedger(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  const { vector, ...rest } = entry;
  const line = JSON.stringify({ ...rest, v: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64") });
  appendFileSync(file, line + "\n");
  return entry;
}

/**
 * @param {Array<{vector: Float32Array}>} entries
 * @param {Float32Array} queryVec unit-normalised
 * @returns {{entry: object, score: number} | null} best match by cosine
 */
export function bestMatch(entries, queryVec) {
  let best = null;
  for (const entry of entries) {
    const score = dot(queryVec, entry.vector);
    if (best === null || score > best.score) best = { entry, score };
  }
  return best;
}
