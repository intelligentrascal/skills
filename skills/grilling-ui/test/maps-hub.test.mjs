// Map storage on the hub and `map-patch` (spec §4a Data, <mapKey>; §5 Security; plan T14, D2, D4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupHub, hubInfo, mkHome, run, runAsync, settle, sleep, sseReader, tmp } from "./helpers.mjs";
import { projectKey } from "../lib/home.mjs";
import { mapKeyOf } from "../lib/maps.mjs";

function homeFor(t, extra) { const h = mkHome(extra); t.after(() => cleanupHub(h.home)); return h; }
const base = (home) => `http://127.0.0.1:${hubInfo(home).port}`;
const MAP = { title: "Auth rewrite", link: "https://github.com/o/r/issues/42", destination: "SSO for all apps",
  tickets: [{ title: "A", type: "research", state: "frontier" }, { title: "B", type: "task", state: "blocked", blockedBy: ["A"] }] };
const mapPatch = (env, key, patch, opts = {}) => runAsync(env, ["map-patch", "--map", key, ...(opts.args || [])], { cwd: opts.cwd, input: typeof patch === "string" ? patch : JSON.stringify(patch) });
const mapDir = (home, key) => join(home, "maps", ...key.split("/"));
const tokenOf = (home, key) => JSON.parse(readFileSync(join(mapDir(home, key), "meta.json"), "utf8")).token;
const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("mapKeyOf: bare slug gets the cwd projectKey; full keys validated; slugs sanitized", () => {
  const cwd = tmp("grill-proj-"), pk = projectKey(cwd);
  assert.equal(mapKeyOf("42", cwd), `${pk}/42`);
  assert.equal(mapKeyOf("Auth Rewrite!", cwd), `${pk}/auth-rewrite`);
  assert.equal(mapKeyOf("proj-1a2b3c4d/42", cwd), "proj-1a2b3c4d/42");
  for (const bad of ["", "a/b/c", "../x", "Proj/42", "p/", "/42", "!!!"]) assert.throws(() => mapKeyOf(bad, cwd), /map key/, bad);
});

test("map-patch: creates maps/<projectKey>/<slug>/ (meta.json 0600 token, events.jsonl), prints {ok, tickets, url}; GET /map", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  const r = await mapPatch(env, "42", MAP, { cwd });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.deepEqual(out, { ok: true, tickets: 2, url: `${base(home)}/m/${key}/` });
  const dir = mapDir(home, key);
  assert.equal(statSync(join(dir, "meta.json")).mode & 0o777, 0o600);
  assert.match(tokenOf(home, key), /^[0-9a-f]{32}$/);
  assert.equal(readFileSync(join(dir, "events.jsonl"), "utf8"), "");
  const m = await (await fetch(`${base(home)}/m/${key}/map`)).json();
  assert.equal(m.title, "Auth rewrite");
  assert.deepEqual(m.tickets.map((x) => x.title), ["A", "B"]);
  assert.ok(Date.now() - Date.parse(m.at) < 5000);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "map.json"), "utf8")), m);
  // --file works too, and the full key form reaches the same map.
  const f = join(tmp("grill-patch-"), "p.json"); writeFileSync(f, JSON.stringify({ notes: "n" }));
  const r2 = await runAsync(env, ["map-patch", "--map", key, "--file", f]);
  assert.equal(r2.code, 0, r2.err);
  assert.equal((await (await fetch(`${base(home)}/m/${key}/map`)).json()).notes, "n");
  assert.equal(tokenOf(home, key), tokenOf(home, key), "token kept");
});

test("map-patch twice merges; an invalid patch is rejected in one line (exit 2) with map.json unchanged", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/effort`;
  assert.equal((await mapPatch(env, "effort", MAP, { cwd })).code, 0);
  const r = await mapPatch(env, "effort", { tickets: [{ title: "A", remove: true }, { title: "B", state: "frontier", blockedBy: null }], closed: [{ title: "A", gist: "done" }] }, { cwd });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).tickets, 1);
  const before = readFileSync(join(mapDir(home, key), "map.json"), "utf8");
  const m = JSON.parse(before);
  assert.deepEqual(m.tickets, [{ title: "B", type: "task", state: "frontier" }]);
  assert.deepEqual(m.closed, [{ title: "A", gist: "done" }]);

  const bad = await mapPatch(env, "effort", { tickets: [{ title: "C", type: "task", state: "blocked", blockedBy: ["Nope"] }] }, { cwd });
  assert.equal(bad.code, 2);
  assert.equal(bad.err.split("\n").length, 1);
  assert.match(bad.err, /^grill: map-patch rejected \(map\.json unchanged\): .*C\.blockedBy names unknown "Nope"/);
  const hubOnly = await mapPatch(env, "effort", { listener: { agentId: "x", heartbeat: "y" } }, { cwd });
  assert.equal(hubOnly.code, 2); assert.match(hubOnly.err, /written by the hub/);
  const notJson = await mapPatch(env, "effort", "{nope", { cwd });
  assert.equal(notJson.code, 2); assert.match(notJson.err, /not valid JSON/);
  const noMap = await runAsync(env, ["map-patch"], { cwd, input: "{}" });
  assert.equal(noMap.code, 2); assert.match(noMap.err, /--map/);
  const badKey = await mapPatch(env, "a/b/c", {}, { cwd });
  assert.equal(badKey.code, 2); assert.match(badKey.err, /map key/);
  assert.equal(readFileSync(join(mapDir(home, key), "map.json"), "utf8"), before);
});

test("hub map routes: token + Origin on POST, 404 for unknown maps, board page boot, heartbeat → listener", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  assert.equal((await mapPatch(env, "42", MAP, { cwd })).code, 0);
  const b = base(home), token = tokenOf(home, key);
  // patch route auth
  assert.equal((await post(`${b}/m/${key}/patch`, { patch: { notes: "x" } })).status, 401);
  assert.equal((await post(`${b}/m/${key}/patch`, { patch: { notes: "x" } }, { "x-grill-token": "nope" })).status, 401);
  assert.equal((await post(`${b}/m/${key}/patch`, { patch: { notes: "x" } }, { "x-grill-token": token, origin: "http://evil.example" })).status, 403);
  const ok = await post(`${b}/m/${key}/patch`, { patch: { notes: "x" } }, { "x-grill-token": token, origin: b });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).tickets, 2);
  const bad = await post(`${b}/m/${key}/patch`, { patch: { tickets: [{ title: "Z" }] } }, { "x-grill-token": token });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /ticket Z\.type/);
  assert.equal((await post(`${b}/m/${key}/patch`, { nope: 1 }, { "x-grill-token": token })).status, 400, "patch must be an object");
  // unknown maps
  assert.equal((await fetch(`${b}/m/${projectKey(cwd)}/nope/map`)).status, 404);
  assert.equal((await post(`${b}/m/${projectKey(cwd)}/nope/patch`, { patch: {} }, { "x-grill-token": token })).status, 404);
  const nf = await fetch(`${b}/m/${projectKey(cwd)}/nope/`);
  assert.equal(nf.status, 404); assert.match(await nf.text(), /No such board/);
  // board page
  const bare = await fetch(`${b}/m/${key}`, { redirect: "manual" });
  assert.equal(bare.status, 302); assert.equal(bare.headers.get("location"), `/m/${key}/`);
  const page = await fetch(`${b}/m/${key}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  const boot = JSON.parse(/<script>window\.GRILL=(.*?)<\/script>/.exec(await page.text())[1]);
  assert.deepEqual(boot, { kind: "map", key, token, base: `/m/${key}/` });
  // heartbeat
  assert.equal((await post(`${b}/m/${key}/heartbeat`, { agentId: "L1" })).status, 401);
  assert.equal((await post(`${b}/m/${key}/heartbeat`, {}, { "x-grill-token": token })).status, 400);
  const hb = await post(`${b}/m/${key}/heartbeat`, { agentId: "L1" }, { "x-grill-token": token });
  assert.equal(hb.status, 200);
  const m = await (await fetch(`${b}/m/${key}/map`)).json();
  assert.equal(m.listener.agentId, "L1");
  assert.ok(Date.now() - Date.parse(m.listener.heartbeat) < 5000);
  assert.equal(m.notes, "x", "heartbeat keeps the map");
  // a later map-patch keeps the listener
  assert.equal((await mapPatch(env, "42", { notes: "y" }, { cwd })).code, 0);
  assert.equal((await (await fetch(`${b}/m/${key}/map`)).json()).listener.agentId, "L1");
});

test("heartbeat before the first map-patch creates a stub map with the listener", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/early`;
  // map-patch creates the folder; a rejected first patch still leaves meta.json (the token) behind.
  const r = await mapPatch(env, "early", { tickets: [{ title: "X" }] }, { cwd });
  assert.equal(r.code, 2);
  assert.ok(existsSync(join(mapDir(home, key), "meta.json")));
  assert.equal((await fetch(`${base(home)}/m/${key}/map`)).status, 404);
  const hb = await post(`${base(home)}/m/${key}/heartbeat`, { agentId: "L" }, { "x-grill-token": tokenOf(home, key) });
  assert.equal(hb.status, 200);
  const m = await (await fetch(`${base(home)}/m/${key}/map`)).json();
  assert.equal(m.listener.agentId, "L");
  assert.equal((await mapPatch(env, "early", MAP, { cwd })).code, 0);
});

test("SSE: `m` {key} pings on map-patch, on a hand edit of map.json and on an events.jsonl append", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  assert.equal((await mapPatch(env, "42", MAP, { cwd })).code, 0);
  const r = sseReader(`${base(home)}/events`); t.after(() => r.close());
  await r.next("hello");
  await fetch(`${base(home)}/m/${key}/map`); // attach the watch
  await settle(r, "m");
  assert.equal((await mapPatch(env, "42", { notes: "1" }, { cwd })).code, 0);
  assert.deepEqual(await r.next("m"), { key });
  await settle(r, "m");
  const file = join(mapDir(home, key), "map.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), notes: "hand" }));
  assert.deepEqual(await r.next("m"), { key });
  await settle(r, "m");
  appendFileSync(join(mapDir(home, key), "events.jsonl"), JSON.stringify({ type: "refresh", seq: 1, at: "x" }) + "\n");
  assert.deepEqual(await r.next("m"), { key });
});

test("map presence + /clients", async (t) => {
  const { home, env } = homeFor(t, { GRILL_PRESENCE_MS: "300" });
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  assert.equal((await mapPatch(env, "42", MAP, { cwd })).code, 0);
  const b = base(home);
  assert.equal((await fetch(`${b}/m/${key}/presence?tab=a`)).status, 204);
  const c = await (await fetch(`${b}/m/${key}/clients`)).json();
  assert.equal(c.count, 1); assert.equal(c.hubStarted, hubInfo(home).started);
  assert.equal((await fetch(`${b}/m/${projectKey(cwd)}/zzz/clients`)).status, 404);
  await sleep(400);
  assert.equal((await (await fetch(`${b}/m/${key}/clients`)).json()).count, 0);
});

test("map-patch --agent-id matching the listener refreshes its heartbeat", async (t) => {
  const { home, env } = homeFor(t);
  const cwd = tmp("grill-proj-"), key = `${projectKey(cwd)}/42`;
  assert.equal((await mapPatch(env, "42", MAP, { cwd })).code, 0);
  const b = base(home), token = tokenOf(home, key);
  await post(`${b}/m/${key}/heartbeat`, { agentId: "L" }, { "x-grill-token": token });
  const hb1 = (await (await fetch(`${b}/m/${key}/map`)).json()).listener.heartbeat;
  await sleep(20);
  assert.equal((await mapPatch(env, "42", { notes: "z" }, { cwd, args: ["--agent-id", "other"] })).code, 0);
  assert.equal((await (await fetch(`${b}/m/${key}/map`)).json()).listener.heartbeat, hb1);
  await sleep(20);
  assert.equal((await mapPatch(env, "42", { notes: "z2" }, { cwd, args: ["--agent-id", "L"] })).code, 0);
  assert.ok((await (await fetch(`${b}/m/${key}/map`)).json()).listener.heartbeat > hb1);
});
