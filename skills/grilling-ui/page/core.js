// grilling-ui page core, shared by every layout (spec §7 Shared core). Ported from
// jasonku09/grill-with-ui page.html (daafa1e): helpers, staging, pending, send/finish/visualize/
// explore (231-377) and the render wrapper, banner, header, status, footer and send button
// (378-433, 456-466, 591-628). Changed for the hub:
//   - paths are relative to GRILL.base; POSTs carry x-grill-token;
//   - staging lives in localStorage["grill:<sessionId>"] (switching layouts keeps it);
//   - state arrives as an SSE ping on /events → GET state (no 1 s polling);
//   - hub down: banner after 3 s, /health every 5 s, state re-fetched on recovery;
//   - tab title "<project> · <topic>", favicon status dot, header project/branch/phase/listener
//     and layout switch; bare /s/<id>/ redirects to the last-used layout (plan D1);
//   - presence ping every 20 s (plan D6).
//
// A layout registers once with Grill.mount(hooks) (see mount below for the contract).
(() => {
  "use strict";
  const G = window.GRILL || {};
  const BASE = typeof G.base === "string" ? G.base : "./";
  const LAYOUTS = Array.isArray(G.layouts) ? G.layouts : ["inbox"];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---- D1: bare /s/<id>/ goes to the last-used layout, if it is built ----
  const bare = /\/s\/[^/]+\/$/.test(location.pathname);
  if (bare) {
    const pref = store.get("grill:layout");
    if (pref && pref !== "inbox" && LAYOUTS.includes(pref)) {
      location.replace(BASE + pref + location.search + location.hash);
      window.Grill = { redirecting: true, mount() {} };
      return;
    }
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WORKING_GRACE_MS = 5 * 60 * 1000;
  const DRAW_GRACE_MS = 10 * 60 * 1000; // a background draw older than this is treated as stuck: Regenerate comes back
  const DRAW_STUCK_NOTE = "The draw has run over 10 minutes; regenerate to try again.";
  const GONE_AFTER_MS = 3000;           // hub-down banner after this long without a successful fetch
  const HEALTH_EVERY_MS = 5000;         // then /health is retried this often
  const LISTENER_FRESH_MS = 180 * 1000; // owner heartbeat younger than this = an agent is listening (spec §5)
  const PRESENCE_EVERY_MS = 20 * 1000;  // D6
  const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor"/><path d="M6 10.4l2.6 2.6L14 7.4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let S = null, raw = null, selected = null;
  let gone = false, troubleSince = 0, confirmFinish = false;
  let L = null; // the mounted layout
  const storeKey = "grill:" + (G.id || "");
  const fresh = () => ({ staged: {}, pending: [], drafts: {}, view: "questions", vfeedback: [] });
  const local = fresh();
  { const v = store.get(storeKey); if (v) { try { Object.assign(local, JSON.parse(v)); } catch {} } }
  const save = () => store.set(storeKey, JSON.stringify(local));

  // ---- data helpers ----
  const qs = () => (S && Array.isArray(S.questions) ? S.questions : []);
  const byId = (id) => qs().find((q) => q.id === id);
  const isOpen = (q) => !!q && (q.status === "open" || q.status === "reopened");
  const curRound = () => qs().reduce((m, q) => Math.max(m, Number(q.round) || 0), 0);
  const rounds = () => { const m = new Map(); for (const q of qs()) { const r = Number(q.round) || 0; if (!m.has(r)) m.set(r, []); m.get(r).push(q); } return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  const firstOpen = () => qs().filter((q) => isOpen(q) && Number(q.round) === curRound())[0] || qs().find(isOpen) || qs()[qs().length - 1] || null;
  // The next open question after `id` in list order (wrapping), or null. For layouts that advance after staging.
  const nextOpen = (id) => { const l = qs(), i = l.findIndex((q) => q.id === id); for (let k = 1; k <= l.length; k++) { const q = l[(i + k) % l.length]; if (q.id !== id && isOpen(q) && !local.staged[q.id]) return q; } return null; };
  const locked = () => !!(S && S.finished);
  const visual = () => (S && S.visual && typeof S.visual === "object" ? S.visual : null);
  const hasVisual = () => { const v = visual(); return !!v && (Number(v.version) || 0) >= 1; }; // version 0 = first draw still running, nothing to show
  const drawing = () => { const v = visual(); return v && v.drawing && typeof v.drawing === "object" ? v.drawing : null; };
  const drawStuck = () => { const d = drawing(); return !!d && Date.now() - Date.parse(d.since || 0) > DRAW_GRACE_MS; };
  const activeView = () => (local.view === "visualize" && hasVisual() ? "visualize" : "questions");
  const timeOf = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const fmtMs = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
  const baseName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  const AGENT_NAMES = { claude: "Claude", codex: "Codex", opencode: "OpenCode", pi: "Pi" };
  const agentName = (a) => AGENT_NAMES[a] || (a && a !== "unknown" ? String(a) : "agent");
  // The listener state from state.owner (merged in by the hub from meta.json, plan D3).
  function listener() {
    const o = S && S.owner && typeof S.owner === "object" ? S.owner : null;
    const t = o ? Date.parse(o.heartbeat) : NaN;
    const fresh = Number.isFinite(t) && Date.now() - t < LISTENER_FRESH_MS;
    return fresh ? { on: true, text: `agent listening (${agentName(o.agent)})` } : { on: false, text: "no agent listening: Sends will queue" };
  }

  // ---- fetching: SSE ping → GET state ----
  let inflight = null, again = false;
  function fetchState() {
    if (inflight) { again = true; return inflight; }
    inflight = (async () => { do { again = false; await fetchOnce(); } while (again); })().finally(() => { inflight = null; });
    return inflight;
  }
  async function fetchOnce() {
    let text;
    try {
      const r = await fetch(BASE + "state", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      text = await r.text();
    } catch { trouble(); return; }
    recovered();
    if (text !== raw) { raw = text; try { S = JSON.parse(text); } catch { return; } onState(); } else tick();
  }
  function recovered() {
    troubleSince = 0;
    if (healthTimer) { clearTimeout(healthTimer); healthTimer = null; }
    if (gone) { gone = false; render(); }
  }
  // Something failed to reach the hub: start (or keep) the /health loop.
  let healthTimer = null;
  function trouble() {
    if (!troubleSince) troubleSince = Date.now();
    if (!gone && Date.now() - troubleSince >= GONE_AFTER_MS) { gone = true; render(); } else tick();
    if (!healthTimer) healthTimer = setTimeout(checkHealth, gone ? HEALTH_EVERY_MS : 1000);
  }
  async function checkHealth() {
    healthTimer = null;
    let up = false;
    try { const r = await fetch("/health", { cache: "no-store" }); up = r.ok; } catch {}
    if (up) { presence(); fetchState(); ensureEvents(); return; } // fetchState clears the banner, or re-enters trouble()
    trouble();
  }

  let es = null, hubId = null;
  function openEvents() {
    try { es = new EventSource("/events"); } catch { es = null; trouble(); return; }
    es.addEventListener("hello", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch {}
      const id = `${d.pid}:${d.started}`;
      if (hubId !== null && id !== hubId) presence(); // a new hub process: tell it this tab exists at once
      hubId = id;
      fetchState(); // pings sent while disconnected were missed
    });
    es.addEventListener("s", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (d.id === G.id) fetchState(); });
    es.onerror = () => {
      trouble();
      if (es && es.readyState === EventSource.CLOSED) { es = null; setTimeout(ensureEvents, HEALTH_EVERY_MS); }
    };
  }
  function ensureEvents() { if (!es) openEvents(); }

  // ---- presence (D6) ----
  const tabId = (() => {
    let t = null; try { t = sessionStorage.getItem("grill:tab"); } catch {}
    if (!t || !/^[A-Za-z0-9_-]{1,64}$/.test(t)) { t = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { sessionStorage.setItem("grill:tab", t); } catch {} }
    return t;
  })();
  const presence = () => { fetch(BASE + "presence?tab=" + encodeURIComponent(tabId), { cache: "no-store" }).catch(() => {}); };

  function onState() {
    const handled = Number((S.agent || {}).handled) || 0;
    const still = local.pending.filter((p) => p.seq > handled);
    if (still.length !== local.pending.length) {
      local.pending = still; save();
      if (!still.length) { const cur = byId(selected); if (!cur || !isOpen(cur)) selected = (firstOpen() || {}).id || selected; }
    }
    if (!selected || !byId(selected)) selected = (firstOpen() || {}).id || null;
    render();
  }

  // ---- staging ----
  const st = (id) => (local.staged[id] = local.staged[id] || {});
  const prune = (id) => { const s = local.staged[id]; if (s && !s.answer && !s.defer && !s.reopen && !(s.thread && s.thread.length)) delete local.staged[id]; };
  function stageAnswer(id, answer) { const s = st(id); s.answer = answer; delete s.defer; delete s.reopen; commit(); }
  function stageThread(id, text) { const s = st(id); (s.thread = s.thread || []).push(text); if (local.drafts[id]) delete local.drafts[id].thread; commit(); }
  function stageDefer(id) { const s = st(id); s.defer = true; delete s.answer; delete s.reopen; commit(); }
  function stageReopen(id) { const s = st(id); s.reopen = true; delete s.answer; delete s.defer; commit(); }
  function clearStaged(id) { const s = local.staged[id]; if (s) { delete s.answer; delete s.defer; delete s.reopen; prune(id); } commit(); }
  function removeThread(id, i) { const s = local.staged[id]; if (s && s.thread) { s.thread.splice(i, 1); prune(id); } commit(); }
  function commit() { save(); render(); }
  const draft = (id) => (local.drafts[id] = local.drafts[id] || {});
  // ---- pending: sent, not yet recorded by the agent (agent.handled < seq) ----
  const pendingActions = (id) => local.pending.flatMap((p) => p.actions.filter((a) => a.q === id));
  const lastPending = () => local.pending[local.pending.length - 1] || null;
  const isExploring = (id) => pendingActions(id).some((a) => a.type === "explore");
  const pendingOfType = (t) => local.pending.flatMap((p) => p.actions.filter((a) => a.type === t));
  const isVisualizing = () => pendingOfType("visualize").length > 0 || (!!drawing() && !drawStuck());
  const isFinishing = () => pendingOfType("finish").length > 0;
  const allSettled = () => qs().length > 0 && !qs().some(isOpen);
  function stagedCount() {
    let n = local.vfeedback.length;
    for (const s of Object.values(local.staged)) n += (s.answer ? 1 : 0) + (s.defer ? 1 : 0) + (s.reopen ? 1 : 0) + (s.thread ? s.thread.length : 0);
    return n;
  }
  function stageFeedback(text) { local.vfeedback.push(text); if (local.drafts.__visual) delete local.drafts.__visual.thread; commit(); }
  function removeFeedback(i) { local.vfeedback.splice(i, 1); commit(); }
  function buildActions() {
    const out = [];
    for (const [q, s] of Object.entries(local.staged)) {
      if (s.reopen) out.push({ q, type: "reopen" });
      if (s.defer) out.push({ q, type: "defer" });
      if (s.answer) { const a = { q, type: "answer", kind: s.answer.kind }; if (s.answer.option) a.option = s.answer.option; if (s.answer.text) a.text = s.answer.text; out.push(a); }
      for (const t of s.thread || []) out.push({ q, type: "thread", text: t });
    }
    for (const t of local.vfeedback) out.push({ type: "visual-feedback", text: t });
    return out;
  }
  function sendState(needStaged = true) {
    const a = (S && S.agent) || {};
    if (locked()) return { disabled: true, why: "" };
    if (gone) return { disabled: true, why: "hub down" };
    if (!S) return { disabled: true, why: "" };
    if (needStaged && !stagedCount()) return { disabled: true, why: "" };
    if (a.status === "working") {
      const ms = Date.now() - Date.parse(a.since || 0);
      if (!(ms > WORKING_GRACE_MS)) return { disabled: true, why: "" };
      return { disabled: false, why: `The agent has been working for ${fmtMs(ms)}; it may not be listening.` };
    }
    const lp = lastPending();
    if (lp) { // sent, but the agent has not even picked it up yet: one event in flight at a time
      const ms = Date.now() - Date.parse(lp.at || 0);
      if (!(ms > WORKING_GRACE_MS)) return { disabled: true, why: "" };
      return { disabled: false, why: `Send #${lp.seq} has waited ${fmtMs(ms)} for the agent; it may not be listening.` };
    }
    return { disabled: false, why: "" };
  }
  async function post(actions) {
    let r, j = {};
    try {
      r = await fetch(BASE + "send", { method: "POST", headers: { "content-type": "application/json", "x-grill-token": G.token || "" }, body: JSON.stringify({ actions }) });
      j = await r.json().catch(() => ({}));
    } catch { r = null; trouble(); }
    if (!j.ok) { const w = $("send-why"); if (w) w.textContent = "Send failed: " + (j.error || (r && r.status) || "hub down"); }
    return j.ok ? j : null;
  }
  const record = (j, actions) => local.pending.push({ seq: j.seq, at: new Date().toISOString(), actions });
  async function send() {
    const { disabled } = sendState(); if (disabled) return;
    const actions = buildActions();
    const j = await post(actions);
    if (j) { record(j, actions); local.staged = {}; local.vfeedback = []; confirmFinish = false; commit(); }
  }
  // Finish is not staged: confirming ships everything staged plus the finish action in one event, right away.
  async function finishNow() {
    if (sendState(false).disabled || isFinishing()) return;
    const actions = buildActions().concat([{ type: "finish" }]);
    const j = await post(actions);
    if (j) { record(j, actions); local.staged = {}; local.vfeedback = []; confirmFinish = false; commit(); }
  }
  // Visualize is not staged either: the first click (and Regenerate) is a generate request, like Explore deeper.
  async function visualize() {
    if (sendState(false).disabled || isVisualizing()) return;
    const actions = [{ type: "visualize" }];
    const j = await post(actions);
    if (j) { record(j, actions); local.view = "visualize"; commit(); }
  }
  // Explore deeper skips staging: one click, one event, so the table is on its way at once.
  async function explore(id) {
    if (sendState(false).disabled || isExploring(id)) return;
    const actions = [{ q: id, type: "explore" }];
    const j = await post(actions);
    if (j) { record(j, actions); commit(); }
  }

  // ---- selection and view (the layout reveals; the core decides) ----
  function select(id) {
    if (!byId(id)) return;
    selected = id; render();
    if (L && L.select) L.select(id);
  }
  function move(delta) {
    if (L && L.move) return L.move(delta);
    const order = qs().map((q) => q.id), i = order.indexOf(selected), n = order[i + delta];
    if (n) select(n);
  }
  function setView(v) { local.view = v; commit(); }
  const toggleVisual = () => { if (hasVisual()) setView(activeView() === "visualize" ? "questions" : "visualize"); else visualize(); };

  // ---- rendering ----
  function render() {
    withThreadScroll(() => withInputs(() => {
      document.body.classList.toggle("visualize", activeView() === "visualize");
      renderBanner(); renderHeader();
      if (L) L.renderBody();
      renderFooter();
    }));
  }
  function tick() { renderStatus(); renderSend(); }
  function withInputs(fn) {
    const act = document.activeElement; const keep = act && act.tagName === "TEXTAREA" && act.id ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
    fn();
    if (keep) { const el = $(keep.id); if (el && el !== document.activeElement) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch {} } }
  }
  // Every render replaces the discussion panel with a fresh element, and a fresh element starts
  // at scrollTop 0: a send, or the agent's reply landing, used to throw you back to the top of a
  // long thread. Put the panel back where it was. One that could scroll and sat at the bottom
  // stays at the bottom so new messages arrive in view; a panel now showing another question, the
  // visual's feedback, or a pros and cons table it did not have before starts at the top, as
  // something you have not read yet should. The panel is the layout's `[data-thread]` element
  // (Inbox: aside .msgs).
  const BOTTOM_SLACK = 32; // px from the bottom that still counts as following the thread
  const threadBox = () => document.querySelector("[data-thread]");
  const threadKey = () => {
    if (activeView() === "visualize") return "visual";
    const q = byId(selected);
    return "q:" + (selected || "") + (q && q.explore ? "|x" + (q.explore.at || "") : "");
  };
  let shownThread = null;
  function withThreadScroll(fn) {
    const el = threadBox();
    const was = el && { key: shownThread, top: el.scrollTop, bottom: el.scrollHeight > el.clientHeight + BOTTOM_SLACK && el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK };
    fn();
    shownThread = threadKey();
    const now = threadBox();
    if (now && was && was.key === shownThread) now.scrollTop = was.bottom ? now.scrollHeight : was.top;
  }
  function renderBanner() {
    const b = $("banner"); if (!b) return;
    if (S && S.finished) { b.className = "show done"; b.textContent = `Finished · the design doc was written to ${S.finished.doc || S.doc || "the doc path"}${S.finished.visual ? ", the visual to " + S.finished.visual : ""}${S.finished.at ? " at " + timeOf(S.finished.at) : ""}.`; }
    else if (gone) { b.className = "show"; b.textContent = "Hub down — reconnecting…"; }
    else { b.className = ""; b.textContent = ""; }
  }
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const PHASE_LABEL = { destination: "Destination", frontier: "Frontier", ticket: "Ticket" };
  function renderHeader() {
    renderLayouts();
    if (!S) return;
    const project = baseName(S.project || S.cwd);
    document.title = [project, S.topic || "grill"].filter(Boolean).join(" · ");
    setText("topic", S.topic || "grill");
    setText("doc-path", S.doc || "");
    setText("where", [project, S.branch].filter(Boolean).join(" · "));
    const ph = $("phase");
    if (ph) { const label = PHASE_LABEL[S.phase] || ""; ph.hidden = !label; ph.textContent = label; }
    const terms = Array.isArray(S.terms) ? S.terms : [];
    setText("terms-toggle", `Terms${terms.length ? " · " + terms.length : ""}`);
    const tb = $("terms");
    if (tb) tb.innerHTML = terms.length
      ? terms.map((t) => `<div class="term"><b>${esc(t.term)}</b> — ${esc(t.def)}${t.avoid && t.avoid.length ? `<div class="avoid">Avoid: ${t.avoid.map(esc).join(", ")}</div>` : ""}</div>`).join("")
      : `<div class="term" style="color:var(--ink-3)">No terms yet. The agent adds vocabulary here as it settles.</div>`;
    renderVisualizeButton();
    renderStatus();
  }
  // Links to the built layouts, the current one marked. Hidden while only one is built.
  function renderLayouts() {
    const el = $("layouts"); if (!el || !L) return;
    el.hidden = LAYOUTS.length < 2;
    const html = LAYOUTS.map((l) => `<a href="${esc(BASE + l)}" data-layout="${esc(l)}"${l === L.layout ? ' aria-current="page"' : ""}>${esc(l[0].toUpperCase() + l.slice(1))}</a>`).join("");
    if (el.dataset.html !== html) {
      el.innerHTML = html; el.dataset.html = html;
      el.querySelectorAll("a").forEach((a) => (a.onclick = () => store.set("grill:layout", a.dataset.layout)));
    }
  }
  function renderVisualizeButton() {
    const b = $("visualize"); if (!b) return;
    const v = visual(); const lk = locked();
    if (hasVisual()) { b.hidden = false; b.disabled = false; b.title = ""; b.textContent = activeView() === "visualize" ? "Questions" : `Visual · v${v.version}`; return; }
    if (lk) { b.hidden = true; return; }
    b.hidden = false;
    if (isVisualizing()) { b.disabled = true; b.title = ""; b.innerHTML = `<span class="spin"></span>Visualizing…`; return; }
    const gate = sendState(false); b.disabled = gate.disabled; b.textContent = "Visualize";
    b.title = gate.disabled && gate.why ? gate.why : drawStuck() ? DRAW_STUCK_NOTE : "Draw a prototype or diagram of the design so far";
  }
  // Favicon: an SVG status dot (spec §5 Tabs), in the page's own token colours.
  let iconFor = null;
  function setFavicon(status) {
    if (status === iconFor) return;
    iconFor = status;
    const cs = getComputedStyle(document.documentElement);
    const color = (cs.getPropertyValue(status === "working" ? "--stage" : status === "waiting" ? "--ok" : "--ink-3") || "").trim() || "#9a9285";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.type = "image/svg+xml";
    link.dataset.status = status;
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function renderStatus() {
    const dot = $("agent-dot"), txt = $("agent-status"), hd = document.querySelector("header"), li = $("listener");
    if (gone) { if (dot) dot.className = "dot gone"; if (txt) txt.textContent = "hub down"; if (li) li.textContent = ""; setFavicon("gone"); return; }
    if (!S) return;
    const a = S.agent || {};
    if (S.finished) { if (dot) dot.className = "dot"; if (txt) txt.textContent = "finished"; if (hd) hd.classList.remove("working"); if (li) li.textContent = ""; setFavicon("finished"); return; }
    const working = a.status === "working";
    if (hd) hd.classList.toggle("working", working);
    if (working) { if (dot) dot.className = "dot working"; if (txt) txt.innerHTML = `<span class="spin"></span> Agent working · ${fmtMs(Date.now() - Date.parse(a.since || 0))}`; }
    else { if (dot) dot.className = "dot"; if (txt) txt.textContent = `Agent waiting for you${a.since ? " · since " + timeOf(a.since) : ""}${a.handled ? " · handled #" + a.handled : ""}`; }
    if (li) { const l = listener(); li.textContent = l.text; li.classList.toggle("off", !l.on); }
    setFavicon(working ? "working" : "waiting");
  }
  function renderFooter() {
    const list = $("staged-list"); if (!list) return;
    const n = stagedCount();
    const parts = Object.entries(local.staged).map(([id, s]) => {
      const bits = [];
      if (s.reopen) bits.push("reopen"); if (s.defer) bits.push("defer");
      if (s.answer) bits.push(s.answer.option ? "→ " + s.answer.option : "→ text");
      if (s.thread && s.thread.length) bits.push(`+${s.thread.length} msg`);
      return `${esc(id).toUpperCase()} ${bits.join(" ")}`;
    });
    if (local.vfeedback.length) parts.push(`visual +${local.vfeedback.length} msg`);
    const lp = lastPending();
    const sent = lp ? `<span class="sent"><span class="spin"></span>Sent #${lp.seq} · waiting for the agent</span>` : "";
    list.innerHTML = locked() ? "This grill is finished." : n ? `<b>${n} staged</b> · ${parts.join(" · ")}${sent ? " · " + sent : ""}` : sent || "Nothing staged. Pick an option or write in the discussion.";
    const fa = $("finish-area");
    if (fa) {
      if (locked()) fa.innerHTML = "";
      else if (isFinishing()) fa.innerHTML = `<button id="finish" type="button" disabled><span class="spin"></span>Finishing…</button>`;
      else if (confirmFinish) fa.innerHTML = `<span class="confirm">Finish this grill? Everything staged goes with it; the agent writes the design doc and stops. <button id="finish-yes" type="button">Finish</button><button id="finish-no" type="button">Cancel</button></span>`;
      else {
        const a = (S && S.agent) || {}; const gate = sendState(false);
        const ready = allSettled() && a.status !== "working" && !lp && !gone;
        fa.innerHTML = `<button id="finish" type="button" class="${ready ? "ready" : ""}"${gate.disabled ? " disabled" : ""}${ready ? ` title="Every question is settled. Finish writes the design doc."` : gate.disabled && gate.why ? ` title="${esc(gate.why)}"` : ""}>Finish grill</button>`;
      }
      const f = $("finish"); if (f && !f.disabled) f.onclick = () => { confirmFinish = true; render(); };
      const fy = $("finish-yes"); if (fy) fy.onclick = finishNow;
      const fn = $("finish-no"); if (fn) fn.onclick = () => { confirmFinish = false; render(); };
    }
    renderSend();
  }
  function renderSend() {
    const b = $("send"); if (!b) return;
    const { disabled, why } = sendState(); const n = stagedCount();
    b.disabled = disabled; b.textContent = n ? `Send ${n} to Agent` : "Send to Agent";
    setText("send-why", why);
  }

  // ---- mount ----
  // Grill.mount(hooks), once per page, after the layout's markup exists. Hooks:
  //   layout            "inbox" | "brief" | "studio"  (required; marks the header switch, and an
  //                     explicit layout URL records it as the last-used layout for D1)
  //   renderBody()      draw everything that is not banner/header/footer (required). Called inside
  //                     the core's render wrapper, so focus/caret in a textarea with an id and the
  //                     [data-thread] panel's scroll position survive it.
  //   current()         the id the keyboard acts on (default: Grill.selected)
  //   select(id)        reveal `id` after the core selected it and re-rendered (scroll it into
  //                     view, move focus); optional
  //   move(delta)       next/previous item (default: walk questions in list order via select)
  //   focusThread()     focus the thread composer for the current question, synchronously
  //   focusFree()       focus the free-text answer for the current question, synchronously
  //   highlightTargets(id)  ids whose visual regions to outline when `id` is pointed at (default [id])
  function mount(hooks) {
    if (L) throw new Error("Grill.mount called twice");
    if (!hooks || typeof hooks.renderBody !== "function" || !hooks.layout) throw new Error("Grill.mount needs {layout, renderBody}");
    L = hooks;
    if (!bare) store.set("grill:layout", L.layout);
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on("send", send);
    on("visualize", toggleVisual);
    on("terms-toggle", () => $("terms") && $("terms").classList.toggle("show"));
    document.addEventListener("click", (e) => { const t = $("terms"); if (t && !e.target.closest("#terms") && !e.target.closest("#terms-toggle")) t.classList.remove("show"); });
    document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } });
    setInterval(tick, 1000);
    setInterval(presence, PRESENCE_EVERY_MS);
    presence();
    render();
    openEvents();
    fetchState();
  }

  window.Grill = {
    boot: G, base: BASE, layouts: LAYOUTS,
    get S() { return S; }, local,
    get selected() { return selected; },
    get gone() { return gone; },
    get layout() { return L; },
    // helpers
    $, esc, CHECK, DRAW_STUCK_NOTE, qs, byId, isOpen, curRound, rounds, firstOpen, nextOpen, locked, visual, hasVisual,
    drawing, drawStuck, activeView, timeOf, fmtMs, baseName, listener,
    // staging and pending
    stageAnswer, stageThread, stageDefer, stageReopen, clearStaged, removeThread, stageFeedback, removeFeedback, draft,
    pendingActions, lastPending, isExploring, pendingOfType, isVisualizing, isFinishing, allSettled, stagedCount, buildActions,
    // actions
    sendState, post, send, finishNow, visualize, explore, select, move, setView, toggleVisual,
    current: () => (L && L.current ? L.current() : selected),
    // rendering
    render, commit, save, tick, fetchState, mount,
  };
})();
