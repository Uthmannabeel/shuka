// Shuka web UI. Streams one answer at a time from /api/ask (SSE over a
// fetch body) and renders it as a manual-style answer sheet with numbered
// source cards. Everything is rendered through text nodes — never
// innerHTML — because answer text quotes third-party document content.

const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askBtn = document.getElementById("ask-btn");
const emptyState = document.getElementById("empty");
const result = document.getElementById("result");
const sheet = document.querySelector(".sheet");
const sheetQ = document.getElementById("sheet-q");
const answerEl = document.getElementById("answer");
const stamp = document.getElementById("stamp");
const metricsEl = document.getElementById("metrics");
const sourcesPanel = document.getElementById("sources-panel");
const sourcesList = document.getElementById("sources-list");

let asking = false;

document.getElementById("examples").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  questionInput.value = e.target.textContent;
  form.requestSubmit();
});

// ?q=... pre-fills and asks immediately — handy for demos and kiosk setups.
const presetQ = new URLSearchParams(location.search).get("q");
if (presetQ) {
  questionInput.value = presetQ;
  queueMicrotask(() => form.requestSubmit());
}

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    document.getElementById("status-text").textContent =
      `offline · ${s.passages.toLocaleString()} passages · ${s.documents} manuals · ${s.model}`;
  })
  .catch(() => {
    document.getElementById("status-text").textContent = "server not reachable";
  });

// Renders answer text, turning [1]-[9] markers into citation chips that
// flash the matching source card. A partial marker at the streaming edge
// ("[" or "[2" with no "]") is held back until it resolves.
function renderAnswer(text, { streaming }) {
  answerEl.replaceChildren();
  // the model emits markdown-style "* " bullets; print them as list dots
  const cleaned = text.replace(/^\s*[*-]\s+/gm, "  •  ");
  const parts = cleaned.split(/(\[[1-9]\])/);
  for (const part of parts) {
    const m = part.match(/^\[([1-9])\]$/);
    if (m) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cite";
      chip.textContent = m[1];
      chip.title = `Show source ${m[1]}`;
      chip.addEventListener("click", () => flashSource(Number(m[1])));
      answerEl.appendChild(chip);
    } else if (part) {
      answerEl.appendChild(document.createTextNode(part));
    }
  }
  if (streaming) {
    const caret = document.createElement("span");
    caret.className = "caret";
    answerEl.appendChild(caret);
  }
}

function flashSource(n) {
  const card = sourcesList.querySelector(`[data-n="${n}"]`);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.classList.remove("flash");
  requestAnimationFrame(() => card.classList.add("flash"));
  setTimeout(() => card.classList.remove("flash"), 1200);
}

function renderSources(sources) {
  sourcesList.replaceChildren();
  for (const s of sources) {
    const li = document.createElement("li");
    li.className = "source-card";
    li.dataset.n = s.n;

    const head = document.createElement("div");
    const n = document.createElement("span");
    n.className = "source-n";
    n.textContent = s.n;
    const doc = document.createElement("span");
    doc.className = "source-doc";
    doc.textContent = s.doc.replace(/\.pdf$/, "").replace(/-/g, " ");
    head.append(n, doc);

    const meta = document.createElement("div");
    meta.className = "source-meta";
    const pages = s.pageStart === s.pageEnd ? `p.${s.pageStart}` : `pp.${s.pageStart}–${s.pageEnd}`;
    meta.textContent = `${pages} · match ${Math.round(s.score * 100)}%`;

    const excerpt = document.createElement("div");
    excerpt.className = "source-excerpt";
    excerpt.textContent = `“${s.excerpt.trim()}…”`;

    li.append(head, meta, excerpt);
    sourcesList.appendChild(li);
  }
  sourcesPanel.hidden = false;
}

function setStamp(text, refused) {
  stamp.textContent = text;
  stamp.classList.toggle("refused", refused);
  stamp.hidden = false;
  stamp.classList.remove("thunk");
  requestAnimationFrame(() => stamp.classList.add("thunk"));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = questionInput.value.trim();
  if (!question || asking) return;

  asking = true;
  askBtn.disabled = true;
  emptyState.hidden = true;
  result.hidden = false;
  sheet.classList.remove("is-refused");
  sheetQ.textContent = question;
  stamp.hidden = true;
  metricsEl.textContent = "";
  sourcesPanel.hidden = true;
  sourcesList.replaceChildren();
  renderAnswer("", { streaming: true });

  let text = "";
  let sourceCount = 0;

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok || !res.body) throw new Error(`server said ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const dataLine = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        const data = JSON.parse(dataLine);

        if (event === "sources") {
          sourceCount = data.sources.length;
          renderSources(data.sources);
        } else if (event === "token") {
          text += data.t;
          renderAnswer(text, { streaming: true });
        } else if (event === "refused") {
          sheet.classList.add("is-refused");
          renderAnswer(data.message, { streaming: false });
          setStamp("Not in sources", true);
          metricsEl.textContent = `checked the manuals in ${(data.retrievalMs / 1000).toFixed(1)}s — no covering passage found`;
        } else if (event === "done") {
          renderAnswer(text, { streaming: false });
          setStamp(`Grounded · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`, false);
          const bits = [];
          if (data.ttftMs != null) bits.push(`first word in ${(data.ttftMs / 1000).toFixed(1)}s`);
          if (data.tokPerSec != null) bits.push(`${data.tokPerSec} tok/s`);
          bits.push("answered on this computer, offline");
          metricsEl.textContent = bits.join(" · ");
        } else if (event === "error") {
          renderAnswer(data.message, { streaming: false });
        }
      }
    }
  } catch (err) {
    renderAnswer("Could not reach the Shuka server on this computer. Check that it is still running, then try again.", { streaming: false });
  } finally {
    asking = false;
    askBtn.disabled = false;
  }
});
