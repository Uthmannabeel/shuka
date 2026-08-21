// Splits per-page document text into retrieval chunks, preserving page
// numbers for citations. PDF extraction gives one newline per visual line,
// so "paragraphs" are unreliable — instead we accumulate lines into chunks
// of a target size, flushing at blank lines when near the target.

const TARGET_CHARS = 1100; // ~250 tokens: small enough for 3-4 chunks in a 1B model's context
const MAX_CHARS = 1600; // hard flush point
const MIN_KEEP_CHARS = 120; // shorter fragments (headers, page furniture) carry no signal
const PAGE_FLUSH_MIN = 400; // at a page end, a buffer this full flushes rather than absorbing the next page's topic

/**
 * @param {{num: number, text: string}[]} pages
 * @returns {{text: string, pageStart: number, pageEnd: number}[]}
 */
export function chunkPages(pages) {
  const chunks = [];
  let buf = [];
  let bufChars = 0;
  let pageStart = null;
  let pageEnd = null;

  const flush = () => {
    const text = normalise(buf.join("\n"));
    if (isSubstantive(text)) {
      chunks.push({ text, pageStart, pageEnd });
    }
    buf = [];
    bufChars = 0;
    pageStart = null;
  };

  for (const page of pages) {
    for (const rawLine of page.text.split("\n")) {
      const line = rawLine.trim();
      const isBlank = line.length === 0;
      if (isBlank && bufChars >= TARGET_CHARS) {
        flush();
        continue;
      }
      if (isBlank) continue;
      if (pageStart === null) pageStart = page.num;
      pageEnd = page.num;
      buf.push(line);
      bufChars += line.length + 1;
      if (bufChars >= MAX_CHARS) flush();
    }
    // Page boundaries are the most reliable topic breaks PDF extraction
    // gives us; mixing topics in one chunk dilutes its embedding.
    if (bufChars >= PAGE_FLUSH_MIN) flush();
  }
  if (bufChars > 0) flush();
  return chunks;
}

/** @param {string} text */
function normalise(text) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // control chars: never trust extracted text
    .replace(/-\n(?=[a-z])/g, "") // re-join words hyphenated across lines
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Rejects chunks that are too short or mostly non-letters (tables of contents,
 * page numbers, figure-label debris common in PDF extraction).
 * @param {string} text
 */
function isSubstantive(text) {
  if (text.length < MIN_KEEP_CHARS) return false;
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  return letters / text.length > 0.6;
}
