// Baseline inference benchmark for the ADTC constraint target
// (8GB RAM, integrated graphics, CPU-only). Measures model load time,
// tokens/sec, and this process's peak RSS while generating.
//
// Peak RSS is sampled in-process; if the QVAC runtime spawns worker
// processes their memory is not counted here — treat results as a
// lower bound and cross-check with Task Manager for the full picture.

import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from "@qvac/sdk";

const PROMPTS = [
  "My maize leaves in Kaduna are showing yellow streaks and stunted growth three weeks after planting. What is the likely cause and what should I do?",
  "Give a planting calendar for cassava in south-west Nigeria, including land preparation, planting, weeding, and harvest windows.",
  "How much NPK 15-15-15 fertiliser should I apply per hectare for rice, and when should I split the applications?",
];

let peakRss = process.memoryUsage().rss;
const rssTimer = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
}, 200);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);

console.log("[bench] loading Llama 3.2 1B Instruct Q4_0 (downloads on first run)...");
const loadStart = Date.now();
const modelId = await loadModel({ modelSrc: LLAMA_3_2_1B_INST_Q4_0 });
console.log(`[bench] model loaded in ${((Date.now() - loadStart) / 1000).toFixed(1)}s`);

const results = [];
for (const [i, prompt] of PROMPTS.entries()) {
  console.log(`\n[bench] prompt ${i + 1}/${PROMPTS.length}: ${prompt.slice(0, 60)}...`);
  const history = [
    {
      role: "system",
      content:
        "You are an agricultural extension assistant for smallholder farmers in Nigeria. Give practical, concise advice.",
    },
    { role: "user", content: prompt },
  ];
  const result = completion({ modelId, history, stream: true });
  const genStart = Date.now();
  let tokens = 0;
  let firstTokenMs = null;
  for await (const token of result.tokenStream) {
    if (firstTokenMs === null) firstTokenMs = Date.now() - genStart;
    process.stdout.write(token);
    tokens += 1;
  }
  const secs = (Date.now() - genStart) / 1000;
  results.push({ prompt: i + 1, tokens, secs, tokPerSec: tokens / secs, firstTokenMs });
  console.log(
    `\n[bench] ${tokens} tokens in ${secs.toFixed(1)}s — ${(tokens / secs).toFixed(1)} tok/s, first token ${firstTokenMs}ms`
  );
}

await unloadModel({ modelId });
clearInterval(rssTimer);

console.log("\n[bench] ===== summary =====");
for (const r of results) {
  console.log(
    `[bench] prompt ${r.prompt}: ${r.tokPerSec.toFixed(1)} tok/s, first token ${r.firstTokenMs}ms, ${r.tokens} tokens`
  );
}
const avg = results.reduce((s, r) => s + r.tokPerSec, 0) / results.length;
console.log(`[bench] avg throughput: ${avg.toFixed(1)} tok/s`);
console.log(`[bench] peak RSS (this process): ${mb(peakRss)} MB`);
