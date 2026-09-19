(() => {
  "use strict";

  /* ------------------------------------------------------------
     Data
     ------------------------------------------------------------ */

  const MAX_LENGTH = 2000;
  const EASE = "cubic-bezier(.2,.8,.2,1)";

  const NEUTRAL = { bg: "#E3E7ED", ink: "#182033", dark: false, fav: "#5B6B8C" };

  // One colour world per emotion. Ink/bg pairs are chosen for readable contrast.
  const THEMES = {
    sadness:  { emoji: "😕", bg: "#35507A", ink: "#EDF2F9", dark: true  },
    joy:      { emoji: "😊", bg: "#F5C542", ink: "#2B1F00", dark: false },
    love:     { emoji: "❤️", bg: "#F28FB0", ink: "#2A0715", dark: false },
    anger:    { emoji: "😠", bg: "#9E2B1F", ink: "#FFF1EC", dark: true  },
    fear:     { emoji: "😨", bg: "#452F6F", ink: "#F1EAFB", dark: true  },
    surprise: { emoji: "😮", bg: "#4CCDBB", ink: "#03221E", dark: false },
  };
  const ORDER = ["sadness", "joy", "love", "anger", "fear", "surprise"];

  const EXAMPLES = [
    "I feel so happy and excited about tomorrow",
    "I feel empty and alone, like nobody would notice if I left",
    "I feel so tender toward her that I just want to protect her",
    "I feel furious that they lied to me again",
    "I feel terrified every time I hear footsteps behind me",
    "I feel stunned, I never expected this to happen",
  ];

  const STATUS_TEXT = {
    connecting: "Connecting to server…",
    loading: "Loading the model…",
    ready: "Model ready",
    offline: "Server unreachable",
  };

  /* ------------------------------------------------------------
     Elements and state
     ------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  const el = {
    input: $("input"), field: $("field"), go: $("go"), example: $("example"),
    count: $("count"), notice: $("notice"), legend: $("legend"),
    readout: $("readout"), emotion: $("emotion"), emotionSr: $("emotionSr"),
    letters: $("letters"), emoji: $("emoji"), pct: $("pct"), note: $("note"),
    bars: $("bars"), history: $("history"), historyList: $("historyList"),
    status: $("status"), statusText: $("statusText"), wash: $("wash"),
    announce: $("announce"), favicon: $("favicon"), themeMeta: $("themeColor"),
  };

  const state = {
    busy: false,
    typing: false,
    current: null,      // entry currently on screen
    analyzed: "",       // text that entry was produced from
    history: [],
    bg: NEUTRAL.bg,
    wash: null,         // running colour wipe, if any
    polling: false,
  };

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ------------------------------------------------------------
     Server status
     ------------------------------------------------------------ */

  function setStatus(kind) {
    el.status.dataset.state = kind;
    el.statusText.textContent = STATUS_TEXT[kind];
  }

  // Free hosting puts the server to sleep, so keep asking until it answers.
  async function pollHealth(attempt = 0) {
    if (state.polling && attempt === 0) return;
    state.polling = true;
    try {
      const res = await fetch("/health", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (data.model_loaded) {
        setStatus("ready");
        state.polling = false;
        return;
      }
      setStatus("loading");
    } catch {
      setStatus(attempt >= 2 ? "offline" : "connecting");
    }
    if (attempt < 40) {
      await sleep(3000);
      return pollHealth(attempt + 1);
    }
    state.polling = false;
  }

  /* ------------------------------------------------------------
     Colour: fade the ink, wipe the background
     ------------------------------------------------------------ */

  function setBackground(color) {
    root.style.setProperty("--bg", color);
    state.bg = color;
  }

  // Land a running wipe immediately, so a new one can start cleanly.
  function settleWash() {
    if (!state.wash) return;
    const { anim, color } = state.wash;
    state.wash = null;
    anim.onfinish = null;
    setBackground(color);
    anim.cancel();
    el.wash.style.background = "";
  }

  function paint(theme, origin) {
    settleWash();

    root.style.setProperty("--ink", theme.ink);
    root.style.setProperty("--paper", theme.bg);
    root.style.colorScheme = theme.dark ? "dark" : "light";
    el.themeMeta.content = theme.bg;
    el.favicon.href =
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='${theme.fav || theme.bg}'/></svg>`
      );

    if (theme.bg === state.bg) return;
    if (reduced() || !origin || !el.wash.animate) return setBackground(theme.bg);

    const r = origin.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 4;

    el.wash.style.background = theme.bg;
    const anim = el.wash.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ],
      { duration: 1100, easing: "cubic-bezier(.65,0,.2,1)", fill: "forwards" }
    );
    state.wash = { anim, color: theme.bg };
    anim.onfinish = settleWash;
  }

  /* ------------------------------------------------------------
     Number tween
     ------------------------------------------------------------ */

  const frames = new WeakMap();

  function tween(node, to, { from = 0, duration = 900, delay = 0, format }) {
    cancelAnimationFrame(frames.get(node));
    if (reduced()) {
      node.textContent = format(to);
      return;
    }
    const start = performance.now() + delay;
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) frames.set(node, requestAnimationFrame(step));
    };
    frames.set(node, requestAnimationFrame(step));
  }

  const percent = (v) => (v > 0 && v < 1 ? "<1%" : `${Math.round(v)}%`);

  /* ------------------------------------------------------------
     Rendering a result
     ------------------------------------------------------------ */

  function buildBars() {
    ORDER.forEach((name) => {
      const li = document.createElement("li");
      li.className = "bar";
      li.dataset.e = name;
      li.dataset.v = "0";
      li.innerHTML =
        '<span class="bar-name"></span>' +
        '<span class="bar-track"><span class="bar-fill"></span></span>' +
        '<span class="bar-val">0%</span>';
      li.querySelector(".bar-name").textContent = name;
      el.bars.append(li);
    });
  }

  function renderWord(name) {
    el.emotion.dataset.e = name;
    el.emotionSr.textContent = name;
    el.letters.textContent = "";
    [...name].forEach((ch, i) => {
      const s = document.createElement("span");
      s.textContent = ch;
      s.style.setProperty("--i", i);
      el.letters.append(s);
    });
  }

  function renderMeta(entry) {
    const theme = THEMES[entry.emotion];
    el.emoji.textContent = theme ? theme.emoji : "";
    el.emoji.classList.remove("pop");
    void el.emoji.offsetWidth; // restart the animation
    el.emoji.classList.add("pop");

    const target = entry.confidence * 100;
    const from = Number(el.pct.dataset.v || 0);
    el.pct.dataset.v = String(target);
    tween(el.pct, target, { from, duration: 1100, delay: 250, format: (v) => Math.round(v) });

    // When the top score is not decisive, say who was runner-up.
    const ranked = ORDER.slice().sort((a, b) => (entry.probs[b] || 0) - (entry.probs[a] || 0));
    if (entry.confidence < 0.6 && ranked[1]) {
      const second = ranked[1];
      el.note.textContent = `Close call. It also reads as ${second} (${Math.round((entry.probs[second] || 0) * 100)}%).`;
      el.note.hidden = false;
    } else {
      el.note.hidden = true;
    }
  }

  // Bars sort by score. Rows glide to their new place (FLIP), then grow to length.
  function renderBars(entry, animateOrder) {
    const rows = [...el.bars.children];
    const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));

    const sorted = rows.slice().sort((a, b) => (entry.probs[b.dataset.e] || 0) - (entry.probs[a.dataset.e] || 0));
    sorted.forEach((r) => el.bars.append(r));

    sorted.forEach((row, i) => {
      const p = entry.probs[row.dataset.e] || 0;
      const from = Number(row.dataset.v);
      row.dataset.v = String(p * 100);

      row.classList.toggle("is-top", i === 0);
      row.style.setProperty("--p", p);
      row.style.setProperty("--d", `${i * 70}ms`);

      if (animateOrder && !reduced()) {
        const dy = before.get(row) - row.getBoundingClientRect().top;
        if (dy) {
          row.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
            { duration: 750, delay: i * 40, easing: EASE, fill: "backwards" }
          );
        }
      }

      tween(row.querySelector(".bar-val"), p * 100, {
        from, duration: 1000, delay: i * 70, format: percent,
      });
    });
  }

  function renderHistory(freshEntry) {
    el.history.hidden = state.history.length === 0;
    el.historyList.textContent = "";
    state.history.forEach((h) => {
      const theme = THEMES[h.emotion] || NEUTRAL;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mark" + (h === freshEntry ? " pop" : "");
      b.style.setProperty("--c", theme.bg);
      b.textContent = theme.emoji || "";
      const short = h.text.length > 90 ? h.text.slice(0, 87) + "…" : h.text;
      b.title = `${cap(h.emotion)}: ${short}`;
      b.setAttribute("aria-label", `${cap(h.emotion)}: ${short}`);
      if (h === state.current) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => restore(h, b));
      el.historyList.append(b);
    });
  }

  function revealIfOffscreen() {
    requestAnimationFrame(() => {
      const r = el.emotion.getBoundingClientRect();
      if (r.bottom > innerHeight - 24) {
        window.scrollTo({ top: scrollY + r.top - 96, behavior: reduced() ? "auto" : "smooth" });
      }
    });
  }

  function show(entry, origin, { isNew = false } = {}) {
    const theme = THEMES[entry.emotion] || NEUTRAL;
    const first = el.readout.hidden;

    state.current = entry;
    state.analyzed = entry.text;

    if (first) {
      el.legend.hidden = true;
      el.readout.hidden = false;
      el.readout.classList.add("is-in");
    }

    paint(theme, origin);
    renderWord(entry.emotion);
    renderMeta(entry);
    renderBars(entry, !first);
    renderHistory(isNew ? entry : null);
    syncStale();

    el.announce.textContent = `${cap(entry.emotion)}, ${Math.round(entry.confidence * 100)} percent sure.`;
    revealIfOffscreen();
  }

  function restore(entry, origin) {
    if (entry === state.current || state.busy || state.typing) return;
    el.input.value = entry.text;
    onInput();
    hideNotice();
    show(entry, origin);
  }

  /* ------------------------------------------------------------
     Input handling
     ------------------------------------------------------------ */

  function fit() {
    el.input.style.height = "auto";
    el.input.style.height = el.input.scrollHeight + "px";
  }

  function syncStale() {
    el.readout.classList.toggle(
      "is-stale",
      Boolean(state.current) && el.input.value.trim() !== state.analyzed
    );
  }

  function syncButtons() {
    el.go.disabled = state.typing || !el.input.value.trim();
    el.example.disabled = state.busy || state.typing;
  }

  function onInput() {
    el.count.textContent = `${el.input.value.length} / ${MAX_LENGTH}`;
    el.count.classList.toggle("is-near", el.input.value.length > MAX_LENGTH * 0.75);
    fit();
    syncButtons();
    syncStale();
  }

  function setBusy(busy) {
    state.busy = busy;
    el.go.setAttribute("aria-busy", String(busy));
    el.field.classList.toggle("is-busy", busy);
    syncButtons();
  }

  /* ------------------------------------------------------------
     Notices
     ------------------------------------------------------------ */

  function showNotice(message, isError = false) {
    el.notice.textContent = message;
    el.notice.classList.toggle("is-error", isError);
    el.notice.setAttribute("role", isError ? "alert" : "status");
    el.notice.hidden = false;
  }

  function hideNotice() {
    el.notice.hidden = true;
    el.notice.textContent = "";
  }

  /* ------------------------------------------------------------
     Talking to the API
     ------------------------------------------------------------ */

  class ApiError extends Error {}

  async function predict(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if (res.status === 503) throw new ApiError("The model is still loading. Try again in a few seconds.");
        if (res.status === 422) throw new ApiError(`Write between 1 and ${MAX_LENGTH} characters.`);
        throw new ApiError(`The server returned an error (${res.status}). Try again.`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function describeError(err) {
    if (err instanceof ApiError) return err.message;
    if (err && err.name === "AbortError") return "The request timed out. Try again in a moment.";
    return "Can't reach the server. Check your connection and try again.";
  }

  async function analyze() {
    const text = el.input.value.trim();
    if (!text || state.busy || state.typing) return;

    setBusy(true);
    hideNotice();
    const slow = setTimeout(
      () => showNotice("Waking the server. The first request after a quiet spell can take up to a minute."),
      4000
    );

    try {
      const data = await predict(text);
      clearTimeout(slow);
      hideNotice();
      setStatus("ready");

      const entry = {
        text,
        emotion: data.predicted_emotion,
        confidence: data.confidence,
        probs: data.all_probabilities || {},
      };
      state.history.push(entry);
      if (state.history.length > 8) state.history.shift();
      show(entry, el.go, { isNew: true });
    } catch (err) {
      clearTimeout(slow);
      showNotice(describeError(err), true);
      if (!(err instanceof ApiError)) {
        setStatus("offline");
        pollHealth();
      }
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------
     Example sentences, typed out
     ------------------------------------------------------------ */

  let lastExample = -1;

  async function tryExample() {
    if (state.busy || state.typing) return;

    let i;
    do { i = Math.floor(Math.random() * EXAMPLES.length); } while (i === lastExample);
    lastExample = i;
    const text = EXAMPLES[i];

    hideNotice();
    state.typing = true;
    el.input.readOnly = true;
    el.input.value = "";
    onInput();

    if (reduced()) {
      el.input.value = text;
    } else {
      for (const ch of text) {
        el.input.value += ch;
        onInput();
        await sleep(16 + Math.random() * 26);
      }
    }

    state.typing = false;
    el.input.readOnly = false;
    onInput();
    analyze();
  }

  /* ------------------------------------------------------------
     Start
     ------------------------------------------------------------ */

  buildBars();

  el.input.addEventListener("input", onInput);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      analyze();
    }
  });
  el.go.addEventListener("click", analyze);
  el.example.addEventListener("click", tryExample);
  window.addEventListener("resize", fit);

  onInput();
  pollHealth();
  if (window.matchMedia("(hover: hover)").matches) el.input.focus();
})();
