// Baseline inference benchmark for the ADTC constraint target
// (8GB RAM, integrated graphics, CPU-only).
//
// Methodology:
// - One untimed warm-up generation, then REPETITIONS timed runs per prompt;
//   medians reported (single runs are noisy on a busy desktop).
// - Time-to-first-token (prefill) and decode tokens/sec are reported
//   separately: lumping prefill into throughput penalises long prompts,
//   which is exactly what RAG context will produce.
// - The stream yields chunks; chunk==token is an SDK assumption we cannot
//   verify here, so chars/sec is reported alongside as a unit-independent
//   cross-check.
// - Peak RAM is sampled over the whole process TREE (the QVAC runtime holds
//   the model in a worker process — the main process's RSS alone was
//   observed at ~227MB with a ~700MB model resident). WorkingSetSize
//   double-counts shared pages across processes, so treat it as an upper
//   bound. The main process is also sampled for comparison.
// - Results are appended to bench-results/ as JSON with machine context,
//   since dev hardware is not the 8GB target spec.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from "@qvac/sdk";

const REPETITIONS = 3;
const PROMPT_TIMEOUT_MS = 180_000; // a stalled stream fails the run instead of hanging the bench
const RSS_SAMPLE_MS = 500; // tree scan is heavyweight; may miss spikes shorter than this
const MODEL_NAME = "LLAMA_3_2_1B_INST_Q4_0";
// Strips terminal control/escape chars (keeps \t \n \r) — RAG will eventually
// feed third-party document text into generations; never trust it with the terminal.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const PROMPTS = [
  "My maize leaves in Kaduna are showing yellow streaks and stunted growth three weeks after planting. What is the likely cause and what should I do?",
  "Give a planting calendar for cassava in south-west Nigeria, including land preparation, planting, weeding, and harvest windows.",
  "How much NPK 15-15-15 fertiliser should I apply per hectare for rice, and when should I split the applications?",
];

const SYSTEM_PROMPT =
  "You are an agricultural extension assistant for smallholder farmers in Nigeria. Give practical, concise advice.";

const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Samples WorkingSetSize summed over this process and all descendants via a
// single long-lived PowerShell child (spawning one per sample would dominate
// the cost). Emits one total-bytes line per interval.
function startTreeRssSampler(rootPid) {
  const script = `
$root = ${rootPid}
while ($true) {
  try {
    $procs = Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, WorkingSetSize
    $children = @{}
    $byId = @{}
    foreach ($p in $procs) {
      $ppid = [int]$p.ParentProcessId
      if (-not $children.ContainsKey($ppid)) { $children[$ppid] = @() }
      $children[$ppid] += $p
      $byId[[int]$p.ProcessId] = $p
    }
    $sum = [long]0
    $visited = @{}
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($root)
    while ($queue.Count -gt 0) {
      $cur = [int]$queue.Dequeue()
      if ($visited.ContainsKey($cur)) { continue } # PID reuse can create cycles
      $visited[$cur] = $true
      if ($byId.ContainsKey($cur)) { $sum += [long]$byId[$cur].WorkingSetSize }
      if ($children.ContainsKey($cur)) { foreach ($c in $children[$cur]) { $queue.Enqueue([int]$c.ProcessId) } }
    }
    [Console]::Out.WriteLine($sum)
  } catch {}
  Start-Sleep -Milliseconds ${RSS_SAMPLE_MS}
}`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let peak = 0;
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const n = Number(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
      if (Number.isFinite(n) && n > peak) peak = n;
    }
  });
  return { peak: () => peak, stop: () => child.kill() };
}

async function runGeneration(modelId, userPrompt, { echo }) {
  const history = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
  const genStart = Date.now();
  const result = completion({ modelId, history, stream: true });

  let chunks = 0;
  let chars = 0;
  let firstTokenAt = null;
  const consume = (async () => {
    for await (const token of result.tokenStream) {
      if (firstTokenAt === null) firstTokenAt = Date.now();
      chunks += 1;
      chars += token.length;
      if (echo) process.stdout.write(token.replace(CONTROL_CHARS, ""));
    }
  })();

  // On timeout we abandon the stream (the SDK offers no cancellation);
  // the finally-block unload below tears the worker down regardless.
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`generation timed out after ${PROMPT_TIMEOUT_MS}ms`)),
      PROMPT_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([consume, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }

  const endAt = Date.now();
  const ttftMs = firstTokenAt === null ? null : firstTokenAt - genStart;
  const decodeSecs = firstTokenAt === null ? 0 : (endAt - firstTokenAt) / 1000;
  return {
    chunks,
    chars,
    ttftMs,
    totalSecs: (endAt - genStart) / 1000,
    decodeSecs,
    // first chunk marks decode start, so rate is over the remaining chunks
    decodeTokPerSec: decodeSecs > 0 && chunks > 1 ? (chunks - 1) / decodeSecs : null,
    charsPerSec: decodeSecs > 0 ? chars / decodeSecs : null,
  };
}

// --- main ---

let mainPeakRss = process.memoryUsage().rss;
const mainRssTimer = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > mainPeakRss) mainPeakRss = rss;
}, RSS_SAMPLE_MS);
const treeSampler = startTreeRssSampler(process.pid);

// Heuristic: the QVAC cache dir existing suggests (not proves) a warm model
// cache, so load time can be labelled cold/warm in the persisted record.
const cacheDirExisted = existsSync(join(os.homedir(), ".qvac"));

let modelId = null;
const promptResults = [];
let loadSecs = null;

try {
  console.log(`[bench] loading ${MODEL_NAME} (downloads on first run; cache dir existed: ${cacheDirExisted})...`);
  const loadStart = Date.now();
  modelId = await loadModel({ modelSrc: LLAMA_3_2_1B_INST_Q4_0 });
  loadSecs = (Date.now() - loadStart) / 1000;
  console.log(`[bench] model loaded in ${loadSecs.toFixed(1)}s`);

  console.log("[bench] warm-up run (untimed)...");
  await runGeneration(modelId, "In one sentence, what does an agricultural extension worker do?", { echo: false });

  for (const [i, prompt] of PROMPTS.entries()) {
    console.log(`\n[bench] prompt ${i + 1}/${PROMPTS.length}: ${prompt.slice(0, 60)}...`);
    const runs = [];
    for (let rep = 0; rep < REPETITIONS; rep++) {
      const echo = rep === 0; // echo once per prompt so answer quality stays inspectable
      const run = await runGeneration(modelId, prompt, { echo });
      if (echo) process.stdout.write("\n");
      runs.push(run);
      console.log(
        `[bench]   rep ${rep + 1}/${REPETITIONS}: ${run.chunks} chunks, ` +
          `ttft ${run.ttftMs}ms, decode ${run.decodeTokPerSec?.toFixed(1) ?? "n/a"} tok/s, ` +
          `${run.charsPerSec?.toFixed(0) ?? "n/a"} chars/s`
      );
    }
    promptResults.push({
      prompt,
      runs,
      medianDecodeTokPerSec: median(runs.map((r) => r.decodeTokPerSec).filter((x) => x !== null)),
      medianTtftMs: median(runs.map((r) => r.ttftMs).filter((x) => x !== null)),
      medianCharsPerSec: median(runs.map((r) => r.charsPerSec).filter((x) => x !== null)),
    });
  }
} finally {
  if (modelId !== null) await unloadModel({ modelId });
  clearInterval(mainRssTimer);
  treeSampler.stop();
}

const allRuns = promptResults.flatMap((p) => p.runs);
const totalChunks = allRuns.reduce((s, r) => s + r.chunks, 0);
const totalDecodeSecs = allRuns.reduce((s, r) => s + r.decodeSecs, 0);
const aggregate = {
  // total/total, not average-of-ratios, so long generations weigh in proportionally
  decodeTokPerSec: totalDecodeSecs > 0 ? (totalChunks - allRuns.length) / totalDecodeSecs : null,
  peakTreeRssMB: mb(treeSampler.peak()),
  peakMainRssMB: mb(mainPeakRss),
};

console.log("\n[bench] ===== summary (medians over " + REPETITIONS + " reps) =====");
for (const [i, p] of promptResults.entries()) {
  console.log(
    `[bench] prompt ${i + 1}: decode ${p.medianDecodeTokPerSec.toFixed(1)} tok/s, ` +
      `ttft ${p.medianTtftMs.toFixed(0)}ms, ${p.medianCharsPerSec.toFixed(0)} chars/s`
  );
}
console.log(`[bench] aggregate decode throughput: ${aggregate.decodeTokPerSec?.toFixed(1) ?? "n/a"} tok/s`);
console.log(`[bench] peak RSS, process tree (includes model worker; upper bound): ${aggregate.peakTreeRssMB} MB`);
console.log(`[bench] peak RSS, main process only (EXCLUDES model worker): ${aggregate.peakMainRssMB} MB`);

const record = {
  timestamp: new Date().toISOString(),
  model: MODEL_NAME,
  runtime: "@qvac/sdk",
  repetitions: REPETITIONS,
  machine: {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    totalMemMB: mb(os.totalmem()),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  },
  modelCacheDirExisted: cacheDirExisted,
  loadSecs,
  prompts: promptResults,
  aggregate,
};
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "bench-results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `bench-${record.timestamp.replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(record, null, 2));
console.log(`[bench] results written to ${outFile}`);
