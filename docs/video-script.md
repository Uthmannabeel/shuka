# Demo video script (max 2:00)

Format: screen recording of the terminal (large font, dark theme), voiceover.
Record with Xbox Game Bar (Win+Alt+R) or OBS; keep one continuous take if
possible. Rehearse the two commands first so model-load time is warm.

**Pre-roll setup (before recording):**
- Terminal font ≥16pt, window ~120 cols. `cd ~/adtc`.
- Run `npm run ask -- "warm up"` once beforehand so OS file cache is warm.
- Disconnect Wi-Fi ON CAMERA (airplane-mode toggle visible) — the whole pitch
  is offline operation. Do this in the first 10 seconds.

---

**0:00–0:15 — the problem (voiceover over title card or terminal)**
> "Nigeria has one agricultural extension worker for every few thousand
> farmers. The obvious fallback — asking an AI — fails exactly where farming
> happens: no connectivity, low-end laptops. This is Shuka: an agronomy
> assistant that runs entirely on an ordinary 8-gigabyte laptop. No cloud.
> Watch — the Wi-Fi is off."
*(toggle airplane mode on screen)*

**0:15–0:30 — the danger (why this isn't just a chatbot)**
> "Small models are fluent, confident — and dangerously wrong. The bare
> model told us to grow cassava from seeds and to spray fungicide on striga,
> a parasitic weed. In our 30-question eval it gave nine dangerous answers.
> So Shuka never lets the model free-associate."
*(show `eval/results/grades-2026-08-21.md` headline table for 3 seconds)*

**0:30–1:10 — live demo, question 1 (fall armyworm)**
```
npm run ask -- "My maize leaves have ragged holes and there are
caterpillars and sawdust-like droppings in the whorl. What is this?"
```
> "Every answer is grounded in real extension literature — FAO, IITA,
> CABI — retrieved on-device and cited by page. Fall armyworm, correctly
> diagnosed, with the FAO Farmer Field School guide as the source."
*(let the streamed answer + Sources block render; point at citations)*

**1:10–1:35 — live demo, question 2 (the guardrail)**
```
npm run ask -- "My chickens are sneezing and have swollen eyes. What
medicine should I give them?"
```
> "And when the corpus doesn't cover something — poultry, in this case —
> Shuka refuses and points to the local extension office. Silence beats
> confident error when the cost of being wrong is someone's growing season."

**1:35–2:00 — the numbers + close**
> "Grounding took dangerous answers from nine in thirty to zero. Fifteen
> tokens a second on integrated graphics, first token in about three
> seconds, under two gigabytes of RAM — headroom to spare on the
> 8-gigabyte target. One offline laptop at a cooperative serves a whole
> community. Shuka — sow knowledge anywhere."
*(show REPORT.md benchmark table briefly, end on the repo README)*

---

Timing notes: keep each generation to its first ~8 lines on screen (the
answers stream fast enough at 15 tok/s). If a take runs long, trim the
middle of generation in the edit, never the citations or the refusal.
