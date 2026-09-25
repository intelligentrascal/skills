// Hub lifecycle (spec §5 Hub lifecycle, Crash recovery; §5b Codex sandbox; decisions D7, D8).
//   ensure: reuse a healthy hub whose /health echoes hub.json's {pid, started} and version, or
//           whose code is at least as new as ours (codeTime; no ping-pong between two installed
//           copies); otherwise take hub.lock (O_EXCL, our pid; stale if that pid is dead or the
//           lock is older than timeoutMs + 20 s), hand off the older hub (SIGTERM if the handoff
//           call fails), spawn `hub.mjs serve` detached in GRILL_HOME on the remembered port,
//           wait ≤ 10 s.
//   serve:  bind 127.0.0.1 on the remembered port (EADDRINUSE: retry 3 s for a handoff in
//           flight, then a free port), write hub.json (0600, with the admin token), idle timer.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
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

const codeFiles = () => [HUB_PATH, ...fs.readdirSync(LIB).filter((f) => f.endsWith(".mjs")).sort().map((f) => path.join(LIB, f))];
// D7: first 12 hex of sha256 over hub.mjs + lib/*.mjs (sorted). GRILL_VERSION_OVERRIDE wins (tests).
export function hubVersion(env = process.env) {
  if (env.GRILL_VERSION_OVERRIDE) return env.GRILL_VERSION_OVERRIDE;
  const h = crypto.createHash("sha256");
  for (const f of codeFiles()) h.update(path.relative(path.dirname(HUB_PATH), f)).update("\0").update(fs.readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 12);
}
// The version hash has no order, so which of two differing hubs is newer comes from codeTime:
// the max mtimeMs over the same file set. GRILL_CODETIME_OVERRIDE wins (tests).
export function hubCodeTime(env = process.env) {
  const o = Number(env.GRILL_CODETIME_OVERRIDE);
  if (env.GRILL_CODETIME_OVERRIDE && Number.isFinite(o)) return o;
  return Math.max(...codeFiles().map((f) => fs.statSync(f).mtimeMs));
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
  return h && h.pid === i.pid && h.started === i.started ? { ...i, version: h.version, codeTime: Number(h.codeTime) || 0 } : null;
}
// Reuse `h` (a liveHub result) instead of replacing it: same version, or its code is at least as
// new as ours. A hub that predates codeTime reports 0 and is always replaced.
const keeps = (h, version, codeTime) => h && (h.version === version || !(codeTime > h.codeTime));
const reuse = (h, version) => ({ ...h, reused: true, ...(h.version === version ? {} : { stale: true }) });

// true when nothing is listening on 127.0.0.1:port (we can bind it).
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
async function waitPortFree(port, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await portFree(port)) return true;
  return false;
}

// true: we hold the lock. false: a live process holds it. A lock is stale when its pid is dead,
// or when it is older than staleMs (its pid was reused by an unrelated live process: no ensure
// holds the lock that long). A lock with no pid yet is another ensure between open and write:
// held, unless it is old enough (5 s) to be a crash between the two.
// Stale removal is race-safe: rename the lock to a unique name, check the renamed file is the
// one judged stale (same text and mtime), and only then delete it; if another ensure had already
// replaced it with a fresh lock, put that back. Then retry O_EXCL.
export function takeLock(file, staleMs) {
  for (;;) {
    try { const fd = fs.openSync(file, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let text, mtime;
      try { text = fs.readFileSync(file, "utf8"); mtime = fs.statSync(file).mtimeMs; } catch { continue; } // vanished: retry
      const pid = Number(text) || 0, age = Date.now() - mtime;
      if (age < staleMs && (pid ? alive(pid) : age < 5000)) return false;
      const aside = `${file}.stale-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      try { fs.renameSync(file, aside); } catch { continue; } // vanished: retry
      let same = false;
      try { same = fs.readFileSync(aside, "utf8") === text && fs.statSync(aside).mtimeMs === mtime; } catch { /* gone */ }
      if (!same) { try { fs.linkSync(aside, file); } catch { /* a newer lock is in place */ } }
      fs.rmSync(aside, { force: true });
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

// Returns hub.json's contents (including adminToken) plus `reused`, and `stale: true` when the
// running hub has a different version whose code is at least as new as ours (it is kept).
// Throws EnsureError.
export async function ensure({ home, version, codeTime = hubCodeTime(), hubPath = HUB_PATH, timeoutMs = 10_000, env = process.env }) {
  const until = Date.now() + timeoutMs, lock = path.join(home, "hub.lock");
  for (;;) {
    const cur = await liveHub(home);
    if (keeps(cur, version, codeTime)) return reuse(cur, version);
    if (takeLock(lock, timeoutMs + 20_000)) {
      try {
        const again = await liveHub(home);
        if (keeps(again, version, codeTime)) return reuse(again, version);
        const remembered = readJson(hubFile(home))?.port || 0;
        if (again) {
          const r = await fetch(`http://127.0.0.1:${again.port}/admin/handoff`, { method: "POST", headers: { "x-grill-admin": again.adminToken }, signal: AbortSignal.timeout(2000) }).catch(() => null);
          if (!r?.ok) {
            // again.pid is verified (its /health echoed hub.json's pid and started).
            try { process.kill(again.pid, "SIGTERM"); } catch { /* already gone */ }
            await waitPortFree(again.port, 3000);
          }
        }
        let offset = 0; try { offset = fs.statSync(logFile(home)).size; } catch { /* no log yet */ }
        // cwd: home, so the detached hub never pins (or dies with) the calling agent's directory.
        // --max-semi-space-size=1 (MB): V8's default young generation lets RSS drift past the §5
        // 80 MB budget under a burst of sends on Node 26 (idle ≈ 73 MB, of which node:http ≈ 19);
        // a 1 MB semi-space keeps it under (test/concurrency.test.mjs, plan T36).
        const child = spawn(process.execPath, ["--max-semi-space-size=1", hubPath, "serve", "--port", String(remembered)],
          { detached: true, stdio: "ignore", cwd: home, env: { ...env, GRILL_HOME: home } });
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
            if (keeps(other, version, codeTime)) return reuse(other, version);
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
  const r = await ensure({ home, version: hubVersion(env), codeTime: hubCodeTime(env), env });
  if (r.stale) process.stderr.write(`grill: a newer hub (${r.version}) is running; using it\n`);
  return { home, ...r };
}

export async function cmdEnsure() {
  let r;
  try { r = await ensureHub(); } catch (e) { die(e instanceof HomeError || e instanceof EnsureError ? e.message : `ensure failed: ${e.message}`, 1); }
  print({ port: r.port, pid: r.pid, version: r.version, started: r.started, reused: r.reused, ...(r.stale ? { stale: true } : {}) });
  process.exit(0); // don't wait on fetch keep-alive sockets
}

export async function cmdServe(o) {
  const env = process.env;
  const home = grillHome(env);
  try { assertWritable(home); } catch (e) { die(e.message, 1); }
  const log = createLog(logFile(home));
  const version = hubVersion(env), codeTime = hubCodeTime(env);
  const hub = createHub({ home, version, codeTime, log, env });
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
        if (keeps(other, version, codeTime)) { log(`port ${current} is held by a healthy hub (pid ${other.pid}); not starting a second one`); process.exit(0); }
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
    writeJson(hubFile(home), { port: hub.port, pid: hub.pid, version, codeTime, started: hub.started, adminToken: hub.adminToken }, 0o600);
  } catch (e) { fatal(`cannot write ${hubFile(home)}: ${e.code || e.message}`); }
  log(`listening on 127.0.0.1:${hub.port} pid ${hub.pid} version ${version}`);
  hub.startIdleTimer();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => hub.exit(sig));
  return hub;
}
