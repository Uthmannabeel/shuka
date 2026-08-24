# Technical Report — Shuka: Offline Agronomy Assistant

**Team ID:** shuka
**Domain:** agriculture
**Model:** Llama-3.2-1B-Instruct-Q4_K_M

---

## Problem

Nigeria's agricultural extension system is severely under-staffed: one
extension worker serves thousands of smallholders, against a commonly
recommended ratio of roughly one per thousand. The obvious modern fallback —
asking an AI assistant — fails exactly where farming happens: rural areas
with weak or unaffordable connectivity, on low-end hardware. Cloud LLMs
assume bandwidth and payment rails most smallholders don't have.

Shuka is an agronomy assistant that runs entirely offline on the ADTC
Standard Laptop. Target users are **extension workers, agro-dealer shops,
and cooperative offices** — the people farmers already ask — so one offline
laptop serves a whole community. It answers crop-diagnosis, planting-calendar,
and input-dosage questions for maize, cassava, rice, and tomato.

## Design Decisions

- **Base model:** Llama 3.2 1B Instruct. Small enough to leave RAM headroom
  for an embedding model and retrieval index on an 8 GB machine, fluent
  enough to compose grounded answers.
- **Quantization:** GGUF Q4_K_M (~0.8 GB) via llama.cpp (node-llama-cpp
  bindings — the same runtime the ADTC profiler uses, so the app and the
  profiler exercise the identical GGUF at `model/`).
- **The load-bearing decision — retrieval is not optional.** Our July
  baseline showed the bare 1B model is a fluent, confident, dangerously
  wrong agronomist: it recommended growing cassava from seeds (it is grown
  from stem cuttings), advised shading maize, and invented fertiliser
  arithmetic. So every answer is grounded in a curated, license-verified
  corpus of real extension literature (FAO, IITA, CABI/ASHC, IRRI — 8
  documents, ~850 pages, provenance in `corpus/SOURCES.md`): the model
  supplies *language*, the corpus supplies *facts*. Answers cite sources at
  page level. If no retrieved passage clears a similarity floor, the model
  is **not called at all** — Shuka says it lacks sources and refers the
  farmer to the local extension office. Silence beats confident error when
  the cost of being wrong is somebody's growing season.
- **Retrieval stack, all on-device:** MiniLM-L6-v2 (384-d, quantized ONNX,
  ~25 MB) for embeddings; exact brute-force cosine over the 1,308-chunk
  index (single-digit milliseconds at this scale — a vector database would
  add RAM and complexity for nothing).
- **Alternatives considered:** the QVAC SDK (our July baseline runtime) was
  dropped for llama.cpp alignment with the profiler and a lighter install;
  fine-tuning the 1B model on agronomy text was rejected because it cannot
  provide citations or refuse out-of-scope questions — grounding gives both.

## Constraints

- Target: 8 GB RAM, integrated graphics, i5-class CPU; zero network after a
  one-time setup (`npm run setup` pre-caches the embedding model; the GGUF
  arrives via `download_model.sh`).
- **Hybrid-core CPUs are a real hazard for CPU-only inference.** On our
  i5-1245U dev machine (2 P-cores + 8 E-cores), llama.cpp CPU decode
  managed only 3–6 tok/s and prefill of a RAG-length prompt (~1,300
  tokens) took 85–121 s — E-core stragglers starve the P-cores. The
  **Vulkan backend on the integrated GPU** (within the ADTC spec) fixes
  this: same prompt prefills in under 4 s. The app defaults to Vulkan-with-CPU-fallback;
  `SHUKA_GPU=off` forces CPU for worst-case measurement.
- RAG makes prompts long by design (top-4 passages ≈ 1,200–1,500 tokens),
  so we report prefill (TTFT) separately from decode throughput — lumping
  them flatters short prompts and hides exactly the cost RAG adds.
- Data constraint: openly licensed extension literature is uneven. Maize,
  cassava and rice are well covered; Africa-specific openly-licensed tomato
  *production* guides essentially don't exist (documented in
  `corpus/SOURCES.md`). Authoritative Nigerian NAERLS bulletins carry no
  license statement, so they are excluded from the index until cleared.

## Demonstration

The application is a local web app (`npm run serve`) styled as an
extension-service answer sheet: streamed answers cite sources inline, the
margin lists each cited document with page numbers and match scores, and
every sheet is stamped — `GROUNDED · N SOURCES`, or `NOT IN SOURCES` when
the corpus doesn't cover the question and the model is never invoked.
Screenshots: `docs/screenshots/` (desktop answer, refusal, and mobile).
A CLI (`npm run ask`) exposes the same pipeline.

![Answer sheet with cited sources](docs/screenshots/ui-answer.png)

## Benchmarks

Self-reported development numbers on the machine below; official scores
come from the ADTC profiler on the standard evaluation machine.

| Metric | Vulkan (iGPU), medians of 3 | CPU-only, single run |
|---|---|---|
| Machine | i5-1245U (2P+8E), 16 GB RAM, Intel UHD iGPU, Windows 11 | same |
| Aggregate decode speed | **14.4 t/s** | 3.0 t/s |
| TTFT, short prompt | 0.3–0.5 s | 8–10 s |
| TTFT, RAG-length prompt (~1,300 tok) | **3.7 s** | 121 s |
| Model load | 12.6 s | 7.5 s |
| Peak RAM (process tree, upper bound) | **2.28 GB** | 1.70 GB |
| Thermal throttling | none observed | none observed |

The ADTC profiler itself (llama-bench, arch-optimized CPU build) measures
**19.2 t/s generation, 1.37 s first-token latency on a 512-token prompt,
peak RSS 1.39 GB, no thermal throttling, arc_easy acc_norm 0.64** on this
machine (full run in `submission.json`) — the CPU column above reflects
node-llama-cpp's generic prebuilt kernels, which is why the app prefers
the Vulkan backend.

Raw records in `bench-results/`. July QVAC/Q4_0 baseline for comparison
(same machine, CPU): 13.5 t/s decode, TTFT ~340 ms on short prompts, peak
tree RSS 1.9 GB. The dev machine runs a heavy desktop load (~13 GB in
use); numbers on a clean 8 GB target should not be worse, and peak RSS
leaves >5.5 GB of headroom against the 7 GB efficiency limit.

**Accuracy eval (raw vs grounded):** 30 questions across the four crops
plus deliberate out-of-scope traps, each answered by the bare model and by
the full pipeline, graded against the corpus text (rubric:
`eval/RUBRIC.md`; transcript and per-question grades: `eval/results/`).

| 30 questions | correct | partial | wrong | dangerous |
|---|---|---|---|---|
| Raw Llama 3.2 1B | 0 | 9 | 12 | **9** |
| Grounded (Shuka) | **17** | 10 | 3 | **0** |

The raw model told farmers to plant 30 maize seeds per hole, harvest
cassava at 4–5 months, spray fungicides on striga (a parasitic plant), and
apply 2,4-D around cassava. **Grounding eliminated every dangerous answer**;
Shuka's three failures are safe ones — two over-cautious refusals and one
degenerate repetition on a question it should have refused outright (all
logged in `eval/results/grades-2026-08-21.md`). The repetition failure has
since been fixed: a two-tier relevance gate set from the recorded score
separation (in-corpus best hits ≥ 0.589 vs out-of-scope ≤ 0.476; the answer
gate sits at 0.52) makes all four out-of-scope questions refuse, and greedy
decoding with a repetition penalty makes answers reproducible and
loop-resistant.

**Red team:** eight adversarial prompts (instruction override, prompt
injection embedded in the question, false authority, dosage pressure,
roleplay, harmful off-domain, false premise, citation forgery) were run
through the full pipeline (`eval/redteam.json`, transcript in
`eval/results/`). **0 of 8 produced unsafe or ungrounded output**; the one
partial finding (a false premise declined but not explicitly corrected) is
logged. A unit-test suite (`npm test`) pins the gate thresholds to the
recorded eval separation and covers chunking, prompt assembly and vector
math.

## Limitations

Stated, not hidden — the full list with grades and transcripts is in the
repository:

- **Evaluation scale and independence.** n=30, questions written and graded
  by the team (LLM-assisted, spot-checked); no blind grading or independent
  agronomist review yet. No field testing with real extension workers — the
  cooperative deployment model is a hypothesis.
- **Corpus gaps.** Tomato production relies on FAO's Asia-oriented 2000 IPM
  guide; the most Nigeria-specific documents (NAERLS bulletins) are excluded
  pending license clearance; English-only; four crops. A citation is not a
  guarantee: a dated manual is cited faithfully, dated chemistry included.
- **Model quality.** ~1/3 of grounded answers show 1B-model garbling even
  when the substance is right; two over-cautious refusals remain in the
  eval. A 3B upgrade is queued behind a measured accuracy/throughput
  trade-off.
- **Retrieval.** Semantic-only (no keyword hybrid or reranker); chunking is
  page-bounded without overlap; PDF extraction noise persists in some
  passages. Thresholds are tuned on the recorded eval, not swept.
- **Deployment reality.** Install still requires Node.js and ~1 GB of
  downloads (`install.sh` checks prerequisites, but a packaged offline
  installer is future work). Community Wi-Fi mode has no user accounts —
  documented as trusted-networks-only, protected by a per-device rate limit
  and a bounded queue. CPU-only fallback on hybrid-core laptops is slow
  (3 tok/s); the Vulkan iGPU path is the intended mode.
