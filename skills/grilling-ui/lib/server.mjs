// The hub's HTTP server (spec §5). createHub() builds the server, a route table and the idle
// timer; lifecycle.mjs `cmdServe` binds it and writes hub.json. Later tasks add routes to
// `routes` (session pages/state/send, SSE, presence, maps, claims).
//
// A route is [method, regex, handler]; the regex is matched against the URL pathname and the
// handler gets (req, res, match, url). The first matching route wins; no match → 404 JSON.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { envMs, isObj, rand, readJson, writeJson } from "./util.mjs";
import { ClaimError, PatchError, QUEUED, applyMapPatch, claim, mapDirOf, mapEventsFile, mapFile, mapMetaFile, readMapMeta, release, validateMap } from "./maps.mjs";
import { OPTION_KEY } from "./state.mjs";
import { AGENT_RE, eventsFile, lastSeq, publicOwner, readMeta, sessionDirById, stateFile, takeSession, touchHeartbeat } from "./sessions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Page files are read per request (D7: page edits need no hub restart). GRILL_PAGE_DIR is a test hook.
export const PAGE_DIR = path.join(HERE, "..", "page");
export const LAYOUTS = ["inbox", "brief", "studio"];
export const ASSETS = { "core.js": "text/javascript; charset=utf-8", "tokens.css": "text/css; charset=utf-8", "map-view.js": "text/javascript; charset=utf-8", "board.js": "text/javascript; charset=utf-8" };
const HTML = "text/html; charset=utf-8";
export const BOOT_MARK = "<!--GRILL_BOOT-->";

export const send = (res, code, body, type = "text/plain; charset=utf-8", headers = {}) => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
};
export const json = (res, code, obj) => send(res, code, JSON.stringify(obj), "application/json");
export const readBody = (req, limit = 1 << 20) => new Promise((resolve, reject) => {
  let b = "", n = 0;
  req.on("data", (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } else b += c; });
  req.on("end", () => resolve(b));
  req.on("error", reject);
});

// `<script>window.GRILL=…</script>` for a page. Every "<" (and U+2028/2029) in the JSON is
// written as a \u escape, so no field can close the script tag or open a comment.
export const bootScript = (obj) => `<script>window.GRILL=${JSON.stringify(obj).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}</script>`;
// Constant-time token compare; a missing expected token never matches.
export function tokenOk(expected, given) {
  if (typeof expected !== "string" || !expected || typeof given !== "string") return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const httpError = (status, message) => Object.assign(new Error(message), { status });
// JSON body as an object, or a 400.
async function readJsonBody(req) {
  let v; try { v = JSON.parse(await readBody(req)); } catch (e) { if (e.status) throw e; throw httpError(400, "body must be JSON"); }
  if (!isObj(v)) throw httpError(400, "body must be a JSON object");
  return v;
}

// Idle-exit inputs (spec §5 Idle exit): a fresh owner heartbeat in any unfinished session, or a
// fresh map listener heartbeat. Cheap enough to scan once per tick. A heartbeat more than
// FUTURE_SKEW_MS in the future is not fresh (a bad clock or a hand-edited file must not pin the hub).
export const FUTURE_SKEW_MS = 5000;
export function freshHeartbeat(home, freshMs, now = Date.now()) {
  const fresh = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && now - t < freshMs && t - now <= FUTURE_SKEW_MS; };
  const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; } };
  for (const proj of subdirs(path.join(home, "grill-sessions"))) {
    for (const s of subdirs(proj)) {
      const meta = readJson(path.join(s, "meta.json"));
      if (!isObj(meta) || !isObj(meta.owner) || !fresh(meta.owner.heartbeat)) continue;
      const st = readJson(path.join(s, "state.json"));
      if (isObj(st) && st.finished) continue;
      return true;
    }
  }
  for (const proj of subdirs(path.join(home, "maps"))) {
    for (const m of subdirs(proj)) {
      const map = readJson(path.join(m, "map.json"));
      if (isObj(map) && isObj(map.listener) && fresh(map.listener.heartbeat)) return true;
    }
  }
  return false;
}

// hub: { home, version, codeTime?, log, env? }. Returns the hub object:
//   server, routes, pid, started, adminToken, sse (Set of open /events responses, T12),
//   port (after listen), lastBusy, selfOrigins(), hostOk(req), originOk(req), isAdmin(req),
//   exit(reason), startIdleTimer()
export function createHub({ home, version, codeTime = 0, log = () => {}, env = process.env }) {
  const hub = {
    home, version, codeTime, log, env,
    lastBusy: Date.now(),
    pid: process.pid,
    started: new Date().toISOString(),
    adminToken: rand(32),
    port: 0,
    sse: new Set(),
    routes: [],
    tickMs: envMs("GRILL_TICK_MS", 60_000, env),
    idleMs: envMs("GRILL_IDLE_MS", 1_800_000, env),
    freshMs: envMs("GRILL_FRESH_MS", 180_000, env),
  };
  hub.selfOrigins = () => [`http://127.0.0.1:${hub.port}`, `http://localhost:${hub.port}`];
  // DNS rebinding guard: every request must name the hub by loopback address in Host. The port
  // comes from the bound socket, so this holds before `hub.port` is set.
  hub.hostOk = (req) => {
    const port = hub.server.address()?.port ?? hub.port;
    return [`127.0.0.1:${port}`, `localhost:${port}`].includes(String(req.headers.host || "").toLowerCase());
  };
  // Browsers set Origin on every POST, same-origin or not; a mismatch (another site, or the
  // sandboxed visual iframe whose Origin is "null") is rejected. No Origin at all (curl, the
  // CLI, tests) is allowed; the token check is separate.
  hub.originOk = (req) => req.headers.origin === undefined || hub.selfOrigins().includes(req.headers.origin);
  hub.isAdmin = (req) => req.headers["x-grill-admin"] === hub.adminToken;

  let exiting = false;
  hub.exit = (reason, code = 0) => {
    if (exiting) return; exiting = true;
    log(`exit: ${reason}`);
    for (const r of hub.sse) { try { r.end(); } catch {} }
    hub.server.close();
    hub.server.closeAllConnections?.();
    // Give in-flight responses a moment to flush, but never hang on a stuck socket.
    setTimeout(() => process.exit(code), 50).unref();
    hub.server.on("close", () => process.exit(code));
  };

  const admin = (action) => (req, res) => {
    if (!hub.originOk(req)) return json(res, 403, { error: "cross-origin request rejected" });
    if (!hub.isAdmin(req)) return json(res, 401, { error: "admin token required" });
    res.on("finish", () => hub.exit(action));
    json(res, 200, { ok: true, pid: hub.pid });
  };
  hub.routes.push(
    ["GET", /^\/health$/, (req, res) => json(res, 200, { pid: hub.pid, started: hub.started, version: hub.version, codeTime: hub.codeTime })],
    ["POST", /^\/admin\/handoff$/, admin("handoff")],
    ["POST", /^\/admin\/shutdown$/, admin("shutdown")],
  );
  addSessionRoutes(hub);
  addLiveRoutes(hub);
  addMapRoutes(hub);
  addClaimRoutes(hub);

  hub.server = http.createServer(async (req, res) => {
    hub.lastBusy = Date.now(); // any request (ensure's /health included) restarts the idle clock
    if (!hub.hostOk(req)) return json(res, 403, { error: "bad Host header" });
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return json(res, 400, { error: "bad url" }); }
    try {
      for (const [method, re, handler] of hub.routes) {
        if (req.method !== method) continue;
        const m = re.exec(url.pathname);
        if (m) return await handler(req, res, m, url);
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      log(`error ${req.method} ${url.pathname}:`, e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : "internal error" });
      else res.destroy();
    }
  });

  // Idle exit: every tick, the hub is busy if any /events client is open or any agent heartbeat
  // is fresh; any HTTP request also counts (hub.lastBusy). After idleMs without being busy it exits.
  hub.startIdleTimer = () => {
    hub.lastBusy = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      if (hub.sse.size > 0 || freshHeartbeat(home, hub.freshMs, now)) { hub.lastBusy = now; return; }
      if (now - hub.lastBusy >= hub.idleMs) { clearInterval(iv); hub.exit(`idle for ${now - hub.lastBusy} ms (no SSE client, no fresh heartbeat, no request)`); }
    }, hub.tickMs);
    return iv;
  };
  return hub;
}

// ---- session routes (plan T11; spec §5 Security, D1, D3) ----
//   GET  /s/<id>                       302 → /s/<id>/
//   GET  /s/<id>/[inbox|brief|studio]  layout HTML with the boot script; unbuilt layout → 302 /s/<id>/inbox
//   GET  /assets/<name>                whitelisted page assets
//   GET  /s/<id>/state                 state.json + owner from meta.json (never the token), last-good fallback
//   GET  /s/<id>/visual                visual.html (sandboxed by CSP)
//   GET  /s/<id>/events.jsonl          the raw send log
//   POST /s/<id>/send       {actions}  token + Origin → appends {type:"send",seq,at,session,actions} → {ok,seq}
//   POST /s/<id>/heartbeat  {agentId}  token + Origin → meta.owner.heartbeat (409 if not the owner)
//   POST /s/<id>/take       {agent}    token + Origin → a fresh owner {agentId, agent, heartbeat now}
//                                      → {ok, agentId, handled, pending} (resume, D3)
// The hub is the single writer of meta.json's owner while it runs (like D4 for map.json):
// heartbeat and take each read-modify-write meta.json in one synchronous block (no await between
// the read and the write), so a take and an old owner's heartbeat can never interleave.
//
// hub gains: pageDir, builtLayouts(), sessionDir(id), onSession (array of (id, dir) hooks called
// on every request that resolves a session; T12 attaches its lazy dir watch there),
// checkSessionPost(req, dir) and appendSend(id, dir, actions).
function addSessionRoutes(hub) {
  hub.pageDir = hub.env.GRILL_PAGE_DIR || PAGE_DIR;
  hub.onSession = [];
  hub.builtLayouts = () => LAYOUTS.filter((l) => fs.existsSync(path.join(hub.pageDir, `${l}.html`)));

  const dirs = new Map(); // id → session folder (ids are unique across projects, D2)
  hub.sessionDir = (id) => {
    let dir = dirs.get(id);
    if (!dir || !fs.existsSync(stateFile(dir))) {
      dir = sessionDirById(hub.home, id);
      if (dir) dirs.set(id, dir); else dirs.delete(id);
    }
    if (dir) for (const f of hub.onSession) { try { f(id, dir); } catch (e) { hub.log("onSession hook:", e); } }
    return dir;
  };
  const mustSession = (id) => { const dir = hub.sessionDir(id); if (!dir) throw httpError(404, "no such grill"); return dir; };

  // Origin before token: a foreign page learns nothing about the token from the status.
  hub.checkSessionPost = (req, dir) => {
    if (!hub.originOk(req)) throw httpError(403, "cross-origin request rejected");
    if (!tokenOk(readMeta(dir)?.token, req.headers["x-grill-token"])) throw httpError(401, "session token required");
  };

  // Per-log seq (session send logs here, map event logs in addMapRoutes). The seq read, the
  // increment and the append all run in one synchronous block, so concurrent appends are
  // serialized by the event loop and never share a seq. The cache (keyed by file) is re-read from
  // the log when the file size is not what the hub last wrote (first use, a hub restart, or a line
  // appended by someone else). hub.nextSeq(file) peeks the seq the next append will get; build(seq)
  // returns the event object. Both must run in the same synchronous block as the append.
  const seqs = new Map(); // file → { seq, size }
  const current = (file) => {
    let size = -1; try { size = fs.statSync(file).size; } catch {}
    let c = seqs.get(file);
    if (!c || c.size !== size) c = { seq: lastSeq(file), size };
    return c;
  };
  hub.nextSeq = (file) => current(file).seq + 1;
  hub.appendEvent = (file, build) => {
    const c = current(file), seq = c.seq + 1;
    const line = JSON.stringify(build(seq)) + "\n";
    fs.appendFileSync(file, line);
    seqs.set(file, { seq, size: (c.size < 0 ? 0 : c.size) + Buffer.byteLength(line) });
    return seq;
  };
  hub.appendSend = (id, dir, actions) =>
    hub.appendEvent(eventsFile(dir), (seq) => ({ type: "send", seq, at: new Date().toISOString(), session: dir, actions }));

  const notFoundPage = (res) => send(res, 404, "<!doctype html><meta charset=\"utf-8\"><title>No such grill</title><p>No such grill.</p>", HTML);
  const servePage = (res, id, layout) => {
    const dir = hub.sessionDir(id);
    if (!dir) return notFoundPage(res);
    const built = hub.builtLayouts();
    // An unbuilt layout falls back to the inbox; a missing inbox is a broken install, not a
    // redirect loop.
    const fallback = () => layout !== "inbox" && built.includes("inbox")
      ? send(res, 302, "", "text/plain", { location: `/s/${id}/inbox` })
      : send(res, 500, `page files missing: no inbox.html in ${hub.pageDir}`);
    if (!built.includes(layout)) return fallback();
    let html;
    try { html = fs.readFileSync(path.join(hub.pageDir, `${layout}.html`), "utf8"); }
    catch { return fallback(); }
    const boot = bootScript({ kind: "session", id, token: readMeta(dir)?.token ?? "", base: `/s/${id}/`, layouts: built });
    send(res, 200, html.replace(BOOT_MARK, () => boot), HTML);
  };

  const lastGood = new Map(); // id → last state text that parsed
  const ID = "([A-Za-z0-9-]+)";
  hub.routes.push(
    ["GET", new RegExp(`^/s/${ID}$`), (req, res, m) => send(res, 302, "", "text/plain", { location: `/s/${m[1]}/` })],
    ["GET", new RegExp(`^/s/${ID}/(inbox|brief|studio)?$`), (req, res, m) => servePage(res, m[1], m[2] || "inbox")],
    ["GET", /^\/assets\/([^/]+)$/, (req, res, m) => {
      const name = m[1];
      if (!Object.hasOwn(ASSETS, name)) return json(res, 404, { error: "not found" });
      let body; try { body = fs.readFileSync(path.join(hub.pageDir, name)); } catch { return json(res, 404, { error: "not found" }); }
      send(res, 200, body, ASSETS[name]);
    }],
    ["GET", new RegExp(`^/s/${ID}/state$`), (req, res, m) => {
      const id = m[1], dir = mustSession(id);
      // `patch` swaps state.json in atomically, but a hand-written file can be caught mid-write:
      // then serve the last parse that worked (port $JASON/server.mjs:153-159).
      try {
        const st = JSON.parse(fs.readFileSync(stateFile(dir), "utf8"));
        if (isObj(st)) {
          delete st.token;
          const owner = publicOwner(readMeta(dir));
          if (owner) st.owner = owner; else delete st.owner;
          lastGood.set(id, JSON.stringify(st));
        }
      } catch { /* keep the last good one */ }
      const raw = lastGood.get(id);
      if (raw === undefined) return json(res, 404, { error: "no state" });
      send(res, 200, raw, "application/json");
    }],
    ["GET", new RegExp(`^/s/${ID}/visual$`), (req, res, m) => {
      // Written only by the agent; shown by the page in a sandboxed iframe. The CSP sandbox keeps
      // it at an opaque origin even when opened top-level, so it can never read the page's token.
      const file = path.join(mustSession(m[1]), "visual.html");
      let body; try { body = fs.readFileSync(file); } catch { return json(res, 404, { error: "no visual" }); }
      send(res, 200, body, HTML, { "content-security-policy": "sandbox allow-scripts" });
    }],
    ["GET", new RegExp(`^/s/${ID}/events\\.jsonl$`), (req, res, m) => {
      const file = eventsFile(mustSession(m[1]));
      let body; try { body = fs.readFileSync(file); } catch { body = ""; }
      send(res, 200, body, "application/x-ndjson");
    }],
    ["POST", new RegExp(`^/s/${ID}/send$`), async (req, res, m) => {
      const id = m[1], dir = mustSession(id);
      hub.checkSessionPost(req, dir);
      const body = await readJsonBody(req);
      if (!Array.isArray(body.actions) || body.actions.length === 0) throw httpError(400, "actions must be a non-empty array");
      // Actions are user input the agent reads; reject malformed ones at the door.
      for (const a of body.actions) {
        if (!isObj(a) || typeof a.type !== "string") throw httpError(400, "each action must be an object with a string type");
        if ("option" in a && !(typeof a.option === "string" && OPTION_KEY.test(a.option))) throw httpError(400, `bad option key ${JSON.stringify(a.option)}`);
      }
      const seq = hub.appendSend(id, dir, body.actions);
      json(res, 200, { ok: true, seq });
    }],
    ["POST", new RegExp(`^/s/${ID}/heartbeat$`), async (req, res, m) => {
      const dir = mustSession(m[1]);
      hub.checkSessionPost(req, dir);
      const body = await readJsonBody(req);
      if (typeof body.agentId !== "string" || !body.agentId) throw httpError(400, "agentId must be a non-empty string");
      const now = new Date();
      if (!touchHeartbeat(dir, body.agentId, now)) {
        const owner = publicOwner(readMeta(dir));
        return json(res, 409, { error: "not the session owner", owner: owner ? { agent: owner.agent, heartbeat: owner.heartbeat } : null });
      }
      json(res, 200, { ok: true, heartbeat: now.toISOString() });
    }],
    ["POST", new RegExp(`^/s/${ID}/take$`), async (req, res, m) => {
      const id = m[1], dir = mustSession(id);
      hub.checkSessionPost(req, dir);
      const body = await readJsonBody(req);
      if (typeof body.agent !== "string" || !AGENT_RE.test(body.agent)) throw httpError(400, "agent must be a name of 1-64 printable characters");
      // synchronous from here: read meta → mint the owner → atomic write
      const r = takeSession(dir, body.agent);
      hub.log(`take ${id}: owner is now ${body.agent}`);
      json(res, 200, { ok: true, agentId: r.agentId, handled: r.handled, pending: r.pending });
    }],
  );
}

// ---- SSE, directory watch, presence (plan T12; spec §5 Updates to the page, §6 step 2; D5, D6) ----
//   GET /events                     hub-wide SSE: `retry: 2000`, `event: hello {pid, started}` on
//                                   connect, then `event: s {"id"}` / `event: m {"key"}` pings; a
//                                   `: keep-alive` comment every GRILL_SSE_KEEPALIVE_MS (25 s)
//   GET /s/<id>/presence?tab=<t>    204; records tab → now (403 for a foreign Origin/Sec-Fetch-Site)
//   GET /s/<id>/clients             {count: tabs seen in the last GRILL_PRESENCE_MS (45 s), lastSeen, hubStarted}
//   GET /admin/stats                admin token → {sse: open /events streams, sessions, maps (folders
//                                   with a watch attached), rss} (plan T18: all tabs share one stream)
//
// hub gains: broadcast(event, obj), watchDir(kind, key, dir, files) (lazy fs.watch on a folder,
// filtered by file name, 30 ms debounce per key, pings `kind` with {id|key}), ping(kind, key)
// (the same debounced ping, for the hub's own writes), watchers (Map "kind:key" → watcher),
// presence (Map "kind:key" → {tabs: Map tab → ms, lastSeen}), touchPresence(kind, key, tab),
// clientsOf(kind, key).
export const SESSION_WATCH = ["state.json", "meta.json", "visual.html"];
export const DEBOUNCE_MS = 30;
const TAB_RE = /^[A-Za-z0-9_-]{1,64}$/;
function addLiveRoutes(hub) {
  const keepAliveMs = envMs("GRILL_SSE_KEEPALIVE_MS", 25_000, hub.env);
  const presenceMs = envMs("GRILL_PRESENCE_MS", 45_000, hub.env);

  hub.broadcast = (event, obj) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`;
    for (const r of hub.sse) { try { r.write(frame); } catch { /* closed; removed on "close" */ } }
  };

  // One pending timer per "kind:key": a burst of file events (temp write, rename, meta.json
  // heartbeat) inside DEBOUNCE_MS is one ping.
  const timers = new Map();
  hub.ping = (kind, key) => {
    const k = `${kind}:${key}`;
    if (timers.has(k)) return;
    timers.set(k, setTimeout(() => { timers.delete(k); hub.broadcast(kind, kind === "s" ? { id: key } : { key }); }, DEBOUNCE_MS));
  };

  // fs.watch on the folder, not the file: an atomic rename swaps the file's inode, which ends a
  // file-level watch on macOS (spec §5). A watcher that errors (folder removed) is dropped and
  // re-attached by the next request that resolves the folder.
  hub.watchers = new Map();
  hub.watchDir = (kind, key, dir, files) => {
    const k = `${kind}:${key}`;
    const cur = hub.watchers.get(k);
    if (cur && cur.dir === dir) return;
    if (cur) { try { cur.w.close(); } catch {} hub.watchers.delete(k); }
    let w;
    try {
      w = fs.watch(dir, { persistent: false }, (_, name) => {
        // No name (some platforms): assume it mattered.
        if (!name || files.includes(String(name))) hub.ping(kind, key);
      });
    } catch (e) { hub.log(`watch ${dir}:`, e.code || e.message); return; }
    w.on("error", (e) => { hub.log(`watch ${dir} ended:`, e.code || e.message); try { w.close(); } catch {} if (hub.watchers.get(k)?.w === w) hub.watchers.delete(k); });
    hub.watchers.set(k, { dir, w });
  };
  hub.onSession.push((id, dir) => hub.watchDir("s", id, dir, SESSION_WATCH));

  hub.presence = new Map();
  hub.touchPresence = (kind, key, tab) => {
    const k = `${kind}:${key}`;
    let p = hub.presence.get(k);
    if (!p) hub.presence.set(k, (p = { tabs: new Map(), lastSeen: 0 }));
    const now = Date.now();
    p.tabs.set(tab, now); p.lastSeen = now;
  };
  hub.clientsOf = (kind, key) => {
    const p = hub.presence.get(`${kind}:${key}`), now = Date.now();
    let count = 0;
    if (p) for (const [tab, t] of p.tabs) { if (now - t < presenceMs) count++; else p.tabs.delete(tab); }
    return { count, lastSeen: p?.lastSeen ? new Date(p.lastSeen).toISOString() : null, hubStarted: hub.started };
  };
  // Shared by /s and /m presence routes; `resolve` 404s an unknown session/map.
  // A GET carries no token, so presence only counts the hub's own pages: a foreign Origin, or a
  // Sec-Fetch-Site other than same-origin/none (another site, or another localhost port, which
  // browsers call same-site), is 403. No such headers (curl, tests) is allowed.
  hub.presenceOk = (req) => {
    if (!hub.originOk(req)) return false;
    const site = req.headers["sec-fetch-site"];
    return site === undefined || site === "same-origin" || site === "none";
  };
  hub.presenceRoute = (kind, resolve) => (req, res, m, url) => {
    if (!hub.presenceOk(req)) throw httpError(403, "cross-origin request rejected");
    const key = resolve(m);
    const tab = url.searchParams.get("tab");
    if (!tab || !TAB_RE.test(tab)) throw httpError(400, "tab must be 1-64 of [A-Za-z0-9_-]");
    hub.touchPresence(kind, key, tab);
    res.writeHead(204, { "cache-control": "no-store" }); res.end();
  };
  hub.clientsRoute = (kind, resolve) => (req, res, m) => json(res, 200, hub.clientsOf(kind, resolve(m)));

  const sessionKey = (m) => { if (!hub.sessionDir(m[1])) throw httpError(404, "no such grill"); return m[1]; };
  hub.routes.push(
    ["GET", /^\/admin\/stats$/, (req, res) => {
      if (!hub.originOk(req)) return json(res, 403, { error: "cross-origin request rejected" });
      if (!hub.isAdmin(req)) return json(res, 401, { error: "admin token required" });
      const kinds = [...hub.watchers.keys()].map((k) => k.split(":")[0]);
      json(res, 200, { sse: hub.sse.size, sessions: kinds.filter((k) => k === "s").length, maps: kinds.filter((k) => k === "m").length, rss: process.memoryUsage().rss });
    }],
    ["GET", /^\/events$/, (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`retry: 2000\n\nevent: hello\ndata: ${JSON.stringify({ pid: hub.pid, started: hub.started })}\n\n`);
      hub.sse.add(res);
      const ka = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch {} }, keepAliveMs);
      ka.unref();
      req.socket.setTimeout(0);
      res.on("close", () => { clearInterval(ka); hub.sse.delete(res); hub.lastBusy = Date.now(); });
    }],
    ["GET", /^\/s\/([A-Za-z0-9-]+)\/presence$/, hub.presenceRoute("s", sessionKey)],
    ["GET", /^\/s\/([A-Za-z0-9-]+)\/clients$/, hub.clientsRoute("s", sessionKey)],
  );
}

// ---- map routes (plan T14; spec §4a; D4: the hub is the only writer of map.json) ----
//   GET  /m/<key>                    302 → /m/<key>/
//   GET  /m/<key>/                   board page (page/board.html, placeholder until T34) with the
//                                    boot script {kind:"map", key, token, base}
//   GET  /m/<key>/map                map.json (last-good fallback) or 404
//   POST /m/<key>/patch  {patch, agentId?}   token + Origin → applyMapPatch + validateMap, atomic
//                                    write, `m` ping → {ok, tickets, handled, at}; 400 {error} on a
//                                    rejected patch. agentId equal to listener.agentId refreshes
//                                    the listener heartbeat.
//   POST /m/<key>/heartbeat {agentId} token + Origin → map.json listener {agentId, heartbeat}
//                                    (the latest watcher wins; a map with no map.json yet gets a
//                                    stub {title:"", listener})
//   GET  /m/<key>/presence?tab=<t>, /m/<key>/clients   as for sessions (D6)
// A map exists once its folder has meta.json (created by the first map-patch).
//
// hub gains: mapDir(key) (resolves + attaches the lazy watch), checkMapPost(req, dir),
// readMap(dir) (null when absent; 500 when unparseable), writeMap(key, dir, map) (atomic + ping).
// Every read-modify-write of map.json runs in one synchronous block (no await between the read
// and the write), so concurrent patches, heartbeats and claims (T33) never lose an update.
export const MAP_WATCH = ["map.json", "events.jsonl"];
// m[3]: "/" + sub (or just "/" for the board page); undefined for the bare key (→ 302).
export const MAP_ROUTE = /^\/m\/([a-z0-9-]+)\/([a-z0-9-]+)(\/(map|patch|heartbeat|presence|clients|claim|action)?)?$/;
const BOARD_PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>Board</title>${BOOT_MARK}<p>board</p>`;
function addMapRoutes(hub) {
  hub.mapDir = (key) => {
    const dir = mapDirOf(hub.home, key);
    if (!fs.existsSync(mapMetaFile(dir))) return null;
    hub.watchDir("m", key, dir, MAP_WATCH);
    return dir;
  };
  const mustMap = (key) => { const dir = hub.mapDir(key); if (!dir) throw httpError(404, "no such map"); return dir; };
  hub.checkMapPost = (req, dir) => {
    if (!hub.originOk(req)) throw httpError(403, "cross-origin request rejected");
    if (!tokenOk(readMapMeta(dir)?.token, req.headers["x-grill-token"])) throw httpError(401, "map token required");
  };
  hub.readMap = (dir) => {
    let text; try { text = fs.readFileSync(mapFile(dir), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
    let m; try { m = JSON.parse(text); } catch { m = null; }
    if (!isObj(m)) throw httpError(500, "map.json is not a JSON object; fix it or delete it");
    return m;
  };
  hub.writeMap = (key, dir, map) => { writeJson(mapFile(dir), map); hub.ping("m", key); };

  const lastGood = new Map();
  const handlers = {
    GET: {
      "": (req, res, key) => {
        const dir = hub.mapDir(key);
        if (!dir) return send(res, 404, "<!doctype html><meta charset=\"utf-8\"><title>No such board</title><p>No such board.</p>", HTML);
        let html; try { html = fs.readFileSync(path.join(hub.pageDir, "board.html"), "utf8"); } catch { html = BOARD_PLACEHOLDER; }
        const boot = bootScript({ kind: "map", key, token: readMapMeta(dir)?.token ?? "", base: `/m/${key}/` });
        send(res, 200, html.replace(BOOT_MARK, () => boot), HTML);
      },
      map: (req, res, key) => {
        const dir = mustMap(key);
        try { const text = fs.readFileSync(mapFile(dir), "utf8"); if (isObj(JSON.parse(text))) lastGood.set(key, text); } catch { /* keep the last good one */ }
        const raw = lastGood.get(key);
        if (raw === undefined) return json(res, 404, { error: "no map yet" });
        send(res, 200, raw, "application/json");
      },
      presence: hub.presenceRoute("m", (m) => (mustMap(m.key), m.key)),
      clients: hub.clientsRoute("m", (m) => (mustMap(m.key), m.key)),
    },
    POST: {
      patch: async (req, res, key) => {
        const dir = mustMap(key);
        hub.checkMapPost(req, dir);
        const body = await readJsonBody(req);
        if (!isObj(body.patch)) throw httpError(400, "body must be {\"patch\": {…map fields…}}");
        // synchronous from here: read → merge → validate → write
        const now = new Date().toISOString();
        let next;
        try {
          next = applyMapPatch(hub.readMap(dir) ?? {}, body.patch, now);
          validateMap(next);
        } catch (e) { if (e instanceof PatchError) return json(res, 400, { error: e.message }); throw e; }
        if (typeof body.agentId === "string" && body.agentId && isObj(next.listener) && next.listener.agentId === body.agentId) next.listener = { ...next.listener, heartbeat: now };
        hub.writeMap(key, dir, next);
        json(res, 200, { ok: true, tickets: Array.isArray(next.tickets) ? next.tickets.length : 0, handled: next.handled ?? 0, at: now });
      },
      heartbeat: async (req, res, key) => {
        const dir = mustMap(key);
        hub.checkMapPost(req, dir);
        const body = await readJsonBody(req);
        if (typeof body.agentId !== "string" || !body.agentId) throw httpError(400, "agentId must be a non-empty string");
        const heartbeat = new Date().toISOString();
        const cur = hub.readMap(dir) ?? { title: "" };
        hub.writeMap(key, dir, { ...cur, listener: { agentId: body.agentId, heartbeat } });
        json(res, 200, { ok: true, heartbeat });
      },
    },
  };
  // Routes on the same prefix registered later (T33: claim, action) go in `hub.mapHandlers`.
  hub.mapHandlers = handlers;
  const route = (method) => async (req, res, m, url) => {
    const key = `${m[1]}/${m[2]}`, sub = m[4] ?? "";
    if (m[3] === undefined) return method === "GET" ? send(res, 302, "", "text/plain", { location: `/m/${key}/` }) : json(res, 404, { error: "not found" });
    const h = Object.hasOwn(handlers[method], sub) ? handlers[method][sub] : null;
    if (!h) return json(res, 404, { error: "not found" });
    // presence/clients take (req, res, match, url) with match.key
    if (sub === "presence" || sub === "clients") return h(req, res, { key }, url);
    return h(req, res, key, url);
  };
  hub.routes.push(["GET", MAP_ROUTE, route("GET")], ["POST", MAP_ROUTE, route("POST")]);
}

// ---- claims and board actions (plan T33; spec §4a Actions, Work this ticket, Concurrency; D4, D10) ----
//   POST /m/<key>/claim {ticket}              board "Work this ticket": token + Origin → compare-and-set
//        on map.json (claim(): frontier and no hubClaim) with hubClaim.agentId = the fresh
//        listener's agentId, else "queued"; appends {type:"work", seq, at, ticket} to events.jsonl
//        → 200 {ok, seq, hubClaim}
//   POST /m/<key>/claim {ticket, agentId}     an agent's own claim (hub.mjs claim): same CAS, no
//        event, hubClaim {agentId, at} → 200 {ok, hubClaim}; also adopts a queued board claim
//   POST /m/<key>/claim {ticket, agentId, release: true}   → 200 {ok, released: bool}
//   Errors: 404 {error} (no map.json or unknown ticket), 409 {error, conflict: {ticket, state,
//   hubClaim?, assignee?}}, 400 bad body, 401/403 token/Origin.
//   POST /m/<key>/action {type:"refresh"}     appends {type:"refresh", seq, at} → 200 {ok, seq}
// Board events share one seq counter per map (hub.appendEvent). Each claim is one synchronous
// block from the map.json read to the event append: no await, so the event loop serializes
// concurrent claims and exactly one wins (D4). The map write and the append each fire an `m` ping
// (debounced into one).
function addClaimRoutes(hub) {
  const str = (v) => typeof v === "string" && v !== "";
  const fresh = (l) => { const t = isObj(l) ? Date.parse(l.heartbeat) : NaN; return Number.isFinite(t) && Date.now() - t < hub.freshMs && t - Date.now() <= FUTURE_SKEW_MS; };
  const mustMap = (key) => { const dir = hub.mapDir(key); if (!dir) throw httpError(404, "no such map"); return dir; };
  hub.mapHandlers.POST.claim = async (req, res, key) => {
    const dir = mustMap(key);
    hub.checkMapPost(req, dir);
    const body = await readJsonBody(req);
    if (!str(body.ticket)) throw httpError(400, "ticket must be a non-empty string (a ticket title)");
    if ("agentId" in body && !str(body.agentId)) throw httpError(400, "agentId must be a non-empty string");
    if ("release" in body && typeof body.release !== "boolean") throw httpError(400, "release must be true or false");
    if (body.release && !("agentId" in body)) throw httpError(400, "release needs the claimant's agentId");
    // synchronous from here: read → claim → write → append
    const map = hub.readMap(dir);
    const now = new Date().toISOString(), events = mapEventsFile(dir);
    try {
      if (!map) throw new ClaimError(404, "no map yet (map-patch it first)");
      if (body.release) {
        const next = release(map, body.ticket, body.agentId);
        if (next !== map) hub.writeMap(key, dir, next);
        return json(res, 200, { ok: true, released: next !== map });
      }
      if (str(body.agentId)) {
        const next = claim(map, body.ticket, body.agentId, now);
        if (next !== map) hub.writeMap(key, dir, next);
        return json(res, 200, { ok: true, hubClaim: next.tickets.find((t) => t.title === body.ticket).hubClaim });
      }
      const who = fresh(map.listener) ? map.listener.agentId : QUEUED;
      const next = claim(map, body.ticket, who, now, hub.nextSeq(events));
      hub.writeMap(key, dir, next);
      const seq = hub.appendEvent(events, (n) => ({ type: "work", seq: n, at: now, ticket: body.ticket }));
      json(res, 200, { ok: true, seq, hubClaim: next.tickets.find((t) => t.title === body.ticket).hubClaim });
    } catch (e) {
      if (e instanceof ClaimError) return json(res, e.status, { error: e.message, ...(e.conflict ? { conflict: e.conflict } : {}) });
      throw e;
    }
  };
  hub.mapHandlers.POST.action = async (req, res, key) => {
    const dir = mustMap(key);
    hub.checkMapPost(req, dir);
    const body = await readJsonBody(req);
    if (body.type !== "refresh") throw httpError(400, 'type must be "refresh" (Work this ticket is POST claim)');
    const seq = hub.appendEvent(mapEventsFile(dir), (n) => ({ type: "refresh", seq: n, at: new Date().toISOString() }));
    hub.ping("m", key);
    json(res, 200, { ok: true, seq });
  };
}
