# Demo video script (max 2:00)

Format: screen recording of the browser (Xbox Game Bar Win+Alt+R or OBS),
voiceover. One continuous take if possible.

**Pre-roll setup (before recording):**
- `npm run serve`, wait for "Shuka is at http://127.0.0.1:4180", open it.
- Ask one throwaway question first so caches are warm.
- Browser at 100% zoom, generous window; close other tabs.
- Plan to toggle Wi-Fi OFF on camera in the first 15 seconds — the whole
  pitch is offline operation.

---

**0:00–0:15 — the problem (over the empty answer-sheet screen)**
> "Nigeria has one agricultural extension worker for every few thousand
> farmers. The obvious fallback — asking an AI — fails exactly where
> farming happens: no connectivity, low-end laptops. This is Shuka. It
> runs entirely on an ordinary 8-gigabyte laptop. Watch — the Wi-Fi is
> going off now."
*(toggle airplane mode on screen; point at the `offline · 1,308 passages ·
8 manuals` status in the header)*

**0:15–0:30 — the danger (why this isn't just a chatbot)**
> "Small models are fluent, confident — and dangerously wrong. The bare
> model told us to plant thirty maize seeds per hole and to harvest
> cassava at four months. In our thirty-question eval it gave nine
> dangerous answers. Shuka's answer is architectural: the model never
> gets to free-associate."

**0:30–1:10 — live demo 1 (fall armyworm, the flagship)**
*(click the first example question — the FAW one — let it stream)*
> "Every answer is drawn only from real extension literature — FAO, IITA,
> CABI — retrieved on this machine and cited by page, like a printed
> extension bulletin. Fall armyworm, correctly diagnosed. The margin shows
> exactly which manual and which page each claim comes from — and the
> sheet is stamped: grounded, four sources."
*(click a citation chip; the source card flashes. Then click PRINT SHEET —
the print preview appears)*
> "And one click turns it into a paper handout the farmer keeps. If someone
> asks the same thing later — even in different words — Shuka answers from
> the desk's own ledger in under half a second."

**1:10–1:35 — live demo 2 (the guardrail)**
*(type: "My chickens are sneezing and have swollen eyes. What medicine
should I give them?")*
> "And when the manuals don't cover something — poultry, here — Shuka
> refuses and points to the local extension office. That red stamp is the
> point: silence beats confident error when the cost of being wrong is
> someone's growing season."

**1:35–2:00 — the numbers + close**
> "Grounding took dangerous answers from nine in thirty to zero. The
> official ADTC profiler measures nineteen tokens a second and one point
> four gigabytes of peak memory — headroom to spare on the 8-gigabyte
> target, no thermal throttling. One offline laptop at a cooperative
> serves a whole community. Shuka — sow knowledge anywhere."
*(end on the README or the grades table)*

---

Timing notes: the FAW answer takes ~40s to stream fully — start the
voiceover over it and cut away once the stamp lands; never trim the
citations or the refusal stamp. If a take runs long, speed up the
mid-generation stretch in the edit.
