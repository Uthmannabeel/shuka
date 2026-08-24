// Local web UI for Shuka: a plain Node HTTP server, no framework, serving
// the static app from web/ and one SSE endpoint. Model and index load once
// at startup; generations are queued so a single model context is never
// asked to serve two prompts at once (one laptop, one answer at a time —
// that is the deployment model).
//
// Usage: npm run serve   (http://localhost:4180)
//   SHUKA_HOST=0.0.0.0 serves other devices on the cooperative's own
//   hotspot. That mode is for TRUSTED networks only: there is no user
//   authentication — protection is the per-IP rate limit, the bounded
//   queue, and the network's own boundary.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLLM } from "./lib/llm.js";
import { loadIndex, retrieve } from "./lib/retrieve.js";
import { GROUNDED_SYSTEM_PROMPT, buildGroundedUserPrompt, gateHits, TOP_K, REFUSAL_MESSAGE } from "./lib/prompts.js";

const PORT = Number(process.env.PORT) || 4180;
const HOST = process.env.SHUKA_HOST || "127.0.0.1";
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const MAX_QUESTION_CHARS = 500;
const MAX_QUEUE = 4; // beyond this, answer "busy" instead of stacking work
const RATE_LIMIT = { windowMs: 60_000, maxAsks: 10 }; // per client IP
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'",
};

console.log("[serve] loading index and model (one-time)...");
const index = loadIndex();
let llm = await loadLLM();
const corpusDocs = new Set(index.chunks.map((c) => c.source)).size;
console.log(`[serve] ready: ${index.chunks.length} passages from ${corpusDocs} documents`);
if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  console.log("[serve] WARNING: serving beyond this machine. Community mode has no");
  console.log("[serve] user accounts — run it only on a network you trust (e.g. the");
  console.log("[serve] cooperative's own hotspot), never on a public or unknown network.");
}

// One generation at a time; later requests wait their turn, up to MAX_QUEUE.
let generationQueue = Promise.resolve();
let queued = 0;
let consecutiveFailures = 0;

// Fail loudly rather than limping: a supervisor (or the operator re-running
// `npm run serve`) restarts from a clean state.
process.on("uncaughtException", (err) => {
  console.error("[serve] fatal:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[serve] fatal (rejection):", err);
  process.exit(1);
});

const rateBuckets = new Map(); // ip -> { count, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT.maxAsks;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(ip);
}, RATE_LIMIT.windowMs).unref();

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

async function recoverModel() {
  console.error("[serve] generation failed twice — reloading the model...");
  try { await llm.unload(); } catch {}
  llm = await loadLLM();
  consecutiveFailures = 0;
  console.error("[serve] model reloaded");
}

async function handleAsk(req, res, ip) {
  if (rateLimited(ip)) { json(res, 429, { error: "Too many questions at once from this device. Wait a minute and try again." }); return; }
  if (queued >= MAX_QUEUE) { json(res, 429, { error: "Shuka is answering other questions right now. Try again in a moment." }); return; }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) { res.writeHead(413).end(); return; }
  }
  let question;
  try {
    question = String(JSON.parse(body).question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  } catch {
    json(res, 400, { error: 'body must be JSON: {"question": "..."}' });
    return;
  }
  if (!question) { json(res, 400, { error: "question is empty" }); return; }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...SECURITY_HEADERS,
  });

  const run = async () => {
    const t0 = Date.now();
    const gate = gateHits(await retrieve(index, question, TOP_K));
    const retrievalMs = Date.now() - t0;

    if (!gate.answerable) {
      sse(res, "refused", { message: REFUSAL_MESSAGE, retrievalMs });
      res.end();
      return;
    }
    const hits = gate.kept;

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
    consecutiveFailures = 0;
    const tokPerSec =
      result.decodeSecs > 0 && result.tokens > 1 ? Number(((result.tokens - 1) / result.decodeSecs).toFixed(1)) : null;
    sse(res, "done", { ttftMs: result.ttftMs, tokPerSec, tokens: result.tokens });
    res.end();
  };

  queued += 1;
  generationQueue = generationQueue
    .then(run)
    .catch(async (err) => {
      console.error("[serve] generation failed:", err instanceof Error ? err.message : err);
      consecutiveFailures += 1;
      try {
        sse(res, "error", { message: "Something went wrong while answering. Try again." });
        res.end();
      } catch {} // client may have disconnected
      if (consecutiveFailures >= 2) await recoverModel().catch((e) => { throw e; });
    })
    .finally(() => { queued -= 1; });
  await generationQueue;
}

async function handleStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const path = normalize(join(WEB_DIR, rel));
  if (!path.startsWith(WEB_DIR)) { res.writeHead(403, SECURITY_HEADERS).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain", ...SECURITY_HEADERS });
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress ?? "unknown";
  if (req.method === "POST" && url.pathname === "/api/ask") return handleAsk(req, res, ip);
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, { passages: index.chunks.length, documents: corpusDocs, model: "Llama 3.2 1B Q4_K_M" });
  }
  if (req.method === "GET") return handleStatic(res, url.pathname);
  res.writeHead(405, SECURITY_HEADERS).end();
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] Shuka is at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
