// grilling-ui page core, shared by every layout (spec §7 Shared core). Ported from
// jasonku09/grill-with-ui page.html (daafa1e): helpers, staging, pending, send/finish/visualize/
// explore (231-377) and the render wrapper, banner, header, status, footer and send button
// (378-433, 456-466, 591-628). Changed for the hub:
//   - paths are relative to GRILL.base; POSTs carry x-grill-token;
//   - staging lives in localStorage["grill:<sessionId>"] (switching layouts keeps it);
//   - state arrives as an SSE ping on /events → GET state (no 1 s polling); one EventSource per
//     browser, shared through a leader tab, with a 5 s poll fallback (plan T18, Grill.transport);
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
  let gone = false, confirmFinish = false;
  let L = null; // the mounted layout
  const storeKey = "grill:" + (G.id || "");
  const fresh = () => ({ staged: {}, pending: [], drafts: {}, view: "questions", vfeedback: [] });
  // Staging is shared by every tab on this session through localStorage. A tab never writes a
  // stale snapshot: save() re-reads the stored value and applies only what this tab changed since
  // it last read or wrote it (`synced`), per question id (staged), per id and field (drafts), and
  // per list item (pending by seq, visual feedback by text). A `storage` event from another tab
  // replaces `local` (in place: layouts hold a reference) and re-renders; the view stays this tab's.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const objOr = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const listOr = (v) => (Array.isArray(v) ? v : []);
  function parseLocal(text) {
    const o = fresh();
    if (text) { try { const v = JSON.parse(text); if (v && typeof v === "object") Object.assign(o, v); } catch {} }
    o.staged = objOr(o.staged); o.drafts = objOr(o.drafts); o.pending = listOr(o.pending); o.vfeedback = listOr(o.vfeedback);
    return o;
  }
  function mergeMap(stored, mine, was) {
    stored = objOr(stored); mine = objOr(mine); was = objOr(was);
    const out = { ...stored };
    for (const k of new Set([...Object.keys(mine), ...Object.keys(was)])) {
      if (same(mine[k], was[k])) continue; // this tab did not touch it: the stored value stands
      if (k in mine) out[k] = mine[k]; else delete out[k];
    }
    return out;
  }
  function mergeList(stored, mine, was, key) {
    const count = (l) => { const m = new Map(); for (const x of l) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const cm = count(listOr(mine)), cw = count(listOr(was));
    const out = listOr(stored).slice();
    for (const [k, n] of cw) for (let r = n - (cm.get(k) || 0); r > 0; r--) { const i = out.findIndex((x) => key(x) === k); if (i >= 0) out.splice(i, 1); }
    const add = new Map([...cm].map(([k, n]) => [k, n - (cw.get(k) || 0)]));
    for (const x of listOr(mine)) { const k = key(x); if (add.get(k) > 0) { add.set(k, add.get(k) - 1); out.push(x); } }
    return out;
  }
  function merge3(stored, mine, was) {
    const drafts = {};
    const sd = objOr(stored.drafts), md = objOr(mine.drafts), wd = objOr(was.drafts);
    for (const id of new Set([...Object.keys(sd), ...Object.keys(md), ...Object.keys(wd)])) {
      const d = mergeMap(sd[id], md[id], wd[id]);
      if (Object.keys(d).length) drafts[id] = d;
    }
    const seqs = new Set();
    const pending = mergeList(stored.pending, mine.pending, was.pending, (p) => String(p && p.seq))
      .filter((p) => p && !seqs.has(p.seq) && seqs.add(p.seq));
    const scalar = (k) => (same(mine[k], was[k]) ? stored[k] : mine[k]);
    return { ...stored, staged: mergeMap(stored.staged, mine.staged, was.staged), drafts, pending,
      vfeedback: mergeList(stored.vfeedback, mine.vfeedback, was.vfeedback, String), view: scalar("view"), mapView: scalar("mapView") };
  }
  const local = parseLocal(store.get(storeKey));
  let synced = clone(local); // the stored value as this tab last read or wrote it
  function replaceLocal(v) { for (const k of Object.keys(local)) delete local[k]; Object.assign(local, v); if (local.mapView === undefined) delete local.mapView; }
  function save() {
    const merged = merge3(parseLocal(store.get(storeKey)), local, synced);
    replaceLocal(merged);
    synced = clone(merged);
    store.set(storeKey, JSON.stringify(merged));
  }
  // Another tab wrote this session's staging: take it, keeping this tab's own view.
  function adoptStored() {
    const stored = parseLocal(store.get(storeKey));
    const merged = merge3(stored, local, synced);
    merged.view = local.view; merged.mapView = local.mapView;
    replaceLocal(merged);
    synced = stored;
  }

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
  // Wayfinder Map screen (plan T24, D9): a grill finished with kind "map" opens on its map snapshot;
  // "Back to questions" (local.mapView = "questions") shows the layout again.
  const mapReady = () => !!(S && S.finished && S.finished.kind === "map" && S.map && typeof S.map === "object");
  const mapShown = () => mapReady() && local.mapView !== "questions";
  const MAP_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
  // ?from=<this session> lets the board's `g i/b/s` and "← Back to the grill" come back here (plan T34).
  const boardUrl = () => (S && typeof S.mapKey === "string" && MAP_KEY_RE.test(S.mapKey) ? `/m/${S.mapKey}/${G.id ? "?from=" + encodeURIComponent(G.id) : ""}` : null);
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

  // ---- transport (plan T18, D5, D6): one EventSource per browser, poll fallback, presence ----
  // Grill.transport(opts) → conn. Shared by every page on the hub (sessions now, the board in
  // T34), so it knows nothing about sessions. opts:
  //   kind       "s" | "m": the ping event this page follows (D5)
  //   key        the session id (kind "s", matched against {id}) or map key (kind "m", {key})
  //   url        what to GET on a matching ping, on every hello, and every 5 s while polling
  //   presence   the presence URL without ?tab= (D6); pinged at start, every 20 s, on a new hub
  //   onText(text)   the fetched body changed (raw text compare)
  //   onSame()       a fetch or a failure that changed nothing visible: refresh clocks
  //   onGone(gone)   the hub-down state flipped (banner after 3 s without a successful fetch)
  //   onMode(mode)   "sse" | "poll" flipped (for the status tooltip)
  // conn: { start(), refetch() → Promise, trouble(), presence(), gone, mode, leader, tabId }.
  //
  // Leader election: navigator.locks "grill-sse"; the tab holding the lock opens the only
  // /events stream and relays every event (and its open/error) on BroadcastChannel "grill-sse";
  // the others only listen. Closing the leader frees the lock and a waiting tab takes over at
  // once. Every tab counts the shared stream's errors: 3 without an open → that tab polls `url`
  // every 5 s (and says so); the leader closes the stream and retries it every 60 s, and at once
  // when the hub comes back after being unreachable. Without locks or BroadcastChannel each tab
  // opens its own stream.
  const SSE_CHANNEL = "grill-sse";
  const SSE_MAX_ERRORS = 3;
  const POLL_EVERY_MS = 5000;
  const SSE_RETRY_MS = 60 * 1000;
  const SSE_REOPEN_MS = 2000; // a stream the browser gave up on (CLOSED) is reopened after this
  const POLL_NOTE = "Live updates are unavailable, so this tab checks for changes every 5 s (it retries live updates every minute).";
  const tabId = (() => {
    let t = null; try { t = sessionStorage.getItem("grill:tab"); } catch {}
    if (!t || !/^[A-Za-z0-9_-]{1,64}$/.test(t)) { t = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { sessionStorage.setItem("grill:tab", t); } catch {} }
    return t;
  })();
  function transport(o) {
    const noop = () => {};
    const onText = o.onText || noop, onSame = o.onSame || noop, onGone = o.onGone || noop, onMode = o.onMode || noop;
    const field = o.kind === "m" ? "key" : "id";
    let raw = null, gone = false, troubleSince = 0, healthTimer = null;
    let inflight = null, again = false;
    let mode = "sse", errors = 0, pollTimer = null, hubId = null;
    let leader = false, bc = null, es = null, retryTimer = null, started = false;
    const owns = () => leader || !bc; // this tab runs the stream

    // ---- fetching ----
    function refetch() {
      if (inflight) { again = true; return inflight; }
      inflight = (async () => { do { again = false; await fetchOnce(); } while (again); })().finally(() => { inflight = null; });
      return inflight;
    }
    async function fetchOnce() {
      let text;
      try {
        const r = await fetch(o.url, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        text = await r.text();
      } catch { trouble(); return; }
      recovered();
      if (text !== raw) { raw = text; onText(text); } else onSame();
    }
    function recovered() {
      troubleSince = 0;
      if (healthTimer) { clearTimeout(healthTimer); healthTimer = null; }
      if (gone) { gone = false; onGone(false); }
    }
    // Something failed to reach the hub: start (or keep) the /health loop.
    function trouble() {
      if (!troubleSince) troubleSince = Date.now();
      if (!gone && Date.now() - troubleSince >= GONE_AFTER_MS) { gone = true; onGone(true); } else onSame();
      if (!healthTimer) healthTimer = setTimeout(checkHealth, gone ? HEALTH_EVERY_MS : 1000);
    }
    async function checkHealth() {
      healthTimer = null;
      let up = false;
      try { const r = await fetch("/health", { cache: "no-store" }); up = r.ok; } catch {}
      if (!up) { trouble(); return; }
      presence();
      // The hub was unreachable, so the stream's errors said nothing about SSE itself: reopen now.
      if (owns() && !es) openES();
      refetch(); // clears the banner, or re-enters trouble()
    }
    const presence = () => { if (o.presence) fetch(o.presence + "?tab=" + encodeURIComponent(tabId), { cache: "no-store" }).catch(noop); };

    // ---- events (the leader's own, or relayed) ----
    function setMode(m) {
      if (m === mode) return;
      mode = m;
      clearInterval(pollTimer); pollTimer = null;
      if (m === "poll") pollTimer = setInterval(refetch, POLL_EVERY_MS);
      onMode(m);
    }
    function dispatch(ev, d) {
      d = d && typeof d === "object" ? d : {};
      if (ev === "_open") { errors = 0; setMode("sse"); }
      else if (ev === "_err") { errors++; if (errors >= SSE_MAX_ERRORS) setMode("poll"); refetch(); } // the fetch tells a dead hub from a dead stream
      else if (ev === "_state") { errors = d.mode === "poll" ? SSE_MAX_ERRORS : 0; setMode(d.mode === "poll" ? "poll" : "sse"); }
      else if (ev === "hello") {
        // Every hello, cheap: a new hub process (a restart or handoff) learns about this tab at once
        // (it also re-attaches the folder watch), whether or not this tab saw the previous hub's hello.
        presence();
        hubId = `${d.pid}:${d.started}`; errors = 0; setMode("sse");
        refetch(); // pings sent while disconnected were missed
      } else if (ev === o.kind && d[field] === o.key) refetch();
    }
    function emit(ev, d) { if (bc && leader) { try { bc.postMessage({ ev, d }); } catch {} } dispatch(ev, d); }
    function closeES() { if (es) { es.onerror = null; try { es.close(); } catch {} es = null; } }
    function openES() {
      if (es) return;
      clearTimeout(retryTimer); retryTimer = null;
      let cur;
      try { cur = es = new EventSource("/events"); } catch { es = null; emit("_err", {}); retryTimer = setTimeout(openES, SSE_RETRY_MS); return; }
      cur.onopen = () => emit("_open", {});
      for (const ev of ["hello", "s", "m"]) cur.addEventListener(ev, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} emit(ev, d); });
      cur.onerror = () => {
        if (es !== cur) return;
        emit("_err", {});
        if (errors >= SSE_MAX_ERRORS) { closeES(); retryTimer = setTimeout(openES, SSE_RETRY_MS); }
        else if (cur.readyState === EventSource.CLOSED) { closeES(); retryTimer = setTimeout(openES, SSE_REOPEN_MS); }
      };
    }
    function start() {
      if (started) return; started = true;
      const canShare = typeof BroadcastChannel === "function" && !!(navigator.locks && navigator.locks.request);
      if (canShare) {
        try { bc = new BroadcastChannel(SSE_CHANNEL); } catch { bc = null; }
      }
      if (bc) {
        bc.onmessage = (e) => {
          const m = e.data || {};
          if (m.hi) { if (leader) bc.postMessage({ ev: "_state", d: { mode } }); return; }
          if (!leader && typeof m.ev === "string") dispatch(m.ev, m.d);
        };
        // Held until the tab goes away; the next tab in the queue then gets it.
        navigator.locks.request(SSE_CHANNEL, () => new Promise(() => { leader = true; openES(); }));
        bc.postMessage({ hi: 1 }); // a leader already polling says so
      } else openES();
      presence();
      setInterval(presence, PRESENCE_EVERY_MS);
      // Back from the bfcache: the page slept through pings, and its stream may be closed.
      window.addEventListener("pageshow", (e) => {
        if (!e.persisted) return;
        presence();
        if (owns() && (!es || es.readyState === EventSource.CLOSED)) { closeES(); openES(); }
        refetch();
      });
      refetch();
    }
    return {
      start, refetch, trouble, presence,
      get gone() { return gone; },
      get mode() { return mode; },
      get leader() { return owns(); },
      get streaming() { return !!es && es.readyState === EventSource.OPEN; },
      tabId,
    };
  }

  // ---- keyboard layer (plan T19, spec §7 Keyboard shortcuts) ----
  // Grill.keys(opts) → kb. Shared by every page (the board adds its own keys in T34). opts:
  //   rows          [[keys html, action text], …] for the `?` cheatsheet
  //   handle(key, e)  a plain key the page may act on; return true when it did (the key's default
  //                 action is then prevented, so a key that moved focus into a field never types there)
  //   go(key)       the key after `g` (within 1 s); return true when it navigated
  //   send()        ⌘↵ / Ctrl↵, from anywhere (also forwarded from the visual, T20)
  //   closeOverlays()  the page's own popovers (e.g. the terms panel); return true if one closed
  // kb: { toast(text, {undo, ms}), undo() → bool, openSheet(), closeSheet(), closeOverlays() → bool,
  //       off() → bool, setOff(bool) }.
  // Rules: one keydown listener on document; ignored during IME composition; ⌘↵/Ctrl↵ sends and
  // Esc leaves a field / closes an overlay from anywhere; everything else is ignored while Ctrl,
  // Alt or ⌘ is held, while focus is in a text field, and while shortcuts are off
  // (localStorage "grill:keys" = "off", the cheatsheet's switch).
  const inField = (el) => !!el && el !== document.body && !!el.matches && el.matches("input, textarea, select, [contenteditable]:not([contenteditable='false']), [contenteditable]:not([contenteditable='false']) *");
  const KEYS_OFF = "grill:keys";
  const TOAST_MS = 3000;
  function keys(o) {
    const noop = () => false;
    const handle = o.handle || noop, go = o.go || noop, sendKey = o.send || noop, pageOverlays = o.closeOverlays || noop;
    const off = () => store.get(KEYS_OFF) === "off";
    const setOff = (v) => { if (v) store.set(KEYS_OFF, "off"); else { try { localStorage.removeItem(KEYS_OFF); } catch {} } };
    let gAt = 0;

    // toast: role=status, one at a time; an `undo` callback adds an Undo button (and makes `u` undo)
    // The live region exists from the start (empty), so screen readers announce the first toast too.
    let toastEl = document.getElementById("grill-toast"), toastTimer = null, pendingUndo = null;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "grill-toast"; toastEl.className = "toast";
      toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    function hideToast() {
      clearTimeout(toastTimer); toastTimer = null; pendingUndo = null;
      if (toastEl) { toastEl.classList.remove("show"); const b = toastEl.querySelector("button"); if (b && b === document.activeElement) b.blur(); }
    }
    function toast(text, { undo = null, ms = TOAST_MS } = {}) {
      hideToast();
      toastEl.innerHTML = `<span class="toast-text">${esc(text)}</span>${undo ? `<button type="button" class="toast-undo" aria-keyshortcuts="u">Undo</button>` : ""}`;
      pendingUndo = undo;
      if (undo) toastEl.querySelector("button").onclick = () => undoNow();
      toastEl.classList.add("show");
      toastTimer = setTimeout(hideToast, ms);
    }
    function undoNow() { const u = pendingUndo; if (!u) return false; hideToast(); u(); return true; }

    // cheatsheet: role=dialog, focus moves in and comes back on close
    let sheet = null, returnTo = null;
    const sheetOpen = () => !!sheet && !sheet.hidden;
    function buildSheet() {
      sheet = document.createElement("div");
      sheet.id = "grill-keys"; sheet.className = "keys-sheet"; sheet.hidden = true;
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "grill-keys-title");
      sheet.innerHTML = `<div class="keys-panel" tabindex="-1">
          <h2 id="grill-keys-title">Keyboard shortcuts</h2>
          <table><tbody>${(o.rows || []).map(([k, t]) => `<tr><td>${k}</td><td>${esc(t)}</td></tr>`).join("")}</tbody></table>
          <div class="keys-foot"><label><input type="checkbox" role="switch" id="grill-keys-off"> Turn shortcuts off <span class="keys-note">(⌘↵ and Esc still work)</span></label><button type="button" id="grill-keys-close">Close</button></div>
        </div>`;
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
      sheet.querySelector("#grill-keys-close").onclick = closeSheet;
      const sw = sheet.querySelector("#grill-keys-off");
      sw.onchange = () => setOff(sw.checked);
      // keep Tab inside the dialog
      sheet.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        const f = [...sheet.querySelectorAll("input, button")];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
      });
    }
    function openSheet() {
      if (!sheet) buildSheet();
      if (sheetOpen()) return;
      returnTo = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      sheet.querySelector("#grill-keys-off").checked = off();
      sheet.hidden = false;
      sheet.querySelector(".keys-panel").focus();
    }
    function closeSheet() {
      if (!sheetOpen()) return false;
      sheet.hidden = true;
      const r = returnTo; returnTo = null;
      if (r && r.isConnected && r.focus) r.focus(); else if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
      return true;
    }
    const closeOverlays = () => closeSheet() || !!pageOverlays();

    document.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "Enter") { e.preventDefault(); if (!e.repeat) sendKey(); return; }
      if (e.key === "Escape") {
        if (closeOverlays()) { e.preventDefault(); return; }
        const a = document.activeElement; if (inField(a)) a.blur();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey || inField(document.activeElement) || off()) return;
      if (sheetOpen()) { if (e.key === "?") { e.preventDefault(); closeSheet(); } return; }
      if (e.key === "?") { e.preventDefault(); openSheet(); return; }
      if (gAt) {
        const fresh = Date.now() - gAt < 1000; gAt = 0;
        if (fresh && go(e.key)) { e.preventDefault(); return; }
        // not a destination: the key acts as it would have without the `g`
      }
      if (e.key === "g") { gAt = Date.now(); e.preventDefault(); return; }
      if (e.key === "u" && undoNow()) { e.preventDefault(); return; }
      if (handle(e.key, e)) e.preventDefault();
    });
    return { toast, hideToast, undo: undoNow, openSheet, closeSheet, closeOverlays, off, setOff, inField };
  }
  // The §7 table (the board's `w` row is added by the board).
  const kbd = (...ks) => ks.map((k) => `<kbd>${esc(k)}</kbd>`).join(" / ");
  const SESSION_ROWS = [
    [kbd("j", "k"), "Next / previous question"],
    [`${kbd("1")}–${kbd("4")}`, "Pick option A–D (staged)"],
    [kbd("a"), "Accept the recommendation (staged)"],
    [kbd("r"), "Write in this question's discussion"],
    [kbd("f"), "Free-text answer"],
    [kbd("d", "o"), "Defer / reopen (staged)"],
    [kbd("e"), "Explore deeper (sends after a 3 s undo)"],
    [kbd("v"), "Toggle the visual / Visualize"],
    // only the built layouts (plus the Map board): with Inbox alone that is `g m`
    [`${kbd("g")} then ${kbd(...LAYOUTS.filter((l) => l !== "inbox" || LAYOUTS.length > 1).map((l) => l[0]), "m")}`,
      [...LAYOUTS.filter((l) => l !== "inbox" || LAYOUTS.length > 1).map((l) => l[0].toUpperCase() + l.slice(1)), "Map board"].join(" / ")],
    [kbd("u"), "Unstage this question (or undo Explore)"],
    [`${kbd("⌘↵")} / ${kbd("Ctrl↵")}`, "Send, from anywhere, including the visual"],
    [kbd("Esc"), "Leave the text field / close this / leave the visual"],
    [kbd("?"), "This list"],
  ];

  // This session's connection (started by mount).
  const conn = transport({
    kind: "s", key: G.id, url: BASE + "state", presence: BASE + "presence",
    onText(text) { raw = text; try { S = JSON.parse(text); } catch { return; } onState(); },
    onSame: () => tick(),
    onGone(g) { gone = g; render(); },
    onMode: () => renderStatus(),
  });
  const fetchState = () => conn.refetch();

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
  function stageAnswer(id, answer) { const s = st(id); s.answer = answer; delete s.defer; delete s.reopen; restaged(); }
  function stageThread(id, text) { const s = st(id); (s.thread = s.thread || []).push(text); if (local.drafts[id]) delete local.drafts[id].thread; restaged(); }
  function stageDefer(id) { const s = st(id); s.defer = true; delete s.answer; delete s.reopen; restaged(); }
  function stageReopen(id) { const s = st(id); s.reopen = true; delete s.answer; delete s.defer; restaged(); }
  function clearStaged(id) { const s = local.staged[id]; if (s) { delete s.answer; delete s.defer; delete s.reopen; prune(id); } restaged(); }
  function removeThread(id, i) { const s = local.staged[id]; if (s && s.thread) { s.thread.splice(i, 1); prune(id); } restaged(); }
  function commit() { save(); render(); }
  // A staging change clears a failed send's message (it is about staging that no longer exists).
  function restaged() { sendError = null; commit(); }
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
  function stageFeedback(text) { local.vfeedback.push(text); if (local.drafts.__visual) delete local.drafts.__visual.thread; restaged(); }
  function removeFeedback(i) { local.vfeedback.splice(i, 1); restaged(); }
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
    if (inFlight) return { disabled: true, why: "" }; // one POST at a time
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
  // One send, finish, visualize or explore POST at a time (a double click, ⌘↵ twice, a key and a
  // click): set before the first await and shown at once, since sendState() reads it.
  let inFlight = false;
  // A failed POST's message stays under Send until the next successful send or staging change.
  let sendError = null;
  async function post(actions) {
    let r, j = {};
    try {
      r = await fetch(BASE + "send", { method: "POST", headers: { "content-type": "application/json", "x-grill-token": G.token || "" }, body: JSON.stringify({ actions }) });
      j = await r.json().catch(() => ({}));
    } catch { r = null; conn.trouble(); }
    sendError = j.ok ? null : "Send failed: " + (j.error || (r && r.status) || "hub down");
    return j.ok ? j : null;
  }
  async function flight(actions) {
    inFlight = true; render();
    try { return await post(actions); } finally { inFlight = false; }
  }
  const record = (j, actions) => local.pending.push({ seq: j.seq, at: new Date().toISOString(), actions });
  // What a send ships: staging can change while the POST is in flight, so only what was sent is
  // taken out of it afterwards (an answer that still matches, the flags, each sent message once).
  const snapStaged = () => clone({ staged: local.staged, vfeedback: local.vfeedback });
  function dropSent(snap) {
    for (const [id, was] of Object.entries(snap.staged)) {
      const s = local.staged[id]; if (!s) continue;
      if (was.answer && same(s.answer, was.answer)) delete s.answer;
      if (was.defer) delete s.defer;
      if (was.reopen) delete s.reopen;
      for (const t of was.thread || []) { const i = (s.thread || []).indexOf(t); if (i >= 0) s.thread.splice(i, 1); }
      if (s.thread && !s.thread.length) delete s.thread;
      prune(id);
    }
    for (const t of snap.vfeedback) { const i = local.vfeedback.indexOf(t); if (i >= 0) local.vfeedback.splice(i, 1); }
  }
  async function send() {
    const { disabled } = sendState(); if (disabled) return;
    const snap = snapStaged(), actions = buildActions();
    const j = await flight(actions);
    if (j) { record(j, actions); dropSent(snap); confirmFinish = false; commit(); } else render();
  }
  // Finish is not staged: confirming ships everything staged plus the finish action in one event, right away.
  async function finishNow() {
    if (sendState(false).disabled || isFinishing()) return;
    const snap = snapStaged(), actions = buildActions().concat([{ type: "finish" }]);
    const j = await flight(actions);
    if (j) { record(j, actions); dropSent(snap); confirmFinish = false; commit(); } else render();
  }
  // Visualize is not staged either: the first click (and Regenerate) is a generate request, like Explore deeper.
  async function visualize() {
    if (sendState(false).disabled || isVisualizing()) return;
    const actions = [{ type: "visualize" }];
    const j = await flight(actions);
    if (j) { record(j, actions); local.view = "visualize"; commit(); } else render();
  }
  // Explore deeper skips staging: one click, one event, so the table is on its way at once.
  async function explore(id) {
    if (sendState(false).disabled || isExploring(id)) return;
    const actions = [{ q: id, type: "explore" }];
    const j = await flight(actions);
    if (j) { record(j, actions); commit(); } else render();
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

  // ---- this page's shortcuts (§7 table), on the current question ----
  let kb = null;
  const EXPLORE_UNDO_MS = 3000;
  // `e`: a 3 s toast with Undo, then the same immediate send as the button. One explore waits at a
  // time: a second `e` replaces the first (its timer and toast). The gate is checked again when the
  // timer fires, since the agent may have started working (or another send gone out) meanwhile.
  let exploreTimer = null;
  function exploreSoon(id) {
    const can = () => { const q = byId(id); return !!q && !!(q.options || []).length && !locked() && !isExploring(id) && !sendState(false).disabled; };
    if (!can()) return false;
    clearTimeout(exploreTimer);
    const timer = exploreTimer = setTimeout(() => {
      if (exploreTimer !== timer) return;
      exploreTimer = null; kb.hideToast();
      if (can()) explore(id);
      else kb.toast(`Explore ${String(id).toUpperCase()} was not sent: ${sendState(false).why || "the agent is busy"}`);
    }, EXPLORE_UNDO_MS);
    kb.toast(`Exploring ${String(id).toUpperCase()}…`, { undo: () => { if (exploreTimer === timer) { clearTimeout(timer); exploreTimer = null; } }, ms: EXPLORE_UNDO_MS + 500 });
    return true;
  }
  function sessionKey(k) {
    const id = window.Grill.current(), q = byId(id), lk = locked();
    const s = (q && local.staged[q.id]) || {};
    const rec = (q && q.rec) || {};
    if (k === "j" || k === "k") { move(k === "j" ? 1 : -1); return true; }
    if (k === "v") { toggleVisual(); return true; }
    if (k === "r") { if (L.focusThread) L.focusThread(); return true; }
    if (k === "f") { if (L.focusFree && !lk) L.focusFree(); return true; }
    if (!q || lk) return false;
    if (/^[1-4]$/.test(k)) {
      const o = (q.options || [])[Number(k) - 1];
      if (!o) return false; // only options that exist
      stageAnswer(q.id, { kind: o.k === rec.option ? "accept" : "option", option: o.k });
      return true;
    }
    if (k === "a") { if (!rec.option || !(q.options || []).some((o) => o.k === rec.option)) return false; stageAnswer(q.id, { kind: "accept", option: rec.option }); return true; }
    if (k === "d") { if (!isOpen(q)) return false; if (s.defer) clearStaged(q.id); else stageDefer(q.id); return true; }
    if (k === "o") { if (isOpen(q)) return false; if (s.reopen) clearStaged(q.id); else stageReopen(q.id); return true; }
    if (k === "u") { if (!local.staged[q.id]) return false; clearStaged(q.id); return true; }
    if (k === "e") return exploreSoon(q.id);
    return false;
  }
  function sessionGo(k) {
    const layout = { i: "inbox", b: "brief", s: "studio" }[k];
    if (layout) {
      if (!LAYOUTS.includes(layout) || (L && L.layout === layout)) return false;
      store.set("grill:layout", layout); location.href = BASE + layout; return true;
    }
    if (k === "m" && boardUrl()) { location.href = boardUrl(); return true; }
    return false;
  }
  // ---- visual linkage (plan T20, spec §7 Visual linkage) ----
  // The visual (#visual-frame, sandboxed, opaque origin) carries visual-brief.md's verbatim
  // listener: parent → child {highlight:[ids]}; child → parent {clicked:id} and {key:"send"|"escape"}.
  // Only messages from that frame's window count, and only as ids or keys.
  const Q_ID = /^q\d+$/;
  const frameEl = () => $("visual-frame");
  let hoverId = null, shownHl = null;
  function highlight(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && Q_ID.test(x));
    shownHl = list.join(",");
    const f = frameEl();
    if (f && f.contentWindow) f.contentWindow.postMessage({ highlight: list }, "*");
  }
  const targets = (id) => (L && L.highlightTargets ? L.highlightTargets(id) : [id]);
  // Outline the question under the pointer; with the visual open and nothing hovered, the selected one.
  function restHighlight(force) {
    const ids = hoverId ? targets(hoverId) : activeView() === "visualize" && selected ? targets(selected) : [];
    if (force || ids.join(",") !== shownHl) highlight(ids);
  }
  function hover(id) { hoverId = id && byId(id) ? id : null; restHighlight(); }
  function leaveVisual() {
    const f = frameEl(); if (f) f.blur();
    const h = $("card-title");
    if (h && h.getClientRects().length) { h.focus(); return; }
    if (!document.body.hasAttribute("tabindex")) document.body.tabIndex = -1;
    document.body.focus();
  }
  function onFrameMessage(e) {
    const f = frameEl();
    if (!f || !f.contentWindow || e.source !== f.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== "object") return;
    // a click in the visual means the pointer is there, whatever mouseleave the page missed
    if (typeof d.clicked === "string") { if (Q_ID.test(d.clicked) && byId(d.clicked)) { hoverId = null; select(d.clicked); } }
    // keys only while the visual has focus (a key pressed there): a visual cannot send by itself
    else if (document.activeElement !== f) return;
    else if (d.key === "send") send();
    else if (d.key === "escape") leaveVisual();
  }

  function closeTerms() { const t = $("terms"); if (t && t.classList.contains("show")) { t.classList.remove("show"); return true; } return false; }

  // ---- rendering ----
  function render() {
    withThreadScroll(() => withInputs(() => {
      document.body.classList.toggle("visualize", activeView() === "visualize");
      document.body.classList.toggle("mapview", mapShown());
      renderBanner(); renderHeader();
      if (L) L.renderBody();
      renderMap();
      renderFooter();
    }));
    restHighlight();
  }
  // The footer's sent note follows the listener too, and a heartbeat ages past the limit without
  // any state change: re-render everything when the listener flips, the clocks otherwise.
  let shownListening = null;
  function tick() { if (S && shownListening !== null && listener().on !== shownListening) render(); else { renderStatus(); renderSend(); } }
  // Focus survives a render. A layout keeps the textarea being typed in as the same element when
  // its question did not change (IME composition and undo live on the element); anything else
  // focused in the page (an option, a button, a link) that the render replaced gets focus back on
  // its equivalent: same id, or same data-opt/-go/-rm/-rmf/-layout in the same region.
  const FOCUS_ATTRS = ["data-opt", "data-go", "data-rm", "data-rmf", "data-layout"];
  function focusSpot() {
    const a = document.activeElement;
    if (!a || a === document.body || !a.closest) return null;
    const region = a.closest("main, aside, header, #banner, footer, #map-screen");
    if (!region) return null;
    const spot = { el: a, region: region.id ? "#" + region.id : region.tagName.toLowerCase() };
    if (a.id) spot.id = a.id;
    else { const at = FOCUS_ATTRS.find((x) => a.hasAttribute(x)); if (at) spot.sel = `[${at}="${CSS.escape(a.getAttribute(at))}"]`; }
    if (a.tagName === "TEXTAREA") { spot.s = a.selectionStart; spot.e = a.selectionEnd; }
    return spot;
  }
  function restoreFocus(spot) {
    if (!spot || spot.el.isConnected) return; // still there: focus is where it was, or was moved on purpose
    const now = document.activeElement; if (now && now !== document.body) return;
    const ok = (el) => (el && el.isConnected && !el.matches(":disabled") && el.getClientRects().length ? el : null);
    const t = ok(spot.id ? $(spot.id) : spot.sel ? document.querySelector(`${spot.region} ${spot.sel}`) : null)
      || (spot.id === "finish" ? ok($("finish-yes")) : spot.id === "finish-yes" || spot.id === "finish-no" ? ok($("finish")) : null)
      || (spot.region === "#main" ? ok($("card-title")) : null);
    if (!t) return;
    t.focus({ preventScroll: true });
    if (spot.s != null && t.setSelectionRange) { try { t.setSelectionRange(spot.s, spot.e); } catch {} }
  }
  function withInputs(fn) {
    const spot = focusSpot();
    fn();
    restoreFocus(spot);
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
    const f = S && S.finished;
    if (f && f.kind === "no-map") { b.className = "show done"; b.textContent = "No map needed — see terminal"; }
    else if (f && f.kind === "map") {
      b.className = "show done";
      b.innerHTML = `Finished · the Wayfinder map is on the tracker${f.at ? " at " + esc(timeOf(f.at)) : ""}.${mapReady() && !mapShown() ? ' <a href="#" id="show-map">Show the map</a>' : ""}`;
      const a = $("show-map"); if (a) a.onclick = (e) => { e.preventDefault(); setMapView(true); };
    }
    else if (f) { b.className = "show done"; b.textContent = `Finished · the design doc was written to ${f.doc || S.doc || "the doc path"}${f.visual ? ", the visual to " + f.visual : ""}${f.at ? " at " + timeOf(f.at) : ""}.`; }
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
  // The Map screen: #map-screen (the layout provides the slot) gets a bar (Back to questions, Open
  // board →) and the MapView snapshot. Rebuilt only when the map or the board link changes.
  function setMapView(on) {
    local.mapView = on ? "map" : "questions"; commit();
    const t = on ? $("map-back") : $("show-map") || $("card-title");
    if (t) t.focus();
  }
  let shownMap = null;
  function renderMap() {
    const el = $("map-screen"); if (!el) return;
    if (!mapShown()) { el.hidden = true; return; }
    el.hidden = false;
    const key = JSON.stringify([S.map, boardUrl()]);
    if (key === shownMap) return;
    shownMap = key;
    const board = boardUrl();
    el.innerHTML = `<div class="map-bar"><button type="button" id="map-back">Back to questions</button>${board ? `<a id="open-board" href="${esc(board)}">Open board →</a>` : ""}</div><div id="map-body"></div>`;
    $("map-back").onclick = () => setMapView(false);
    if (window.MapView) window.MapView.render($("map-body"), S.map, { now: Date.now() });
    else $("map-body").textContent = "The map view failed to load.";
  }
  function renderStatus() {
    const dot = $("agent-dot"), txt = $("agent-status"), hd = document.querySelector("header"), li = $("listener");
    const box = document.querySelector("header .status");
    if (box) { const t = conn.mode === "poll" ? POLL_NOTE : ""; if (box.title !== t) box.title = t; }
    if (gone) { if (dot) dot.className = "dot gone"; if (txt) txt.textContent = "hub down"; if (li) li.textContent = ""; setFavicon("gone"); return; }
    if (!S) return;
    const a = S.agent || {};
    if (S.finished) { if (dot) dot.className = "dot"; if (txt) txt.textContent = "finished"; if (hd) hd.classList.remove("working"); if (li) li.textContent = ""; setFavicon("finished"); return; }
    const working = a.status === "working";
    if (hd) hd.classList.toggle("working", working);
    const l = listener();
    const handled = a.handled ? " · handled #" + a.handled : "";
    if (working) { if (dot) dot.className = "dot working"; if (txt) txt.innerHTML = `<span class="spin"></span> Agent working · ${fmtMs(Date.now() - Date.parse(a.since || 0))}`; }
    else if (l.on) { if (dot) dot.className = "dot"; if (txt) txt.textContent = `Agent waiting for you${a.since ? " · since " + timeOf(a.since) : ""}${handled}`; }
    else {
      // Nobody is listening: the agent is not waiting for anything, so say what a Send does now
      // (the status line carries it; the separate listener note would only repeat it).
      const lp = lastPending();
      if (dot) dot.className = "dot off";
      if (txt) txt.textContent = lp ? `Sent #${lp.seq} · queued until an agent resumes${handled}` : `No agent listening${handled} · Sends will queue · resume the grill in your agent to continue`;
    }
    if (li) { li.textContent = working || l.on ? l.text : ""; li.classList.toggle("off", !l.on); }
    setFavicon(working ? "working" : l.on ? "waiting" : "idle");
  }
  function renderFooter() {
    const list = $("staged-list"); if (!list) return;
    const n = stagedCount();
    const parts = Object.entries(local.staged).map(([id, s]) => {
      const bits = [];
      if (s.reopen) bits.push("reopen"); if (s.defer) bits.push("defer");
      if (s.answer) bits.push(s.answer.option ? "→ " + esc(s.answer.option) : "→ text");
      if (s.thread && s.thread.length) bits.push(`+${esc(s.thread.length)} msg`);
      return `${esc(String(id).toUpperCase())} ${bits.join(" ")}`;
    });
    if (local.vfeedback.length) parts.push(`visual +${local.vfeedback.length} msg`);
    const lp = lastPending();
    shownListening = listener().on;
    const sent = lp ? `<span class="sent"><span class="spin"></span>Sent #${esc(lp.seq)} · ${listener().on ? "waiting for the agent" : "queued until an agent resumes"}</span>` : "";
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
    setText("send-why", sendError || why);
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
  // The layout calls Grill.hover(id) when the pointer is over a question (list item, card) and
  // Grill.hover(null) when it leaves; the core outlines those regions in #visual-frame (T20). The
  // core owns the keyboard (Grill.keys, T19) and the frame's messages (click → select, ⌘↵ → send,
  // Esc → focus back to #card-title or the body).
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
    kb = keys({ rows: SESSION_ROWS, handle: sessionKey, go: sessionGo, send, closeOverlays: closeTerms });
    on("keys-help", (e) => { e.preventDefault(); kb.openSheet(); });
    window.addEventListener("message", onFrameMessage);
    // another tab on this session staged, sent or typed a draft (item: tabs never clobber staging)
    window.addEventListener("storage", (e) => { if (e.key === storeKey || e.key === null) { adoptStored(); render(); } });
    // back from the bfcache: staging may have moved on in another tab (the transport refetches state)
    window.addEventListener("pageshow", (e) => { if (e.persisted) { adoptStored(); render(); } });
    { const f = frameEl(); if (f) { f.addEventListener("load", () => restHighlight(true)); f.addEventListener("mouseenter", () => hover(null)); } } // a (re)loaded visual starts unhighlighted
    setInterval(tick, 1000);
    render();
    conn.start();
  }

  window.Grill = {
    boot: G, base: BASE, layouts: LAYOUTS,
    // shared with the board (T34): the connection factory, and this page's connection
    transport, conn, POLL_NOTE, keys, inField, kbd,
    get kb() { return kb; },
    highlight, hover, mapReady, mapShown, setMapView, boardUrl,
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
