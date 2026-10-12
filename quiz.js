(() => {
  "use strict";

  const data = window.ROADMAP_TEST || {};
  const SEAL = window.SEAL;
  const questions = data.questions || [];
  const sections = data.sections || [];
  const POINTS = Number(data.pointsPerQuestion) || 1;
  const STORAGE_KEY = data.storageKey || "roadmap-test";
  // One colour per section, each dark enough to be read as text on the light page.
  const SECTION_COLORS = ["#6a4bd8", "#2563d9", "#0b7d6b", "#3d7a12", "#c2316c", "#0a6f9e", "#a335b4"];
  const NOTES = {
    command: ["Type it exactly as you would in a terminal.", "Մուտքագրեք ճիշտ այնպես, ինչպես տերմինալում։"],
    code: ["Spaces do not matter. Everything else does.", "Բացատները կարևոր չեն, մնացած ամեն ինչը կարևոր է։"],
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // [[text]] in a question is shown as code.
  const inline = (text) =>
    String(text ?? "")
      .split(/\[\[(.+?)\]\]/g)
      .map((part, i) => (i % 2 ? `<code>${esc(part)}</code>` : esc(part)))
      .join("");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointsWord = POINTS === 1 ? "point" : "points";
  const byNumber = new Map(questions.map((q) => [q.n, q]));

  // A way back to the roadmap is offered only when the page lives in a folder of a bigger site.
  const inFolder = location.pathname.replace(/[^/]*$/, "").split("/").filter(Boolean).length > 0;
  const HOME = data.roadmapLink && inFolder ? data.roadmapLink : "";

  function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /* ───────── Marking ───────── */

  // The page does not know the right answers. It fingerprints what was entered and looks for a match.
  // Nothing is marked while the test is being taken: this is used once, for the final score.
  const marks = new Map();

  function isRight(q, given) {
    if (given == null) return false;
    const tag = `${q.n}\u0000${JSON.stringify(given)}`;
    if (!marks.has(tag)) marks.set(tag, q.keys.includes(SEAL.key(data.salt, data.rounds, q.n, q.kind, given, q.mode)));
    return marks.get(tag);
  }

  /* ───────── Saved state ───────── */

  // The order in which a question's options or pieces are shown, as positions in its list.
  function mixed(q) {
    const size = (q.options || q.tokens || []).length;
    let order = shuffle([...Array(size).keys()]);
    // Pieces to be put in order must not start out already in order.
    for (let tries = 0; q.kind === "order" && tries < 20 && isRight(q, order.map((i) => q.tokens[i])); tries++) {
      order = shuffle(order);
    }
    return order;
  }

  // A saved answer as the page expects it, or undefined if it is not one (hand-edited storage, say).
  function clean(q, value) {
    if (q.kind === "type") return typeof value === "string" && value ? value : undefined;
    if (q.kind === "choice") return q.options.includes(value) ? value : undefined;
    if (!Array.isArray(value)) return undefined;
    const pool = q.kind === "multi" ? q.options : q.tokens;
    const kept = [...new Set(value)].filter((v) => pool.includes(v));
    return kept.length ? kept : undefined;
  }

  // Only the answers are saved, never whether they are right: the score is worked out from them.
  function usable(a) {
    if (!a || typeof a !== "object") return null;
    a.given = a.given && typeof a.given === "object" ? a.given : {};
    a.order = a.order && typeof a.order === "object" ? a.order : {};
    a.at = Number.isInteger(a.at) && a.at >= 0 && a.at < questions.length ? a.at : 0;
    for (const n of Object.keys(a.given)) {
      const q = byNumber.get(Number(n));
      const value = q ? clean(q, a.given[n]) : undefined;
      if (value === undefined) delete a.given[n];
      else a.given[n] = value;
    }
    for (const q of questions) {
      const size = (q.options || q.tokens || []).length;
      const saved = a.order[q.n];
      const valid = Array.isArray(saved) && saved.length === size && [...saved].sort((x, y) => x - y).every((v, i) => v === i);
      if (size && !valid) a.order[q.n] = mixed(q);
    }
    return a;
  }

  function load() {
    const base = { attempt: null, history: [] };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") Object.assign(base, saved);
    } catch {
      // Storage blocked or corrupted: start clean, the test still works for this visit.
    }
    if (!Array.isArray(base.history)) base.history = [];
    base.attempt = usable(base.attempt);
    return base;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Nothing to do; the attempt just won't outlive the tab.
    }
  }

  // An ordering counts as an answer only once every piece has been placed.
  function answered(a, q) {
    const value = a.given[q.n];
    if (value == null) return false;
    return q.kind === "order" ? value.length === q.tokens.length : value.length > 0;
  }

  const doneCount = (a) => questions.filter((q) => answered(a, q)).length;
  const rightCount = (a) => questions.filter((q) => isRight(q, a.given[q.n])).length;
  const bestScore = () => state.history.reduce((best, h) => (!best || h.points > best.points ? h : best), null);

  /* ───────── Mistakes review ───────── */

  // The page holds only fingerprints, so the right answer of a choice, tick or ordering question
  // is found by trying every possibility against them. This runs only once the test is finished.
  const solved = new Map();
  function solve(q) {
    if (solved.has(q.n)) return solved.get(q.n);
    let found = null;
    if (q.kind === "choice") {
      found = q.options.find((option) => isRight(q, option)) ?? null;
    } else if (q.kind === "multi") {
      for (let mask = 1; mask < 1 << q.options.length && !found; mask++) {
        const pick = q.options.filter((_, i) => mask & (1 << i));
        if (isRight(q, pick)) found = pick;
      }
    } else if (q.kind === "order") {
      const walk = (left, placed) => {
        if (!left.length) return isRight(q, placed) ? placed : null;
        for (let i = 0; i < left.length; i++) {
          const hit = walk(left.filter((_, j) => j !== i), [...placed, left[i]]);
          if (hit) return hit;
        }
        return null;
      };
      found = walk(q.tokens, []);
    }
    // A typed answer cannot be recovered from its fingerprint, so it stays null.
    solved.set(q.n, found);
    return found;
  }

  // An answer as written in the review. Lines of code keep one row each.
  function describe(q, value) {
    const rows = q.kind === "order" && q.lines;
    const text = q.kind === "multi" ? value.join(", ") : q.kind === "order" ? value.join(rows ? "\n" : " → ") : value;
    return `<code${rows ? ' class="is-lines"' : ""}>${esc(text)}</code>`;
  }

  function mistakeHTML(q) {
    const given = state.attempt.given[q.n];
    const right = solve(q);
    return `
      <div class="mistake-item" style="--accent:${SECTION_COLORS[q.section % SECTION_COLORS.length]}">
        <div class="mistake-head">
          <span>${esc(sections[q.section] || "")}</span>
          <span>Question ${q.n}</span>
        </div>
        <p class="mistake-ask">${inline(q.ask)}</p>
        ${q.askHy ? `<p class="mistake-ask-hy" lang="hy">${inline(q.askHy)}</p>` : ""}
        ${q.code ? `<pre class="q-code">${esc(q.code)}</pre>` : ""}
        <p class="mistake-given">Your answer: ${given == null ? "<i>no answer</i>" : describe(q, given)}</p>
        ${
          right
            ? `<p class="mistake-correct">Correct answer: ${describe(q, right)}</p>`
            : `<p class="mistake-note">The accepted answer to a typed question is not stored in the page, so it cannot be shown here.</p>`
        }
      </div>`;
  }

  /* ───────── Views ───────── */

  const quiz = $("#quiz");
  const track = $("#track");
  const state = load();
  let view = "start"; // "start", "question" or "summary"; a finished attempt always shows the score
  let draft = null; // what is entered for the question on screen: an option, ticked options, or picked pieces

  if (HOME) {
    $("#home-link").href = HOME;
    $("#home-link").hidden = false;
  }

  const current = () => questions[state.attempt.at];

  function updateHud() {
    const a = state.attempt;
    const showing = Boolean(a && (view !== "start" || a.finished));
    $("#track-row").hidden = !showing;
    if (!showing) return;
    const done = doneCount(a);
    track.style.setProperty("--w", `${(done / questions.length) * 100}%`);
    track.setAttribute("aria-valuemax", questions.length);
    track.setAttribute("aria-valuenow", done);
    $("#track-count").textContent = `${done}/${questions.length}`;
  }

  function renderStart() {
    const a = state.attempt;
    const inProgress = a && !a.finished;
    const best = bestScore();
    const actions = !questions.length
      ? `<p class="start-note">There are no questions yet.</p>`
      : inProgress
        ? `<button class="btn btn-gold" type="button" data-do="continue">Continue from question ${a.at + 1}</button>
           <button class="link-btn" type="button" data-do="restart">Start a new test</button>`
        : `<button class="btn btn-gold" type="button" data-do="start">Start the test</button>`;
    quiz.innerHTML = `
      <section class="panel start">
        <p class="eyebrow">${plural(sections.length, "section")}</p>
        <h1>${esc(data.title || "Roadmap test")}</h1>
        <p class="lede">${esc(data.intro || "")}</p>
        <ul class="facts">
          <li><b>${questions.length}</b><span>questions</span></li>
          <li><b>${POINTS}</b><span>${pointsWord} each</span></li>
          <li><b>${questions.length * POINTS}</b><span>points in total</span></li>
        </ul>
        <ul class="kinds">
          <li><b>Choose</b><span>Pick the one right answer, or tick every answer that applies.</span></li>
          <li><b>Type</b><span>Write a word, a command or a line of code.</span></li>
          <li><b>Arrange</b><span>Put pieces of a command or lines of code in order.</span></li>
        </ul>
        <p class="start-note" lang="hy">Հարցերը և պատասխանների տարբերակները տրված են անգլերեն և հայերեն։ Հրամանները, կոդը և մուտքագրվող բառերը գրվում են անգլերեն։</p>
        <p class="start-note">Nothing is marked while you work, and you can go back and change any answer. When you finish, you get your score and a review of your mistakes. Your answers are saved in this browser as you go, so you can close the page and carry on later.</p>
        <div class="start-actions">${actions}</div>
        ${best ? `<p class="best">Best score so far: <b>${best.points}</b> out of ${best.max}</p>` : ""}
      </section>`;
  }

  function optionsHTML(q) {
    const many = q.kind === "multi";
    const picked = many ? draft : [draft];
    const options = state.attempt.order[q.n]
      .map((index, position) => {
        const on = picked.includes(q.options[index]);
        const armenian = q.optionsHy && q.optionsHy[index];
        return `
          <label class="option${on ? " is-on is-picked" : ""}">
            <input type="${many ? "checkbox" : "radio"}" name="pick" value="${index}"${on ? " checked" : ""}>
            <span class="option-key${many ? " is-box" : ""}">${many ? "" : position + 1}</span>
            <span class="option-body">
              <span class="option-text">${esc(q.options[index])}</span>
              ${armenian ? `<span class="option-hy" lang="hy">${esc(armenian)}</span>` : ""}
            </span>
          </label>`;
      })
      .join("");
    return `<div class="options${q.mono ? " is-mono" : ""}" role="${many ? "group" : "radiogroup"}" aria-label="Answers">${options}</div>`;
  }

  function typeHTML(q, given) {
    const mono = q.mode === "command" || q.mode === "code" ? " is-mono" : "";
    // Browser spelling help is switched off: it would rewrite commands and code.
    return `<input class="answer-input${mono}" type="text" name="typed" aria-label="Your answer" placeholder="Type your answer"
      autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${esc(given || "")}">
      ${NOTES[q.mode] ? `<p class="q-note">${NOTES[q.mode][0]}<span lang="hy">${NOTES[q.mode][1]}</span></p>` : ""}`;
  }

  function orderHTML(q) {
    const lines = q.lines ? " is-lines" : "";
    // A piece that is a plain word carries its Armenian beside it.
    const piece = (index) => {
      const armenian = q.tokensHy && q.tokensHy[index];
      return `<span class="chip-text">${esc(q.tokens[index])}</span>${armenian ? `<span class="chip-hy" lang="hy">${esc(armenian)}</span>` : ""}`;
    };
    const row = draft.length
      ? draft
          .map(
            (index, position) =>
              `<button type="button" class="chip is-set" data-slot="${position}" aria-label="Take back: ${esc(q.tokens[index])}">${piece(index)}</button>`,
          )
          .join("")
      : `<span class="order-hint">Tap the ${q.lines ? "lines" : "pieces"} below in the right order.</span>`;
    const pool = state.attempt.order[q.n]
      .filter((index) => !draft.includes(index))
      .map((index) => `<button type="button" class="chip" data-token="${index}">${piece(index)}</button>`)
      .join("");
    return `<div class="order"><div class="order-row${lines}">${row}</div><div class="order-pool${lines}">${pool}</div></div>`;
  }

  function renderQuestion() {
    const a = state.attempt;
    const q = current();
    const body = q.kind === "type" ? typeHTML(q, a.given[q.n]) : q.kind === "order" ? orderHTML(q) : optionsHTML(q);
    quiz.innerHTML = `
      <form class="panel question" data-n="${q.n}" data-kind="${q.kind}" style="--accent:${SECTION_COLORS[q.section % SECTION_COLORS.length]}" novalidate>
        <div class="q-head">
          <span>${esc(sections[q.section] || "")}</span>
          <span>Question ${a.at + 1} of ${questions.length}</span>
        </div>
        <p class="q-ask">${inline(q.ask)}</p>
        ${q.askHy ? `<p class="q-ask-hy" lang="hy">${inline(q.askHy)}</p>` : ""}
        ${q.code ? `<pre class="q-code">${esc(q.code)}</pre>` : ""}
        ${body}
        <div class="q-actions">
          ${a.at ? `<button type="button" class="btn" data-do="back">Back</button>` : "<span></span>"}
          <button type="submit" class="btn btn-gold">${a.at === questions.length - 1 ? "Finish" : "Next"}</button>
        </div>
        <p class="q-finish"><button type="button" class="link-btn" data-do="summary">Review and finish</button></p>
      </form>`;
    const input = $(".answer-input", quiz);
    if (input) input.focus({ preventScroll: true });
  }

  // The last stop before marking: what is still empty, and one button that closes the test.
  function renderSummary() {
    const open = questions.filter((q) => !answered(state.attempt, q));
    quiz.innerHTML = `
      <section class="panel summary">
        <p class="eyebrow">Before you finish</p>
        <h1>${open.length ? `${plural(open.length, "question")} without an answer` : "Every question has an answer"}</h1>
        <p class="lede">${
          open.length
            ? "A question left empty scores nothing. Choose a number to go to it, or finish as it is."
            : "You can still go back and change anything. Once you finish, the test is marked and scored."
        }</p>
        ${
          open.length
            ? `<div class="jump-list" aria-label="Questions without an answer">${open.map((q) => `<button type="button" class="jump" data-jump="${q.n}">${q.n}</button>`).join("")}</div>`
            : ""
        }
        <div class="summary-actions">
          <button class="btn" type="button" data-do="return">Back to the questions</button>
          <button class="btn btn-gold" type="button" data-do="finish">Finish and see my score</button>
        </div>
      </section>`;
  }

  // The score and the mistakes review breakdown.
  function renderResults() {
    const a = state.attempt;
    const right = rightCount(a);
    const points = right * POINTS;
    const max = questions.length * POINTS;
    const share = max ? points / max : 0;
    const verdict =
      share === 1 ? "A perfect score." : share >= 0.9 ? "Excellent." : share >= 0.7 ? "Good work." : share >= 0.5 ? "Getting there." : "Keep practising.";
    const best = bestScore();
    const record =
      best && best.points > points
        ? ` Your best so far is ${best.points}.`
        : state.history.length > 1
          ? " That is your best score so far."
          : "";

    // Every question that did not earn its point: wrong answers and questions left empty.
    const missed = questions.filter((q) => !isRight(q, a.given[q.n]));
    const mistakesHTML = missed.length
      ? `<div class="mistakes-list">
          <h3>Review your mistakes (${missed.length})</h3>
          ${missed.map(mistakeHTML).join("")}
        </div>`
      : `<p class="no-mistakes">🎉 No mistakes: every answer was right.</p>`;

    quiz.innerHTML = `
      <section class="panel results">
        <p class="eyebrow">Test complete</p>
        <div class="score" role="img" aria-label="${points} out of ${max} points">
          <svg class="score-ring" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="ring-gold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#ffcf4a"/><stop offset=".45" stop-color="#f7a600"/><stop offset="1" stop-color="#e07b00"/>
              </linearGradient>
            </defs>
            <circle class="ring-back" cx="60" cy="60" r="52"/>
            <circle class="ring-front" cx="60" cy="60" r="52"${points ? "" : " hidden"}/>
          </svg>
          <div class="score-num"><b id="score-value">${reducedMotion ? points : 0}</b><span>out of ${max}</span></div>
        </div>
        <h1>${verdict}</h1>
        <p class="lede">You answered ${right} of ${questions.length} questions correctly.${record}</p>

        ${mistakesHTML}

        <div class="results-actions">
          <button class="btn btn-gold" type="button" data-do="again">Try again</button>
          ${HOME ? `<a class="btn" href="${esc(HOME)}">Back to the roadmap</a>` : ""}
        </div>
      </section>`;

    const ring = $(".ring-front", quiz);
    if (reducedMotion) {
      ring.style.setProperty("--share", share);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty("--share", share)));
    const number = $("#score-value");
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / 1200);
      number.textContent = Math.round(points * (1 - (1 - t) ** 3));
      if (t < 1 && number.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function render() {
    const a = state.attempt;
    updateHud();
    if (a && a.finished) renderResults();
    else if (a && view === "question") renderQuestion();
    else if (a && view === "summary") renderSummary();
    else renderStart();
  }

  /* ───────── Taking the test ───────── */

  // Whatever is entered is saved straight away, finished or not, so it is there on the way back.
  function keep() {
    const a = state.attempt;
    const q = current();
    const value = q.kind === "type" ? $(".answer-input", quiz).value.trim() : q.kind === "order" ? draft.map((i) => q.tokens[i]) : draft;
    if (value == null || !value.length) delete a.given[q.n];
    else a.given[q.n] = value;
    save();
    updateHud();
  }

  function open(index) {
    const a = state.attempt;
    a.at = Math.max(0, Math.min(questions.length - 1, index));
    const q = current();
    const given = a.given[q.n];
    draft = q.kind === "order" ? (given || []).map((piece) => q.tokens.indexOf(piece)) : q.kind === "multi" ? [...(given || [])] : (given ?? null);
    view = "question";
    save();
    render();
    window.scrollTo(0, 0);
  }

  function show(name) {
    view = name;
    render();
    window.scrollTo(0, 0);
  }

  function redrawOrder() {
    $(".order", quiz).outerHTML = orderHTML(current());
    keep();
  }

  function pick(index) {
    if (draft.includes(index)) return;
    draft = [...draft, index];
    redrawOrder();
  }

  function unpick(position) {
    draft = draft.filter((_, p) => p !== position);
    redrawOrder();
  }

  function begin() {
    state.attempt = usable({ given: {}, order: {}, at: 0, finished: false });
    open(0);
  }

  // Marks the test. From here on the answers are closed and the score and mistakes are shown.
  function finish() {
    const a = state.attempt;
    a.finished = true;
    state.history = [...state.history, { points: rightCount(a) * POINTS, max: questions.length * POINTS, at: Date.now() }].slice(-20);
    save();
    show("start");
  }

  /* ───────── Events ───────── */

  quiz.addEventListener("submit", (e) => {
    e.preventDefault();
    if (view !== "question") return;
    if (state.attempt.at === questions.length - 1) show("summary");
    else open(state.attempt.at + 1);
  });

  quiz.addEventListener("change", (e) => {
    if (e.target.name !== "pick") return;
    const q = current();
    const ticked = $$("input[name=pick]:checked", quiz).map((input) => q.options[Number(input.value)]);
    draft = q.kind === "multi" ? ticked : ticked[0] || null;
    for (const option of $$(".option", quiz)) {
      const on = $("input", option).checked;
      option.classList.toggle("is-on", on);
      option.classList.toggle("is-picked", on);
    }
    keep();
  });

  quiz.addEventListener("input", (e) => {
    if (e.target.name === "typed") keep();
  });

  quiz.addEventListener("click", (e) => {
    const token = e.target.closest("[data-token]");
    if (token) return pick(Number(token.dataset.token));
    const slot = e.target.closest("[data-slot]");
    if (slot) return unpick(Number(slot.dataset.slot));
    const jump = e.target.closest("[data-jump]");
    if (jump) return open(questions.findIndex((q) => q.n === Number(jump.dataset.jump)));
    const action = e.target.closest("[data-do]");
    if (!action) return;
    const what = action.dataset.do;
    if (what === "start" || what === "again") begin();
    else if (what === "continue" || what === "return") open(state.attempt.at);
    else if (what === "back") open(state.attempt.at - 1);
    else if (what === "summary") show("summary");
    else if (what === "finish") finish();
    else if (what === "restart" && window.confirm("Start a new test? Your answers so far will be lost.")) begin();
  });

  // Keyboard: digits pick or tick an option, Backspace takes back the last piece, Enter moves on.
  document.addEventListener("keydown", (e) => {
    if (view !== "question" || !state.attempt || state.attempt.finished || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter" && !e.target.closest("button, input, a")) {
      e.preventDefault();
      $("form", quiz).requestSubmit();
      return;
    }
    if (e.target.matches("input[type=text]")) return;
    const q = current();
    if (q.options && /^[1-9]$/.test(e.key)) {
      const input = $$("input[name=pick]", quiz)[Number(e.key) - 1];
      if (!input) return;
      input.checked = q.kind === "multi" ? !input.checked : true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (q.kind === "order" && e.key === "Backspace") {
      e.preventDefault();
      if (draft.length) unpick(draft.length - 1);
    }
  });

  render();
})();