// One hub, many grills: 5 sessions across 2 projects plus 1 board map. Parallel sends land in the
// right events.jsonl with contiguous seqs, 8 SSE readers stay connected, and the hub's RSS stays
// under the §5 budget (spec §10 Concurrency, §5 Resource budget; plan T36).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cleanupHub, hubInfo, mkHome, run, sseReader, tmp } from "./helpers.mjs";

const RSS_BUDGET = 96 * 1024 * 1024; // measured ~79 MB on Node 26 arm64 (spec §5 Resource budget)

test("5 sessions + 1 map on 2 projects: 50 parallel sends, 8 SSE readers, rss < 96 MB", async (t) => {
  const { home, env } = mkHome();
  t.after(() => cleanupHub(home));
  const projects = [tmp("grill-conc-a-"), tmp("grill-conc-b-")];
  const sessions = [0, 0, 0, 1, 1].map((p, i) => {
    const s = JSON.parse(run(env, ["new", "--topic", `Topic ${i}`], { cwd: projects[p] }));
    return { ...s, token: JSON.parse(readFileSync(join(s.session, "meta.json"), "utf8")).token, sent: [] };
  });
  assert.equal(new Set(sessions.map((s) => s.projectKey)).size, 2, "two projects");
  const mapOut = JSON.parse(run(env, ["map-patch", "--map", "board"], { cwd: projects[0], input: JSON.stringify({ title: "Board", tickets: [{ title: "A", type: "task", state: "frontier" }] }) }));
  assert.equal(mapOut.ok, true);

  const base = `http://127.0.0.1:${hubInfo(home).port}`;
  const readers = Array.from({ length: 8 }, () => sseReader(`${base}/events`));
  t.after(() => readers.forEach((r) => r.close()));
  await Promise.all(readers.map((r) => r.next("hello", 5000)));

  // 50 sends spread randomly over the 5 sessions, all in flight at once; each carries a unique marker.
  const sends = Array.from({ length: 50 }, (_, i) => ({ s: sessions[Math.floor(Math.random() * sessions.length)], mark: `m${i}` }));
  const replies = await Promise.all(sends.map(({ s, mark }) => {
    s.sent.push(mark);
    return fetch(`${base}/s/${basename(s.session)}/send`, {
      method: "POST", headers: { "content-type": "application/json", "x-grill-token": s.token },
      body: JSON.stringify({ actions: [{ q: "q1", type: "thread", text: mark }] }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  }));
  assert.ok(replies.every((r) => r.status === 200 && r.body.ok), JSON.stringify(replies.filter((r) => r.status !== 200)));

  for (const s of sessions) {
    const lines = readFileSync(join(s.session, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((e) => e.actions[0].text).sort(), [...s.sent].sort(), `${s.id} holds exactly its own sends`);
    assert.deepEqual(lines.map((e) => e.seq), lines.map((_, i) => i + 1), `${s.id} seqs are contiguous from 1`);
    assert.ok(lines.every((e) => e.type === "send" && e.session === s.session));
  }

  const stats = await (await fetch(`${base}/admin/stats`, { headers: { "x-grill-admin": hubInfo(home).adminToken } })).json();
  assert.ok(stats.sse >= 8, `8 SSE readers connected (hub counts ${stats.sse})`);
  assert.ok(stats.rss < RSS_BUDGET, `rss ${(stats.rss / 1048576).toFixed(1)} MB < 96 MB`);
  t.diagnostic(`hub rss ${(stats.rss / 1048576).toFixed(1)} MB, ${stats.sse} SSE streams`);
});
