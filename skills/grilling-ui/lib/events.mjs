// events.jsonl readers and the listening commands `watch` and `wait` (spec §5 Per-agent watcher,
// Session ownership; §5b Listening; §4a Board watcher; §10 "watch has no gap between drain and
// tail"; plan T13, D11). readEvents/lastSeq are ported from jasonku09/grill-with-ui
// server.mjs:90-99 (daafa1e); sessions.mjs re-exports them.
//
//   --after defaults to state.agent.handled (a map: map.json handled); wait's --timeout is clamped
//   to 1..86400 s.
//   watch (--session DIR | --map KEY) --after N --agent-id ID
//       prints every relevant line past N already on disk, then each one as it lands; never exits
//       on its own.
//   wait  (--session DIR | --map KEY) --after N --timeout S --agent-id ID
//       prints every relevant line past N on disk when it wakes (D11: all of them, not just the
//       first) and exits 0; exit 3 at the timeout.
//
// Relevant lines: `send` for a session (the only type the hub appends there); `work`, `refresh`
// and `action` for a map (§4a: Work this ticket → the hub's claim appends `work`; Refresh →
// `refresh`, T33). Lines are printed whole and unchanged, one JSON object per line.
//
// Both heartbeat through the hub once at start and every GRILL_HEARTBEAT_MS (default 60 000):
// POST /s/<id>/heartbeat or /m/<key>/heartbeat {agentId} with the folder's token. A 409 means
// another agent took the session: print {"type":"taken","by":<agent>} and exit 4 so the listener
// stops. Hub down (no hub.json, the call fails, or whatever answers is not our hub): ensure
// again, best effort, and keep tailing: the file is the source of truth, not the hub. A 401
// (wrong token) is reported once on stderr. See startHeartbeat.
//
// Exit codes: 0 wait printed a batch; 2 bad input; 3 wait timed out; 4 taken.
import fs from "node:fs";
import path from "node:path";
import { die, envMs, isObj, readJson } from "./util.mjs";
import { grillHome } from "./home.mjs";
import { mapDirOf, mapEventsFile, mapKeyOf, mapMetaFile } from "./maps.mjs";

// ---- events.jsonl ----
export function readEvents(file) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push({ line, ev: JSON.parse(line) }); } catch { /* partial or corrupt line: skip */ }
  }
  return out;
}
export const lastSeq = (file) => readEvents(file).reduce((m, { ev }) => Math.max(m, Number(ev?.seq) || 0), 0);

// Calls onLine(line, ev) once per complete line with seq > after, in file order, deduped by seq
// (a seq at or below the highest one seen is skipped). The directory watch is installed BEFORE the
// first drain, so a line appended between the two still fires the watcher: no gap. The byte
// offset is tracked so each drain reads only what is new; a file that shrank (replaced) is read
// from the start again, and the seq check drops what was already emitted. A 1 s re-drain is the
// safety net for missed fs events, and it (re)installs the watch if the folder did not exist yet
// or the watcher died. The first drain is synchronous. Returns stop().
export function tailLog(file, after, onLine) {
  const dir = path.dirname(file), base = path.basename(file);
  // `partial` holds the bytes after the last newline, undecoded: a multibyte character split
  // across two appends (two reads) is decoded only once its line is complete.
  let pos = 0, seen = Number(after) || 0, partial = Buffer.alloc(0), w = null, stopped = false;
  const drain = () => {
    if (stopped) return;
    let fd; try { fd = fs.openSync(file, "r"); } catch { return; }
    try {
      const { size } = fs.fstatSync(fd);
      if (size < pos) { pos = 0; partial = Buffer.alloc(0); }
      if (size === pos) return;
      const b = Buffer.alloc(size - pos);
      const n = fs.readSync(fd, b, 0, b.length, pos);
      pos += n; partial = partial.length ? Buffer.concat([partial, b.subarray(0, n)]) : b.subarray(0, n);
    } finally { fs.closeSync(fd); }
    let start = 0, i;
    try {
      while ((i = partial.indexOf(0x0a, start)) >= 0) {
        const l = partial.toString("utf8", start, i); start = i + 1;
        if (!l.trim()) continue;
        let ev; try { ev = JSON.parse(l); } catch { continue; }
        const n = Number(ev?.seq) || 0;
        if (n > seen) { seen = n; onLine(l, ev); }
        if (stopped) return;
      }
    } finally { partial = partial.subarray(start); }
  };
  const arm = () => {
    if (w || stopped) return;
    try {
      w = fs.watch(dir, (_, name) => { if (!name || name === base) drain(); });
      w.on("error", () => { try { w.close(); } catch {} w = null; });
    } catch { w = null; } // folder missing: the interval retries
  };
  arm(); drain();
  const iv = setInterval(() => { arm(); drain(); }, 1000);
  return () => { stopped = true; clearInterval(iv); if (w) { try { w.close(); } catch {} w = null; } };
}

// ---- map keys ----
// `<projectKey>/<slug>`, or a bare slug prefixed with the projectKey of cwd: maps.mjs mapKeyOf,
// the same rule as map-patch. Throws MapKeyError.
export const resolveMapKey = (key, cwd = process.cwd()) => mapKeyOf(key, cwd);

// ---- watch / wait ----
const SESSION_TYPES = new Set(["send"]);
const MAP_TYPES = new Set(["work", "refresh", "action"]);

// `handled` of state.agent / map.json, or 0.
const handledIn = (o) => { const n = isObj(o) ? Number(o.handled) : 0; return Number.isInteger(n) && n > 0 ? n : 0; };
// The target of a watch/wait call: { home, file, types, route, meta, handled() }.
function target(o, env) {
  const home = grillHome(env);
  const hasS = o.session !== undefined, hasM = o.map !== undefined;
  if (hasS === hasM) die("exactly one of --session <dir> or --map <key> is required");
  if (hasS) {
    if (o.session === true) die("--session needs a folder");
    const dir = path.resolve(o.session);
    if (!fs.existsSync(path.join(dir, "state.json"))) die(`no grill session in ${dir} (no state.json)`);
    return { home, file: path.join(dir, "events.jsonl"), types: SESSION_TYPES, route: `/s/${path.basename(dir)}/heartbeat`, meta: path.join(dir, "meta.json"),
      handled: () => handledIn(readJson(path.join(dir, "state.json"))?.agent) };
  }
  if (o.map === true) die("--map needs a key");
  let key;
  try { key = resolveMapKey(o.map); } catch (e) { die(e.message); }
  const dir = mapDirOf(home, key);
  return { home, file: mapEventsFile(dir), types: MAP_TYPES, route: `/m/${key}/heartbeat`, meta: mapMetaFile(dir),
    handled: () => handledIn(readJson(path.join(dir, "map.json"))) };
}

export const MIN_TIMEOUT_S = 1, MAX_TIMEOUT_S = 86_400;
function parseListen(o, { wait }) {
  if (!o["agent-id"] || o["agent-id"] === true) die("--agent-id <id> is required (printed by new or resume)");
  let after;
  if (o.after !== undefined) {
    after = Number(o.after);
    if (o.after === true || !Number.isInteger(after) || after < 0) die(`--after must be a sequence number (0 or more), not ${JSON.stringify(o.after)}`);
  }
  let timeout = 480;
  if (wait && o.timeout !== undefined) {
    timeout = Number(o.timeout);
    if (o.timeout === true || Number.isNaN(timeout) || timeout < 0) die(`--timeout must be seconds (0 or more), not ${JSON.stringify(o.timeout)}`);
    // Clamped: below 1 s a wait is a busy loop; above a day setTimeout's 2^31 ms limit is near
    // and a huge value would fire at once.
    timeout = Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, timeout));
  }
  return { agentId: String(o["agent-id"]), after, timeout };
}

const exitAfterFlush = (code) => process.stdout.write("", () => process.exit(code));

// Heartbeats every `ms` (and now) through the hub; calls onTaken(by) on a 409. Returns stop().
//   200 ok; 409 taken → onTaken; 401 the token is wrong → warn once (stderr), keep tailing.
//   Anything else (a failed call, a 404 or 5xx) may be a foreign server that took the port after
//   the hub died: check /health against hub.json (lifecycle liveHub); unless it is really our hub,
//   ensure again and beat once more. Our own hub answering 404 (a map without meta.json yet) is
//   left alone: re-ensuring it would change nothing.
// `ensure` and `warn` are test hooks.
export function startHeartbeat({ home, route, meta, agentId, env, ms, onTaken, ensure, warn = (m) => process.stderr.write(`grill: ${m}\n`) }) {
  let ensuring = null, stopped = false, warned401 = false;
  const doEnsure = ensure ?? (async () => { const { ensureHub } = await import("./lifecycle.mjs"); await ensureHub(env); });
  const reEnsure = () => {
    if (ensuring) return ensuring;
    ensuring = (async () => {
      try { await doEnsure(); } catch { /* best effort: keep tailing */ }
    })().finally(() => { ensuring = null; });
    return ensuring;
  };
  const ourHub = async (port) => {
    try { const { liveHub } = await import("./lifecycle.mjs"); const h = await liveHub(home); return !!h && Number(h.port) === port; } catch { return false; }
  };
  const beat = async (retry = true) => {
    if (stopped) return;
    const port = Number(readJson(path.join(home, "hub.json"))?.port);
    if (!Number.isInteger(port) || port <= 0) { if (retry) { await reEnsure(); return beat(false); } return; }
    const token = readJson(meta)?.token;
    let r;
    try {
      r = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST", signal: AbortSignal.timeout(3000),
        headers: { "content-type": "application/json", ...(typeof token === "string" ? { "x-grill-token": token } : {}) },
        body: JSON.stringify({ agentId }),
      });
    } catch { if (retry) { await reEnsure(); return beat(false); } return; }
    if (stopped) return;
    if (r.status === 409) {
      const body = await r.json().catch(() => ({}));
      const by = (isObj(body.owner) && body.owner.agent) || (isObj(body.listener) && (body.listener.agent || body.listener.agentId)) || null;
      if (!stopped) onTaken(by);
      return;
    }
    await r.arrayBuffer().catch(() => {}); // free the socket
    if (r.status === 200) return;
    if (r.status === 401) {
      if (!warned401) { warned401 = true; warn(`heartbeat rejected (HTTP 401): the token in ${meta} is not the one the hub expects; listening continues without heartbeats`); }
      return;
    }
    if (retry && !(await ourHub(port))) { await reEnsure(); return beat(false); }
  };
  let busy = false;
  const tick = () => { if (busy || stopped) return; busy = true; beat().finally(() => { busy = false; }); };
  // Ensure first (spec: watch/wait run ensure), then the first beat.
  reEnsure().then(tick);
  const iv = setInterval(tick, ms);
  return () => { stopped = true; clearInterval(iv); };
}

async function listen(o, env, { wait }) {
  const args = parseListen(o, { wait });
  const t = target(o, env);
  // No --after: resume from what the agent has handled (not the log's end, which would skip
  // sends made while nobody listened).
  const after = args.after ?? t.handled();
  const out = (line) => process.stdout.write(line + "\n");
  let stopHb = () => {}, stopTail = () => {}, done = false;
  const finish = (code) => { if (done) return; done = true; stopHb(); stopTail(); exitAfterFlush(code); };

  if (wait) {
    // Collect one drain's worth of lines, then print them all (D11) and exit 0. A drain is
    // synchronous, so setImmediate runs after every line of the batch that woke us.
    const batch = [];
    stopTail = tailLog(t.file, after, (line, ev) => {
      if (!t.types.has(ev?.type)) return;
      if (batch.push(line) === 1) setImmediate(() => { for (const l of batch) out(l); finish(0); });
    });
    if (batch.length) return; // already on disk: no need to touch the hub
    setTimeout(() => finish(3), args.timeout * 1000);
  } else {
    stopTail = tailLog(t.file, after, (line, ev) => { if (t.types.has(ev?.type)) out(line); });
  }
  stopHb = startHeartbeat({
    home: t.home, route: t.route, meta: t.meta, agentId: args.agentId, env,
    ms: Math.max(50, envMs("GRILL_HEARTBEAT_MS", 60_000, env)),
    onTaken: (by) => { if (done) return; out(JSON.stringify({ type: "taken", by })); finish(4); },
  });
}

export const cmdWatch = (o, env = process.env) => listen(o, env, { wait: false });
export const cmdWait = (o, env = process.env) => listen(o, env, { wait: true });
