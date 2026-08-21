// Prompt assembly and grounding policy, shared by the CLI and the eval
// harness so both exercise the identical pipeline.

export const TOP_K = 4;
export const SIMILARITY_FLOOR = 0.35; // MiniLM cosine; tuned against the eval set

export const GROUNDED_SYSTEM_PROMPT = [
  "You are Shuka, an agricultural extension assistant for smallholder farmers in Nigeria.",
  "Answer the farmer's question using ONLY the numbered SOURCES provided.",
  "Cite the sources you use, like [1] or [2].",
  "If the sources do not contain the answer, say so plainly and advise the farmer",
  "to contact their local agricultural extension office. Never guess dosages,",
  "application rates, or chemical names that are not in the sources.",
  "Be practical and concise.",
].join(" ");

export const RAW_SYSTEM_PROMPT =
  "You are an agricultural extension assistant for smallholder farmers in Nigeria. Give practical, concise advice.";

export const REFUSAL_MESSAGE =
  "I don't have reliable information on this in my sources, and I won't guess — " +
  "wrong agricultural advice can cost you a season. Please ask your local " +
  "agricultural extension office (ADP) or a trusted agro-dealer.";

/**
 * @param {{chunk: {text: string}}[]} hits retrieval results, best first
 * @param {string} question
 */
export function buildGroundedUserPrompt(hits, question) {
  return (
    "SOURCES:\n" +
    hits.map((h, i) => `[${i + 1}] ${h.chunk.text}`).join("\n\n") +
    `\n\nQUESTION: ${question}`
  );
}
