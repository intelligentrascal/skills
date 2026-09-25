// Wayfinder ticket board (spec §4a, §5 Tabs, §7 keyboard; plan T34, D5, D6, D10) at /m/<mapKey>/.
// Boot: window.GRILL = {kind:"map", key, token, base:"/m/<key>/"} (lib/server.mjs). Reuses core.js:
// Grill.transport (one shared EventSource, poll fallback, presence) and Grill.keys (keyboard layer,
// toast, `?` cheatsheet).
//
// Columns: Frontier · In progress (state "claimed") · Blocked · Done (map.closed); Fog and Out of
// scope below. A board claim (POST claim) shows "queued" while hubClaim.seq > map.handled, then
// "claimed by <agentId>"; a ticket's `session` URL shows "grilling now →". Refresh (POST action)
// shows "refresh requested" until the agent's next map-patch (map.at changes or handled catches up).
// Links are anchors only for http(s) URLs; anything else is plain text (§4a).
(() => {
  "use strict";
  const G = window.Grill;
  const B = window.GRILL || {};
  if (!G || B.kind !== "map" || typeof B.key !== "string") return;
  const { $, esc } = G;
  const BASE = typeof B.base === "string" ? B.base : "./";
  const LISTENER_FRESH_MS = 180 * 1000; // spec §4a: a heartbeat younger than this = an agent is listening
  const FUTURE_SKEW_MS = 5000;
  const TICK_MS = 5000;                 // listener age and "Updated …" are re-rendered this often
  const REFRESH_GRACE_MS = 5 * 60 * 1000; // a refresh request nobody answered can be sent again after this
  const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor"/><path d="M6 10.4l2.6 2.6L14 7.4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const QUEUED = "queued";

  let M = null, gone = false, selected = null;
  let claiming = null;           // title of the ticket whose claim is in flight
  let refreshReq = null;         // { seq, at (map.at when asked), since (ms) }
  let refreshing = false;        // the refresh POST is in flight
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isHttp = (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u);
  const anchor = (href, text, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  // project = the projectKey's name part ("<name>-<8 hex>", plan D2)
  const project = B.key.split("/")[0].replace(/-[0-9a-f]{8}$/, "");
  // ?from=<session id>: `g i/b/s` and the header link go back to that grill
  const from = (() => { const f = new URLSearchParams(location.search).get("from"); return f && /^[A-Za-z0-9-]{1,80}$/.test(f) ? f : null; })();

  // ---- derived state ----
  const handled = () => (M && Number.isInteger(M.handled) ? M.handled : 0);
  const tickets = () => arr(M && M.tickets).filter((t) => t && typeof t === "object" && typeof t.title === "string");
  const hubClaim = (t) => (t.hubClaim && typeof t.hubClaim === "object" ? t.hubClaim : null);
  const isQueued = (t) => { const h = hubClaim(t); return !!h && Number.isInteger(h.seq) && h.seq > handled(); };
  function listener() {
    const l = M && M.listener && typeof M.listener === "object" ? M.listener : null;
    const t = l ? Date.parse(l.heartbeat) : NaN, now = Date.now();
    const on = Number.isFinite(t) && now - t < LISTENER_FRESH_MS && t - now <= FUTURE_SKEW_MS;
    return { on, agentId: l && l.agentId, text: on ? "agent listening" : "no agent listening: requests queue" };
  }
  function ago(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  }
  const refreshPending = () => !!refreshReq && Date.now() - refreshReq.since < REFRESH_GRACE_MS;

  // ---- columns ----
  const COLS = [
    { key: "frontier", title: "Frontier", empty: "No ticket is ready to start." },
    { key: "progress", title: "In progress", empty: "Nothing claimed." },
    { key: "blocked", title: "Blocked", empty: "Nothing blocked." },
    { key: "done", title: "Done", empty: "Nothing closed yet." },
  ];
  function columns() {
    const ts = tickets();
    return {
      frontier: ts.filter((t) => t.state === "frontier"),
      progress: ts.filter((t) => t.state === "claimed"),
      blocked: ts.filter((t) => t.state === "blocked"),
      done: arr(M && M.closed).filter((c) => c && typeof c === "object" && typeof c.title === "string"),
    };
  }
  function titleHtml(t) {
    return `<div class="t">${isHttp(t.link) ? anchor(t.link, t.title) : esc(t.title)}</div>${typeof t.link === "string" && t.link && !isHttp(t.link) ? `<div class="path-text">${esc(t.link)}</div>` : ""}`;
  }
  function claimHtml(t) {
    const h = hubClaim(t), bits = [];
    if (isQueued(t)) bits.push(`<span class="claim queued"><span class="spin" aria-hidden="true"></span>queued${listener().on ? " · the agent picks it up next" : " · waits for an agent"}</span>`);
    else if (h && h.agentId !== QUEUED) bits.push(`<span class="claim claimed">${CHECK}claimed by ${esc(h.agentId)}</span>`);
    else if (h) bits.push(`<span class="claim claimed">${CHECK}claimed${t.assignee ? " by " + esc(t.assignee) : ""}</span>`);
    if (isHttp(t.session)) bits.push(`<span class="claim">${anchor(t.session, "grilling now →", "go")}</span>`);
    return bits.join("");
  }
  function card(t, col) {
    const chip = col === "done" ? "done" : t.type || "task";
    const meta = [];
    if (arr(t.blockedBy).length) meta.push(`<div class="meta"><b>Blocked by</b> ${arr(t.blockedBy).map(esc).join(", ")}</div>`);
    // the assignee, unless the claim line below already names them
    const h = hubClaim(t), namedByClaim = col === "progress" && h && !isQueued(t) && (h.agentId === t.assignee || h.agentId === QUEUED);
    if (t.assignee && !namedByClaim) meta.push(`<div class="meta"><b>Assignee</b> ${esc(t.assignee)}</div>`);
    let act = "";
    if (col === "frontier") {
      const busy = claiming === t.title;
      act = `<div class="act"><button type="button" class="work" aria-keyshortcuts="w"${busy || gone ? " disabled" : ""}>${busy ? '<span class="spin" aria-hidden="true"></span>Claiming…' : "Work this ticket"}</button></div>`;
    }
    const cls = ["tk", col === "done" ? "done" : "", isQueued(t) ? "queued" : "", t.title === selected ? "sel" : ""].filter(Boolean).join(" ");
    return `<article class="${cls}" data-title="${esc(t.title)}" data-col="${col}" tabindex="-1">
      <span class="chip">${esc(chip)}</span>${titleHtml(t)}${meta.join("")}
      ${col === "progress" ? claimHtml(t) : ""}${col === "done" && t.gist ? `<div class="gist">${esc(t.gist)}</div>` : ""}${act}
    </article>`;
  }

  // ---- rendering ----
  function render() {
    renderBanner(); renderHeader(); renderFooter();
    const main = $("main"), board = $("board"), head = $("head");
    if (!M) return;
    main.removeAttribute("aria-busy");
    const fresh = [`Updated ${esc(ago(M.at) || "at an unknown time")}`];
    if (typeof M.link === "string" && M.link) fresh.push(`canonical: ${isHttp(M.link) ? anchor(M.link, M.link) : `<span class="path-text">${esc(M.link)}</span>`}`);
    const headHtml = `<div class="kicker">Wayfinder board${M.title ? " · " + esc(M.title) : ""}</div>
      <h2 class="dest">${esc(M.destination || M.title || "Map")}</h2>
      ${M.notes ? `<p class="notes">${esc(M.notes)}</p>` : ""}
      <div class="fresh" id="fresh">${fresh.join(" · ")}</div>`;
    if (head.dataset.html !== headHtml) { head.innerHTML = headHtml; head.dataset.html = headHtml; }

    const cols = columns();
    if (selected && !allCards(cols).some((c) => c.title === selected)) selected = null;
    const fog = arr(M.fog).filter((f) => typeof f === "string");
    const out = arr(M.outOfScope).filter((o) => o && typeof o === "object");
    const html = `<div class="cols">${COLS.map((c) => `<section class="col" data-col="${c.key}" aria-label="${c.title}">
        <h2><span>${c.title}</span><span class="n">${cols[c.key].length}</span></h2>
        <div class="list">${cols[c.key].length ? cols[c.key].map((t) => card(t, c.key)).join("") : `<div class="empty">${c.empty}</div>`}</div>
      </section>`).join("")}</div>
      <div class="below">
        <section data-sec="fog" aria-label="Not yet specified"><h2>Not yet specified <span class="n">${fog.length}</span></h2>
          ${fog.length ? `<ul>${fog.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : `<div class="empty">No fog left.</div>`}</section>
        <section data-sec="out" aria-label="Out of scope"><h2>Out of scope <span class="n">${out.length}</span></h2>
          ${out.length ? `<ul>${out.map((o) => `<li>${esc(o.gist)}${typeof o.link === "string" && o.link ? ` · ${isHttp(o.link) ? anchor(o.link, o.link) : `<span class="path-text">${esc(o.link)}</span>`}` : ""}</li>`).join("")}</ul>` : `<div class="empty">Nothing ruled out.</div>`}</section>
      </div>`;
    if (board.dataset.html === html) return;
    // keep focus on the same card (or its button) across the rebuild
    const a = document.activeElement, card0 = a && a.closest ? a.closest(".tk") : null;
    const keep = card0 && board.contains(card0) ? { title: card0.dataset.title, work: a.classList.contains("work") } : null;
    board.innerHTML = html; board.dataset.html = html;
    if (keep) {
      const el = cardEl(keep.title);
      const target = el && (keep.work ? el.querySelector(".work:not(:disabled)") || el : el);
      if (target) target.focus({ preventScroll: true });
    }
  }
  const allCards = (cols = columns()) => COLS.flatMap((c) => cols[c.key].map((t) => ({ title: t.title, col: c.key, t })));
  const cardEl = (title) => [...document.querySelectorAll("#board .tk")].find((e) => e.dataset.title === title) || null;

  function renderBanner() {
    const b = $("banner");
    if (gone) { b.className = "show"; b.textContent = "Hub down — reconnecting…"; }
    else { b.className = ""; b.textContent = ""; }
  }
  function renderHeader() {
    const title = M ? M.title || M.destination || "board" : "board";
    document.title = [project, title].filter(Boolean).join(" · ");
    $("title").textContent = M && M.title ? M.title : "Board";
    $("where").textContent = project;
    const back = $("back");
    if (from) { back.hidden = false; back.href = `/s/${from}/`; }
    renderStatus();
  }
  function renderStatus() {
    const dot = $("listen-dot"), li = $("listener");
    if (gone) { dot.className = "dot gone"; li.textContent = "hub down"; li.className = ""; setFavicon("gone"); return; }
    if (!M) return;
    const l = listener();
    dot.className = "dot" + (l.on ? "" : " off");
    li.textContent = l.text; li.className = l.on ? "" : "off";
    li.title = l.on && l.agentId ? `Watcher ${l.agentId}` : "Work and Refresh requests wait in the board's queue until an agent runs /wayfinder-ui board.";
    const box = $("status"), t = conn.mode === "poll" ? G.POLL_NOTE : "";
    if (box.title !== t) box.title = t;
    setFavicon(l.on ? "listening" : "idle");
  }
  function renderFooter() {
    const q = $("queue"), r = $("refresh");
    const queued = tickets().filter(isQueued).length;
    const parts = [];
    if (!M) parts.push(gone ? "The hub is down." : "Loading the board…");
    else {
      if (queued) parts.push(`<b>${queued} ${queued === 1 ? "request" : "requests"} queued</b>${listener().on ? "" : '<span class="wide"> · no agent is listening; the next /wayfinder-ui board session takes them</span>'}`);
      if (refreshPending()) parts.push(`<span class="sent"><span class="spin" aria-hidden="true"></span>Refresh requested · waiting for the agent</span>`);
      if (!parts.length) parts.push("The board is only as fresh as the agent's last step. Work a frontier ticket, or ask for a refresh.");
    }
    const html = parts.join(" · ");
    if (q.dataset.html !== html) { q.innerHTML = html; q.dataset.html = html; }
    const pending = refreshPending();
    r.disabled = !M || gone || pending || refreshing;
    r.innerHTML = refreshing ? '<span class="spin" aria-hidden="true"></span>Refreshing…' : pending ? "Refresh requested" : "Refresh";
  }
  let iconFor = null;
  function setFavicon(status) {
    if (status === iconFor) return;
    iconFor = status;
    const cs = getComputedStyle(document.documentElement);
    const color = (cs.getPropertyValue(status === "listening" ? "--ok" : "--ink-3") || "").trim() || "#9a9285";
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.type = "image/svg+xml"; link.dataset.status = status;
    link.href = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`);
  }

  // ---- actions ----
  async function post(sub, body) {
    let r = null, j = {};
    try {
      r = await fetch(BASE + sub, { method: "POST", headers: { "content-type": "application/json", "x-grill-token": B.token || "" }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    } catch { conn.trouble(); }
    return { status: r ? r.status : 0, j };
  }
  async function work(title) {
    const t = tickets().find((x) => x.title === title);
    if (!t || t.state !== "frontier" || claiming || gone) return;
    claiming = title; render();
    const { status, j } = await post("claim", { ticket: title });
    claiming = null;
    if (status === 200 && j.ok) {
      // the card moves to In progress with the hub's claim at once; the ping refetch confirms it
      M = { ...M, tickets: arr(M.tickets).map((x) => (x.title === title ? { ...x, state: "claimed", hubClaim: j.hubClaim } : x)) };
    } else if (status === 409) {
      const c = j.conflict || {}, h = c.hubClaim || {};
      const who = c.assignee || (h.agentId && h.agentId !== QUEUED ? h.agentId : h.agentId === QUEUED ? "another request (queued)" : "");
      kb.toast(who ? `Already claimed by ${who}` : `Already claimed: ${j.error || "this ticket is not on the frontier"}`);
    } else if (status === 404) kb.toast("That ticket is no longer on the map.");
    else if (status === 401 || status === 403) kb.toast("The hub refused this board's token; reopen the board from the agent.");
    else kb.toast(status ? `Work this ticket failed: ${j.error || "HTTP " + status}` : "Could not reach the hub.");
    render();
    conn.refetch();
  }
  async function refresh() {
    if (!M || gone || refreshing || refreshPending()) return;
    refreshing = true; renderFooter();
    const { status, j } = await post("action", { type: "refresh" });
    refreshing = false;
    if (status === 200 && j.ok) refreshReq = { seq: j.seq, at: M.at, since: Date.now() };
    else kb.toast(status ? `Refresh failed: ${j.error || "HTTP " + status}` : "Could not reach the hub.");
    renderFooter();
  }

  // ---- selection and keyboard (spec §7: j/k cards, w work, g i/b/s back to the grill, ?) ----
  function select(title, { focus = true } = {}) {
    selected = title;
    document.querySelectorAll("#board .tk.sel").forEach((e) => e.classList.remove("sel"));
    const el = cardEl(title);
    if (el) { el.classList.add("sel"); if (focus) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); } }
    const board = $("board"); board.dataset.html = ""; // the next render re-marks it from `selected`
  }
  function move(delta) {
    const list = allCards(); if (!list.length) return;
    const i = list.findIndex((c) => c.title === selected);
    const n = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + delta));
    select(list[n].title);
  }
  function workKey() {
    const list = allCards();
    let cur = list.find((c) => c.title === selected);
    if (!cur) { cur = list.find((c) => c.col === "frontier"); if (cur) select(cur.title); }
    if (!cur) { kb.toast("No frontier ticket to work on."); return true; }
    if (cur.col !== "frontier") { kb.toast("Only a frontier ticket can be worked on."); return true; }
    work(cur.title); return true;
  }
  const kbd = G.kbd;
  const rows = [
    [kbd("j", "k"), "Next / previous card"],
    [kbd("w"), "Work this ticket (frontier cards)"],
    ...(from ? [[`${kbd("g")} then ${kbd("i", "b", "s")}`, "Back to the grill"]] : []),
    [kbd("Esc"), "Close this"],
    [kbd("?"), "This list"],
  ];
  const kb = G.keys({
    rows,
    handle(k) {
      if (k === "j" || k === "k") { move(k === "j" ? 1 : -1); return true; }
      if (k === "w") return workKey();
      return false;
    },
    go(k) {
      const layout = { i: "inbox", b: "brief", s: "studio" }[k];
      if (layout && from) { location.href = `/s/${from}/${layout}`; return true; }
      return false;
    },
  });

  // ---- connection ----
  const conn = G.transport({
    kind: "m", key: B.key, url: BASE + "map", presence: BASE + "presence",
    onText(text) {
      let m; try { m = JSON.parse(text); } catch { return; }
      if (!m || typeof m !== "object") return;
      M = m;
      if (refreshReq && (M.at !== refreshReq.at || handled() >= refreshReq.seq)) refreshReq = null;
      render();
    },
    onSame: () => { renderStatus(); renderFooter(); },
    onGone(g) { gone = g; render(); },
    onMode: () => renderStatus(),
  });

  // clicks: select a card; its Work button claims; links open as links
  $("board").addEventListener("click", (e) => {
    const el = e.target.closest(".tk"); if (!el) return;
    if (e.target.closest(".work")) { select(el.dataset.title, { focus: false }); work(el.dataset.title); return; }
    if (e.target.closest("a")) return;
    select(el.dataset.title);
  });
  $("refresh").onclick = refresh;
  $("keys-help").onclick = (e) => { e.preventDefault(); kb.openSheet(); };
  setInterval(render, TICK_MS); // listener age, "Updated …" and the refresh grace; unchanged parts are not rebuilt
  render();
  conn.start();
  window.Board = { get map() { return M; }, get selected() { return selected; }, listener, conn };
})();
