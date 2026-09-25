// End-to-end check of the Wayfinder ticket board (plan T34, T36; spec §4a, §5 Tabs, §7 keyboard,
// §10 "the board (render, Refresh, Work → claimed)") against a real hub. Needs Playwright:
//   PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/board.e2e.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's bundled Chromium.
// BOARD_SHOTS=<dir> also saves board-1440.png, board-1440-claims.png and board-390.png there.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { mkHome, run, runAsync, tmp, hubInfo, cleanupHub, sleep } from "./helpers.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const { home, env } = mkHome();
const proj = tmp("grill-board-e2e-proj-");
const KEY = "shop-0123abcd/checkout";
const LOCAL_PATH = "docs/wayfinder/checkout-map.md";
const T = { a: "Research payment SDKs", b: "Prototype the address form", c: "Wire the flag rollout", d: "Spike on taxes" };
const map = {
  title: "Checkout rewrite", link: LOCAL_PATH,
  destination: "One-page checkout that ships behind a flag",
  notes: "Charted in one grill.",
  tickets: [
    { title: T.a, link: "https://github.com/acme/shop/issues/2", type: "research", state: "frontier" },
    { title: T.b, link: "docs/tickets/address-form.md", type: "prototype", state: "frontier" },
    { title: T.c, link: "file:///etc/passwd", type: "task", state: "blocked", blockedBy: [T.a] },
  ],
  closed: [{ title: T.d, gist: "The tax service already handles it", link: "https://github.com/acme/shop/issues/1" }],
  fog: ["How refunds flow back", "<img src=x onerror=alert(1)> partial captures"],
  outOfScope: [{ gist: "Mobile app checkout", link: "javascript:alert(1)" }],
};
const mapPatch = async (patch) => {
  const r = await runAsync(env, ["map-patch", "--map", KEY], { input: JSON.stringify(patch), cwd: proj });
  if (r.code !== 0) throw new Error(`map-patch failed: ${r.err}`);
  return JSON.parse(r.out);
};
const created = await mapPatch(map);
const dir = join(home, "maps", ...KEY.split("/"));
const token = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).token;
const port = hubInfo(home).port;
const base = `http://127.0.0.1:${port}/m/${KEY}`;
const post = (sub, body) => fetch(`${base}/${sub}`, { method: "POST", headers: { "content-type": "application/json", "x-grill-token": token }, body: JSON.stringify(body) }).then((r) => r.json());
const events = () => readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const readMap = () => JSON.parse(readFileSync(join(dir, "map.json"), "utf8"));
const writeMapFile = (m) => { const f = join(dir, "map.json"); writeFileSync(f + ".e2e-tmp", JSON.stringify(m, null, 2)); renameSync(f + ".e2e-tmp", f); };
// a grill session for ?from=
const sess = JSON.parse(run(env, ["new", "--topic", "Chart the checkout", "--doc", "docs/none.md", "--agent", "claude", "--map-key", KEY], { cwd: proj }));

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [], requests = [];
const watch = (p) => {
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss().catch(() => {}); });
  p.on("request", (r) => requests.push(r.url()));
};
watch(page);
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); if (!ok) console.log("FAIL", name, extra); };
const col = (k, p = page) => p.locator(`#board .col[data-col="${k}"]`);
const cardOf = (title, p = page) => p.locator("#board .tk").filter({ has: p.locator(".t", { hasText: title }) });
const colTitles = async (k, p = page) => (await col(k, p).locator(".tk .t").allTextContents()).map((s) => s.trim());
const until = (fn, arg, ms = 6000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const shots = process.env.BOARD_SHOTS;

try {
  check("map-patch prints the board url", created.url === `${base}/`, created.url);
  await page.goto(`${base}/`);
  await page.locator("#board .tk").first().waitFor({ timeout: 8000 });

  // ---- render ----
  check("tab title is <project> · <map title>", (await page.title()) === "shop · Checkout rewrite", await page.title());
  check("favicon is an SVG status dot", /^data:image\/svg\+xml,/.test(await page.locator('link[rel="icon"]').getAttribute("href")));
  check("header: map title and project", (await page.locator("#title").textContent()) === "Checkout rewrite" && (await page.locator("#where").textContent()) === "shop");
  check("destination shown", (await page.locator(".dest").textContent()) === map.destination);
  const fresh = await page.locator("#fresh").textContent();
  check("\"Updated <relative time> · canonical: <link>\"", /^Updated just now · canonical: /.test(fresh), fresh);
  check("the canonical local path is plain text", fresh.includes(LOCAL_PATH) && await page.locator("#fresh a").count() === 0);
  check("column order: Frontier · In progress · Blocked · Done", (await page.locator("#board .col h2 > span:first-child").allTextContents()).join("|") === "Frontier|In progress|Blocked|Done");
  check("Frontier has the 2 frontier tickets", (await colTitles("frontier")).join("|") === `${T.a}|${T.b}`, (await colTitles("frontier")).join("|"));
  check("In progress starts empty (with its empty state)", await col("progress").locator(".tk").count() === 0 && (await col("progress").locator(".empty").textContent()) === "Nothing claimed.");
  check("Blocked has the blocked ticket and names its blocker", (await colTitles("blocked")).join("|") === T.c && (await col("blocked").locator(".meta").textContent()).includes(`Blocked by ${T.a}`));
  check("Done has the closed ticket with its gist", (await colTitles("done")).join("|") === T.d && (await col("done").locator(".gist").textContent()) === map.closed[0].gist);
  check("column counts", (await page.locator("#board .col h2 .n").allTextContents()).join(",") === "2,0,1,1");
  check("type chips", (await col("frontier").locator(".chip").allTextContents()).join(",") === "research,prototype");
  check("http ticket link is an anchor", (await cardOf(T.a).locator(".t a").getAttribute("href")) === map.tickets[0].link);
  check("local path ticket link is plain text", await cardOf(T.b).locator("a").count() === 0 && (await cardOf(T.b).locator(".path-text").textContent()) === "docs/tickets/address-form.md");
  check("file:// link is plain text", await cardOf(T.c).locator("a").count() === 0 && (await cardOf(T.c).textContent()).includes("file:///etc/passwd"));
  check("fog and out of scope sit below the columns", (await page.locator('[data-sec="fog"] li').allTextContents()).length === 2 && (await page.locator('[data-sec="out"]').textContent()).includes("Mobile app checkout"));
  check("text is escaped (no injected element) and javascript: is not a link", await page.locator("#board img").count() === 0 && await page.locator('[data-sec="out"] a').count() === 0);
  check("frontier cards have Work this ticket; others do not", await col("frontier").locator("button.work").count() === 2 && await page.locator("#board button.work").count() === 2);
  check("no listener: \"no agent listening: requests queue\"", (await page.locator("#listener").textContent()) === "no agent listening: requests queue");
  if (shots) await page.screenshot({ path: join(shots, "board-1440.png"), fullPage: true });

  // ---- listener text flips with heartbeat age ----
  await post("heartbeat", { agentId: "watcher-1" });
  check("a heartbeat → \"agent listening\"", await until(() => document.getElementById("listener").textContent === "agent listening"));
  writeMapFile({ ...readMap(), listener: { agentId: "watcher-1", heartbeat: new Date(Date.now() - 176 * 1000).toISOString() } });
  await sleep(300);
  check("a 176 s old heartbeat still counts as listening", (await page.locator("#listener").textContent()) === "agent listening");
  const aged = await until(() => document.getElementById("listener").textContent === "no agent listening: requests queue", null, 12000);
  check("… and flips to \"no agent listening\" as it ages past 180 s (no map change)", aged);
  await post("heartbeat", { agentId: "watcher-1" });
  check("a fresh heartbeat flips it back", await until(() => document.getElementById("listener").textContent === "agent listening"));

  // ---- Refresh ----
  const before = events().length;
  await page.locator("#refresh").click();
  check("Refresh appends a refresh event", await until(() => document.getElementById("refresh").textContent === "Refresh requested") && events().slice(before).some((e) => e.type === "refresh"), JSON.stringify(events()));
  const refreshSeq = events().filter((e) => e.type === "refresh").pop().seq;
  check("\"refresh requested\" shows until the next map update", (await page.locator("#queue").textContent()).includes("Refresh requested") && await page.locator("#refresh").isDisabled());
  await mapPatch({ handled: refreshSeq, notes: "Re-read the tracker." });
  check("the agent's map-patch clears it", await until(() => document.getElementById("refresh").textContent === "Refresh" && !document.getElementById("queue").textContent.includes("Refresh requested")));
  const staleMap = await (await fetch(`${base}/map`)).text(); // for the second tab below

  // ---- keyboard: j/k, w on a non-frontier card, w → queued → handled → claimed by ----
  await page.locator("#title").click();
  await page.keyboard.press("j");
  check("j selects the first card", (await page.locator("#board .tk.sel .t").textContent()) === T.a);
  await page.keyboard.press("j"); await page.keyboard.press("j");
  check("j walks the columns in order", (await page.locator("#board .tk.sel .t").textContent()) === T.c);
  await page.keyboard.press("w");
  check("w on a blocked card explains instead of claiming", await until(() => /Only a frontier ticket/.test((document.getElementById("grill-toast") || {}).textContent || "")) && !events().some((e) => e.type === "work"));
  await page.keyboard.press("k"); await page.keyboard.press("k");
  check("k goes back", (await page.locator("#board .tk.sel .t").textContent()) === T.a);
  await page.keyboard.press("w");
  check("w → the card moves to In progress", await until((t) => [...document.querySelectorAll('#board .col[data-col="progress"] .tk .t')].some((e) => e.textContent.trim() === t), T.a));
  const work = events().filter((e) => e.type === "work");
  check("w appends a work event for that ticket", work.length === 1 && work[0].ticket === T.a, JSON.stringify(work));
  check("the claimed card shows \"queued\" (seq > handled)", await until((t) => { const c = [...document.querySelectorAll("#board .tk")].find((e) => e.querySelector(".t").textContent.trim() === t); return !!c && c.classList.contains("queued") && /queued/.test(c.querySelector(".claim").textContent); }, T.a));
  check("the footer counts the queued request", (await page.locator("#queue").textContent()).includes("1 request queued"));
  check("selection and focus follow the card", (await page.evaluate(() => document.activeElement && document.activeElement.closest(".tk") && document.activeElement.closest(".tk").dataset.title)) === T.a);
  await mapPatch({ handled: work[0].seq, tickets: [{ title: T.a, assignee: "watcher-1" }] });
  check("after the agent's map-patch with handled → \"claimed by watcher-1\"", await until((t) => { const c = [...document.querySelectorAll("#board .tk")].find((e) => e.querySelector(".t").textContent.trim() === t); return !!c && !c.classList.contains("queued") && c.querySelector(".claim.claimed") && c.querySelector(".claim.claimed").textContent === "claimed by watcher-1"; }, T.a));

  // ---- a second tab with a stale board clicks the same ticket → conflict toast ----
  const page2 = await context.newPage(); watch(page2);
  await page2.route(`**/m/${KEY}/map`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: staleMap }));
  await page2.goto(`${base}/`);
  await cardOf(T.a, page2).locator("button.work").waitFor({ timeout: 8000 });
  await cardOf(T.a, page2).locator("button.work").click();
  const toast2 = await page2.waitForFunction(() => /Already claimed by watcher-1/.test((document.getElementById("grill-toast") || {}).textContent || ""), null, { timeout: 6000 }).then(() => true, () => false);
  check("second tab: Work on a ticket already claimed → \"Already claimed by watcher-1\"", toast2, await page2.locator("#grill-toast").textContent().catch(() => ""));
  check("the conflict appended no second work event", events().filter((e) => e.type === "work").length === 1);
  await page2.close();

  // ---- grilling now → ----
  const sessionUrl = `http://127.0.0.1:${port}/s/${sess.id}/`;
  await mapPatch({ tickets: [{ title: T.a, session: sessionUrl }] });
  check("a ticket's session link shows \"grilling now →\"", await until((u) => { const a = document.querySelector("#board a.go"); return !!a && a.textContent === "grilling now →" && a.getAttribute("href") === u; }, sessionUrl));

  // ---- a claim while no agent listens stays queued ----
  writeMapFile({ ...readMap(), listener: { agentId: "watcher-1", heartbeat: new Date(Date.now() - 600 * 1000).toISOString() } });
  check("stale listener → no agent listening", await until(() => document.getElementById("listener").textContent === "no agent listening: requests queue"));
  await cardOf(T.b).locator("button.work").click();
  check("Work with nobody listening → queued, and the footer says it waits", await until((t) => { const c = [...document.querySelectorAll('#board .col[data-col="progress"] .tk')].find((e) => e.querySelector(".t").textContent.trim() === t); return !!c && /queued · waits for an agent/.test(c.textContent); }, T.b) && /no agent is listening/.test(await page.locator("#queue").textContent()));
  check("its hub claim is \"queued\"", readMap().tickets.find((t) => t.title === T.b).hubClaim.agentId === "queued");
  if (shots) await page.screenshot({ path: join(shots, "board-1440-claims.png"), fullPage: true });

  // ---- ? cheatsheet, ?from= and g i ----
  await page.locator("#title").click();
  await page.keyboard.press("?");
  check("? opens the cheatsheet with the board's keys", await page.locator("#grill-keys").isVisible() && (await page.locator("#grill-keys").textContent()).includes("Work this ticket"));
  await page.keyboard.press("Escape");
  check("Esc closes it", await page.locator("#grill-keys").isHidden());
  check("no ?from → no back link", await page.locator("#back").isHidden());
  await page.goto(`${base}/?from=${sess.id}`);
  await page.locator("#board .tk").first().waitFor();
  check("?from= shows \"← Back to the grill\"", await page.locator("#back").isVisible() && (await page.locator("#back").getAttribute("href")) === `/s/${sess.id}/`);
  await page.locator("#title").click();
  await page.keyboard.press("g"); await page.keyboard.press("i");
  await page.waitForURL(/\/s\//, { timeout: 5000 }).catch(() => {});
  check("g i goes back to the grill", new URL(page.url()).pathname === `/s/${sess.id}/inbox`, page.url());

  // ---- hub down: banner ----
  // (covered for the shared transport by sse.e2e; here only that the board wires onGone)

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/`);
  await page.locator("#board .tk").first().waitFor();
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  check("390px: no horizontal scroll", w.doc <= w.win, JSON.stringify(w));
  const stacked = await page.evaluate(() => { const c = [...document.querySelectorAll("#board .col")].map((e) => e.getBoundingClientRect()); return c.every((r, i) => i === 0 || r.top > c[i - 1].top); });
  check("390px: the columns stack", stacked);
  if (shots) await page.screenshot({ path: join(shots, "board-390.png"), fullPage: true });

  const off = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !/^(data|about|blob):/.test(u));
  check("no request leaves 127.0.0.1 (links are never fetched)", off.length === 0, off.join(" "));
  const real = errors.filter((e) => !/40[49]/.test(e));
  check("no console errors or dialogs", real.length === 0, real.join(" | "));
} catch (e) {
  check("run finished without an exception", false, String(e && e.stack || e));
} finally {
  await browser.close();
  await cleanupHub(home);
}
const failed = results.filter((r) => !r.ok);
console.log(`board e2e: ${results.length - failed.length}/${results.length} checks passed${failed.length ? " — FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
