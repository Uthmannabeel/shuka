# Concept — Offline Agronomy Assistant (working codename: Shuka)

ADTC 2026 entry, Agriculture track. "Shuka" is Hausa for *to plant/sow* — working
codename, revisit before submission.

## Problem

Nigeria's agricultural extension system is severely under-staffed: one extension
worker serves thousands of farmers, against a commonly recommended ratio of roughly
one per thousand. Smallholders' practical fallback — asking an AI assistant — fails
exactly where farming happens: rural areas with weak or unaffordable connectivity,
on low-end hardware. Cloud LLMs assume bandwidth and payment rails most smallholders
don't have.

## Product

An agronomy assistant that runs **entirely offline** on the hardware African
agri-officers and cooperatives actually own (the ADTC Standard Laptop: 8GB RAM,
integrated graphics, i5-class CPU). Target users: extension workers, agro-dealer
shops, and cooperative offices — the people farmers already ask — rather than
every farmer directly. One offline laptop at a cooperative serves a whole community.

Core interactions:

1. **Diagnose** — describe crop symptoms in plain language, get likely causes and
   treatment steps grounded in extension literature.
2. **Plan** — planting calendars, input schedules, and post-harvest guidance by
   crop and region.
3. **Dose** — fertiliser/agrochemical rates with the arithmetic done explicitly.

Initial scope: 4–6 staple crops for Nigeria (maize, cassava, rice, tomato as the
starting set), English first; Hausa/Yoruba/Pidgin stretch goal for the finals.

## Why retrieval is non-negotiable (baseline finding, 2026-07-09)

Baseline benchmark of raw Llama 3.2 1B Instruct Q4_0 on-device (`src/bench.js`):

- Throughput: **12.2 tok/s average**, first token 328–817ms, model load 41.5s —
  comfortably usable for a chat UI on constrained hardware.
- Quality: **dangerously wrong**. The raw model recommended cucumber/squash pest
  treatments for maize, advised shading maize, described growing cassava from
  seeds (it's grown from stem cuttings) with a ~3-month harvest (reality: 9–18
  months), and produced incoherent fertiliser arithmetic.

Conclusion: the small model supplies *language*; a curated corpus must supply the
*facts*. Every substantive answer must be grounded in retrieved extension
literature, with sources shown. This constraint is also the judging story: honest
benchmarks showing hallucination in the raw model vs grounded accuracy in ours.

## Architecture

```
question ──► on-device embedding model (≈30–100MB, e.g. bge-small / MiniLM)
        ──► local vector index over curated agronomy corpus (sqlite-vec or LanceDB)
        ──► top-k passages + question ──► quantized 1–3B instruct model (GGUF Q4)
        ──► answer constrained to retrieved context, with source citations
```

- **Corpus**: openly licensed extension materials — FAO, IITA, NAERLS and
  state-extension guides — chunked and embedded at build time; ships with the app.
  Licensing of each source must be verified before inclusion.
- **Inference**: @qvac/sdk proven on this machine (baseline above); evaluate
  node-llama-cpp as the alternative for the final stack (open-source posture,
  model flexibility, GGUF ecosystem). Decision by end of July.
- **Guardrails**: no retrieved context above a similarity floor → say so and point
  to the local extension office; never free-associate dosages.
- **Metrics as features**: tokens/sec, first-token latency, peak RAM, and a
  grounded-accuracy eval on a hand-built agronomy Q&A set, tracked from day one
  (contest requires benchmarks in the report).

## Gate 1 plan (due Aug 24)

1. Corpus pipeline: collect + license-check sources for the 4 starter crops,
   chunk, embed, index. **Target: mid-July.**
2. RAG loop wired end-to-end with citations; inference-stack decision
   (QVAC vs node-llama-cpp). **Target: end of July.**
3. Accuracy eval: ~50-question agronomy test set, raw-model vs grounded
   comparison. **Target: early August.**
4. Minimal UI (local web UI or CLI-first), 2-minute demo video, proposal
   write-up. **Target: Aug 15–22, buffer before the Aug 24 gate.**

XPRIZE (Aug 17) and CockroachDB (Aug 18) deadlines land in the same window —
steps 1–3 must be substantially done before mid-August.
