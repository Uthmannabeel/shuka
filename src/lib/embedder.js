// On-device embedding via transformers.js (ONNX, CPU-only). The model is
// downloaded once on first use and cached locally; after that the pipeline
// is fully offline, which is the contest's hard constraint.

import { pipeline } from "@huggingface/transformers";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;
const BATCH_SIZE = 16; // bounds peak memory during corpus ingestion

let embedderPromise = null;

/** @returns {Promise<Function>} the shared feature-extraction pipeline */
function getPipeline() {
  if (embedderPromise === null) {
    // q8 quantization: ~4x smaller than fp32, negligible retrieval-quality
    // loss for MiniLM, and faster on the CPU-only target hardware.
    embedderPromise = pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" });
  }
  return embedderPromise;
}

/**
 * Embed texts into unit-normalised vectors (so cosine similarity is a dot product).
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export async function embedTexts(texts) {
  const embed = await getPipeline();
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const out = await embed(batch, { pooling: "mean", normalize: true });
    const [rows, dims] = out.dims;
    for (let r = 0; r < rows; r++) {
      vectors.push(new Float32Array(out.data.buffer, out.data.byteOffset + r * dims * 4, dims).slice());
    }
    out.dispose?.();
  }
  return vectors;
}

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} dot product (== cosine similarity for unit vectors)
 */
export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
