// On-device generation via node-llama-cpp (llama.cpp bindings — the same
// runtime the ADTC profiler uses). The model file lives at the path declared
// in metadata.json so the app and the profiler exercise the identical GGUF.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTEXT_TOKENS = 4096; // enough for 4 retrieved chunks + answer, modest KV-cache RAM

/** @returns {string} absolute model path from metadata.json (single source of truth) */
export function modelPath() {
  const metadata = JSON.parse(readFileSync(join(ROOT, "metadata.json"), "utf8"));
  return join(ROOT, metadata._runtime.model_path);
}

/**
 * Loads the model once; returned handle answers independent questions.
 * Default is auto: llama.cpp's Vulkan backend on the integrated GPU when
 * available (measured 27x faster prefill than CPU on the dev machine),
 * falling back to CPU. Set SHUKA_GPU=off to force CPU-only — that is the
 * configuration used for the report's worst-case benchmark numbers.
 */
export async function loadLLM() {
  const llama = await getLlama({ gpu: process.env.SHUKA_GPU === "off" ? false : "auto" });
  const model = await llama.loadModel({ modelPath: modelPath() });
  const context = await model.createContext({ contextSize: CONTEXT_TOKENS });

  return {
    /**
     * @param {{systemPrompt: string, userPrompt: string, onTextChunk?: (t: string) => void, maxTokens?: number}} opts
     * @returns {Promise<{text: string, tokens: number, ttftMs: number|null, decodeSecs: number}>}
     */
    async ask({ systemPrompt, userPrompt, onTextChunk, maxTokens = 512 }) {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt });
      try {
        const start = Date.now();
        let firstTokenAt = null;
        let tokens = 0;
        const text = await session.prompt(userPrompt, {
          maxTokens,
          // Greedy decoding: identical inputs give identical answers, so the
          // published eval is reproducible run-to-run. The repeat penalty
          // guards against the degenerate-loop failure mode a 1B model shows
          // on marginal prompts.
          temperature: 0,
          repeatPenalty: { penalty: 1.12, frequencyPenalty: 0.15 },
          onToken(toks) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            tokens += toks.length;
          },
          onTextChunk,
        });
        const decodeSecs = firstTokenAt === null ? 0 : (Date.now() - firstTokenAt) / 1000;
        return { text, tokens, ttftMs: firstTokenAt === null ? null : firstTokenAt - start, decodeSecs };
      } finally {
        // frees the sequence so the next ask() can claim one
        session.dispose({ disposeSequence: true });
      }
    },

    async unload() {
      await context.dispose();
      await model.dispose();
      await llama.dispose();
    },
  };
}
