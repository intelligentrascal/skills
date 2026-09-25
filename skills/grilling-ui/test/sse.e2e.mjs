// End-to-end check of the shared EventSource (plan T18; spec §5 Connection cap, Version change;
// §10 "shared EventSource across 8 tabs, with poll fallback", "hub restart and handoff with SSE
// reconnect"). Needs Playwright:
//   PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/sse.e2e.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's bundled Chromium.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { mkHome, run, tmp, hubInfo, cleanupHub, waitUntil, sleep } from "./helpers.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
// v1 now, v2 (newer code) for the handoff step.
const { home, env } = mkHome({ GRILL_VERSION_OVERRIDE: "sse-v1", GRILL_CODETIME_OVERRIDE: "1000" });
const proj = tmp("grill-sse-e2e-proj-");

const atomic = (file, text) => { writeFileSync(file + ".e2e-tmp", text); renameSync(file + ".e2e-tmp", file); };
const sessions = ["Alpha", "Bravo", "Charlie"].map((name) => {
  const c = JSON.parse(run(env, ["new", "--topic", `${name} topic`, "--doc", `docs/${name}.md`, "--agent", "claude"], { cwd: proj }));
  const file = join(c.session, "state.json");
  const base = JSON.parse(readFileSync(file, "utf8"));
  const write = (topic) => atomic(file, JSON.stringify({
    ...base, topic,
    agent: { status: "waiting", since: new Date().toISOString(), handled: 0 },
    questions: [{ id: "q1", round: 1, deps: [], title: `${name} question`, body: "Body.", options: [{ k: "A", text: "One" }, { k: "B", text: "Two" }], rec: { option: "A", why: "Why." }, status: "open", durable: false, updated: false, thread: [] }],
  }, null, 2));
  write(`${name} topic`);
  return { name, url: c.url, id: c.id, write };
});

const admin = async () => { const h = hubInfo(home); return (await fetch(`http://127.0.0.1:${h.port}/admin/stats`, { headers: { "x-grill-admin": h.adminToken } })).json(); };
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); if (!ok) console.log("FAIL", name, extra); };
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
// 8 tabs on 3 sessions: 3 + 3 + 2.
const tabs = [];
try {
  for (const [i, n] of [[0, 3], [1, 3], [2, 2]]) for (let k = 0; k < n; k++) {
    const p = await context.newPage(); watch(p);
    await p.goto(sessions[i].url);
    await p.locator(".item").first().waitFor();
    tabs.push({ p, s: sessions[i] });
  }
  const topicOf = (t) => t.p.locator("#topic").textContent();
  const allShow = async (list, topic, ms) => { try { await waitUntil(async () => (await Promise.all(list.map(topicOf))).every((x) => x === topic), ms); return true; } catch { return false; } };
  const leaders = async (list = tabs) => (await Promise.all(list.map((t) => t.p.evaluate(() => window.Grill.conn.leader)))).filter(Boolean).length;
  const sse = async (n, ms = 4000) => { try { await waitUntil(async () => (await admin()).sse === n, ms); return true; } catch { return false; } };

  check("8 tabs render their own session", (await Promise.all(tabs.map(topicOf))).every((x, i) => x === `${tabs[i].s.name} topic`));
  check("8 tabs on 3 sessions → exactly one /events client on the hub", await sse(1), JSON.stringify(await admin()));
  const st = await admin();
  check("/admin/stats reports sse, sessions and rss", st.sse === 1 && st.sessions === 3 && st.rss > 0, JSON.stringify(st));
  check("/admin/stats needs the admin token", (await fetch(`http://127.0.0.1:${hubInfo(home).port}/admin/stats`)).status === 401);
  check("exactly one tab is the leader", (await leaders()) === 1);

  // a patch in each session updates its tabs within 1 s, and only those
  for (const s of sessions) {
    const mine = tabs.filter((t) => t.s === s), others = tabs.filter((t) => t.s !== s);
    const t0 = Date.now();
    s.write(`${s.name} update 1`);
    const ok = await allShow(mine, `${s.name} update 1`, 1000);
    check(`patch in ${s.name} updates its ${mine.length} tabs within 1 s`, ok, `${Date.now() - t0} ms`);
    check(`other sessions' tabs are untouched by ${s.name}'s patch`, (await Promise.all(others.map(topicOf))).every((x) => !x.startsWith(s.name)));
  }

  // close the leader: another tab takes over, the hub still sees one stream, updates continue
  const li = (await Promise.all(tabs.map((t) => t.p.evaluate(() => window.Grill.conn.leader)))).indexOf(true);
  const gone = tabs.splice(li, 1)[0];
  await gone.p.close();
  let ok = false; try { await waitUntil(async () => (await leaders()) === 1, 3000); ok = true; } catch {}
  check("closing the leader: another tab takes the lock within ~1 s", ok);
  check("still exactly one /events client after the leader closed", await sse(1));
  for (const s of sessions) {
    s.write(`${s.name} update 2`);
    check(`after the leader closed, ${s.name}'s tabs update within 1 s`, await allShow(tabs.filter((t) => t.s === s), `${s.name} update 2`, 1000));
  }

  // handoff to newer code on the same port: the shared stream reconnects by itself
  const before = hubInfo(home);
  const ens = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "sse-v2", GRILL_CODETIME_OVERRIDE: "2000" }, ["ensure"]));
  check("handoff: a new hub on the same port", ens.port === before.port && ens.pid !== before.pid, JSON.stringify(ens));
  await sleep(300);
  for (const s of sessions) {
    s.write(`${s.name} after handoff`);
    check(`after the handoff, ${s.name}'s tabs update on the same URL`, await allShow(tabs.filter((t) => t.s === s), `${s.name} after handoff`, 8000) && tabs.filter((t) => t.s === s).every((t) => t.p.url() === s.url));
  }
  check("the new hub also sees exactly one /events client", await sse(1, 8000), JSON.stringify(await admin()));
  check("no tab fell back to polling across the handoff", (await Promise.all(tabs.map((t) => t.p.evaluate(() => window.Grill.conn.mode)))).every((m) => m === "sse"));

  // /events blocked (a separate browser profile, so it runs its own leader): poll fallback
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx2.route("**/events", (r) => r.abort());
  const bp = await ctx2.newPage(); watch(bp);
  const s0 = sessions[0];
  await bp.goto(s0.url);
  await bp.locator(".item").first().waitFor();
  ok = false; try { await waitUntil(() => bp.evaluate(() => window.Grill.conn.mode === "poll"), 15000); ok = true; } catch {}
  check("3 failed EventSource attempts → the tab polls", ok);
  check("the status tooltip says the tab is polling", ((await bp.locator("header .status").getAttribute("title")) || "").includes("every 5 s"));
  check("no hub-down banner while polling (the hub is fine)", !(await bp.locator("#banner").evaluate((el) => el.classList.contains("show"))));
  const t1 = Date.now();
  s0.write(`${s0.name} while blocked`);
  check("a polling tab still updates (within one 5 s poll)", await allShow([{ p: bp }], `${s0.name} while blocked`, 7000), `${Date.now() - t1} ms`);
  check("the SSE tabs update too", await allShow(tabs.filter((t) => t.s === s0), `${s0.name} while blocked`, 1000));
  check("SSE tabs' status carries no polling tooltip", !((await tabs[0].p.locator("header .status").getAttribute("title")) || ""));
  await ctx2.close();

  const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_FAILED|EventSource/.test(e));
  check("no page errors", real.length === 0, real.join(" | "));
} catch (e) {
  check("run finished without an exception", false, String(e && e.stack || e));
} finally {
  await browser.close();
  await cleanupHub(home);
}
const failed = results.filter((r) => !r.ok);
console.log(`sse e2e: ${results.length - failed.length}/${results.length} checks passed${failed.length ? " — FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
