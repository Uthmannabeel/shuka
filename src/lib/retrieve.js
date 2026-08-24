// Retrieval over the pre-built corpus index: brute-force cosine top-k.
// At corpus scale (thousands of chunks) exact search is single-digit
// milliseconds on the target CPU — a vector database would add complexity
// and RAM for nothing. Revisit (sqlite-vec) only if the corpus grows 100x.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts, dot } from "./embedder.js";

const INDEX_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus", "index.json");

/** @returns {{chunks: Array<object>, model: string}} index with vectors decoded */
export function loadIndex() {
  if (!existsSync(INDEX_FILE)) {
    throw new Error(`corpus index not found at ${INDEX_FILE} — run \`npm run ingest\` first`);
  }
  const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  for (const chunk of index.chunks) {
    const buf = Buffer.from(chunk.vector, "base64");
    chunk.vector = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return index;
}

/**
 * @param {object} index from loadIndex()
 * @param {Float32Array} queryVec unit-normalised query embedding
 * @param {number} k
 * @returns {{chunk: object, score: number}[]} top-k by cosine, descending
 */
export function rankByVector(index, queryVec, k) {
  return index.chunks
    .map((chunk) => ({ chunk, score: dot(queryVec, chunk.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * @param {object} index from loadIndex()
 * @param {string} query
 * @param {number} k
 * @returns {Promise<{chunk: object, score: number}[]>} top-k by cosine, descending
 */
export async function retrieve(index, query, k) {
  const [queryVec] = await embedTexts([query]);
  return rankByVector(index, queryVec, k);
}
