// Sessions: new (D2 ids, D3 meta.json), sessions, resume/ownership (--take), pending, and the
// patch CLI contract (spec §5 Session identity and ownership, Security; §10; plan T10). CLI-level
// tests ported from jasonku09/grill-with-ui test/server.test.mjs:35-61, 199-289, 487-612 (daafa1e)
// with the new key format and --agent-id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HUB, mkHome, run, runAsync, hubInfo, sleep, waitUntil, stopHub, tmp } from "./helpers.mjs";
import { projectKeyOf } from "../lib/home.mjs";
import { newSession, sessionDirById, readMeta, touchHeartbeat, publicOwner } from "../lib/sessions.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Stop the hub and make sure its process is gone, whatever the test did.
async function cleanup(home) {
  let pid; try { pid = hubInfo(home).pid; } catch { /* never started */ }
  await stopHub(home);
  if (pid) { try { await waitUntil(() => !alive(pid), 3000); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
  rmSync(home, { recursive: true, force: true });
}
// A fresh GRILL_HOME whose hub is stopped when the test ends.
function homeFor(t, extra) { const h = mkHome(extra); t.after(() => cleanup(h.home)); return h; }
const newIn = (env, cwd, topic = "Fonts", extra = []) => JSON.parse(run(env, ["new", "--topic", topic, ...extra], { cwd }));
const stateOf = (session) => JSON.parse(readFileSync(join(session, "state.json"), "utf8"));
const metaOf = (session) => JSON.parse(readFileSync(join(session, "meta.json"), "utf8"));
const writeState = (session, st) => writeFileSync(join(session, "state.json"), JSON.stringify(st, null, 2));
const ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

// ---- new ----

test("new: outside git the key comes from the cwd; state.json, meta.json and events.jsonl are written", (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-nogit-");
  const out = newIn(env, cwd, "Fonts & Colours", ["--agent", "codex"]);
  const real = realpathSync(cwd);
  assert.equal(out.projectKey, projectKeyOf(real));
  assert.match(out.projectKey, /^grill-nogit-[a-z0-9]+-[0-9a-f]{8}$/);
  assert.match(out.id, ID);
  assert.equal(out.session, join(home, "grill-sessions", out.projectKey, out.id));
  assert.equal(out.url, `http://127.0.0.1:${hubInfo(home).port}/s/${out.id}/`);
  assert.equal(out.doc, "docs/fonts-colours-design.md");
  assert.match(out.agentId, /^[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(out).sort(), ["agentId", "doc", "id", "projectKey", "session", "url"]);

  const st = stateOf(out.session);
  assert.equal(st.id, out.id);
  assert.equal(st.topic, "Fonts & Colours");
  assert.equal(st.doc, "docs/fonts-colours-design.md");
  assert.equal(st.project, real);
  assert.equal(st.projectKey, out.projectKey);
  assert.equal(st.cwd, real);
  assert.equal(st.branch, "");
  assert.match(st.created, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(st.agent, { status: "working", since: st.created });
  assert.deepEqual(st.terms, []); assert.deepEqual(st.questions, []);
  assert.ok(!("owner" in st) && !("token" in st), "owner and token live in meta.json (D3)");
  assert.ok(!("phase" in st) && !("mapKey" in st));

  const meta = metaOf(out.session);
  assert.match(meta.token, /^[0-9a-f]{32}$/);
  assert.equal(meta.owner.agentId, out.agentId);
  assert.equal(meta.owner.agent, "codex");
  assert.ok(Date.now() - Date.parse(meta.owner.heartbeat) < 10_000);
  assert.equal(statSync(join(out.session, "meta.json")).mode & 0o777, 0o600, "the token is private");
  assert.equal(readFileSync(join(out.session, "events.jsonl"), "utf8"), "");
});

test("new: a git repo and one of its worktrees share one key; branch is recorded; two sessions never collide", (t) => {
  const { env } = homeFor(t);
  const repo = tmp("grill-repo-");
  const git = (args, cwd) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
  git(["init", "-q", "-b", "main"], repo);
  git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
  const wt = join(tmp("grill-wt-"), "wt");
  git(["worktree", "add", "-q", wt, "-b", "side"], repo);
  const a = newIn(env, repo), b = newIn(env, wt), c = newIn(env, repo);
  assert.equal(a.projectKey, b.projectKey);
  assert.equal(a.projectKey, projectKeyOf(realpathSync(repo)));
  assert.equal(stateOf(a.session).project, realpathSync(repo));
  assert.equal(stateOf(b.session).project, realpathSync(repo));
  assert.equal(stateOf(b.session).cwd, realpathSync(wt));
  assert.equal(stateOf(a.session).branch, "main");
  assert.equal(stateOf(b.session).branch, "side");
  assert.notEqual(a.session, c.session);
  assert.notEqual(a.id, c.id);
});

test("projectKey: basename-hash; different paths with the same basename differ", (t) => {
  const { env } = homeFor(t);
  const one = join(tmp("grill-k1-"), "app"), two = join(tmp("grill-k2-"), "app");
  mkdirSync(one); mkdirSync(two);
  const a = newIn(env, one), b = newIn(env, two);
  assert.match(a.projectKey, /^app-[0-9a-f]{8}$/);
  assert.match(b.projectKey, /^app-[0-9a-f]{8}$/);
  assert.notEqual(a.projectKey, b.projectKey);
});

test("new: --doc, --phase and --map-key are recorded; a bad --phase is rejected with nothing created", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-opts-");
  const a = newIn(env, cwd, "Chart it", ["--doc", "notes/x.md", "--phase", "destination", "--map-key", "proj-12345678/42"]);
  assert.equal(a.doc, "notes/x.md");
  const st = stateOf(a.session);
  assert.equal(st.doc, "notes/x.md"); assert.equal(st.phase, "destination"); assert.equal(st.mapKey, "proj-12345678/42");
  const before = readdirSync(join(home, "grill-sessions", a.projectKey));
  const r = await runAsync(env, ["new", "--topic", "X", "--phase", "later"], { cwd });
  assert.equal(r.code, 2, r.err);
  assert.equal(r.out, "");
  assert.match(r.err, /^grill: [^\n]*phase must be one of destination\|frontier\|ticket$/);
  assert.deepEqual(readdirSync(join(home, "grill-sessions", a.projectKey)), before, "no folder created");
  assert.equal(newIn(env, cwd, "   ").doc, "docs/grill-design.md", "an empty slug still gives a doc path");
  const fresh = mkHome(); t.after(() => cleanup(fresh.home));
  const r2 = await runAsync(fresh.env, ["new", "--topic", "X", "--phase", "later"], { cwd });
  assert.equal(r2.code, 2, r2.err);
  assert.deepEqual(readdirSync(fresh.home), [], "bad input is rejected before the hub starts");
});

test("new: the id retries on a collision with any project's session (D2)", () => {
  const home = tmp("grill-home-");
  try {
    const now = new Date(2026, 8, 25, 10, 11, 12);
    const taken = join(home, "grill-sessions", "other-00000000", "20260925-101112-aaaa");
    mkdirSync(taken, { recursive: true }); writeFileSync(join(taken, "state.json"), "{}");
    const seq = ["aaaa", "bbbb"];
    const r = newSession({ home, cwd: tmp("grill-coll-"), topic: "T", agent: "pi", now, rand: (n) => (n === 4 ? seq.shift() : "f".repeat(n)) });
    assert.equal(r.id, "20260925-101112-bbbb");
    assert.equal(sessionDirById(home, r.id), r.session);
    assert.equal(sessionDirById(home, "20260925-101112-aaaa"), taken);
    assert.equal(sessionDirById(home, "nope"), null);
    assert.equal(sessionDirById(home, "../other-00000000/20260925-101112-aaaa"), null, "no path traversal");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("meta helpers: touchHeartbeat only for the owner; publicOwner never carries the token", () => {
  const home = tmp("grill-home-");
  try {
    const r = newSession({ home, cwd: tmp("grill-meta-"), topic: "T", agent: "claude", now: new Date(Date.now() - 60_000) });
    const old = readMeta(r.session).owner.heartbeat;
    assert.equal(touchHeartbeat(r.session, "someone-else"), false);
    assert.equal(readMeta(r.session).owner.heartbeat, old);
    assert.equal(touchHeartbeat(r.session, r.agentId), true);
    assert.ok(Date.parse(readMeta(r.session).owner.heartbeat) > Date.parse(old));
    assert.deepEqual(Object.keys(publicOwner(readMeta(r.session))).sort(), ["agent", "agentId", "heartbeat"]);
    assert.equal(publicOwner(null), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---- sessions ----

test("sessions: lists this project's sessions newest first, unfinished by default, --all includes finished", async (t) => {
  const { env } = homeFor(t, { GRILL_FRESH_MS: "180000" });
  const cwd = tmp("grill-ls-");
  const a = newIn(env, cwd, "First topic", ["--agent", "claude"]);
  await sleep(1100); // ids and created are second-resolution stamps
  const b = newIn(env, cwd, "Second topic", ["--agent", "pi"]);
  await sleep(1100);
  const c = newIn(env, cwd, "Finished topic");
  const sb = stateOf(b.session);
  sb.agent = { status: "waiting", since: "x", handled: 2 };
  sb.questions = [
    { id: "q1", round: 1, status: "answered" }, { id: "q2", round: 1, status: "open" },
    { id: "q3", round: 2, status: "deferred" }, { id: "q4", round: 2, status: "reopened" },
  ];
  writeState(b.session, sb);
  writeFileSync(join(b.session, "events.jsonl"), '{"seq":1}\n{"seq":2}\n{"seq":3}\n');
  const sc = stateOf(c.session); sc.finished = { doc: "docs/x.md", at: "y" }; writeState(c.session, sc);
  // a's owner went quiet 10 minutes ago: not in use
  const ma = metaOf(a.session); ma.owner.heartbeat = new Date(Date.now() - 600_000).toISOString();
  writeFileSync(join(a.session, "meta.json"), JSON.stringify(ma));

  const lines = run(env, ["sessions"], { cwd }).split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.session), [b.session, a.session]);
  const { ageSec: ageB, ...restB } = lines[0];
  assert.deepEqual(restB, {
    session: b.session, id: b.id, topic: "Second topic", created: sb.created, finished: null, open: 2, answered: 1, handled: 2, lastSeq: 3,
    branch: "", cwd: realpathSync(cwd), inUse: true, agent: "pi",
  });
  assert.ok(ageB >= 0 && ageB < 60, `fresh heartbeat age ${ageB}`);
  const { ageSec: ageA, ...restA } = lines[1];
  assert.deepEqual(restA, {
    session: a.session, id: a.id, topic: "First topic", created: stateOf(a.session).created, finished: null, open: 0, answered: 0, handled: 0, lastSeq: 0,
    branch: "", cwd: realpathSync(cwd), inUse: false, agent: "claude",
  });
  assert.ok(ageA >= 599 && ageA < 700, `stale heartbeat age ${ageA}`);
  const all = run(env, ["sessions", "--all"], { cwd }).split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(all.map((l) => l.session), [c.session, b.session, a.session]);
  assert.deepEqual(all[0].finished, { doc: "docs/x.md", at: "y" });
  assert.equal(run(env, ["sessions"], { cwd: tmp("grill-empty-") }), "");
});

// ---- pending ----

test("pending: prints the events past agent.handled, nothing when caught up", (t) => {
  const { env } = homeFor(t);
  const { session } = newIn(env, tmp("grill-pd-"));
  const lines = [1, 2, 3].map((seq) => JSON.stringify({ type: "send", seq, at: "x", actions: [{ q: "q1", type: "answer", kind: "option", option: "ABC"[seq - 1] }] }));
  writeFileSync(join(session, "events.jsonl"), lines.join("\n") + "\n" + '{"seq":4, "partial');
  const st = stateOf(session);
  st.agent.handled = 1; writeState(session, st);
  const out = run(env, ["pending", "--session", session]).split("\n");
  assert.deepEqual(out.map((l) => JSON.parse(l).seq), [2, 3]);
  assert.equal(out[0], lines[1], "prints the exact stored lines");
  st.agent.handled = 3; writeState(session, st);
  assert.equal(run(env, ["pending", "--session", session]), "");
  delete st.agent.handled; writeState(session, st);
  assert.equal(run(env, ["pending", "--session", session]).split("\n").length, 3, "no handled means everything is pending");
  const r = spawnSync(process.execPath, [HUB, "pending"], { env, encoding: "utf8" });
  assert.equal(r.status, 2); assert.match(r.stderr, /^grill: --session <dir> is required\n$/);
});

// ---- resume ----

test("resume: auto-picks one idle session; asks when two; --take overrides in-use", async (t) => {
  const { home, env } = mkHome({ GRILL_FRESH_MS: "180000" }); t.after(() => cleanup(home));
  const cwd = tmp("proj-");
  const a = JSON.parse(run(env, ["new", "--topic", "A", "--agent", "claude"], { cwd }));
  // fresh heartbeat → in use
  const r1 = await runAsync(env, ["resume", "--session", a.session], { cwd });
  assert.equal(r1.code, 4); assert.equal(JSON.parse(r1.out).inUse, true);
  const r2 = JSON.parse(run(env, ["resume", "--session", a.session, "--take", "--agent", "codex"], { cwd }));
  assert.notEqual(r2.agentId, a.agentId);
  const oldPatch = await runAsync(env, ["patch", "--session", a.session, "--agent-id", a.agentId], { cwd, input: "{\"note\":\"x\"}" });
  assert.equal(oldPatch.code, 4);
  run(env, ["new", "--topic", "B"], { cwd });
  const list = JSON.parse(run({ ...env, GRILL_FRESH_MS: "0" }, ["resume"], { cwd }));
  assert.equal(list.choose.length, 2);
});

test("resume: in-use shape; --take output; the old owner's patch gets the exact message", async (t) => {
  const { home, env } = homeFor(t, { GRILL_FRESH_MS: "180000" });
  const cwd = tmp("grill-rs-");
  const a = newIn(env, cwd, "A", ["--agent", "claude"]);
  const r1 = await runAsync(env, ["resume", "--session", a.session], { cwd });
  assert.equal(r1.code, 4);
  const busy = JSON.parse(r1.out);
  assert.deepEqual(Object.keys(busy).sort(), ["ageSec", "agent", "inUse"]);
  assert.equal(busy.agent, "claude"); assert.ok(busy.ageSec >= 0 && busy.ageSec < 60);
  const token = metaOf(a.session).token;

  writeFileSync(join(a.session, "events.jsonl"), '{"seq":1}\n{"seq":2}\n{"seq":3}\n');
  const st = stateOf(a.session); st.agent.handled = 1; writeState(a.session, st);
  const r2 = JSON.parse(run(env, ["resume", "--session", a.session, "--take", "--agent", "codex"], { cwd }));
  assert.deepEqual(r2, { session: a.session, agentId: r2.agentId, url: `http://127.0.0.1:${hubInfo(home).port}/s/${a.id}/`, handled: 1, pending: 2 });
  assert.match(r2.agentId, /^[0-9a-f]{12}$/);
  const meta = metaOf(a.session);
  assert.equal(meta.token, token, "take keeps the token (open tabs keep working)");
  assert.equal(meta.owner.agentId, r2.agentId); assert.equal(meta.owner.agent, "codex");

  const before = readFileSync(join(a.session, "state.json"), "utf8");
  const old = await runAsync(env, ["patch", "--session", a.session, "--agent-id", a.agentId], { cwd, input: '{"note":"x"}' });
  assert.equal(old.code, 4);
  assert.equal(old.out, "");
  assert.match(old.err, /^grill: session is owned by another agent \(codex, \d+s ago\); resume --take to take it$/);
  assert.equal(readFileSync(join(a.session, "state.json"), "utf8"), before, "state.json untouched");
  const ok = await runAsync(env, ["patch", "--session", a.session, "--agent-id", r2.agentId], { cwd, input: '{"note":"x"}' });
  assert.equal(ok.code, 0, ok.err);
});

test("resume: without --session, one idle unfinished session is picked; none or a busy one asks", async (t) => {
  const { home, env } = homeFor(t, { GRILL_FRESH_MS: "180000" });
  const cwd = tmp("grill-auto-");
  assert.deepEqual(JSON.parse(run(env, ["resume"], { cwd })), { choose: [] });
  const a = newIn(env, cwd, "A");
  const busy = JSON.parse(run(env, ["resume"], { cwd }));
  assert.equal(busy.choose.length, 1, "the only session is in use: ask");
  assert.equal(busy.choose[0].session, a.session); assert.equal(busy.choose[0].inUse, true);
  const done = newIn(env, cwd, "Done"); const sd = stateOf(done.session); sd.finished = { doc: "d", at: "x" }; writeState(done.session, sd);
  const picked = JSON.parse(run({ ...env, GRILL_FRESH_MS: "0" }, ["resume", "--agent", "opencode"], { cwd }));
  assert.equal(picked.session, a.session, "finished sessions are not offered");
  assert.equal(picked.url, `http://127.0.0.1:${hubInfo(home).port}/s/${a.id}/`);
  assert.deepEqual([picked.handled, picked.pending], [0, 0]);
  assert.notEqual(picked.agentId, a.agentId);
  assert.equal(metaOf(a.session).owner.agent, "opencode");
  const r = await runAsync(env, ["resume", "--session", join(cwd, "nope")], { cwd });
  assert.equal(r.code, 2); assert.match(r.err, /^grill: no such session folder/);
});

// ---- patch: the agent's only way to write state.json ----

const T0 = "2026-09-01T10:00:00.000Z";
const rawState = (session) => readFileSync(join(session, "state.json"), "utf8");
const leftovers = (session) => readdirSync(session).filter((f) => !["state.json", "events.jsonl", "meta.json"].includes(f));
const qn = (id, round, extra = {}) => ({
  id, round, deps: [], title: `Title ${id}`, body: `Body ${id}`,
  options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }], rec: { option: "A", why: "Alpha is simpler." },
  status: "open", durable: false, updated: false, thread: [], ...extra,
});
function seeded(env, fields = {}) {
  const { session, agentId } = newIn(env, tmp("grill-pt-"), "Patch topic");
  writeState(session, { ...stateOf(session), agent: { status: "waiting", since: T0, handled: 0 }, ...fields });
  return { session, agentId };
}
function patch(env, { session, agentId }, body, extra = []) {
  const input = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const r = spawnSync(process.execPath, [HUB, "patch", "--session", session, "--agent-id", agentId, ...extra], { env, input, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function applied(env, s, body, extra) {
  const r = patch(env, s, body, extra);
  assert.equal(r.code, 0, `patch failed: ${r.err}`);
  assert.equal(r.err, "");
  return r;
}
function rejected(env, s, body, pattern, extra) {
  const before = rawState(s.session);
  const r = patch(env, s, body, extra);
  assert.notEqual(r.code, 0, `expected a rejection for ${typeof body === "string" ? body : JSON.stringify(body)}`);
  assert.equal(r.out, "", "nothing on stdout when rejected");
  assert.match(r.err, /^grill: [^\n]+\n$/, "exactly one line on stderr");
  if (pattern) assert.match(r.err, pattern);
  assert.equal(rawState(s.session), before, "state.json untouched");
  assert.deepEqual(leftovers(s.session), [], "no temp file left behind");
  return r;
}

test("patch: prints one summary line, refreshes the owner heartbeat, and rejects owner/token", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1), qn("q2", 1, { status: "answered" })] });
  const meta = metaOf(s.session);
  meta.owner.heartbeat = new Date(Date.now() - 600_000).toISOString();
  writeFileSync(join(s.session, "meta.json"), JSON.stringify(meta));
  const r = applied(env, s, { agent: { handled: 3 } });
  const out = JSON.parse(r.out);
  assert.deepEqual(Object.keys(out).sort(), ["bytes", "handled", "ok", "open", "questions"]);
  assert.deepEqual([out.ok, out.questions, out.open, out.handled], [true, 2, 1, 3]);
  assert.equal(out.bytes, Buffer.byteLength(rawState(s.session)));
  assert.ok(Date.now() - Date.parse(metaOf(s.session).owner.heartbeat) < 10_000, "heartbeat refreshed");
  assert.equal(metaOf(s.session).token, meta.token);
  rejected(env, s, { owner: { agentId: "x" } }, /written by the hub/);
  rejected(env, s, { token: "t" }, /written by the hub/);
  const r2 = spawnSync(process.execPath, [HUB, "patch", "--session", s.session], { env, input: "{}", encoding: "utf8" });
  assert.equal(r2.status, 2); assert.match(r2.stderr, /^grill: --agent-id <id> is required[^\n]*\n$/);
});

test("patch: invalid JSON, a failed validation, a bad shape, or a missing state.json exits 2 with one stderr line and leaves state.json untouched", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  for (const [body, re] of [
    ["{ nope", /JSON/], ["", /empty/], ["[1,2]", /object/], ['"just a string"', /object/],
    [{ agent: { status: "sleeping" } }, /agent\.status/], [{ agent: { handled: -1 } }, /agent\.handled/], [{ agent: "waiting" }, /agent/],
    [{ questions: null }, /questions/], [{ questions: { id: "q1" } }, /questions/],
    [{ questions: [{ id: "q1", status: "done" }] }, /q1.*status/], [{ questions: [{ id: "q1", answer: { kind: "maybe" } }] }, /q1.*answer/],
    [{ questions: [{ id: "q1", thread: [{ who: "bot", text: "hi" }] }] }, /q1.*thread/],
    [{ visual: { kind: "painting" } }, /visual\.kind/], [{ visual: { stale: true } }, /visual needs kind and version/], [{ terms: "round" }, /terms/],
    ['{"questions":null,"__proto__":{"questions":[]}}', /__proto__.*the patch/],
    ['{"agent":{"status":null,"__proto__":{"status":"waiting"}}}', /__proto__.*agent/],
    ['{"questions":[{"id":"q1","status":null,"__proto__":{"status":"open"}}]}', /__proto__.*q1/],
    ['{"questions":[{"id":"q9","round":2,"title":"t","rec":{"why":"w"},"__proto__":{"status":"answered"}}]}', /__proto__.*q9/],
    [{ phase: "later" }, /phase must be one of/],
  ]) assert.equal(rejected(env, s, body, re).code, 2);

  const empty = tmp("grill-nostate-");
  const r = patch(env, { session: empty, agentId: s.agentId }, { note: "x" });
  assert.equal(r.code, 2);
  assert.match(r.err, /^grill: [^\n]*state\.json[^\n]*\n$/);
  assert.deepEqual(readdirSync(empty), [], "nothing created");
});

test("patch: an error the merge never expected keeps the contract — one grill: line, exit 2, state.json untouched", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  const deep = `{"extra":${"[".repeat(20000)}${"]".repeat(20000)}}`;
  const r = rejected(env, s, deep, /could not apply the patch \(state\.json unchanged\)/);
  assert.equal(r.code, 2, "the same exit code as every other rejection");
});

test("patch: every field the page renders must have the shape the render reads, or the patch is rejected", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, {
    terms: [{ term: "round", def: "One turn of questions.", avoid: ["batch"] }],
    questions: [qn("q1", 1, { explore: { at: T0, rows: [{ option: "A", pros: ["p"], cons: ["c"] }] } })],
    visual: { kind: "prototype", version: 1, at: T0, note: "v1", stale: false, thread: [] },
  });
  rejected(env, s, { terms: [{ term: "round", def: "d", avoid: "batch" }] }, /round.*avoid/);
  rejected(env, s, { terms: [{ term: "round", def: "d", avoid: [["batch"]] }] }, /round.*avoid/);
  rejected(env, s, { terms: [{ term: "round", def: ["d"] }] }, /round.*def/);
  const ex = (rows, at) => ({ questions: [{ id: "q1", explore: { ...(at === undefined ? {} : { at }), rows } }] });
  rejected(env, s, ex([null]), /q1\.explore\.rows\[0\]/);
  rejected(env, s, ex(["A"]), /q1\.explore\.rows\[0\]/);
  rejected(env, s, ex([{ option: "A", pros: "fast", cons: ["c"] }]), /q1\.explore\.rows\[0\]\.pros/);
  rejected(env, s, ex([{ option: "A", pros: ["p"], cons: [{ text: "c" }] }]), /q1\.explore\.rows\[0\]\.cons/);
  rejected(env, s, ex([{ option: 1, pros: ["p"], cons: ["c"] }]), /q1\.explore\.rows\[0\]\.option/);
  rejected(env, s, ex([], 12), /q1\.explore\.at/);
  const boom = { toString: "x" };
  rejected(env, s, { questions: [{ id: "q1", options: [{ k: "A", text: boom }] }] }, /q1\.options/);
  rejected(env, s, { questions: [{ id: "q1", rec: { option: "A", why: boom } }] }, /q1\.rec\.why/);
  rejected(env, s, { questions: [{ id: "q1", rec: { option: ["A"], why: "w" } }] }, /q1\.rec\.option/);
  rejected(env, s, { questions: [{ id: "q1", rec: { text: 5, why: "w" } }] }, /q1\.rec\.text/);
  rejected(env, s, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", option: 2 } }] }, /q1\.answer\.option/);
  rejected(env, s, { questions: [{ id: "q1", status: "answered", answer: { kind: "text", text: boom } }] }, /q1\.answer\.text/);
  rejected(env, s, { visual: { note: boom } }, /visual\.note/);
  rejected(env, s, { visual: { version: 2, at: 5 } }, /visual\.at/);
  rejected(env, s, { visual: { drawing: { since: boom, seq: 2 } } }, /visual\.drawing/);
  rejected(env, s, { finished: { doc: boom } }, /finished\.doc/);
  rejected(env, s, { finished: { doc: "docs/x.md", visual: 1 } }, /finished\.visual/);
  rejected(env, s, { finished: { doc: "docs/x.md", at: boom } }, /finished\.at/);

  applied(env, s, {
    terms: [{ term: "round", def: "d", avoid: [] }, { term: "send", def: "One press." }],
    questions: [
      { id: "q1", status: "answered", answer: { kind: "text", text: "Neither, a third way" }, rec: { text: "t", why: "w" },
        explore: { rows: [{ option: "A", pros: ["p"], cons: [] }, { option: "B", pros: [], cons: ["c"] }] } },
      { id: "q2", round: 2, title: "No options", body: "b", rec: { why: "only a why" } },
    ],
    visual: { version: 2, note: "v2: bigger", drawing: { seq: 3 } },
    finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html" },
  });
});

test("patch: a stdin that cannot be read exits non-zero with one stderr line and leaves state.json untouched", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  const before = rawState(s.session);
  const fd = openSync(tmp("grill-stdin-dir-"), "r");
  let r;
  try { r = spawnSync(process.execPath, [HUB, "patch", "--session", s.session, "--agent-id", s.agentId], { env, stdio: [fd, "pipe", "pipe"], encoding: "utf8" }); } finally { closeSync(fd); }
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "", "nothing on stdout");
  assert.match(r.stderr, /^grill: [^\n]*stdin[^\n]*\n$/, `exactly one grill: line on stderr, got: ${r.stderr}`);
  assert.equal(rawState(s.session), before, "state.json untouched");
  assert.deepEqual(leftovers(s.session), [], "no temp file left behind");
});

test("patch: a patch that reaches stdin after patch has started reading is still applied", async (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  const child = spawn(process.execPath, [HUB, "patch", "--session", s.session, "--agent-id", s.agentId], { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise((res) => child.on("exit", res));
  await sleep(500);
  child.stdin.end(JSON.stringify({ agent: { handled: 4 } }));
  assert.equal(await exited, 0, `patch failed: ${err}`);
  assert.equal(err, "");
  assert.equal(JSON.parse(out).handled, 4);
  assert.equal(stateOf(s.session).agent.handled, 4);
});

test("patch: --file reads the patch from a file instead of stdin", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  const file = join(tmp("grill-pf-"), "patch.json");
  writeFileSync(file, JSON.stringify({ agent: { handled: 7 }, questions: [{ id: "q1", status: "deferred" }] }));
  const r = applied(env, s, undefined, ["--file", file]);
  assert.equal(JSON.parse(r.out).handled, 7);
  assert.equal(stateOf(s.session).questions[0].status, "deferred");
  rejected(env, s, undefined, /no-such/, ["--file", join(tmp("grill-pf-"), "no-such.json")]);
});

test("patch: a write failure exits 1", (t) => {
  const { env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  // a read-only session folder: the temp file for the atomic write can't be created
  chmodSync(s.session, 0o500);
  try {
    const r = patch(env, s, { note: "x" });
    assert.equal(r.code, 1);
    assert.match(r.err, /^grill: could not write state\.json[^\n]*\n$/);
  } finally { chmodSync(s.session, 0o700); }
});

test("patch: ensure is best effort — with the hub down and unstartable the patch still applies, with a warning", async (t) => {
  const { home, env } = homeFor(t);
  const s = seeded(env, { questions: [qn("q1", 1)] });
  const pid = hubInfo(home).pid;
  await stopHub(home);
  await waitUntil(() => !alive(pid), 3000);
  const r = patch({ ...env, GRILL_TEST_BIND_ERROR: "EPERM" }, s, { agent: { handled: 5 } });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).handled, 5);
  assert.match(r.err, /^grill: warning: [^\n]*the patch still applies[^\n]*\n$/);
  assert.equal(stateOf(s.session).agent.handled, 5);
  // and when the hub can start, patch brings it back up
  applied(env, s, { agent: { handled: 6 } });
  assert.notEqual(hubInfo(home).pid, pid);
});
