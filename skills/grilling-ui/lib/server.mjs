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
import { envMs, isObj, rand, readJson } from "./util.mjs";
import { eventsFile, lastSeq, publicOwner, readMeta, sessionDirById, stateFile, touchHeartbeat } from "./sessions.mjs";

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

  // Per-session seq. The seq read, the increment and the append all run in one synchronous
  // block, so concurrent sends are serialized by the event loop and never share a seq. The cache
  // is re-read from the log when the file size is not what the hub last wrote (first use, a hub
  // restart, or a line appended by someone else).
  const seqs = new Map(); // id → { seq, size }
  hub.appendSend = (id, dir, actions) => {
    const file = eventsFile(dir);
    let size = -1; try { size = fs.statSync(file).size; } catch {}
    let c = seqs.get(id);
    if (!c || c.size !== size) c = { seq: lastSeq(file), size };
    const seq = c.seq + 1;
    const line = JSON.stringify({ type: "send", seq, at: new Date().toISOString(), session: dir, actions }) + "\n";
    fs.appendFileSync(file, line);
    seqs.set(id, { seq, size: (size < 0 ? 0 : size) + Buffer.byteLength(line) });
    return seq;
  };

  const notFoundPage = (res) => send(res, 404, "<!doctype html><meta charset=\"utf-8\"><title>No such grill</title><p>No such grill.</p>", HTML);
  const servePage = (res, id, layout) => {
    const dir = hub.sessionDir(id);
    if (!dir) return notFoundPage(res);
    const built = hub.builtLayouts();
    if (!built.includes(layout)) return send(res, 302, "", "text/plain", { location: `/s/${id}/inbox` });
    let html;
    try { html = fs.readFileSync(path.join(hub.pageDir, `${layout}.html`), "utf8"); }
    catch { return send(res, 302, "", "text/plain", { location: `/s/${id}/inbox` }); }
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
  );
}
