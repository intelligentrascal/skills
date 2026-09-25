// The hub's HTTP server (spec §5). createHub() builds the server, a route table and the idle
// timer; lifecycle.mjs `cmdServe` binds it and writes hub.json. Later tasks add routes to
// `routes` (session pages/state/send, SSE, presence, maps, claims).
//
// A route is [method, regex, handler]; the regex is matched against the URL pathname and the
// handler gets (req, res, match, url). The first matching route wins; no match → 404 JSON.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { envMs, isObj, rand, readJson } from "./util.mjs";

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
