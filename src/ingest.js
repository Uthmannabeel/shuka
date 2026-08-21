// Corpus ingestion: corpus/raw/*.pdf|txt|md -> corpus/index.json
// (chunks with page-level provenance + unit-normalised embeddings).
// Run once at build time; the resulting index ships with the app so
// retrieval needs no network at runtime.
//
// Usage: npm run ingest

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
import { chunkPages } from "./lib/chunk.js";
import { embedTexts, EMBED_MODEL, EMBED_DIMS } from "./lib/embedder.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "corpus", "raw");
const INDEX_FILE = join(ROOT, "corpus", "index.json");
const EMBED_LOG_EVERY = 200;

/** @param {string} filePath @returns {Promise<{num: number, text: string}[]>} */
async function extractPages(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(readFileSync(filePath)) });
    try {
      const result = await parser.getText();
      return result.pages.map((p) => ({ num: p.num, text: p.text }));
    } finally {
      await parser.destroy();
    }
  }
  // Plain text/markdown: treat the whole file as page 1
  return [{ num: 1, text: readFileSync(filePath, "utf8") }];
}

const files = existsSync(RAW_DIR)
  ? readdirSync(RAW_DIR).filter((f) => [".pdf", ".txt", ".md"].includes(extname(f).toLowerCase()))
  : [];
if (files.length === 0) {
  console.error(`[ingest] no corpus documents found in ${RAW_DIR}`);
  console.error("[ingest] add PDF/txt/md extension documents there first (see corpus/SOURCES.md)");
  process.exit(1);
}

const allChunks = [];
for (const file of files) {
  const path = join(RAW_DIR, file);
  try {
    const pages = await extractPages(path);
    const chunks = chunkPages(pages);
    for (const c of chunks) allChunks.push({ ...c, source: file });
    console.log(`[ingest] ${file}: ${pages.length} pages -> ${chunks.length} chunks`);
  } catch (err) {
    // One corrupt PDF must not sink the whole corpus build
    console.error(`[ingest] FAILED ${file}: ${err instanceof Error ? err.message : err}`);
  }
}

if (allChunks.length === 0) {
  console.error("[ingest] extraction produced no chunks — aborting");
  process.exit(1);
}

console.log(`[ingest] embedding ${allChunks.length} chunks with ${EMBED_MODEL}...`);
const t0 = Date.now();
const texts = allChunks.map((c) => c.text);
const vectors = [];
for (let i = 0; i < texts.length; i += EMBED_LOG_EVERY) {
  const batch = texts.slice(i, i + EMBED_LOG_EVERY);
  vectors.push(...(await embedTexts(batch)));
  console.log(`[ingest]   ${Math.min(i + EMBED_LOG_EVERY, texts.length)}/${texts.length}`);
}
const embedSecs = (Date.now() - t0) / 1000;

const index = {
  model: EMBED_MODEL,
  dims: EMBED_DIMS,
  createdAt: new Date().toISOString(),
  chunks: allChunks.map((c, i) => ({
    id: i,
    source: c.source,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    text: c.text,
    // base64-encoded Float32Array: ~3x smaller than JSON number arrays
    vector: Buffer.from(vectors[i].buffer, vectors[i].byteOffset, vectors[i].byteLength).toString("base64"),
  })),
};
writeFileSync(INDEX_FILE, JSON.stringify(index));

const sizeMB = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(1);
console.log(
  `[ingest] wrote ${allChunks.length} chunks from ${files.length} documents ` +
    `to ${basename(INDEX_FILE)} (${sizeMB} MB) in ${embedSecs.toFixed(1)}s embedding time`
);
