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

## Status

- Domain/track: **Agriculture** — offline agronomy assistant for farmers/extension
  workers (chosen 2026-07-09; targets Best African Use Case prize as well)
- Working codename: **Shuka** (Hausa: to plant/sow); concept + Gate 1 plan in
  `docs/concept.md`
- Baseline benchmark (2026-07-15, `npm run bench`, medians over 3 reps,
  warm cache): Llama 3.2 1B Q4_0 via @qvac/sdk — 13.5 tok/s aggregate decode,
  TTFT ~340ms, load 45.9s, **peak process-tree RSS 1.9GB** (model lives in a
  QVAC worker; main process alone shows only ~200MB — never quote that).
  Raw model hallucinates dangerous agronomy (cassava from seeds, shading
  maize) → all answers MUST be RAG-grounded with citations; never
  free-associate dosages. Full records in `bench-results/`.
- ECC installed via `--target claude-project` (modules: rules-core, agents-core,
  commands-core, platform-configs, framework-language, workflow-quality)
