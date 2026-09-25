// Board claims and actions (spec §4a Actions, Board watcher, Work-this-ticket hand-off,
// Concurrency; §10 "claim compare-and-set: two concurrent claims give one winner"; plan T33, D4, D10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { HUB, cleanupHub, hubInfo, mkHome, runAsync, sleep, sseReader, settle, tmp, waitUntil } from "./helpers.mjs";
import { projectKey } from "../lib/home.mjs";
import { ClaimError, claim, release, validateMap } from "../lib/maps.mjs";

const NOW = "2026-09-25T10:00:00.000Z", LATER = "2026-09-25T11:00:00.000Z";
const MAP = { title: "Auth rewrite", at: NOW, link: "https://github.com/o/r/issues/42",
  tickets: [
    { title: "A", type: "research", state: "frontier" },
    { title: "B", type: "task", state: "frontier" },
    { title: "C", type: "task", state: "blocked", blockedBy: ["A"] },
    { title: "D", type: "task", state: "claimed", assignee: "someone" },
  ] };
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ClaimError, e.message); return e.status; } return 200; };

// ---- pure claim / release (D10) ----
test("claim: a frontier ticket with no hubClaim → claimed + hubClaim {agentId, at, seq}; inputs untouched; at kept", () => {
  const before = JSON.stringify(MAP);
  const m = claim(MAP, "A", "agent-1", LATER, 3);
  assert.equal(JSON.stringify(MAP), before, "input not mutated");
  const a = m.tickets.find((t) => t.title === "A");
  assert.deepEqual(a, { title: "A", type: "research", state: "claimed", hubClaim: { agentId: "agent-1", at: LATER, seq: 3 } });
  assert.equal(m.at, NOW, "a claim is not an agent step: the board's freshness stamp stays");
  validateMap(m);
  // seq is optional (an agent's own CLI claim has no board event)
  assert.deepEqual(claim(MAP, "B", "agent-2", LATER).tickets[1].hubClaim, { agentId: "agent-2", at: LATER });
});

test("claim: 404 unknown ticket; 409 blocked, tracker-claimed, or already hub-claimed (same agent again is idempotent)", () => {
  assert.equal(code(() => claim(MAP, "Nope", "a", LATER, 1)), 404);
  assert.equal(code(() => claim(MAP, "C", "a", LATER, 1)), 409);
  assert.equal(code(() => claim(MAP, "D", "a", LATER, 1)), 409);
  const m = claim(MAP, "A", "a", LATER, 1);
  assert.equal(code(() => claim(m, "A", "b", LATER, 2)), 409);
  let err; try { claim(m, "A", "b", LATER, 2); } catch (e) { err = e; }
  assert.deepEqual(err.conflict, { ticket: "A", state: "claimed", hubClaim: { agentId: "a", at: LATER, seq: 1 } });
  assert.match(err.message, /already claimed by a/);
  assert.equal(claim(m, "A", "a", "x"), m, "the claimant's own claim again is a no-op");
  assert.equal(code(() => claim(m, "A", "a", LATER, 9)), 409, "a board click is always a strict compare-and-set");
  assert.equal(code(() => claim({ title: "M" }, "A", "a", LATER)), 404);
});

test("claim: a queued board claim is adopted by the first agent that claims it (itself a compare-and-set)", () => {
  const q = claim(MAP, "A", "queued", NOW, 4);
  const m = claim(q, "A", "agent-9", LATER);
  assert.deepEqual(m.tickets[0].hubClaim, { agentId: "agent-9", at: LATER, seq: 4 }, "adoption keeps the board seq");
  assert.equal(code(() => claim(m, "A", "agent-8", LATER)), 409);
  assert.equal(code(() => claim(q, "A", "queued", LATER, 5)), 409, "a second board click never adopts");
});

test("release: by the claimant (or of a queued claim) → frontier, hubClaim gone; others 409; unknown 404; unclaimed is a no-op", () => {
  const m = claim(MAP, "A", "a", LATER, 1);
  assert.equal(code(() => release(m, "A", "b")), 409);
  assert.equal(code(() => release(m, "Nope", "a")), 404);
  const r = release(m, "A", "a");
  assert.deepEqual(r.tickets[0], { title: "A", type: "research", state: "frontier" });
  assert.equal(r.at, NOW);
  assert.equal(release(r, "A", "a"), r, "releasing an unclaimed ticket changes nothing");
  assert.equal(release(MAP, "D", "a"), MAP, "a tracker claim (no hubClaim) is not the hub's to release");
  const q = claim(MAP, "B", "queued", LATER, 2);
  assert.equal(release(q, "B", "whoever").tickets[1].state, "frontier");
  validateMap(r);
});

// ---- hub ----
function setup(t, extra) {
  const h = mkHome(extra), kids = [];
  t.after(async () => {
    for (const k of kids) if (k.exitCode === null && k.signalCode === null) k.kill("SIGKILL");
    await cleanupHub(h.home);
  });
  h.spawn = (args, opts = {}) => {
    const c = spawn(process.execPath, [HUB, ...args], { env: h.env, stdio: ["ignore", "pipe", "pipe"], ...opts });
    kids.push(c);
    c.lines = []; c.err = "";
    let buf = "";
    c.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { c.lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    c.stderr.on("data", (d) => (c.err += d));
    return c;
  };
  return h;
}
// A map created through map-patch; returns helpers bound to it.
async function mkMap(h, map = MAP) {
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  const r = await runAsync(h.env, ["map-patch", "--map", key], { input: JSON.stringify(map) });
  assert.equal(r.code, 0, r.err);
  const dir = join(h.home, "maps", ...key.split("/"));
  const token = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).token;
  const base = `http://127.0.0.1:${hubInfo(h.home).port}/m/${key}`;
  const post = (sub, body, headers = {}) => fetch(`${base}/${sub}`, { method: "POST", headers: { "content-type": "application/json", "x-grill-token": token, ...headers }, body: JSON.stringify(body) });
  const events = () => readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const getMap = async () => (await fetch(`${base}/map`)).json();
  return { cwd, key, dir, token, base, post, events, getMap };
}

test("POST claim: 20 concurrent board claims on one ticket → exactly one 200, 19 × 409; one work event with the winner's seq", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const res = await Promise.all(Array.from({ length: 20 }, () => m.post("claim", { ticket: "A" })));
  const bodies = await Promise.all(res.map((r) => r.json()));
  const codes = res.map((r) => r.status).sort();
  assert.deepEqual(codes, [200, ...Array(19).fill(409)]);
  const win = bodies.find((b) => b.ok);
  assert.equal(win.seq, 1);
  assert.deepEqual(Object.keys(win).sort(), ["hubClaim", "ok", "seq"]);
  assert.equal(win.hubClaim.agentId, "queued", "no listener → queued (D10)");
  for (const b of bodies.filter((x) => !x.ok)) {
    assert.match(b.error, /already claimed by queued/);
    assert.equal(b.conflict.hubClaim.seq, 1);
  }
  const ev = m.events();
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0]).sort(), ["at", "seq", "ticket", "type"]);
  assert.deepEqual([ev[0].type, ev[0].seq, ev[0].ticket], ["work", 1, "A"]);
  const map = await m.getMap();
  const a = map.tickets.find((x) => x.title === "A");
  assert.equal(a.state, "claimed");
  assert.deepEqual(a.hubClaim, win.hubClaim);
  assert.equal(map.at, JSON.parse(readFileSync(join(m.dir, "map.json"), "utf8")).at);
});

test("POST claim: two different tickets both succeed with increasing seqs; 404 unknown ticket; 409 blocked; 400 bad body; token + Origin", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const [ra, rb] = await Promise.all([m.post("claim", { ticket: "A" }), m.post("claim", { ticket: "B" })]);
  assert.equal(ra.status, 200); assert.equal(rb.status, 200);
  const seqs = [(await ra.json()).seq, (await rb.json()).seq].sort();
  assert.deepEqual(seqs, [1, 2]);
  assert.deepEqual(m.events().map((e) => [e.type, e.seq]).sort(), [["work", 1], ["work", 2]]);
  assert.equal((await m.post("claim", { ticket: "Nope" })).status, 404);
  assert.equal((await m.post("claim", { ticket: "C" })).status, 409);
  assert.equal((await m.post("claim", {})).status, 400);
  assert.equal((await m.post("claim", { ticket: "A", agentId: 3 })).status, 400);
  assert.equal((await m.post("claim", { ticket: "A" }, { "x-grill-token": "nope" })).status, 401);
  assert.equal((await m.post("claim", { ticket: "A" }, { origin: "http://evil.example" })).status, 403);
  assert.equal(m.events().length, 2, "failed claims append nothing");
});

test("POST claim with a fresh listener → hubClaim.agentId is the listener; seq > handled until the agent map-patches handled", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  assert.equal((await m.post("heartbeat", { agentId: "watcher-1" })).status, 200);
  await m.post("action", { type: "refresh" }); // seq 1
  const r = await (await m.post("claim", { ticket: "B" })).json();
  assert.deepEqual([r.seq, r.hubClaim.agentId], [2, "watcher-1"]);
  let map = await m.getMap();
  assert.ok(map.tickets[1].hubClaim.seq > (map.handled ?? 0), "queued: the agent has not drained it yet");
  const p = await runAsync(h.env, ["map-patch", "--map", m.key], { input: JSON.stringify({ handled: 2, tickets: [{ title: "B", assignee: "watcher-1" }] }) });
  assert.equal(p.code, 0, p.err);
  map = await m.getMap();
  assert.equal(map.handled, 2);
  assert.ok(map.tickets[1].hubClaim.seq <= map.handled, "claimed by watcher-1");
  assert.equal(map.tickets[1].hubClaim.agentId, "watcher-1", "map-patch keeps the hub claim");
  // map-patch still may not write hubClaim itself
  const bad = await runAsync(h.env, ["map-patch", "--map", m.key], { input: JSON.stringify({ tickets: [{ title: "A", hubClaim: { agentId: "x", at: NOW } }] }) });
  assert.equal(bad.code, 2);
});

test("a stale listener heartbeat does not count: the claim is queued", async (t) => {
  const h = setup(t, { GRILL_FRESH_MS: "100" });
  const m = await mkMap(h);
  await m.post("heartbeat", { agentId: "old" });
  await sleep(250);
  const r = await (await m.post("claim", { ticket: "A" })).json();
  assert.equal(r.hubClaim.agentId, "queued");
});

test("POST action refresh appends {type:\"refresh\", seq, at} and shares the seq counter with work; other types 400", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const r1 = await m.post("action", { type: "refresh" });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, seq: 1 });
  await m.post("claim", { ticket: "A" });
  const r3 = await (await m.post("action", { type: "refresh" })).json();
  assert.equal(r3.seq, 3);
  const ev = m.events();
  assert.deepEqual(ev.map((e) => [e.type, e.seq]), [["refresh", 1], ["work", 2], ["refresh", 3]]);
  assert.deepEqual(Object.keys(ev[0]).sort(), ["at", "seq", "type"]);
  assert.ok(Date.now() - Date.parse(ev[0].at) < 5000);
  assert.equal((await m.post("action", { type: "work" })).status, 400);
  assert.equal((await m.post("action", {})).status, 400);
  assert.equal((await m.post("action", { type: "refresh" }, { "x-grill-token": "x" })).status, 401);
  assert.equal(m.events().length, 3);
  // A line appended by someone else is respected: the hub re-reads the log's last seq.
  const { appendFileSync } = await import("node:fs");
  appendFileSync(join(m.dir, "events.jsonl"), JSON.stringify({ type: "note", seq: 10 }) + "\n");
  assert.equal((await (await m.post("action", { type: "refresh" })).json()).seq, 11);
});

test("claim and action ping `m` over SSE; a map with no map.json yet: claim 404, action ok", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const sse = sseReader(`http://127.0.0.1:${hubInfo(h.home).port}/events`);
  t.after(() => sse.close());
  await sse.next("hello");
  await settle(sse, "m");
  await m.post("claim", { ticket: "A" });
  assert.deepEqual(await sse.next("m"), { key: m.key });
  await settle(sse, "m");
  await m.post("action", { type: "refresh" });
  assert.deepEqual(await sse.next("m"), { key: m.key });
  rmSync(join(m.dir, "map.json"));
  assert.equal((await m.post("claim", { ticket: "A" })).status, 404);
  assert.equal((await m.post("action", { type: "refresh" })).status, 200);
});

test("CLI claim: exit 0 prints {ok, ticket, hubClaim}; conflict exit 5 prints {conflict}; unknown ticket/map exit 4; --release; re-claim", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const claimCli = (...args) => runAsync(h.env, ["claim", "--map", m.key, ...args], { cwd: m.cwd });
  const r1 = await claimCli("--ticket", "A", "--agent-id", "ag-1");
  assert.equal(r1.code, 0, r1.err);
  const o1 = JSON.parse(r1.out);
  assert.equal(o1.ok, true); assert.equal(o1.ticket, "A");
  assert.equal(o1.hubClaim.agentId, "ag-1");
  assert.equal("seq" in o1.hubClaim, false, "an agent's own claim has no board event");
  assert.equal(m.events().length, 0, "and appends none");
  // same agent again: idempotent
  assert.equal((await claimCli("--ticket", "A", "--agent-id", "ag-1")).code, 0);
  // bare slug resolves through the cwd
  const r2 = await runAsync(h.env, ["claim", "--map", "42", "--ticket", "A", "--agent-id", "ag-2"], { cwd: m.cwd });
  assert.equal(r2.code, 5, r2.err);
  const c = JSON.parse(r2.out).conflict;
  assert.equal(c.ticket, "A"); assert.equal(c.hubClaim.agentId, "ag-1");
  // board click on the claimed ticket also conflicts
  assert.equal((await m.post("claim", { ticket: "A" })).status, 409);
  // release by a non-claimant: conflict; by the claimant: ok
  assert.equal((await claimCli("--ticket", "A", "--agent-id", "ag-2", "--release")).code, 5);
  const rel = await claimCli("--ticket", "A", "--agent-id", "ag-1", "--release");
  assert.equal(rel.code, 0, rel.err);
  assert.deepEqual(JSON.parse(rel.out), { ok: true, ticket: "A", released: true });
  let a = (await m.getMap()).tickets[0];
  assert.deepEqual([a.state, a.hubClaim], ["frontier", undefined]);
  // re-claim by the other agent now works
  const r3 = await claimCli("--ticket", "A", "--agent-id", "ag-2");
  assert.equal(r3.code, 0, r3.err);
  a = (await m.getMap()).tickets[0];
  assert.equal(a.hubClaim.agentId, "ag-2");
  // unknown ticket, unknown map, bad args
  const u = await claimCli("--ticket", "Nope", "--agent-id", "ag-1");
  assert.equal(u.code, 4); assert.match(u.err, /^grill: .*Nope/);
  const um = await runAsync(h.env, ["claim", "--map", "nope-12345678/zz", "--ticket", "A", "--agent-id", "x"]);
  assert.equal(um.code, 4); assert.match(um.err, /no such map/);
  assert.equal((await claimCli("--ticket", "A")).code, 2);
  assert.equal((await claimCli("--agent-id", "x")).code, 2);
  assert.equal((await runAsync(h.env, ["claim", "--ticket", "A", "--agent-id", "x"])).code, 2);
});

test("CLI claim: 8 parallel agents on one ticket → one exit 0, seven exit 5", async (t) => {
  const h = setup(t);
  const m = await mkMap(h);
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => runAsync(h.env, ["claim", "--map", m.key, "--ticket", "B", "--agent-id", `ag-${i}`])));
  assert.deepEqual(rs.map((r) => r.code).sort(), [0, 5, 5, 5, 5, 5, 5, 5], rs.map((r) => r.err).join("\n"));
  const winner = JSON.parse(rs.find((r) => r.code === 0).out).hubClaim.agentId;
  assert.equal((await m.getMap()).tickets[1].hubClaim.agentId, winner);
});

test("wait --map returns the work event from a board claim; watch --map prints work and refresh lines as they land", async (t) => {
  const h = setup(t, { GRILL_HEARTBEAT_MS: "200" });
  const m = await mkMap(h);
  const w = h.spawn(["watch", "--map", m.key, "--agent-id", "watcher-1"]);
  // The watcher's heartbeat makes it the listener, so board claims name it.
  await waitUntil(async () => (await m.getMap()).listener?.agentId === "watcher-1", 5000);
  const waiter = runAsync(h.env, ["wait", "--map", m.key, "--after", "0", "--timeout", "10", "--agent-id", "watcher-2"]);
  await sleep(300);
  const r = await (await m.post("claim", { ticket: "A" })).json();
  const done = await waiter;
  assert.equal(done.code, 0, done.err);
  const got = done.out.split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(got.map((e) => [e.type, e.seq, e.ticket]), [["work", r.seq, "A"]]);
  await m.post("action", { type: "refresh" });
  await waitUntil(() => w.lines.length >= 2, 5000);
  assert.deepEqual(w.lines.map((e) => [e.type, e.seq]), [["work", 1], ["refresh", 2]]);
  assert.equal(w.lines[0].ticket, "A");
});
