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

Baseline (Llama 3.2 1B Instruct Q4_0, via @qvac/sdk): ~12 tok/s, first token
<1s on developer hardware. See docs/concept.md for the quality findings that
motivate the retrieval-grounded architecture.
