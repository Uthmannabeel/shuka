// Local web UI for Shuka: a plain Node HTTP server, no framework, serving
// the static app from web/ and one SSE endpoint. Model and index load once
// at startup; generations are queued so a single model context is never
// asked to serve two prompts at once (one laptop, one answer at a time —
// that is the deployment model).
//
// Usage: npm run serve   (http://localhost:4180)
//   SHUKA_HOST=0.0.0.0 to serve other devices on the cooperative's LAN.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLLM } from "./lib/llm.js";
import { loadIndex, retrieve } from "./lib/retrieve.js";
import { GROUNDED_SYSTEM_PROMPT, buildGroundedUserPrompt, SIMILARITY_FLOOR, TOP_K, REFUSAL_MESSAGE } from "./lib/prompts.js";

const PORT = Number(process.env.PORT) || 4180;
const HOST = process.env.SHUKA_HOST || "127.0.0.1";
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const MAX_QUESTION_CHARS = 500;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

console.log("[serve] loading index and model (one-time)...");
const index = loadIndex();
const llm = await loadLLM();
const corpusDocs = new Set(index.chunks.map((c) => c.source)).size;
console.log(`[serve] ready: ${index.chunks.length} passages from ${corpusDocs} documents`);

// One generation at a time; later requests wait their turn.
let generationQueue = Promise.resolve();

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleAsk(req, res) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) { res.writeHead(413).end(); return; }
  }
  let question;
  try {
    question = String(JSON.parse(body).question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "body must be JSON: {\"question\": \"...\"}" }));
    return;
  }
  if (!question) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "question is empty" }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const run = async () => {
    const t0 = Date.now();
    const hits = (await retrieve(index, question, TOP_K)).filter((h) => h.score >= SIMILARITY_FLOOR);
    const retrievalMs = Date.now() - t0;

    if (hits.length === 0) {
      sse(res, "refused", { message: REFUSAL_MESSAGE, retrievalMs });
      res.end();
      return;
    }

    sse(res, "sources", {
      retrievalMs,
      sources: hits.map((h, i) => ({
        n: i + 1,
        doc: h.chunk.source,
        pageStart: h.chunk.pageStart,
        pageEnd: h.chunk.pageEnd,
        score: Number(h.score.toFixed(2)),
        excerpt: h.chunk.text.slice(0, 220),
      })),
    });

    const result = await llm.ask({
      systemPrompt: GROUNDED_SYSTEM_PROMPT,
      userPrompt: buildGroundedUserPrompt(hits, question),
      onTextChunk: (t) => sse(res, "token", { t }),
    });
    const tokPerSec =
      result.decodeSecs > 0 && result.tokens > 1 ? Number(((result.tokens - 1) / result.decodeSecs).toFixed(1)) : null;
    sse(res, "done", { ttftMs: result.ttftMs, tokPerSec, tokens: result.tokens });
    res.end();
  };

  generationQueue = generationQueue.then(run).catch((err) => {
    console.error("[serve] generation failed:", err instanceof Error ? err.message : err);
    try {
      sse(res, "error", { message: "Something went wrong while answering. Try again." });
      res.end();
    } catch {} // client may have disconnected
  });
  await generationQueue;
}

async function handleStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const path = normalize(join(WEB_DIR, rel));
  if (!path.startsWith(WEB_DIR)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "POST" && url.pathname === "/api/ask") return handleAsk(req, res);
  if (req.method === "GET" && url.pathname === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ passages: index.chunks.length, documents: corpusDocs, model: "Llama 3.2 1B Q4_K_M" }));
    return;
  }
  if (req.method === "GET") return handleStatic(res, url.pathname);
  res.writeHead(405).end();
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] Shuka is at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
