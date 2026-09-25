// Session folders, ownership and the session CLI commands (spec §5 Session identity and
// ownership, Security; §4 doc default; decisions D2, D3). sessions/pending/patch are ported from
// jasonku09/grill-with-ui server.mjs:105-133, 452-483 (daafa1e).
//
//   grill-sessions/<projectKey>/<id>/          id = <YYYYMMDD-HHMMSS>-<rand4>, unique across projects
//     state.json    written only by `patch` (and `new`)
//     meta.json     { token, owner: { agentId, agent, heartbeat } } (D3), 0600, atomic writes;
//                   created by `new`; after that the hub is its single writer (heartbeats, and
//                   POST /s/<id>/take for resume), each a synchronous read-modify-write. The CLI
//                   writes it directly (resume's take, patch's heartbeat) only when the hub
//                   cannot be reached: then nothing else is writing it.
//     events.jsonl  sends, appended by the hub
//
// Exit codes: 0 ok; 1 hub/home or write failure; 2 bad input or a rejected patch; 4 ownership
// (resume of a session in use without --take, or patch by an agent that is not the owner).
import fs from "node:fs";
import path from "node:path";
import tty from "node:tty";
import { die, envMs, isObj, oneLine, print, rand as randHex, readJson, writeJson } from "./util.mjs";
import { branchOf, grillHome, projectKeyOf, projectRoot } from "./home.mjs";
import { PatchError, applyPatch, isOpen, validateState } from "./state.mjs";
import { readEvents, lastSeq } from "./events.mjs";

export const SESSIONS_DIR = "grill-sessions";
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const SAFE_ID = /^[A-Za-z0-9-]+$/;
export const sessionsRoot = (home) => path.join(home, SESSIONS_DIR);
export const metaFile = (dir) => path.join(dir, "meta.json");
export const stateFile = (dir) => path.join(dir, "state.json");
export const eventsFile = (dir) => path.join(dir, "events.jsonl");
export const sessionUrl = (port, id) => `http://127.0.0.1:${port}/s/${id}/`;

// Local time, second resolution (Jason's stamp).
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "grill";
export const defaultDoc = (topic) => `docs/${slug(topic)}-design.md`;

// D13 agent detection, used when --agent is not given. (T16's lib/profile.mjs detectAgent is the
// full version; this keeps `new`/`resume` independent of it.)
export function agentFromEnv(env = process.env) {
  if (env.CLAUDECODE === "1") return "claude";
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return "codex";
  if (env.OPENCODE === "1") return "opencode";
  if (env.PI_CODING_AGENT === "true") return "pi";
  return "unknown";
}
// What an owner's `agent` may be (the hub's take route checks it).
export const AGENT_RE = /^[^\x00-\x1f\x7f]{1,64}$/;
const agentName = (flag, env) => (typeof flag === "string" && flag.trim() ? flag.trim().toLowerCase() : agentFromEnv(env));

// ---- events.jsonl (readEvents/lastSeq live in events.mjs, re-exported here) ----
export { readEvents, lastSeq } from "./events.mjs";
export const handledOf = (st) => Number(isObj(st) && isObj(st.agent) && st.agent.handled) || 0;
export const pendingEvents = (dir, handled) => readEvents(eventsFile(dir)).filter(({ ev }) => (Number(ev?.seq) || 0) > handled);

// ---- meta.json (D3) ----
export const readMeta = (dir) => { const m = readJson(metaFile(dir)); return isObj(m) ? m : null; };
export const writeMeta = (dir, meta) => writeJson(metaFile(dir), meta, 0o600);
// The owner as the page may see it: never the token.
export function publicOwner(meta) {
  if (!isObj(meta) || !isObj(meta.owner)) return null;
  const { agentId, agent, heartbeat } = meta.owner;
  return { agentId, agent, heartbeat };
}
// Seconds since the owner's heartbeat, or null when there is none.
export function heartbeatAge(meta, now = Date.now()) {
  const t = Date.parse(isObj(meta) && isObj(meta.owner) ? meta.owner.heartbeat : "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : null;
}
// In use: an owner heartbeat younger than freshMs (spec §5: 3 minutes).
export function inUse(meta, freshMs, now = Date.now()) {
  const t = Date.parse(isObj(meta) && isObj(meta.owner) ? meta.owner.heartbeat : "");
  return Number.isFinite(t) && now - t < freshMs;
}
// Refresh the heartbeat if agentId is the owner. Re-reads meta.json right before the atomic
// write to keep the window against a concurrent `resume --take` small. Used by patch and by the
// hub's heartbeat route (T11/T13: false → 409).
export function touchHeartbeat(dir, agentId, now = new Date()) {
  const meta = readMeta(dir);
  if (!meta || !isObj(meta.owner) || !agentId || meta.owner.agentId !== agentId) return false;
  writeMeta(dir, { ...meta, owner: { ...meta.owner, heartbeat: now.toISOString() } });
  return true;
}
// "12s ago" / "4m ago" / "3h ago" / "2d ago" / "no heartbeat".
export function fmtAge(sec) {
  if (sec === null || sec === undefined) return "no heartbeat";
  if (sec < 120) return `${sec}s ago`;
  if (sec < 7200) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 172800) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ---- lookup ----
// The folder of session `id` in any project (ids are unique across projects, D2), or null.
export function sessionDirById(home, id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) return null;
  let projects; try { projects = fs.readdirSync(sessionsRoot(home), { withFileTypes: true }); } catch { return null; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(sessionsRoot(home), p.name, id);
    if (fs.existsSync(stateFile(dir))) return dir;
  }
  return null;
}
const idTaken = (home, id) => {
  try { return fs.readdirSync(sessionsRoot(home), { withFileTypes: true }).some((p) => p.isDirectory() && fs.existsSync(path.join(sessionsRoot(home), p.name, id))); }
  catch { return false; }
};

// ---- new ----
// The initial state.json (id filled in by newSession). Throws PatchError when it is invalid (bad
// phase …), so callers can reject bad input before starting the hub or creating anything.
export function draftState({ cwd = process.cwd(), topic = "", doc, phase, mapKey, now = new Date() }) {
  const project = projectRoot(cwd);
  const created = now.toISOString();
  const st = {
    id: "", topic: typeof topic === "string" ? topic : "", doc: typeof doc === "string" && doc ? doc : defaultDoc(topic),
    project, projectKey: projectKeyOf(project), cwd: fs.realpathSync(cwd), branch: branchOf(cwd), created,
    agent: { status: "working", since: created }, terms: [], questions: [],
  };
  if (phase !== undefined) st.phase = phase;
  if (mapKey !== undefined) st.mapKey = mapKey;
  validateState(st);
  return st;
}
// Creates the session folder. Throws PatchError (via draftState) before anything is created.
// `rand` and `now` are injectable for tests.
export function newSession({ home, cwd = process.cwd(), topic = "", doc, agent = "unknown", phase, mapKey, now = new Date(), rand = randHex }) {
  const st = draftState({ cwd, topic, doc, phase, mapKey, now });
  const { projectKey, created } = st;
  const dir = path.join(sessionsRoot(home), projectKey);
  fs.mkdirSync(dir, { recursive: true });
  let id, session;
  for (let tries = 0; ; tries++) {
    if (tries >= 50) throw new Error("could not find a free session id");
    id = `${stamp(now)}-${rand(4)}`;
    if (!ID_RE.test(id) || idTaken(home, id)) continue;
    session = path.join(dir, id);
    try { fs.mkdirSync(session); break; } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  st.id = id;
  const agentId = rand(12);
  try {
    writeMeta(session, { token: rand(32), owner: { agentId, agent, heartbeat: created } });
    fs.writeFileSync(eventsFile(session), "");
    writeJson(stateFile(session), st); // last: sessionDirById/listSessions see a complete folder
  } catch (e) { fs.rmSync(session, { recursive: true, force: true }); throw e; }
  return { session, id, projectKey, agentId, doc: st.doc, state: st };
}

// ---- sessions ----
// This project's sessions, newest first (port $JASON/server.mjs:106-123) plus branch, cwd,
// ageSec (seconds since the owner heartbeat), inUse and the owner's agent.
export function listSessions(home, key, { all = false, freshMs = 180_000, now = Date.now() } = {}) {
  const dir = path.join(sessionsRoot(home), key);
  let ids; try { ids = fs.readdirSync(dir); } catch { return []; }
  const rows = [];
  for (const id of ids) {
    const session = path.join(dir, id);
    const st = readJson(stateFile(session));
    if (!isObj(st)) continue;
    const meta = readMeta(session);
    const qs = Array.isArray(st.questions) ? st.questions.filter(isObj) : [];
    rows.push({
      session, id, topic: st.topic || "", created: st.created || "", finished: st.finished || null,
      open: qs.filter(isOpen).length, answered: qs.filter((q) => q.status === "answered").length,
      handled: handledOf(st), lastSeq: lastSeq(eventsFile(session)),
      branch: typeof st.branch === "string" ? st.branch : "", cwd: typeof st.cwd === "string" ? st.cwd : "",
      ageSec: heartbeatAge(meta, now), inUse: inUse(meta, freshMs, now),
      agent: isObj(meta?.owner) && typeof meta.owner.agent === "string" ? meta.owner.agent : null,
    });
  }
  rows.sort((a, b) => (b.created < a.created ? -1 : b.created > a.created ? 1 : b.id.localeCompare(a.id)));
  return all ? rows : rows.filter((r) => !r.finished);
}

// ---- resume ----
// Take ownership of `dir`: a fresh agentId, the given agent, heartbeat now. Keeps the token.
export function takeSession(dir, agent, now = new Date(), rand = randHex) {
  const meta = readMeta(dir) || { token: rand(32) };
  const agentId = rand(12);
  writeMeta(dir, { ...meta, token: meta.token || rand(32), owner: { agentId, agent, heartbeat: now.toISOString() } });
  const st = readJson(stateFile(dir));
  const handled = handledOf(st);
  return { session: dir, agentId, handled, pending: pendingEvents(dir, handled).length };
}
// One of:
//   { choose: rows }                              no --session and not exactly one idle unfinished session
//   { inUse: true, agent, ageSec }                --session in use and no take
//   { session, agentId, handled, pending }        taken
// `taker(dir, agent, now)` does the take (default: takeSession, a direct write; the CLI passes
// one that goes through the hub, and then the result is a Promise).
export function resumeSession({ home, cwd = process.cwd(), session, take = false, agent = "unknown", freshMs = 180_000, now = new Date(), taker = takeSession }) {
  if (!session) {
    const rows = listSessions(home, projectKeyOf(projectRoot(cwd)), { freshMs, now: now.getTime() });
    if (rows.length !== 1 || rows[0].inUse) return { choose: rows };
    return taker(rows[0].session, agent, now);
  }
  const meta = readMeta(session);
  if (!take && inUse(meta, freshMs, now.getTime())) return { inUse: true, agent: meta.owner.agent ?? null, ageSec: heartbeatAge(meta, now.getTime()) };
  return taker(session, agent, now);
}

// ---- CLI ----
function mustSession(o) {
  if (!o.session || o.session === true) die("--session <dir> is required");
  const dir = path.resolve(o.session);
  if (!fs.existsSync(dir)) die(`no such session folder: ${dir}`);
  return dir;
}
const str = (o, k) => (typeof o[k] === "string" ? o[k] : undefined);
// Flush stdout before exiting: fetch keep-alive sockets from ensure would otherwise hold the process.
const done = (code = 0) => process.stdout.write("", () => process.exit(code));
async function hubOrDie(env) {
  const { ensureHub, EnsureError } = await import("./lifecycle.mjs");
  const { HomeError } = await import("./home.mjs");
  try { return await ensureHub(env); } catch (e) { die(e instanceof HomeError || e instanceof EnsureError ? e.message : `ensure failed: ${oneLine(e.message)}`, 1); }
}

// POST a session route on the hub with the session's token. null when the hub cannot be reached
// (or the session has no token to send); else { status, reply }.
async function hubSessionPost(port, dir, sub, body) {
  const token = readMeta(dir)?.token;
  if (!Number.isInteger(port) || port <= 0 || typeof token !== "string" || !token) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/s/${path.basename(dir)}/${sub}`, {
      method: "POST", headers: { "content-type": "application/json", "x-grill-token": token },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    return { status: r.status, reply: await r.json().catch(() => ({})) };
  } catch { return null; }
}
// resume's take through the hub (the single writer of meta.json); a direct write only when the
// hub cannot be reached.
const hubTaker = (port) => async (dir, agent, now) => {
  const r = await hubSessionPost(port, dir, "take", { agent });
  if (!r) return takeSession(dir, agent, now);
  if (r.status !== 200 || typeof r.reply.agentId !== "string") die(`could not take the session (HTTP ${r.status}): ${oneLine(r.reply.error ?? "")}`, 1);
  const handled = handledOf(readJson(stateFile(dir)));
  return { session: dir, agentId: r.reply.agentId, handled, pending: pendingEvents(dir, handled).length };
};

export async function cmdNew(o, env = process.env) {
  for (const k of ["topic", "doc", "agent", "phase", "map-key"]) if (o[k] === true) die(`--${k} needs a value`);
  const args = { topic: str(o, "topic") ?? "", doc: str(o, "doc"), phase: str(o, "phase"), mapKey: str(o, "map-key") };
  // Bad input is rejected (exit 2) before the hub is started or anything is created.
  try { draftState(args); } catch (e) { die(e instanceof PatchError ? `new rejected: ${oneLine(e.message)}` : `cannot read the project: ${e.code || oneLine(e.message)}`, e instanceof PatchError ? 2 : 1); }
  const hub = await hubOrDie(env);
  let r;
  try { r = newSession({ home: hub.home, ...args, agent: agentName(o.agent, env) }); }
  catch (e) { die(`could not create the session: ${e.code || oneLine(e.message)}`, 1); }
  print({ session: r.session, id: r.id, projectKey: r.projectKey, agentId: r.agentId, url: sessionUrl(hub.port, r.id), doc: r.doc });
  done();
}

export function cmdSessions(o, env = process.env) {
  const home = grillHome(env);
  for (const r of listSessions(home, projectKeyOf(projectRoot(process.cwd())), { all: !!o.all, freshMs: envMs("GRILL_FRESH_MS", 180_000, env) })) print(r);
}

export async function cmdResume(o, env = process.env) {
  if (o.agent === true) die("--agent needs a value");
  const agent = agentName(o.agent, env);
  if (!AGENT_RE.test(agent)) die("--agent must be a name of 1-64 printable characters");
  const session = o.session === undefined ? undefined : mustSession(o);
  if (session && !fs.existsSync(stateFile(session))) die(`no state.json in ${session}; not a grill session`);
  const hub = await hubOrDie(env);
  let r;
  try {
    r = await resumeSession({ home: hub.home, session, take: !!o.take, agent, freshMs: envMs("GRILL_FRESH_MS", 180_000, env), taker: hubTaker(hub.port) });
  } catch (e) { die(`could not resume: ${e.code || oneLine(e.message)}`, 1); }
  if (r.choose || r.inUse) { print(r); return done(r.inUse ? 4 : 0); }
  const id = path.basename(r.session);
  print({ session: r.session, agentId: r.agentId, url: sessionUrl(hub.port, id), handled: r.handled, pending: r.pending });
  done();
}

export function cmdPending(o) {
  const session = mustSession(o);
  const handled = handledOf(readJson(stateFile(session)));
  for (const { line } of pendingEvents(session, handled)) process.stdout.write(line + "\n");
}

// The patch text from --file or stdin (exit 2 on a missing/empty patch). Shared with map-patch.
export function readPatchText(o, shape = "state.json") {
  let text;
  if (o.file !== undefined) {
    if (o.file === true) die("--file needs a path");
    try { text = fs.readFileSync(path.resolve(o.file), "utf8"); } catch (e) { die(`cannot read the patch file ${o.file}: ${e.code || oneLine(e.message)}`); }
  } else {
    // tty.isatty, not process.stdin.isTTY: touching process.stdin creates a stream that makes fd 0
    // non-blocking, and the read below would then fail with EAGAIN if the patch has not arrived yet.
    if (tty.isatty(0)) die("no patch: pipe a JSON patch on stdin or pass --file <path>");
    try { text = fs.readFileSync(0, "utf8"); } catch (e) { die(`cannot read the patch from stdin: ${e.code || oneLine(e.message)}`); }
  }
  if (!text.trim()) die(`empty patch: send a JSON object shaped like ${shape}`);
  return text;
}

export async function cmdPatch(o, env = process.env) {
  const session = mustSession(o);
  if (!o["agent-id"] || o["agent-id"] === true) die("--agent-id <id> is required (printed by new or resume)");
  const agentId = String(o["agent-id"]);
  // Best effort (spec §5 Crash recovery): the patch is a file write and must not depend on the hub.
  let hub = null;
  try {
    const { ensureHub } = await import("./lifecycle.mjs");
    hub = await ensureHub(env);
  } catch (e) { process.stderr.write(`grill: warning: the hub is not running (${oneLine(e.message)}); the patch still applies\n`); }
  const file = stateFile(session);
  const text = readPatchText(o, "state.json");
  let p;
  try { p = JSON.parse(text); } catch (e) { die(`the patch is not valid JSON (state.json unchanged): ${oneLine(e.message)}`); }
  if (!fs.existsSync(file)) die(`no state.json in ${session}; \`new\` creates it`);
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { die(`state.json in ${session} is not valid JSON, so it was not patched: ${oneLine(e.message)}`); }
  const meta = readMeta(session);
  if (!meta || !isObj(meta.owner) || meta.owner.agentId !== agentId) {
    const who = isObj(meta?.owner) && meta.owner.agent ? meta.owner.agent : "unknown agent";
    die(`session is owned by another agent (${who}, ${fmtAge(heartbeatAge(meta))}); resume --take to take it`, 4);
  }
  let next;
  try { next = applyPatch(state, p, new Date().toISOString()); validateState(next); } catch (e) {
    // Every failure owes the caller one line, never a stack trace.
    die(e instanceof PatchError ? `patch rejected (state.json unchanged): ${oneLine(e.message)}`
      : `could not apply the patch (state.json unchanged): ${oneLine(e.message)}`);
  }
  let bytes;
  try { bytes = writeJson(file, next); } catch (e) { die(`could not write state.json: ${e.code || oneLine(e.message)}`, 1); }
  // The heartbeat goes through the hub (meta.json's single writer); directly only when it is down.
  try {
    const hb = await hubSessionPost(hub?.port, session, "heartbeat", { agentId });
    if (!hb) touchHeartbeat(session, agentId);
    else if (hb.status === 409) process.stderr.write(`grill: warning: the session was taken by ${hb.reply.owner?.agent ?? "another agent"} while this patch ran; stop and tell the user\n`);
  } catch { /* the patch landed; a missed heartbeat is harmless */ }
  // One short line, never the state itself: keeping the state out of the agent's context is the point.
  const qs = Array.isArray(next.questions) ? next.questions : [];
  print({ ok: true, questions: qs.length, open: qs.filter(isOpen).length, handled: handledOf(next), bytes });
  done();
}
