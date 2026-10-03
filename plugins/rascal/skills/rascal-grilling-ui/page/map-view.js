// Wayfinder Map snapshot view (plan T24, D9; spec §4 wayfinder-ui Map screen, §4a). A shared
// module: the end-of-grill Map screen in every built layout, and the board's styles (T34).
//
//   MapView.render(el, map, { now })   replaces el's content with the snapshot of `map`
//                                      (the spec §4a shape, already validated by the hub)
//
// Header: destination, notes, "Snapshot at <time> · canonical: <link>". Sections (empty ones are
// left out): Decisions so far (title → gist), Frontier, Blocked (with the blockedBy titles),
// Claimed (assignee / hub claim), Closed (gist), Not yet specified (fog), Out of scope.
// Every text is escaped. A link renders as <a> only for an http(s) URL; anything else (a local
// path, a relative link, javascript:) is plain text (§4a "Local file paths render as plain text").
// Styles use the page's tokens only (tokens.css) and are injected once, so every page that loads
// this module shows the map the same way.
(() => {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isHttp = (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u);
  const arr = (v) => (Array.isArray(v) ? v : []);
  // A title (or any label) that links out when `link` is an http(s) URL; a local path is shown as text after it.
  function linked(text, link) {
    if (isHttp(link)) return `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
    return `${esc(text)}${typeof link === "string" && link ? ` <span class="mv-path">${esc(link)}</span>` : ""}`;
  }
  const linkOnly = (link) => (isHttp(link) ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a>` : `<span class="mv-path">${esc(link)}</span>`);
  function when(iso, now) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    const t = d.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    if (!Number.isFinite(now)) return t;
    const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
    const ago = s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
    return `${t} (${ago})`;
  }
  const section = (key, title, items) => (items.length
    ? `<section class="mv-sec" data-sec="${key}"><h3>${esc(title)} <span class="mv-n">${items.length}</span></h3><ul>${items.join("")}</ul></section>` : "");
  function ticket(t) {
    const bits = [];
    if (t.state === "blocked" && arr(t.blockedBy).length) bits.push(`blocked by ${arr(t.blockedBy).map((b) => esc(b)).join(", ")}`);
    if (t.assignee) bits.push(`assignee ${esc(t.assignee)}`);
    else if (t.hubClaim && t.hubClaim.agentId && t.hubClaim.agentId !== "queued") bits.push(`claimed by ${esc(t.hubClaim.agentId)}`);
    else if (t.hubClaim) bits.push("queued");
    if (isHttp(t.session)) bits.push(`<a href="${esc(t.session)}">grilling now →</a>`);
    return `<li class="mv-item mv-ticket" data-title="${esc(t.title)}"><div><span class="mv-chip">${esc(t.type || "task")}</span>${linked(t.title, t.link)}</div>${bits.length ? `<div class="mv-meta">${bits.join(" · ")}</div>` : ""}</li>`;
  }
  function render(el, map, opts = {}) {
    if (!el) return;
    ensureCss();
    const m = map && typeof map === "object" ? map : {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const tickets = arr(m.tickets).filter((t) => t && typeof t === "object");
    const byState = (s) => tickets.filter((t) => t.state === s);
    const note = (d) => `<li class="mv-item"><div>${linked(d.title, d.link)}${d.gist ? ` <span class="mv-arrow">→</span> <span class="mv-gist">${esc(d.gist)}</span>` : ""}</div></li>`;
    const closed = (d) => `<li class="mv-item"><div>${linked(d.title, d.link)}</div>${d.gist ? `<div class="mv-meta">${esc(d.gist)}</div>` : ""}</li>`;
    const snap = [`Snapshot at ${esc(when(m.at, now) || "an unknown time")}`];
    if (typeof m.link === "string" && m.link) snap.push(`canonical: ${linkOnly(m.link)}`);
    el.innerHTML = `<div class="mv">
      <div class="mv-head">
        <div class="mv-kicker">Wayfinder map${m.title ? " · " + esc(m.title) : ""}</div>
        <h2 class="mv-dest">${esc(m.destination || m.title || "Map")}</h2>
        ${m.notes ? `<p class="mv-notes">${esc(m.notes)}</p>` : ""}
        <div class="mv-snap">${snap.join(" · ")}</div>
      </div>
      ${section("decisions", "Decisions so far", arr(m.decisions).filter(Boolean).map(note))}
      ${section("frontier", "Frontier", byState("frontier").map(ticket))}
      ${section("blocked", "Blocked", byState("blocked").map(ticket))}
      ${section("claimed", "Claimed", byState("claimed").map(ticket))}
      ${section("closed", "Closed", arr(m.closed).filter(Boolean).map(closed))}
      ${section("fog", "Not yet specified", arr(m.fog).map((f) => `<li class="mv-item"><div>${esc(f)}</div></li>`))}
      ${section("out", "Out of scope", arr(m.outOfScope).filter(Boolean).map((o) => `<li class="mv-item"><div>${esc(o.gist)}${typeof o.link === "string" && o.link ? ` · ${linkOnly(o.link)}` : ""}</div></li>`))}
    </div>`;
  }
  // page.html's vocabulary: serif headings, the round label's small caps, rule-separated rows,
  // the Recommended tag's chip type. Tokens only.
  const CSS = `
  .mv { max-width: 760px; }
  .mv-kicker, .mv-sec h3 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; margin: 0; }
  .mv-dest { font-family: var(--serif); font-weight: 500; font-size: 30px; line-height: 1.15; margin: 8px 0 10px; }
  .mv-notes { font-size: 15px; color: var(--ink-2); max-width: 62ch; margin: 0 0 8px; white-space: pre-line; }
  .mv-snap { font-size: 12px; color: var(--ink-3); }
  .mv-snap a, .mv-item a { color: var(--accent); }
  .mv-path { color: var(--ink-3); font-size: 12px; word-break: break-all; }
  .mv-sec { margin-top: 28px; }
  .mv-sec h3 { display: flex; gap: 8px; margin-bottom: 4px; } .mv-n { color: var(--ink-3); font-weight: 400; }
  .mv-sec ul { list-style: none; margin: 0; padding: 0; }
  .mv-item { padding: 10px 0; border-top: 1px solid var(--rule); font-size: 14px; }
  .mv-meta { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .mv-gist { color: var(--ink-2); } .mv-arrow { color: var(--ink-3); }
  .mv-chip { display: inline-block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin-right: 8px; }
  .mv-sec[data-sec="closed"] .mv-item > div:first-child { color: var(--ink-2); }
  `;
  function ensureCss() {
    if (document.getElementById("map-view-css")) return;
    const s = document.createElement("style");
    s.id = "map-view-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }
  window.MapView = { render, isHttp, esc };
})();
