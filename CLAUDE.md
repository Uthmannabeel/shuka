# ADTC 2026 — Africa Deep Tech Challenge entry

Entry for the Africa Deep Tech Challenge 2026 (https://adtc-2026.devpost.com/):
"Build On-Device AI for the Hardware Africa Actually Has."

## Hard constraints (from contest rules — never violate)

- The application must run **entirely on-device** on the ADTC Standard Laptop:
  **8GB RAM, integrated graphics, Intel i5 / AMD Ryzen 5**. No cloud inference,
  no API calls to hosted LLMs at runtime.
- End-to-end language-model application in ONE domain (to be chosen):
  Math & Scientific Reasoning, Healthcare & Medical, Agriculture,
  Creative Writing, Coding Assistants, Corporate/Enterprise, or Autonomous AI Agents.
- Repo must be **open source** with a comprehensive project report,
  performance benchmarks, and documentation.
- Demo video: max 2 minutes.
- Team: 1–3 people. Entry must be ideation/early-PoC stage (no revenue, <12-month-old
  venture, <$25k raised).

## Timeline

- **Aug 24, 2026 11:45pm PDT** — Gate 1: proposal + prototype due
- Sep 8 — semifinalists (~20 teams) announced
- Sep 22 — semifinalist submissions due
- Sep 29 — finalists (up to 10) announced
- Oct 17 — live defense + awards

## Engineering implications

- Model budget: quantized small models (≈1–4B params, GGUF/ONNX, 4-bit) so the
  whole app fits in 8GB RAM alongside the OS. Benchmark on CPU-only inference.
- Every feature must be justified against the memory/latency budget; measure
  tokens/sec and peak RSS as first-class metrics from day one.
- Prior art we own: QVAC on-device AI spike from the Terrace project (~/qvac-spike).

## Submission contract (verified 2026-08-21 from Devpost + template repo)

- Repo must follow https://github.com/Africa-Deep-Tech-Foundation/adtc-2026-submission-template:
  `metadata.json` + `download_model.sh` + `REPORT.md` (1-3 pages) + `model/*.gguf`
  (downloaded, never committed). All present in this repo.
- Scoring: **50% accuracy, 30% throughput (normalized vs 15 tok/s), 20% efficiency
  (peak RAM vs 7GB)**, −10 thermal penalty, +10 African-use-case bonus.
- We submit 2 `test_prompts` in metadata.json; judges add 2 hidden prompts.
  Official numbers come from the pip-installable ADTC profiler (open source,
  runs llama.cpp on the GGUF at `_runtime.model_path`) — run it before submitting.
- "Zero external network dependencies during the testing window": `npm run setup`
  pre-caches the embedding model; after it, nothing touches the network.

## Status (2026-08-21)

- Working codename: **Shuka** (Hausa: to plant/sow); concept in `docs/concept.md`
- **Stack switched from @qvac/sdk to node-llama-cpp** (matches the profiler's
  llama.cpp runtime; single GGUF at `model/` shared by app and profiler).
  Model: Llama 3.2 1B Instruct **Q4_K_M**.
- **Backend finding (this machine, i5-1245U):** CPU-only decode is ~5.7 tok/s
  with terrible prefill (~85s for a 1400-token RAG prompt) — the 2P+8E hybrid
  cores starve llama.cpp. The **Vulkan backend on the integrated GPU does
  15.3 tok/s decode and 3.1s prefill** on the same prompt; `llm.js` defaults
  to auto (Vulkan→CPU), `SHUKA_GPU=off` forces CPU for worst-case benchmarks.
  Report both; integrated graphics is within the ADTC target spec.
- RAG pipeline live end-to-end: `ingest → index.json (1308 chunks / 8 verified
  docs / ~850pp) → retrieve (cosine, floor 0.35) → grounded generation with
  page-level citations + refusal guardrail`. Corpus licenses in `corpus/SOURCES.md`
  (unverified-license docs stay in `corpus/raw/unverified/`, never indexed).
- Eval harness: 30 questions × raw vs grounded (`npm run eval`), rubric in
  `eval/RUBRIC.md`. Grade vs corpus text; headline = dangerous-answer count.
- Raw 1B model hallucinates dangerous agronomy (cassava from seeds, wrong
  fertiliser math) → never free-associate dosages; the similarity-floor refusal
  is a feature, not a bug.
- ECC installed via `--target claude-project` (modules: rules-core, agents-core,
  commands-core, platform-configs, framework-language, workflow-quality)
