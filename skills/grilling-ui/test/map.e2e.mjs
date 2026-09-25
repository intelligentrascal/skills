// End-to-end check of the Wayfinder Map screen (plan T24, D9; spec §4 wayfinder-ui, §4a, §10 "the
// Map screen") on the Inbox, against a real hub. Needs Playwright:
//   PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/map.e2e.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's bundled Chromium.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { mkHome, run, tmp, hubInfo, cleanupHub } from "./helpers.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const { home, env } = mkHome();
const proj = tmp("grill-map-e2e-proj-");
const atomic = (file, text) => { writeFileSync(file + ".e2e-tmp", text); renameSync(file + ".e2e-tmp", file); };
const now = new Date().toISOString();
const questions = [
  { id: "q1", round: 1, deps: [], title: "Where are we going?", body: "The destination.", options: [{ k: "A", text: "Here" }, { k: "B", text: "There" }], rec: { option: "A", why: "W." }, status: "answered", answer: { kind: "option", option: "A" }, thread: [] },
];
function mk(topic, extra) {
  const c = JSON.parse(run(env, ["new", "--topic", topic, "--doc", "docs/none.md", "--agent", "claude"], { cwd: proj }));
  const file = join(c.session, "state.json");
  const base = JSON.parse(readFileSync(file, "utf8"));
  const write = (more) => atomic(file, JSON.stringify({ ...base, agent: { status: "waiting", since: now, handled: 0 }, questions, ...extra, ...more }, null, 2));
  write({});
  return { ...c, write };
}
const SNAP_AT = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const LOCAL_PATH = "docs/wayfinder/checkout-map.md";
const MAP_KEY = "shop-0123abcd/42";
const map = {
  title: "Checkout rewrite", link: LOCAL_PATH, at: SNAP_AT,
  destination: "One-page checkout that ships behind a flag",
  notes: "Charted in one grill.",
  decisions: [{ title: "Keep the cart service", link: "https://github.com/acme/shop/issues/1", gist: "No rewrite of the cart" }],
  tickets: [
    { title: "Research payment SDKs", link: "https://github.com/acme/shop/issues/2", type: "research", state: "frontier" },
    { title: "Prototype the address form", link: "file:///etc/passwd", type: "prototype", state: "blocked", blockedBy: ["Research payment SDKs"] },
    { title: "<img src=x onerror=alert(1)> Grill the flag rollout", type: "grilling", state: "claimed", assignee: "rahil" },
  ],
  closed: [{ title: "Spike on taxes", gist: "Tax service handles it" }],
  fog: ["How refunds flow back"],
  outOfScope: [{ gist: "Mobile app checkout", link: "javascript:alert(1)" }],
};
const withMap = mk("Chart the checkout", { phase: "frontier", mapKey: MAP_KEY, map, finished: { kind: "map", at: now } });
const noMap = mk("Small thing", { phase: "frontier", finished: { kind: "no-map", at: now } });
const noKey = mk("Map without a board", { phase: "destination", map: { title: "Loose map", destination: "Somewhere" }, finished: { kind: "map", at: now } });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [], requests = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss().catch(() => {}); });
page.on("request", (r) => requests.push(r.url()));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); if (!ok) console.log("FAIL", name, extra); };
const port = hubInfo(home).port;
const sec = (k) => page.locator(`#map-screen [data-sec="${k}"]`);

try {
  await page.goto(withMap.url);
  await page.locator("#map-screen .mv").waitFor({ timeout: 8000 });
  check("a map-finished grill opens on the Map screen; the list, card and discussion give way", await page.locator("#map-screen").isVisible() && await page.locator("nav").isHidden() && await page.locator("main").isHidden() && await page.locator("aside").isHidden());
  check("header shows the destination", (await page.locator(".mv-dest").textContent()) === map.destination);
  const snap = await page.locator(".mv-snap").textContent();
  check("snapshot time shown (\"Snapshot at <time> · canonical: …\")", snap.startsWith("Snapshot at ") && snap.includes("5 min ago") && snap.includes("canonical: "), snap);
  check("the canonical local path is plain text, not a link", snap.includes(LOCAL_PATH) && await page.locator(".mv-snap a").count() === 0 && await page.locator(".mv-snap .mv-path").textContent() === LOCAL_PATH);
  check("sections: decisions, frontier, blocked, claimed, closed, fog, out of scope", await Promise.all(["decisions", "frontier", "blocked", "claimed", "closed", "fog", "out"].map((k) => sec(k).count())).then((n) => n.every((x) => x === 1)));
  check("section titles", (await page.locator("#map-screen .mv-sec h3").allTextContents()).map((t) => t.replace(/\s*\d+$/, "")).join("|") === "Decisions so far|Frontier|Blocked|Claimed|Closed|Not yet specified|Out of scope");
  check("decision: title → gist, title links out (http)", (await sec("decisions").textContent()).includes("Keep the cart service → No rewrite of the cart") && (await sec("decisions").locator("a").getAttribute("href")) === "https://github.com/acme/shop/issues/1");
  check("frontier ticket: type chip and http link", (await sec("frontier").locator(".mv-chip").textContent()) === "research" && (await sec("frontier").locator("a").getAttribute("href")) === "https://github.com/acme/shop/issues/2");
  check("blocked ticket names what blocks it", (await sec("blocked").locator(".mv-meta").textContent()).includes("blocked by Research payment SDKs"));
  check("a file:// link is plain text", await sec("blocked").locator("a").count() === 0 && (await sec("blocked").textContent()).includes("file:///etc/passwd"));
  check("claimed ticket shows the assignee", (await sec("claimed").locator(".mv-meta").textContent()).includes("assignee rahil"));
  check("titles are escaped (no injected element)", await page.locator("#map-screen img").count() === 0 && (await sec("claimed").textContent()).includes("<img src=x onerror=alert(1)> Grill the flag rollout"));
  check("closed shows its gist", (await sec("closed").textContent()).includes("Spike on taxes") && (await sec("closed").textContent()).includes("Tax service handles it"));
  check("fog and out of scope", (await sec("fog").textContent()).includes("How refunds flow back") && (await sec("out").textContent()).includes("Mobile app checkout"));
  check("a javascript: link is plain text", await sec("out").locator("a").count() === 0 && (await sec("out").textContent()).includes("javascript:alert(1)"));
  check("every anchor on the Map screen is http(s) or the board", (await page.locator("#map-screen a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).every((h) => /^https?:\/\//.test(h) || h === `/m/${MAP_KEY}/`));
  check("\"Open board →\" links to /m/<mapKey>/", (await page.locator("#open-board").textContent()) === "Open board →" && (await page.locator("#open-board").getAttribute("href")) === `/m/${MAP_KEY}/`);
  check("phase label in the header", await page.locator("#phase").isVisible() && (await page.locator("#phase").textContent()) === "Frontier");
  check("finished banner names the map", (await page.locator("#banner").textContent()).includes("Wayfinder map") && await page.locator("#banner.done").count() === 1);

  // Back to questions and back to the map
  await page.locator("#map-back").click();
  check("Back to questions shows the layout again", await page.locator("#map-screen").isHidden() && await page.locator("nav").isVisible() && await page.locator("main").isVisible());
  check("the banner offers the map again", await page.locator("#show-map").count() === 1);
  await page.reload(); await page.locator(".item").first().waitFor();
  check("the choice survives a reload", await page.locator("#map-screen").isHidden() && await page.locator("#show-map").count() === 1);
  await page.locator("#show-map").click();
  check("Show the map brings the Map screen back, focus on its Back button", await page.locator("#map-screen").isVisible() && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "map-back");

  // phase labels
  withMap.write({ phase: "ticket" });
  await page.waitForFunction(() => document.getElementById("phase").textContent === "Ticket", null, { timeout: 5000 }).catch(() => {});
  check("phase ticket → \"Ticket\"", (await page.locator("#phase").textContent()) === "Ticket");
  withMap.write({ phase: "destination" });
  await page.waitForFunction(() => document.getElementById("phase").textContent === "Destination", null, { timeout: 5000 }).catch(() => {});
  check("phase destination → \"Destination\"", (await page.locator("#phase").textContent()) === "Destination");
  // the snapshot updates live
  withMap.write({ map: { ...map, destination: "A newer destination" } });
  await page.waitForFunction(() => (document.querySelector(".mv-dest") || {}).textContent === "A newer destination", null, { timeout: 5000 }).catch(() => {});
  check("a new snapshot re-renders the Map screen", (await page.locator(".mv-dest").textContent()) === "A newer destination");

  // g m goes to the board
  await page.locator("#map-back").click(); await page.locator("h1").click();
  await page.keyboard.press("g"); await page.keyboard.press("m");
  await page.waitForURL(/\/m\//, { timeout: 5000 }).catch(() => {});
  check("g m goes to the board", new URL(page.url()).pathname === `/m/${MAP_KEY}/`, page.url());

  // no-map
  await page.goto(noMap.url); await page.locator(".item").first().waitFor();
  check("no-map: banner \"No map needed — see terminal\"", (await page.locator("#banner").textContent()) === "No map needed — see terminal" && await page.locator("#banner.show").isVisible());
  check("no-map: no Map screen, the questions stay", await page.locator("#map-screen").isHidden() && await page.locator("nav").isVisible());

  // a map without a mapKey: no board link; destination phase label
  await page.goto(noKey.url);
  await page.locator("#map-screen .mv").waitFor({ timeout: 8000 });
  check("no mapKey → no Open board link", await page.locator("#open-board").count() === 0 && (await page.locator(".mv-dest").textContent()) === "Somewhere");
  check("a map without `at` still says Snapshot at …", (await page.locator(".mv-snap").textContent()).startsWith("Snapshot at "));

  // phone width: the Map screen stacks
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(withMap.url); await page.locator(".item").first().waitFor();
  await page.locator("#show-map").click(); // "Back to questions" was remembered from the step above
  await page.locator("#map-screen .mv").waitFor();
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  check("390px: no horizontal scroll on the Map screen", w.doc <= w.win, JSON.stringify(w));

  const off = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !/^(data|about|blob):/.test(u));
  check("no request leaves 127.0.0.1 (links are never fetched)", off.length === 0, off.join(" "));
  const real = errors.filter((e) => !/404/.test(e));
  check("no console errors or dialogs", real.length === 0, real.join(" | "));
} catch (e) {
  check("run finished without an exception", false, String(e && e.stack || e));
} finally {
  await browser.close();
  await cleanupHub(home);
}
const failed = results.filter((r) => !r.ok);
console.log(`map e2e: ${results.length - failed.length}/${results.length} checks passed${failed.length ? " — FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
