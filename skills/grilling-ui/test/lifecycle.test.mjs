// Hub lifecycle: ensure races, reused pid/port, version handoff on the same port, idle exit and
// what blocks it, unwritable GRILL_HOME / denied bind (spec §5, §5b, §10; plan T9).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkHome, run, runAsync, hubInfo, sleep, waitUntil, stopHub, tmp } from "./helpers.mjs";
import { createLog } from "../lib/log.mjs";
import { grillHome, projectKeyOf, projectKey, codexFix } from "../lib/home.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Shut the hub down and make sure its process is gone, whatever the test did.
async function cleanup(home) {
  let pid; try { pid = hubInfo(home).pid; } catch { /* never started */ }
  await stopHub(home);
  if (pid) { try { await waitUntil(() => !alive(pid), 3000); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
  try { chmodSync(home, 0o700); } catch {}
  rmSync(home, { recursive: true, force: true });
}
const ensure = (env) => JSON.parse(run(env, ["ensure"]));
const fixText = (what, code, home) => `grill: cannot ${what} (${code}). If you are in Codex, add to ~/.codex/config.toml:
  [sandbox_workspace_write]
  network_access = true
  writable_roots = ["${home}"]
then restart Codex. Other agents: make ${home} writable or set GRILL_HOME.`;

test("two parallel ensures give one hub", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  const [a, b] = await Promise.all([runAsync(env, ["ensure"]), runAsync(env, ["ensure"])]);
  assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
  const [ja, jb] = [JSON.parse(a.out), JSON.parse(b.out)];
  assert.equal(ja.pid, jb.pid);
  assert.equal(ja.port, jb.port);
  assert.deepEqual([ja.reused, jb.reused].sort(), [false, true], "one spawned, one reused");
  assert.ok(!existsSync(join(home, "hub.lock")), "lock released");
});

test("ensure: output shape, reuse, hub.json 0600 with admin token, /health echoes it", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  const one = ensure(env);
  assert.deepEqual(Object.keys(one).sort(), ["pid", "port", "reused", "started", "version"], "no adminToken in the output");
  assert.equal(one.reused, false);
  assert.match(one.version, /^[0-9a-f]{12}$/, "version = 12 hex of sha256 over the hub code (D7)");
  const info = hubInfo(home);
  assert.equal(statSync(join(home, "hub.json")).mode & 0o777, 0o600);
  assert.match(info.adminToken, /^[0-9a-f]{32,}$/);
  assert.deepEqual([info.port, info.pid, info.version, info.started], [one.port, one.pid, one.version, one.started]);
  const h = await (await fetch(`http://127.0.0.1:${one.port}/health`)).json();
  assert.deepEqual(h, { pid: one.pid, started: one.started, version: one.version });
  const two = ensure(env);
  assert.deepEqual({ ...two, reused: false }, one); assert.equal(two.reused, true);
  for (const d of ["logs", "grill-sessions", "maps"]) assert.ok(statSync(join(home, d)).isDirectory(), d);
  assert.match(readFileSync(join(home, "logs", "hub.log"), "utf8"), /listening on 127\.0\.0\.1:\d+/);
});

test("admin routes need the admin token and no foreign Origin; unknown routes 404", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  const { port, pid } = ensure(env);
  const { adminToken } = hubInfo(home);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/admin/shutdown`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/admin/shutdown`, { method: "POST", headers: { "x-grill-admin": "nope" } })).status, 401);
  assert.equal((await fetch(`${base}/admin/handoff`, { method: "POST", headers: { "x-grill-admin": adminToken, origin: "http://evil.example" } })).status, 403);
  assert.equal((await fetch(`${base}/admin/shutdown`, { method: "GET", headers: { "x-grill-admin": adminToken } })).status, 404);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.ok(alive(pid), "still running after rejected admin calls");
  const r = await fetch(`${base}/admin/shutdown`, { method: "POST", headers: { "x-grill-admin": adminToken, origin: base } });
  assert.equal(r.status, 200);
  await waitUntil(() => !alive(pid), 3000);
});

test("hub.json pointing at a live foreign pid/port is not reused", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  const hits = [];
  const foreign = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ pid: 999999, started: "2020-01-01T00:00:00.000Z", version: "x" })); });
  await new Promise((r) => foreign.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { foreign.closeAllConnections(); foreign.close(r); }));
  const fport = foreign.address().port;
  // pid is alive (this test process) but /health does not echo it: a reused pid and port.
  writeFileSync(join(home, "hub.json"), JSON.stringify({ port: fport, pid: process.pid, version: "x", started: "2021-01-01T00:00:00.000Z", adminToken: "t" }));
  // runAsync, not run: the foreign server lives in this process and must keep answering.
  const r = await runAsync(env, ["ensure"]);
  assert.equal(r.code, 0, r.err);
  const one = JSON.parse(r.out);
  assert.equal(one.reused, false);
  assert.ok(hits.includes("GET /health"), "the foreign server was asked and answered");
  assert.notEqual(one.pid, process.pid); assert.notEqual(one.pid, 999999);
  assert.ok(alive(one.pid));
  assert.notEqual(one.port, fport, "the foreign server keeps its port; the hub falls back to a free one");
  assert.ok(!hits.some((h) => h.startsWith("POST")), `no admin call to the foreign server: ${hits}`);
  const h = await (await fetch(`http://127.0.0.1:${one.port}/health`)).json();
  assert.equal(h.pid, one.pid);
});

test("a stale lock (dead pid) is taken over", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "hub.lock"), "999999");
  const one = ensure(env);
  assert.equal(one.reused, false);
  assert.ok(!existsSync(join(home, "hub.lock")));
});

test("version change hands off on the same port", async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  const one = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "v1" }, ["ensure"]));
  const two = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "v2" }, ["ensure"]));
  assert.equal(two.port, one.port); assert.notEqual(two.pid, one.pid); assert.equal(two.reused, false);
  assert.equal(one.version, "v1"); assert.equal(two.version, "v2");
  await waitUntil(() => !alive(one.pid), 3000);
  assert.equal(hubInfo(home).pid, two.pid);
  const again = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "v2" }, ["ensure"]));
  assert.equal(again.pid, two.pid); assert.equal(again.reused, true);
});

const idleEnv = { GRILL_IDLE_MS: "300", GRILL_TICK_MS: "100" };
function fakeSession(home, { heartbeat, finished = false }) {
  const dir = join(home, "grill-sessions", "proj-12345678", "20260925-101010-abcd");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ topic: "t", questions: [], ...(finished ? { finished: { kind: "doc", at: heartbeat } } : {}) }));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ token: "x", owner: { agentId: "a", agent: "claude", heartbeat } }));
  return dir;
}

test("idle exit: the hub exits after GRILL_IDLE_MS with no client and no fresh heartbeat", async (t) => {
  const { home, env } = mkHome(idleEnv); t.after(() => cleanup(home));
  const { pid } = ensure(env);
  await waitUntil(() => !alive(pid), 5000);
  assert.match(readFileSync(join(home, "logs", "hub.log"), "utf8"), /idle/);
});

test("idle exit is blocked by a fresh owner heartbeat in an unfinished session, not by a finished one", async (t) => {
  const { home, env } = mkHome(idleEnv); t.after(() => cleanup(home));
  mkdirSync(home, { recursive: true });
  fakeSession(home, { heartbeat: new Date().toISOString() });
  const { pid } = ensure(env);
  await sleep(1000);
  assert.ok(alive(pid), "a fresh heartbeat keeps the hub up");
  fakeSession(home, { heartbeat: new Date().toISOString(), finished: true });
  await waitUntil(() => !alive(pid), 5000);
});

test("idle exit is blocked by a fresh heartbeat until it goes stale (GRILL_FRESH_MS)", async (t) => {
  const { home, env } = mkHome({ ...idleEnv, GRILL_FRESH_MS: "1500" }); t.after(() => cleanup(home));
  mkdirSync(home, { recursive: true });
  fakeSession(home, { heartbeat: new Date().toISOString() });
  const { pid } = ensure(env);
  await sleep(800);
  assert.ok(alive(pid), "still fresh");
  await waitUntil(() => !alive(pid), 5000);
});

test("idle exit is blocked by a fresh map listener heartbeat", async (t) => {
  const { home, env } = mkHome(idleEnv); t.after(() => cleanup(home));
  const mapDir = join(home, "maps", "proj-12345678", "42");
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(join(mapDir, "map.json"), JSON.stringify({ title: "M", listener: { agentId: "a", heartbeat: new Date().toISOString() } }));
  const { pid } = ensure(env);
  await sleep(1000);
  assert.ok(alive(pid), "a fresh map listener keeps the hub up");
  writeFileSync(join(mapDir, "map.json"), JSON.stringify({ title: "M" }));
  await waitUntil(() => !alive(pid), 5000);
});

test("unwritable GRILL_HOME prints the Codex fix and exits 1 (ensure and serve)", { skip: process.getuid && process.getuid() === 0 ? "root ignores chmod" : false }, async (t) => {
  const { home, env } = mkHome(); t.after(() => cleanup(home));
  chmodSync(home, 0o500);
  for (const cmd of [["ensure"], ["serve"]]) {
    const r = await runAsync(env, cmd);
    assert.equal(r.code, 1, `${cmd}: ${r.err}`);
    assert.equal(r.out, "");
    assert.equal(r.err, fixText("write GRILL_HOME", "EACCES", home));
  }
  assert.deepEqual(readdirSync(home), [], "nothing created, no fallback location");
});

test("a denied bind prints the Codex fix and exits 1 (serve and ensure)", async (t) => {
  const { home, env } = mkHome({ GRILL_TEST_BIND_ERROR: "EPERM" }); t.after(() => cleanup(home));
  const s = await runAsync(env, ["serve"]);
  assert.equal(s.code, 1, s.err);
  assert.equal(s.err, fixText("bind 127.0.0.1", "EPERM", home));
  const e = await runAsync(env, ["ensure"]);
  assert.equal(e.code, 1, e.err);
  assert.equal(e.out, "");
  assert.equal(e.err, fixText("bind 127.0.0.1", "EPERM", home));
  assert.ok(!existsSync(join(home, "hub.json")));
  assert.ok(!existsSync(join(home, "hub.lock")));
});

test("codexFix text matches the plan exactly", () => {
  assert.equal("grill: " + codexFix("bind 127.0.0.1", "EACCES", "/h"), fixText("bind 127.0.0.1", "EACCES", "/h"));
});

test("hub log rotates at the size limit and keeps three old files", () => {
  const dir = tmp("grill-log-"); const file = join(dir, "hub.log");
  const log = createLog(file, { max: 200 });
  for (let i = 0; i < 40; i++) log(`line ${i} ${"x".repeat(40)}`);
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, ["hub.log", "hub.log.1", "hub.log.2", "hub.log.3"]);
  for (const f of files) assert.ok(statSync(join(dir, f)).size <= 200, `${f} within the limit`);
  assert.match(readFileSync(file, "utf8"), /line 39 /);
  assert.match(readFileSync(file, "utf8"), /^\d{4}-\d{2}-\d{2}T[^ ]+Z line /);
  rmSync(dir, { recursive: true, force: true });
});

test("home: GRILL_HOME default and projectKey format (D2)", () => {
  assert.equal(grillHome({}), join(homedir(), ".intelligentrascal"));
  assert.equal(grillHome({ GRILL_HOME: "/tmp/x/../y" }), "/tmp/y");
  assert.match(projectKeyOf("/Users/a/My Project.v2"), /^my-project-v2-[0-9a-f]{8}$/);
  assert.notEqual(projectKeyOf("/a/proj"), projectKeyOf("/b/proj"), "same basename, different paths differ");
  assert.match(projectKeyOf("/a/.dotfiles"), /^dotfiles-[0-9a-f]{8}$/);
  const cwd = tmp("Proj_Key-");
  assert.match(projectKey(cwd), /^proj-key-[a-z0-9]+-[0-9a-f]{8}$/);
});
