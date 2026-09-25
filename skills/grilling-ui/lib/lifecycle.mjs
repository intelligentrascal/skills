// Hub lifecycle (spec §5 Hub lifecycle, Crash recovery; §5b Codex sandbox; decisions D7, D8).
//   ensure: reuse a healthy hub whose /health echoes hub.json's {pid, started} and version;
//           otherwise take hub.lock (O_EXCL, our pid; stale only if that pid is dead), hand off an
//           old-version hub, spawn `hub.mjs serve` detached on the remembered port, wait ≤ 10 s.
//   serve:  bind 127.0.0.1 on the remembered port (EADDRINUSE: retry 3 s for a handoff in
//           flight, then a free port), write hub.json (0600, with the admin token), idle timer.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { die, print, readJson, sleep, writeJson } from "./util.mjs";
import { grillHome, assertWritable, codexFix, HomeError } from "./home.mjs";
import { createLog } from "./log.mjs";
import { createHub } from "./server.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));
export const HUB_PATH = path.join(LIB, "..", "hub.mjs");
const BIND_DENIED = ["EPERM", "EACCES"];
export const hubFile = (home) => path.join(home, "hub.json");
export const logFile = (home) => path.join(home, "logs", "hub.log");

// D7: first 12 hex of sha256 over hub.mjs + lib/*.mjs (sorted). GRILL_VERSION_OVERRIDE wins (tests).
export function hubVersion(env = process.env) {
  if (env.GRILL_VERSION_OVERRIDE) return env.GRILL_VERSION_OVERRIDE;
  const h = crypto.createHash("sha256");
  const files = [HUB_PATH, ...fs.readdirSync(LIB).filter((f) => f.endsWith(".mjs")).sort().map((f) => path.join(LIB, f))];
  for (const f of files) h.update(path.relative(path.dirname(HUB_PATH), f)).update("\0").update(fs.readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 12);
}

export async function health(port, ms = 800) {
  if (!Number.isInteger(port) || port <= 0) return null;
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; }
}
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// hub.json (with adminToken) if the hub it names is up and is really that hub, else null.
export async function liveHub(home) {
  const i = readJson(hubFile(home));
  if (!i) return null;
  const h = await health(i.port);
  return h && h.pid === i.pid && h.started === i.started ? { ...i, version: h.version } : null;
}

// true: we hold the lock. false: a live process holds it. A lock whose pid is dead is stale and
// removed. A lock with no pid yet is another ensure between open and write: held, unless it is
// old enough (5 s) to be a crash between the two.
function takeLock(file) {
  for (;;) {
    try { const fd = fs.openSync(file, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let text, mtime;
      try { text = fs.readFileSync(file, "utf8"); mtime = fs.statSync(file).mtimeMs; } catch { continue; } // vanished: retry
      const pid = Number(text) || 0;
      if (pid && alive(pid)) return false;
      if (!pid && Date.now() - mtime < 5000) return false;
      fs.rmSync(file, { force: true });
    }
  }
}
function releaseLock(file) {
  try { if (Number(fs.readFileSync(file, "utf8")) === process.pid) fs.rmSync(file, { force: true }); } catch { /* gone */ }
}

// The message a spawned hub logged as fatal since `offset` (it has no stderr: stdio "ignore").
function fatalSince(home, offset) {
  try {
    const buf = fs.readFileSync(logFile(home));
    const text = buf.subarray(Math.min(offset, buf.length)).toString("utf8");
    const i = text.lastIndexOf(" fatal: ");
    return i >= 0 ? text.slice(i + " fatal: ".length).trim() : null;
  } catch { return null; }
}

export class EnsureError extends Error {}

// Returns hub.json's contents (including adminToken) plus `reused`. Throws EnsureError.
export async function ensure({ home, version, hubPath = HUB_PATH, timeoutMs = 10_000, env = process.env }) {
  const until = Date.now() + timeoutMs, lock = path.join(home, "hub.lock");
  for (;;) {
    const cur = await liveHub(home);
    if (cur && cur.version === version) return { ...cur, reused: true };
    if (takeLock(lock)) {
      try {
        const again = await liveHub(home);
        if (again && again.version === version) return { ...again, reused: true };
        const remembered = readJson(hubFile(home))?.port || 0;
        if (again) {
          await fetch(`http://127.0.0.1:${again.port}/admin/handoff`, { method: "POST", headers: { "x-grill-admin": again.adminToken }, signal: AbortSignal.timeout(2000) }).catch(() => {});
        }
        let offset = 0; try { offset = fs.statSync(logFile(home)).size; } catch { /* no log yet */ }
        const child = spawn(process.execPath, [hubPath, "serve", "--port", String(remembered)],
          { detached: true, stdio: "ignore", env: { ...env, GRILL_HOME: home } });
        let exited = null;
        child.on("exit", (code, sig) => { exited = code ?? sig; });
        child.unref();
        const spawnUntil = Date.now() + timeoutMs;
        for (; Date.now() < spawnUntil; await sleep(100)) {
          const up = await liveHub(home);
          if (up && up.pid !== again?.pid && up.version === version) return { ...up, reused: false };
          if (exited !== null) {
            // A racing hub that found a healthy one exits 0 quietly: re-check before failing.
            const other = await liveHub(home);
            if (other && other.version === version) return { ...other, reused: true };
            throw new EnsureError(fatalSince(home, offset) || `the hub exited (${exited}) before answering /health; see ${logFile(home)}`);
          }
        }
        throw new EnsureError(`the hub did not answer /health within ${Math.round(timeoutMs / 1000)} s; see ${logFile(home)}`);
      } finally { releaseLock(lock); }
    }
    // Another ensure holds the lock and is starting the hub: it has up to timeoutMs, we wait a bit longer.
    if (Date.now() > until + 5000) throw new EnsureError("timed out waiting for another ensure to start the hub");
    await sleep(100);
  }
}

// For CLI commands that need the hub (new, patch, url, open, watch, wait, map-patch …).
// Throws HomeError (unwritable home, message = Codex fix) or EnsureError.
export async function ensureHub(env = process.env) {
  const home = grillHome(env);
  assertWritable(home);
  return { home, ...(await ensure({ home, version: hubVersion(env), env })) };
}

export async function cmdEnsure() {
  let r;
  try { r = await ensureHub(); } catch (e) { die(e instanceof HomeError || e instanceof EnsureError ? e.message : `ensure failed: ${e.message}`, 1); }
  print({ port: r.port, pid: r.pid, version: r.version, started: r.started, reused: r.reused });
  process.exit(0); // don't wait on fetch keep-alive sockets
}

export async function cmdServe(o) {
  const env = process.env;
  const home = grillHome(env);
  try { assertWritable(home); } catch (e) { die(e.message, 1); }
  const log = createLog(logFile(home));
  const version = hubVersion(env);
  const hub = createHub({ home, version, log, env });
  const explicit = o.port !== undefined && o.port !== true;
  const port = explicit ? Number(o.port) : readJson(hubFile(home))?.port || 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) die(`--port must be a port number, not ${o.port}`);
  const fatal = (msg) => { log(`fatal: ${msg}`); die(msg, 1); };
  process.on("uncaughtException", (e) => { log("uncaught:", e); process.exit(1); });

  await new Promise((resolve) => {
    const retryUntil = Date.now() + 3000;
    let current = port;
    const attempt = (p) => {
      current = p;
      if (env.GRILL_TEST_BIND_ERROR) return onError(Object.assign(new Error("simulated bind error"), { code: env.GRILL_TEST_BIND_ERROR }));
      hub.server.listen(p, "127.0.0.1");
    };
    const onError = async (e) => {
      if (BIND_DENIED.includes(e.code)) return fatal(codexFix("bind 127.0.0.1", e.code, home));
      if (e.code === "EADDRINUSE" && current !== 0) {
        if (Date.now() < retryUntil) return void setTimeout(() => attempt(current), 100);
        const other = await liveHub(home);
        if (other && other.version === version) { log(`port ${current} is held by a healthy hub (pid ${other.pid}); not starting a second one`); process.exit(0); }
        log(`port ${current} still in use after 3 s; falling back to a free port`);
        return attempt(0);
      }
      fatal(`cannot listen on 127.0.0.1:${current}: ${e.code || e.message}`);
    };
    hub.server.on("error", (e) => { if (!hub.server.listening) onError(e); else log("server error:", e); });
    hub.server.once("listening", resolve);
    attempt(port);
  });

  hub.port = hub.server.address().port;
  try {
    writeJson(hubFile(home), { port: hub.port, pid: hub.pid, version, started: hub.started, adminToken: hub.adminToken }, 0o600);
  } catch (e) { fatal(`cannot write ${hubFile(home)}: ${e.code || e.message}`); }
  log(`listening on 127.0.0.1:${hub.port} pid ${hub.pid} version ${version}`);
  hub.startIdleTimer();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => hub.exit(sig));
  return hub;
}
