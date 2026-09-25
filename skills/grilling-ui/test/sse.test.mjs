// Hub-wide SSE stream, directory watch and presence (spec §5 Updates to the page, §6 step 2;
// §10 "directory watch still sees changes after an atomic rename", "/clients"; plan T12, D5, D6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupHub, hubInfo, mkHome, run, runAsync, settle, sleep, sseReader, tmp } from "./helpers.mjs";

function homeFor(t, extra) { const h = mkHome(extra); t.after(() => cleanupHub(h.home)); return h; }
const newIn = (env, topic = "Fonts") => JSON.parse(run(env, ["new", "--topic", topic], { cwd: tmp("grill-p-") }));
const base = (home) => `http://127.0.0.1:${hubInfo(home).port}`;
function reader(t, url) { const r = sseReader(url); t.after(() => r.close()); return r; }
// No `event` arrives within ms.
async function quiet(r, event, ms = 250) {
  await assert.rejects(r.next(event, ms), /no "/, `unexpected ${event} event`);
}
// How many `event`s arrive within ms.
async function countFor(r, event, ms) { await sleep(ms); const n = r.queue.filter((e) => e.event === event).length; r.clear(event); return n; }

test("/events: event-stream headers, retry 2000, hello {pid, started}, keep-alive comments", async (t) => {
  const { home, env } = homeFor(t, { GRILL_SSE_KEEPALIVE_MS: "100" });
  newIn(env);
  const r = reader(t, `${base(home)}/events`);
  const h = await r.headers;
  assert.equal(r.status, 200);
  assert.match(h.get("content-type"), /^text\/event-stream/);
  assert.equal(h.get("cache-control"), "no-store");
  const hello = await r.next("hello");
  const info = hubInfo(home);
  assert.deepEqual(hello, { pid: info.pid, started: info.started });
  assert.equal(r.retry, 2000);
  await sleep(350);
  assert.ok(r.comments >= 2, `keep-alive comments seen: ${r.comments}`);
});

test("dir watch: two consecutive atomic-rename patches both ping `s` {id}", async (t) => {
  const { home, env } = homeFor(t);
  const s = newIn(env);
  const r = reader(t, `${base(home)}/events`);
  await r.next("hello");
  // The watch attaches lazily on the first request touching the session.
  assert.equal((await fetch(`${s.url}state`)).status, 200);
  await settle(r, "s");
  const patch = async (p) => {
    const x = await runAsync(env, ["patch", "--session", s.session, "--agent-id", s.agentId], { input: JSON.stringify(p) });
    assert.equal(x.code, 0, x.err);
  };
  await patch({ note: "one" });
  assert.deepEqual(await r.next("s"), { id: s.id });
  await settle(r, "s");
  await patch({ note: "two" });
  assert.deepEqual(await r.next("s"), { id: s.id });
  assert.equal((await (await fetch(`${s.url}state`)).json()).note, "two");
});

test("dir watch: visual.html and meta.json ping; other files do not; bursts are debounced", async (t) => {
  const { home, env } = homeFor(t);
  const s = newIn(env);
  const r = reader(t, `${base(home)}/events`);
  await r.next("hello");
  await fetch(`${s.url}state`);
  await settle(r, "s");
  writeFileSync(join(s.session, "notes.txt"), "x");
  writeFileSync(join(s.session, "events.jsonl"), "");
  await quiet(r, "s");
  writeFileSync(join(s.session, "visual.html"), "<p>v</p>");
  assert.deepEqual(await r.next("s"), { id: s.id });
  await settle(r, "s");
  // heartbeat → meta.json
  const token = JSON.parse((await import("node:fs")).readFileSync(join(s.session, "meta.json"), "utf8")).token;
  const hb = await fetch(`${s.url}heartbeat`, { method: "POST", headers: { "x-grill-token": token, "content-type": "application/json" }, body: JSON.stringify({ agentId: s.agentId }) });
  assert.equal(hb.status, 200);
  assert.deepEqual(await r.next("s"), { id: s.id });
  await settle(r, "s");
  // A burst of writes is coalesced: at least one ping, and fewer pings than writes (each write
  // raises one or more file events; exact grouping depends on load and the platform).
  for (let i = 0; i < 8; i++) writeFileSync(join(s.session, "visual.html"), `<p>${i}</p>`);
  await r.next("s");
  const n = 1 + await countFor(r, "s", 400);
  assert.ok(n >= 1 && n < 8, `burst of 8 writes gave ${n} pings`);
});

test("two sessions: pings name their own id", async (t) => {
  const { home, env } = homeFor(t);
  const a = newIn(env, "A"), b = newIn(env, "B");
  const r = reader(t, `${base(home)}/events`);
  await r.next("hello");
  await fetch(`${a.url}state`); await fetch(`${b.url}state`);
  await settle(r, "s");
  writeFileSync(join(b.session, "visual.html"), "b");
  assert.deepEqual(await r.next("s"), { id: b.id });
  await settle(r, "s");
  writeFileSync(join(a.session, "visual.html"), "a");
  assert.deepEqual(await r.next("s"), { id: a.id });
});

test("presence + /clients: counts distinct tabs, drops them after GRILL_PRESENCE_MS, keeps lastSeen", async (t) => {
  const { home, env } = homeFor(t, { GRILL_PRESENCE_MS: "300" });
  const s = newIn(env);
  const clients = async () => { const x = await fetch(`${s.url}clients`); assert.equal(x.status, 200); return x.json(); };
  const c0 = await clients();
  assert.deepEqual(c0, { count: 0, lastSeen: null, hubStarted: hubInfo(home).started });
  for (const tab of ["t1", "t2", "t1"]) {
    const p = await fetch(`${s.url}presence?tab=${tab}`);
    assert.equal(p.status, 204);
  }
  const c1 = await clients();
  assert.equal(c1.count, 2);
  assert.ok(Date.now() - Date.parse(c1.lastSeen) < 2000);
  await sleep(400);
  const c2 = await clients();
  assert.equal(c2.count, 0);
  assert.equal(c2.lastSeen, c1.lastSeen);
  assert.equal((await fetch(`${s.url}presence`)).status, 400, "tab is required");
  assert.equal((await fetch(`${s.url}presence?tab=${"x".repeat(80)}`)).status, 400);
  assert.equal((await fetch(`${base(home)}/s/20990101-000000-ffff/presence?tab=a`)).status, 404);
  assert.equal((await fetch(`${base(home)}/s/20990101-000000-ffff/clients`)).status, 404);
});

test("idle exit is held off while an /events client is open", async (t) => {
  const { home, env } = homeFor(t, { GRILL_TICK_MS: "50", GRILL_IDLE_MS: "300", GRILL_FRESH_MS: "0" });
  newIn(env);
  const r = reader(t, `${base(home)}/events`);
  await r.next("hello");
  await sleep(700);
  assert.equal((await fetch(`${base(home)}/health`)).status, 200, "hub still up with a client");
  r.close();
  await sleep(900);
  await assert.rejects(fetch(`${base(home)}/health`), "hub exited once the client left");
});
