// Hub session routes, page serving, token + Origin auth (spec §5 Security, "Sends go by POST
// /s/<id>/send"; §10 token auth; plan T11, D1, D3). Serve tests ported from
// jasonku09/grill-with-ui test/server.test.mjs:63-118, 159-172 (daafa1e) onto the hub (`new` → url).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hubInfo, mkHome, run, stopHub, tmp, waitUntil } from "./helpers.mjs";
import { bootScript } from "../lib/server.mjs";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Stop the hub and make sure its process is gone, whatever the test did.
async function cleanup(home) {
  let pid; try { pid = hubInfo(home).pid; } catch { /* never started */ }
  await stopHub(home);
  if (pid) { try { await waitUntil(() => !alive(pid), 3000); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
  rmSync(home, { recursive: true, force: true });
}
function homeFor(t, extra) { const h = mkHome(extra); t.after(() => cleanup(h.home)); return h; }
const newIn = (env, topic = "Fonts") => JSON.parse(run(env, ["new", "--topic", topic], { cwd: tmp("grill-p-") }));
const metaOf = (session) => JSON.parse(readFileSync(join(session, "meta.json"), "utf8"));
const lines = (session) => readFileSync(join(session, "events.jsonl"), "utf8").split("\n").filter(Boolean);
const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const bootOf = (html) => {
  const m = /<script>window\.GRILL=(.*?)<\/script>/.exec(html);
  assert.ok(m, "boot script present");
  return JSON.parse(m[1]);
};
// A page dir with inbox + studio only (brief unbuilt) and all whitelisted assets but board.js.
function pageFixture() {
  const dir = tmp("grill-page-");
  writeFileSync(join(dir, "inbox.html"), "<!doctype html><!--GRILL_BOOT--><p>INBOX $& $1</p>");
  writeFileSync(join(dir, "studio.html"), "<!doctype html><!--GRILL_BOOT--><p>STUDIO</p>");
  writeFileSync(join(dir, "core.js"), "window.core = 1;");
  writeFileSync(join(dir, "tokens.css"), ":root{--ink:#000}");
  writeFileSync(join(dir, "map-view.js"), "window.mv = 1;");
  writeFileSync(join(dir, "secret.js"), "nope");
  return dir;
}

test("bootScript: JSON is escaped so no field can close the script tag", () => {
  const s = bootScript({ kind: "session", id: "</script><script>alert(1)</script>", x: "<!--    " });
  assert.equal(s.indexOf("</script"), s.length - "</script>".length, "only the closing tag");
  assert.ok(!s.slice(8, -9).includes("<"), "no raw < inside the script body");
  const body = s.slice("<script>window.GRILL=".length, -"</script>".length);
  assert.deepEqual(JSON.parse(body), { kind: "session", id: "</script><script>alert(1)</script>", x: "<!--    " });
});

test("layouts: boot injection, built layouts only, D1 302 for unbuilt, 404 for unknown id, bare id redirects", async (t) => {
  const { env } = homeFor(t, { GRILL_PAGE_DIR: pageFixture() });
  const s = newIn(env);
  const token = metaOf(s.session).token;
  const base = `/s/${s.id}/`;

  const bare = await fetch(s.url);
  assert.equal(bare.status, 200);
  assert.match(bare.headers.get("content-type"), /^text\/html/);
  assert.equal(bare.headers.get("cache-control"), "no-store");
  const html = await bare.text();
  assert.match(html, /<p>INBOX \$& \$1<\/p>/, "replacement patterns in the page are not interpreted");
  assert.ok(!html.includes("<!--GRILL_BOOT-->"));
  assert.deepEqual(bootOf(html), { kind: "session", id: s.id, token, base, layouts: ["inbox", "studio"] });

  const inbox = await (await fetch(s.url + "inbox")).text();
  assert.match(inbox, /INBOX/);
  const studio = await (await fetch(s.url + "studio")).text();
  assert.match(studio, /STUDIO/);
  assert.equal(bootOf(studio).token, token);

  const brief = await fetch(s.url + "brief", { redirect: "manual" });
  assert.equal(brief.status, 302);
  assert.equal(brief.headers.get("location"), `/s/${s.id}/inbox`);

  const noSlash = await fetch(s.url.slice(0, -1), { redirect: "manual" });
  assert.equal(noSlash.status, 302);
  assert.equal(noSlash.headers.get("location"), base);

  const origin = new URL(s.url).origin;
  for (const p of ["/s/20260101-000000-abcd/", "/s/20260101-000000-abcd/studio", "/s/nope/brief"]) {
    const r = await fetch(origin + p, { redirect: "manual" });
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get("content-type"), /^text\/html/);
    assert.match(await r.text(), /No such grill/);
  }
  assert.equal((await fetch(s.url + "gallery")).status, 404);
});

test("layouts: the shipped page dir serves the inbox with the boot and lists inbox as built", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const html = await (await fetch(s.url)).text();
  assert.ok(!html.includes("<!--GRILL_BOOT-->"));
  const boot = bootOf(html);
  assert.equal(boot.kind, "session");
  assert.ok(boot.layouts.includes("inbox"));
  const tokens = await fetch(new URL("/assets/tokens.css", s.url));
  assert.equal(tokens.status, 200);
  assert.match(tokens.headers.get("content-type"), /^text\/css/);
});

test("assets: whitelist only, content types, no-store, 404 when not built", async (t) => {
  const { env } = homeFor(t, { GRILL_PAGE_DIR: pageFixture() });
  const s = newIn(env);
  const a = (n) => fetch(new URL(`/assets/${n}`, s.url));
  const css = await a("tokens.css");
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(css.headers.get("cache-control"), "no-store");
  assert.equal(await css.text(), ":root{--ink:#000}");
  for (const n of ["core.js", "map-view.js"]) {
    const r = await a(n);
    assert.equal(r.status, 200, n);
    assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal((await a("board.js")).status, 404, "whitelisted but not built");
  for (const n of ["secret.js", "inbox.html", "..%2Fhub.mjs", "%2e%2e/lib/util.mjs"]) assert.equal((await a(n)).status, 404, n);
});

test("state: owner merged from meta.json, never the token; last-good fallback; events.jsonl raw", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const meta = metaOf(s.session);
  const r = await fetch(s.url + "state");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const st = await r.json();
  assert.equal(st.topic, "Fonts");
  assert.deepEqual(st.owner, { agentId: meta.owner.agentId, agent: meta.owner.agent, heartbeat: meta.owner.heartbeat });
  assert.ok(!JSON.stringify(st).includes(meta.token), "token never served");

  // A hand-written token in state.json is stripped too.
  const file = join(s.session, "state.json");
  const good = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...good, token: "leak", topic: "Fonts 2" }));
  const st2 = await (await fetch(s.url + "state")).json();
  assert.equal(st2.topic, "Fonts 2");
  assert.ok(!("token" in st2));

  // Mid-write (unparseable) → last good parse.
  writeFileSync(file, "{\"topic\": \"half");
  const r3 = await fetch(s.url + "state");
  assert.equal(r3.status, 200);
  assert.equal((await r3.json()).topic, "Fonts 2");

  const ev0 = await fetch(s.url + "events.jsonl");
  assert.equal(ev0.status, 200);
  assert.match(ev0.headers.get("content-type"), /^application\/x-ndjson/);
  assert.equal(await ev0.text(), "");
  const token = meta.token;
  await post(s.url + "send", { actions: [{ type: "finish" }] }, { "x-grill-token": token });
  assert.equal(await (await fetch(s.url + "events.jsonl")).text(), readFileSync(join(s.session, "events.jsonl"), "utf8"));

  const origin = new URL(s.url).origin;
  assert.equal((await fetch(origin + "/s/nope/state")).status, 404);
});

// Port of $JASON/test/server.test.mjs:159-172.
test("visual: serves the session's visual.html (no-store, sandboxed), 404 JSON when absent", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const miss = await fetch(s.url + "visual");
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { error: "no visual" });
  const html = "<!doctype html><title>v</title><h1>Prototype</h1>";
  writeFileSync(join(s.session, "visual.html"), html);
  const hit = await fetch(s.url + "visual?v=1");
  assert.equal(hit.status, 200);
  assert.match(hit.headers.get("content-type"), /^text\/html/);
  assert.equal(hit.headers.get("cache-control"), "no-store");
  assert.match(hit.headers.get("content-security-policy"), /^sandbox allow-scripts/, "opaque origin even when opened top-level");
  assert.equal(await hit.text(), html);
});

// Plan T11 Step 1.
test("send: token required; foreign or null Origin rejected; no Origin allowed with token", async (t) => {
  const { env } = homeFor(t);
  const s = JSON.parse(run(env, ["new", "--topic", "T"], { cwd: tmp("p-") }));
  const token = JSON.parse(readFileSync(join(s.session, "meta.json"), "utf8")).token;
  const send = (h) => fetch(s.url + "send", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ actions: [{ type: "finish" }] }) });
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ "x-grill-token": "nope" })).status, 401);
  assert.equal((await send({ "x-grill-token": token, origin: "http://evil.example" })).status, 403);
  assert.equal((await send({ "x-grill-token": token, origin: "null" })).status, 403);
  const ok = await send({ "x-grill-token": token }); assert.deepEqual(await ok.json(), { ok: true, seq: 1 });
  assert.equal(lines(s.session).length, 1, "rejected sends append nothing");
});

// Port of $JASON/test/server.test.mjs:102-118, plus the token.
test("send: rejects a mismatched Origin, allows same-origin (127.0.0.1 and localhost) and no-Origin requests", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const token = metaOf(s.session).token;
  const actions = [{ q: "q1", type: "defer" }];
  const withOrigin = (origin, contentType = "application/json") =>
    fetch(s.url + "send", { method: "POST", headers: { "content-type": contentType, origin, "x-grill-token": token }, body: JSON.stringify({ actions }) });
  assert.equal((await post(s.url + "send", { actions }, { "x-grill-token": token })).status, 200, "no Origin header (curl, wait mode, tests) is allowed");
  const port = Number(new URL(s.url).port);
  assert.equal((await withOrigin(`http://127.0.0.1:${port}`)).status, 200, "the page's own origin is allowed");
  assert.equal((await withOrigin(`http://localhost:${port}`)).status, 200, "the same hub opened as localhost is allowed");
  assert.equal((await withOrigin(`http://localhost:${port + 1}`)).status, 403, "localhost on another port is still rejected");
  assert.equal((await withOrigin("https://evil.example", "text/plain")).status, 403, "a foreign origin is rejected even as a no-preflight content-type");
  assert.equal((await withOrigin("null")).status, 403, "the sandboxed visual iframe's opaque origin is rejected too");
  assert.equal(lines(s.session).length, 3, "only the three accepted sends landed");
  // Another session's token does not work here.
  const other = newIn(env, "Other");
  assert.equal((await post(s.url + "send", { actions }, { "x-grill-token": metaOf(other.session).token })).status, 401);
});

// Port of $JASON/test/server.test.mjs:63-100 (the send half) onto the hub.
test("send: appends the send line, bad bodies are 400, seq survives a hub restart", async (t) => {
  const { home, env } = homeFor(t);
  const s = newIn(env);
  const token = metaOf(s.session).token;
  const send = (body) => post(s.url + "send", body, { "x-grill-token": token });

  const actions = [{ q: "q1", type: "answer", kind: "text", text: "B, bundle them" }];
  const r1 = await send({ actions });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, seq: 1 });
  const [l1] = lines(s.session);
  const ev = JSON.parse(l1);
  assert.deepEqual(Object.keys(ev), ["type", "seq", "at", "session", "actions"]);
  assert.equal(ev.type, "send"); assert.equal(ev.seq, 1); assert.equal(ev.session, s.session);
  assert.deepEqual(ev.actions, actions);
  assert.match(ev.at, /^\d{4}-\d{2}-\d{2}T/);

  for (const bad of ["nope", { actions: [] }, { actions: "x" }, {}, "null", "[]"]) assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
  assert.equal(lines(s.session).length, 1, "bad bodies append nothing");

  const port = hubInfo(home).port;
  await stopHub(home);
  await waitUntil(async () => { try { await fetch(s.url + "state"); return false; } catch { return true; } }, 3000);
  run(env, ["ensure"]);
  assert.equal(hubInfo(home).port, port, "same port after restart");
  const r2 = await send({ actions: [{ q: "q1", type: "thread", text: "why not C?" }] });
  assert.deepEqual(await r2.json(), { ok: true, seq: 2 });
  assert.equal(JSON.parse(lines(s.session)[1]).seq, 2);
});

test("send: concurrent sends get distinct consecutive seqs; a line appended by hand is respected", async (t) => {
  const { env } = homeFor(t);
  const a = newIn(env, "A"), b = newIn(env, "B");
  const send = (s, n) => post(s.url + "send", { actions: [{ type: "thread", q: "q1", text: `m${n}` }] }, { "x-grill-token": metaOf(s.session).token });
  const rs = await Promise.all([...Array.from({ length: 12 }, (_, n) => send(a, n)), ...Array.from({ length: 5 }, (_, n) => send(b, n))]);
  const seqs = await Promise.all(rs.map((r) => r.json().then((j) => j.seq)));
  assert.deepEqual(seqs.slice(0, 12).sort((x, y) => x - y), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(seqs.slice(12).sort((x, y) => x - y), [1, 2, 3, 4, 5], "seq is per session");
  assert.deepEqual(lines(a.session).map((l) => JSON.parse(l).seq).sort((x, y) => x - y), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(lines(b.session).length, 5);

  appendFileSync(join(a.session, "events.jsonl"), JSON.stringify({ type: "send", seq: 40, at: "x", actions: [{ type: "finish" }] }) + "\n");
  assert.deepEqual(await (await send(a, 99)).json(), { ok: true, seq: 41 });
});

test("heartbeat: token + Origin, 409 on agentId mismatch, updates meta.owner.heartbeat on match", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const meta0 = metaOf(s.session);
  const hb = (body, h = { "x-grill-token": meta0.token }) => post(s.url + "heartbeat", body, h);
  assert.equal((await hb({ agentId: s.agentId }, {})).status, 401);
  assert.equal((await hb({ agentId: s.agentId }, { "x-grill-token": meta0.token, origin: "null" })).status, 403);
  assert.equal((await hb("nope")).status, 400);
  assert.equal((await hb({})).status, 400);
  const miss = await hb({ agentId: "someone-else" });
  assert.equal(miss.status, 409);
  assert.equal(metaOf(s.session).owner.heartbeat, meta0.owner.heartbeat, "mismatch changes nothing");
  await new Promise((r) => setTimeout(r, 15));
  const ok = await hb({ agentId: s.agentId });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  const meta1 = metaOf(s.session);
  assert.equal(meta1.token, meta0.token);
  assert.equal(meta1.owner.agentId, s.agentId);
  assert.ok(Date.parse(meta1.owner.heartbeat) > Date.parse(meta0.owner.heartbeat));
  assert.equal(body.heartbeat, meta1.owner.heartbeat);
});

test("session routes: unknown id or unsafe id is 404 for every endpoint", async (t) => {
  const { env } = homeFor(t);
  const s = newIn(env);
  const origin = new URL(s.url).origin;
  const token = metaOf(s.session).token;
  for (const p of ["state", "visual", "events.jsonl"]) assert.equal((await fetch(`${origin}/s/20990101-000000-ffff/${p}`)).status, 404, p);
  for (const p of ["send", "heartbeat"]) assert.equal((await post(`${origin}/s/20990101-000000-ffff/${p}`, { actions: [{ type: "finish" }], agentId: "x" }, { "x-grill-token": token })).status, 404, p);
  // A session folder without state.json is not a session.
  const ghost = join(s.session, "..", "20990101-000000-eeee");
  mkdirSync(ghost);
  assert.equal((await fetch(`${origin}/s/20990101-000000-eeee/state`)).status, 404);
});
