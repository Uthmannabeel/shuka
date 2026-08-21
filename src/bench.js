// Inference benchmark on the ADTC constraint target (8GB RAM, integrated
// graphics, CPU-only fallback). Ported from the July QVAC baseline to
// node-llama-cpp; methodology unchanged:
// - One untimed warm-up, then REPETITIONS timed runs per prompt; medians
//   reported (single runs are noisy on a busy desktop).
// - TTFT (prefill) and decode tok/s reported separately: lumping prefill
//   into throughput penalises long prompts, which is exactly what RAG
//   context produces. A RAG-length prompt is benchmarked explicitly.
// - Peak RAM is sampled over the whole process TREE (WorkingSetSize
//   double-counts shared pages, so treat as an upper bound).
// - Records appended to bench-results/ as JSON with machine context.
//
// Usage: npm run bench            (auto backend: Vulkan if available)
//        SHUKA_GPU=off npm run bench   (CPU-only worst case)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { loadLLM } from "./lib/llm.js";
import { RAW_SYSTEM_PROMPT } from "./lib/prompts.js";

const REPETITIONS = 3;
const RSS_SAMPLE_MS = 500;

const SHORT_PROMPTS = [
  "My maize leaves in Kaduna are showing yellow streaks and stunted growth three weeks after planting. What is the likely cause and what should I do?",
  "Give a planting calendar for cassava in south-west Nigeria, including land preparation, planting, weeding, and harvest windows.",
  "How much NPK 15-15-15 fertiliser should I apply per hectare for rice, and when should I split the applications?",
];
// Simulates a grounded prompt: ~4 retrieved chunks of context ahead of the question
const RAG_LENGTH_PROMPT =
  "CONTEXT:\n" +
  "Maize is a staple crop across West Africa grown by smallholder farmers under rainfed conditions. ".repeat(55) +
  "\n\nQUESTION: In one sentence, why is early planting recommended for maize?";

const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Samples WorkingSetSize summed over this process and all descendants via a
// single long-lived PowerShell child. (Windows dev machine; on the Linux
// evaluation target the profiler does its own memory accounting.)
function startTreeRssSampler(rootPid) {
  const script = `
$root = ${rootPid}
while ($true) {
  try {
    $procs = Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, WorkingSetSize
    $children = @{}; $byId = @{}
    foreach ($p in $procs) {
      $ppid = [int]$p.ParentProcessId
      if (-not $children.ContainsKey($ppid)) { $children[$ppid] = @() }
      $children[$ppid] += $p
      $byId[[int]$p.ProcessId] = $p
    }
    $sum = [long]0; $visited = @{}
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($root)
    while ($queue.Count -gt 0) {
      $cur = [int]$queue.Dequeue()
      if ($visited.ContainsKey($cur)) { continue }
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

const treeSampler = startTreeRssSampler(process.pid);
const backend = process.env.SHUKA_GPU === "off" ? "cpu" : "auto";

console.log(`[bench] loading model (backend: ${backend})...`);
const loadStart = Date.now();
const llm = await loadLLM();
const loadSecs = (Date.now() - loadStart) / 1000;
console.log(`[bench] model loaded in ${loadSecs.toFixed(1)}s`);

const promptResults = [];
let ragPrompt = null;

try {
  console.log("[bench] warm-up (untimed)...");
  await llm.ask({ systemPrompt: RAW_SYSTEM_PROMPT, userPrompt: "In one sentence, what does an agricultural extension worker do?", maxTokens: 64 });

  for (const [i, prompt] of SHORT_PROMPTS.entries()) {
    console.log(`[bench] prompt ${i + 1}/${SHORT_PROMPTS.length}: ${prompt.slice(0, 60)}...`);
    const runs = [];
    for (let rep = 0; rep < REPETITIONS; rep++) {
      const r = await llm.ask({ systemPrompt: RAW_SYSTEM_PROMPT, userPrompt: prompt });
      const decodeTokPerSec = r.decodeSecs > 0 && r.tokens > 1 ? (r.tokens - 1) / r.decodeSecs : null;
      runs.push({ tokens: r.tokens, ttftMs: r.ttftMs, decodeSecs: r.decodeSecs, decodeTokPerSec });
      console.log(`[bench]   rep ${rep + 1}: ${r.tokens} tok, ttft ${r.ttftMs}ms, ${decodeTokPerSec?.toFixed(1) ?? "n/a"} tok/s`);
    }
    promptResults.push({
      prompt,
      runs,
      medianDecodeTokPerSec: median(runs.map((r) => r.decodeTokPerSec).filter((x) => x !== null)),
      medianTtftMs: median(runs.map((r) => r.ttftMs).filter((x) => x !== null)),
    });
  }

  console.log("[bench] RAG-length prompt (~1300 tokens of context)...");
  const ragRuns = [];
  for (let rep = 0; rep < REPETITIONS; rep++) {
    const r = await llm.ask({ systemPrompt: RAW_SYSTEM_PROMPT, userPrompt: RAG_LENGTH_PROMPT, maxTokens: 64 });
    ragRuns.push({ ttftMs: r.ttftMs });
    console.log(`[bench]   rep ${rep + 1}: ttft ${r.ttftMs}ms`);
  }
  ragPrompt = { medianTtftMs: median(ragRuns.map((r) => r.ttftMs).filter((x) => x !== null)) };
} finally {
  await llm.unload();
  treeSampler.stop();
}

const allRuns = promptResults.flatMap((p) => p.runs);
const totalTokens = allRuns.reduce((s, r) => s + r.tokens, 0);
const totalDecodeSecs = allRuns.reduce((s, r) => s + r.decodeSecs, 0);
const aggregate = {
  decodeTokPerSec: totalDecodeSecs > 0 ? (totalTokens - allRuns.length) / totalDecodeSecs : null,
  peakTreeRssMB: mb(treeSampler.peak()),
};

console.log(`\n[bench] ===== summary (medians over ${REPETITIONS} reps, backend ${backend}) =====`);
for (const [i, p] of promptResults.entries()) {
  console.log(`[bench] prompt ${i + 1}: decode ${p.medianDecodeTokPerSec.toFixed(1)} tok/s, ttft ${p.medianTtftMs.toFixed(0)}ms`);
}
console.log(`[bench] RAG-length prompt median ttft: ${ragPrompt.medianTtftMs.toFixed(0)}ms`);
console.log(`[bench] aggregate decode: ${aggregate.decodeTokPerSec?.toFixed(1) ?? "n/a"} tok/s`);
console.log(`[bench] peak process-tree RSS (upper bound): ${aggregate.peakTreeRssMB} MB`);

const record = {
  timestamp: new Date().toISOString(),
  model: "Llama-3.2-1B-Instruct-Q4_K_M",
  runtime: "node-llama-cpp (llama.cpp)",
  backend,
  repetitions: REPETITIONS,
  machine: {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    totalMemMB: mb(os.totalmem()),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  },
  loadSecs,
  prompts: promptResults,
  ragPrompt,
  aggregate,
};
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "bench-results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `bench-${record.timestamp.replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(record, null, 2));
console.log(`[bench] results written to ${outFile}`);
