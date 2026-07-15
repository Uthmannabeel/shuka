# Shuka (working title)

Offline agronomy assistant for the hardware Africa actually has — an entry for the
[Africa Deep Tech Challenge 2026](https://adtc-2026.devpost.com/), Agriculture track.

Runs a quantized small language model entirely on-device (target: 8GB RAM,
integrated graphics, CPU-only), grounded in curated agricultural extension
literature via local retrieval. No cloud, no API keys, no connectivity required.

## Status

Early proof-of-concept. See [docs/concept.md](docs/concept.md) for the design and
plan.

## Benchmark

```
npm install
npm run bench
```

The bench runs one untimed warm-up then 3 timed repetitions per prompt and
reports medians. Time-to-first-token (prefill) and decode tokens/sec are
measured separately, chars/sec is reported as a unit-independent cross-check,
and peak RAM is sampled over the whole process tree (the QVAC runtime holds
the model in a worker process, so main-process RSS alone is misleading).
Each run is persisted to `bench-results/` as JSON with machine context —
developer hardware is not the 8GB target spec, so no number travels without it.

Baseline (Llama 3.2 1B Instruct Q4_0, via @qvac/sdk): see the latest record in
`bench-results/`. See docs/concept.md for the quality findings that motivate
the retrieval-grounded architecture.

## Dev notes

- `package.json` pins `bare-zlib` to 1.3.1 via `overrides` — carried over from
  the QVAC spike where newer versions broke the Bare runtime install. Re-test
  before removing when bumping `@qvac/sdk`.
- This dev machine sits behind a TLS-intercepting middlebox; `npm install`
  needs `NODE_OPTIONS=--use-system-ca`. Prefer `npm ci` (lockfile-only) and a
  cleanly-verifying network for anything release-bound.
