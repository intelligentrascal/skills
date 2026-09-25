// watch and wait: no gap between drain and tail, D11 batches, exit codes, heartbeat through the
// hub, "taken" on 409, hub-down tolerance, --map (spec §5 Per-agent watcher, Session ownership;
// §5b Listening; §10 "watch has no gap"; plan T13, D11). The wait exit 0/3 test ports
// jasonku09/grill-with-ui test/server.test.mjs:120-157 (daafa1e) onto the hub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { HUB, hubInfo, mkHome, run, runAsync, sleep, stopHub, tmp, waitUntil } from "./helpers.mjs";
import { projectKey } from "../lib/home.mjs";
import { lastSeq, readEvents, resolveMapKey, tailLog } from "../lib/events.mjs";
import * as sessions from "../lib/sessions.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Kill every child the test spawned, then stop the hub (whichever one is current) and wait for it.
function setup(t, extra) {
  const h = mkHome(extra), kids = [];
  t.after(async () => {
    for (const k of kids) if (k.exitCode === null && k.signalCode === null) k.kill("SIGKILL");
    let pid; try { pid = hubInfo(h.home).pid; } catch { /* never started */ }
    await stopHub(h.home);
    if (pid) { try { await waitUntil(() => !alive(pid), 3000); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
    rmSync(h.home, { recursive: true, force: true });
  });
  // A hub child with a line reader on stdout (every line parsed as JSON) and an exit promise.
  h.spawn = (args) => {
    const c = spawn(process.execPath, [HUB, ...args], { env: h.env, stdio: ["ignore", "pipe", "pipe"] });
    kids.push(c);
    c.lines = []; c.err = "";
    let buf = "";
    c.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { c.lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    c.stderr.on("data", (d) => (c.err += d));
    c.exited = new Promise((res) => c.on("exit", (code) => res(code)));
    return c;
  };
  return h;
}
const newIn = (env, cwd = tmp("grill-p-")) => JSON.parse(run(env, ["new", "--topic", "T"], { cwd }));
const metaOf = (dir) => JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
const ev = (n, type = "send") => JSON.stringify({ type, seq: n, at: "x", actions: [{ type: "finish" }] }) + "\n";

test("sessions.mjs re-exports readEvents/lastSeq from events.mjs", () => {
  assert.equal(sessions.readEvents, readEvents);
  assert.equal(sessions.lastSeq, lastSeq);
});

test("tailLog: drains what is on disk past `after`, then tails; skips partial and bad lines; dedupes by seq", async () => {
  const dir = tmp("grill-tail-"), file = join(dir, "events.jsonl");
  writeFileSync(file, ev(1) + ev(2) + "not json\n");
  const got = [];
  const stop = tailLog(file, 1, (line, e) => got.push(e.seq));
  try {
    assert.deepEqual(got, [2], "drain is synchronous");
    appendFileSync(file, ev(3) + '{"type":"send","seq":4');   // 4 is still partial
    await waitUntil(() => got.length === 2, 3000);
    appendFileSync(file, ',"at":"x"}\n' + ev(2) + ev(5));    // completes 4; 2 again is a dup
    await waitUntil(() => got.length === 4, 3000);
    await sleep(100);
    assert.deepEqual(got, [2, 3, 4, 5]);
  } finally { stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("tailLog: a folder that appears later is picked up by the 1 s safety net", async () => {
  const root = tmp("grill-tail-"), dir = join(root, "later"), file = join(dir, "events.jsonl");
  const got = [];
  const stop = tailLog(file, 0, (line, e) => got.push(e.seq));
  try {
    mkdirSync(dir); writeFileSync(file, ev(1));
    await waitUntil(() => got.length === 1, 4000);
    appendFileSync(file, ev(2));
    await waitUntil(() => got.length === 2, 4000);
    assert.deepEqual(got, [1, 2]);
  } finally { stop(); rmSync(root, { recursive: true, force: true }); }
});

test("watch: no gap between drain and tail", async (t) => {
  const h = setup(t);
  const s = newIn(h.env);
  const log = join(s.session, "events.jsonl");
  appendFileSync(log, ev(1) + ev(2));
  const w = h.spawn(["watch", "--session", s.session, "--after", "1", "--agent-id", s.agentId]);
  for (let n = 3; n <= 22; n++) { appendFileSync(log, ev(n)); await sleep(5); }
  await waitUntil(() => w.lines.length >= 21, 5000);
  await sleep(300); // nothing extra arrives late
  assert.deepEqual(w.lines.map((l) => l.seq), Array.from({ length: 21 }, (_, i) => i + 2));
  assert.equal(w.exitCode, null, "watch never exits on its own");
});

test("watch: prints only send lines, whole and unchanged, one per line", async (t) => {
  const h = setup(t);
  const s = newIn(h.env);
  const log = join(s.session, "events.jsonl");
  const w = h.spawn(["watch", "--session", s.session, "--after", "0", "--agent-id", s.agentId]);
  appendFileSync(log, ev(1, "ready") + ev(2) + ev(3, "work") + ev(4));
  await waitUntil(() => w.lines.length >= 2, 5000);
  await sleep(300);
  assert.deepEqual(w.lines.map((l) => [l.type, l.seq]), [["send", 2], ["send", 4]]);
  assert.deepEqual(w.lines[0], JSON.parse(ev(2)));
});

test("wait: prints ALL sends past --after on disk and exits 0 (D11); blocks until one lands; exit 3 on timeout", async (t) => {
  const h = setup(t);
  const s = newIn(h.env);
  const log = join(s.session, "events.jsonl");
  appendFileSync(log, ev(1) + ev(2) + ev(3));
  const r = await runAsync(h.env, ["wait", "--session", s.session, "--after", "1", "--timeout", "5", "--agent-id", s.agentId]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.split("\n").map((l) => JSON.parse(l).seq), [2, 3]);

  // Nothing new: it blocks, then prints every line of the batch that woke it.
  const w = h.spawn(["wait", "--session", s.session, "--after", "3", "--timeout", "10", "--agent-id", s.agentId]);
  await sleep(500);
  assert.equal(w.lines.length, 0, "nothing printed before a new send");
  appendFileSync(log, ev(4, "note") + ev(5) + ev(6));
  assert.equal(await w.exited, 0, w.err);
  assert.deepEqual(w.lines.map((l) => l.seq), [5, 6]);

  // A non-send line alone does not wake it.
  const w2 = h.spawn(["wait", "--session", s.session, "--after", "6", "--timeout", "0.8", "--agent-id", s.agentId]);
  appendFileSync(log, ev(7, "note"));
  assert.equal(await w2.exited, 3);
  assert.equal(w2.lines.length, 0);

  const w3 = await runAsync(h.env, ["wait", "--session", s.session, "--after", "7", "--timeout", "0.5", "--agent-id", s.agentId]);
  assert.equal(w3.code, 3);
  assert.equal(w3.out, "");
});

test("watch/wait: missing --agent-id or --session is one line, exit 2", async (t) => {
  const h = setup(t);
  const s = newIn(h.env);
  for (const cmd of ["watch", "wait"]) {
    const a = await runAsync(h.env, [cmd, "--session", s.session, "--after", "0"]);
    assert.equal(a.code, 2); assert.match(a.err, /^grill: --agent-id/);
    const b = await runAsync(h.env, [cmd, "--after", "0", "--agent-id", "x"]);
    assert.equal(b.code, 2); assert.match(b.err, /^grill: .*--session/);
    const c = await runAsync(h.env, [cmd, "--session", s.session, "--after", "soon", "--agent-id", "x"]);
    assert.equal(c.code, 2); assert.match(c.err, /--after/);
  }
});

test("heartbeat: watch refreshes meta.owner.heartbeat through the hub every GRILL_HEARTBEAT_MS", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const s = newIn(h.env);
  const hb0 = metaOf(s.session).owner.heartbeat;
  const w = h.spawn(["watch", "--session", s.session, "--after", "0", "--agent-id", s.agentId]);
  await waitUntil(() => metaOf(s.session).owner.heartbeat !== hb0, 5000);
  const hb1 = metaOf(s.session).owner.heartbeat;
  await waitUntil(() => metaOf(s.session).owner.heartbeat !== hb1, 3000);
  assert.ok(Date.parse(metaOf(s.session).owner.heartbeat) > Date.parse(hb1));
  assert.equal(metaOf(s.session).owner.agentId, s.agentId);
  assert.equal(w.exitCode, null);
});

test("heartbeat: wait heartbeats while it blocks", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const s = newIn(h.env);
  const hb0 = metaOf(s.session).owner.heartbeat;
  const w = h.spawn(["wait", "--session", s.session, "--after", "0", "--timeout", "10", "--agent-id", s.agentId]);
  await waitUntil(() => metaOf(s.session).owner.heartbeat !== hb0, 5000);
  const hb1 = metaOf(s.session).owner.heartbeat;
  await waitUntil(() => metaOf(s.session).owner.heartbeat !== hb1, 3000);
  assert.equal(w.exitCode, null);
});

test("taken: a 409 heartbeat prints {type:taken,by} and exits 4 (watch and wait)", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const s = newIn(h.env);
  const w = h.spawn(["watch", "--session", s.session, "--after", "0", "--agent-id", s.agentId]);
  const wt = h.spawn(["wait", "--session", s.session, "--after", "0", "--timeout", "20", "--agent-id", s.agentId]);
  await sleep(300);
  const took = JSON.parse(run(h.env, ["resume", "--session", s.session, "--take", "--agent", "codex"]));
  assert.notEqual(took.agentId, s.agentId);
  assert.equal(await w.exited, 4, w.err);
  assert.equal(await wt.exited, 4, wt.err);
  for (const c of [w, wt]) {
    assert.equal(c.lines.length, 1);
    assert.deepEqual(c.lines[0], { type: "taken", by: "codex" });
  }
  assert.equal(metaOf(s.session).owner.agentId, took.agentId, "the loser never wrote meta.json");
});

test("hub down: watch keeps tailing the file and ensures the hub again", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const s = newIn(h.env);
  const log = join(s.session, "events.jsonl");
  const w = h.spawn(["watch", "--session", s.session, "--after", "0", "--agent-id", s.agentId]);
  appendFileSync(log, ev(1));
  await waitUntil(() => w.lines.length === 1, 5000);
  const first = hubInfo(h.home);
  await stopHub(h.home);
  await waitUntil(() => !alive(first.pid), 3000);
  appendFileSync(log, ev(2));
  await waitUntil(() => w.lines.length === 2, 5000);
  await waitUntil(() => { try { const i = hubInfo(h.home); return i.pid !== first.pid && alive(i.pid); } catch { return false; } }, 8000);
  const hb = metaOf(s.session).owner.heartbeat;
  await waitUntil(() => metaOf(s.session).owner.heartbeat !== hb, 3000); // heartbeats reach the new hub
  appendFileSync(log, ev(3));
  await waitUntil(() => w.lines.length === 3, 5000);
  assert.deepEqual(w.lines.map((l) => l.seq), [1, 2, 3]);
  assert.equal(w.exitCode, null);
});

test("resolveMapKey: full key kept, bare slug prefixed with the cwd's projectKey, junk rejected", () => {
  const cwd = tmp("grill-proj-");
  assert.equal(resolveMapKey("abc-12345678/42", cwd), "abc-12345678/42");
  assert.equal(resolveMapKey("42", cwd), `${projectKey(cwd)}/42`);
  assert.equal(resolveMapKey("My Effort!", cwd), `${projectKey(cwd)}/my-effort`);
  for (const bad of ["", "a/b/c", "../x", "A/b", "a/", "/b"]) assert.throws(() => resolveMapKey(bad, cwd), /map key/, bad);
});

test("--map: watch and wait tail maps/<key>/events.jsonl, print work/refresh/action lines, heartbeat sets map.json listener", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const cwd = tmp("grill-proj-");
  const key = `${projectKey(cwd)}/7`;
  const dir = join(h.home, "maps", ...key.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ token: "t0k" }));
  const log = join(dir, "events.jsonl");
  writeFileSync(log, ev(1, "work") + ev(2, "note") + ev(3, "refresh"));

  const r = await runAsync(h.env, ["wait", "--map", "7", "--after", "0", "--timeout", "5", "--agent-id", "a1"], { cwd });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.split("\n").map((l) => [JSON.parse(l).type, JSON.parse(l).seq]), [["work", 1], ["refresh", 3]]);

  const w = h.spawn(["watch", "--map", key, "--after", "3", "--agent-id", "a1"]);
  await sleep(700); // several heartbeats: a 404 (route not there yet) or 401 must not stop it
  appendFileSync(log, ev(4, "action") + ev(5, "note") + ev(6, "work"));
  await waitUntil(() => w.lines.length >= 2, 5000);
  await sleep(300);
  assert.deepEqual(w.lines.map((l) => [l.type, l.seq]), [["action", 4], ["work", 6]]);
  assert.equal(w.exitCode, null, w.err);
  // With the T14 route in place the listener heartbeat lands in map.json.
  await waitUntil(() => { try { return JSON.parse(readFileSync(join(dir, "map.json"), "utf8")).listener?.agentId === "a1"; } catch { return false; } }, 3000);

  const bad = await runAsync(h.env, ["wait", "--map", "../x", "--after", "0", "--timeout", "1", "--agent-id", "a1"], { cwd });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /^grill: .*map key/);
});
