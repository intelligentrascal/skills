// End-to-end check of the Inbox layout (page/inbox.html + page/core.js) against a real hub.
// Port of jasonku09/grill-with-ui test/page.e2e.mjs (daafa1e): all 99 checks kept, on the hub
// (SSE pings, token sends, sends read from events.jsonl), plus checks for what the hub adds
// (title, favicon, listener state, presence, hub-down banner, D1 redirect, layout switch).
// Needs Playwright:
//   PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/page.e2e.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's bundled Chromium.
import { readFileSync, writeFileSync, renameSync, symlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { mkHome, run, tmp, hubInfo, stopHub, cleanupHub, waitUntil, sleep } from "./helpers.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, "..", "page");

// The shipped page files, plus a stub Studio so D1 and the header switch have two built layouts.
const pageDir = tmp("grill-e2e-page-");
for (const f of ["inbox.html", "core.js", "tokens.css", "map-view.js"]) symlinkSync(join(PAGE, f), join(pageDir, f));
writeFileSync(join(pageDir, "studio.html"), `<!doctype html><meta charset="utf-8"><title>studio stub</title><!--GRILL_BOOT--><p id="studio-stub">studio stub</p>`);
const { home, env } = mkHome({ GRILL_PAGE_DIR: pageDir });
const proj = tmp("grill-e2e-proj-");

const created = JSON.parse(run(env, ["new", "--topic", "E2E topic", "--doc", "docs/e2e-design.md", "--agent", "claude"], { cwd: proj }));
const { session, url, id } = created;
const stateFile = join(session, "state.json");
const base = JSON.parse(readFileSync(stateFile, "utf8"));
const projectName = basename(base.project);
const now = new Date().toISOString();
const fixture = () => ({
  ...base,
  phase: "frontier",
  agent: { status: "waiting", since: now, handled: 0 },
  terms: [{ term: "Send", def: "One press of Send to Agent.", avoid: ["submit", "reply"] }],
  questions: [
    { id: "q1", round: 1, deps: [], title: "Root question", body: "Answered earlier.", options: [{ k: "A", text: "First" }, { k: "B", text: "Second" }], rec: { option: "A", why: "Because." }, status: "answered", durable: true, updated: false, answer: { kind: "option", option: "B" }, thread: [{ who: "user", text: "Why not B?", at: now }, { who: "agent", text: "B is fine too.", at: now }] },
    { id: "q2", round: 2, deps: ["q1"], title: "Deferred one", body: "Parked.", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "Sure." }, status: "deferred", durable: false, updated: false, thread: [] },
    { id: "q3", round: 3, deps: ["q1"], title: "Current open question", body: "Pick one.", options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }, { k: "C", text: "Gamma" }], rec: { option: "B", why: "Beta balances both." }, status: "open", durable: false, updated: true, thread: [] },
    { id: "q4", round: 3, deps: ["q2"], title: "Free-text question", body: "No options here.", options: [], rec: { text: "Something short", why: "Keeps it simple." }, status: "open", durable: false, updated: false, thread: [] },
  ],
});
// Atomic, like `patch`: the hub's folder watch sees the rename and pings the page.
const atomic = (file, text) => { writeFileSync(file + ".e2e-tmp", text); renameSync(file + ".e2e-tmp", file); };
const writeState = (s) => atomic(stateFile, JSON.stringify(s, null, 2));
writeState(fixture());

// Sends are read from events.jsonl (the hub appends them; there is no server stdout).
const events = () => readFileSync(join(session, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
async function sendNo(seq) {
  try { await waitUntil(() => events().some((e) => e.seq === seq), 8000); } catch { return { actions: [] }; }
  return events().find((e) => e.seq === seq);
}
const port0 = hubInfo(home).port;
const clients = async () => { try { return await (await fetch(`http://127.0.0.1:${hubInfo(home).port}/s/${id}/clients`)).json(); } catch { return { count: -1 }; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const requests = []; // { url, t }
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => requests.push({ url: r.url(), t: Date.now() }));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); if (!ok) console.log("FAIL", name, extra); };
const offHost = () => requests.filter((r) => !r.url.startsWith(`http://127.0.0.1:${port0}/`) && !/^(data|about|blob):/.test(r.url)).map((r) => r.url);
const favicon = () => page.evaluate(() => { const l = document.querySelector('link[rel="icon"]'); return l ? { status: l.dataset.status, href: l.href } : {}; });

try {
  await page.goto(url);
  await page.locator(".item").first().waitFor();
  check("default selection = first open question in the current round", (await page.locator(".item.selected .id").textContent()) === "Q3");
  check("updated marker on q3", await page.locator(".item.updated .id", { hasText: "Q3" }).count() === 1);
  check("crumb shows recommendation updated", (await page.locator(".crumb .upd").textContent()) === "recommendation updated");
  check("send disabled with nothing staged", await page.locator("#send").isDisabled());
  check("no Accept button (clicking the recommended option is the accept)", await page.locator("#accept").count() === 0);
  check("explore button sits next to the title", await page.locator(".title-row #explore").count() === 1 && (await page.locator("#explore").textContent()) === "Explore deeper");
  check("system fonts only (no Google Fonts link), and no request leaves 127.0.0.1", (await page.content()).includes("fonts.googleapis") === false && offHost().length === 0, offHost().join(" "));
  const geo = await page.evaluate(() => { const r = (sel) => document.querySelector(sel).getBoundingClientRect(); return { main: r("main"), footer: r("footer"), h: innerHeight }; });
  check("layout fills the viewport (content row stretches, footer sits at the bottom)", Math.abs(geo.footer.bottom - geo.h) < 2 && Math.abs(geo.main.bottom - geo.footer.top) < 2 && geo.main.height > 600, JSON.stringify(geo));

  // hub additions: tab title, favicon, header, listener, presence, SSE instead of polling
  check("tab title is <project> · <topic>", (await page.title()) === `${projectName} · E2E topic`, await page.title());
  const fav0 = await favicon();
  check("favicon is the waiting dot (--ok)", fav0.status === "waiting" && fav0.href.includes(encodeURIComponent("#3d6b4a")), JSON.stringify(fav0));
  check("header shows the project, the doc path and the phase", (await page.locator("#where").textContent()).includes(projectName) && (await page.locator("#doc-path").textContent()) === "docs/e2e-design.md" && (await page.locator("#phase").textContent()) === "Frontier" && await page.locator("#phase").isVisible());
  check("header shows the listener: agent listening (Claude)", (await page.locator("#listener").textContent()) === "agent listening (Claude)");
  check("tokens come from tokens.css with Jason's values", (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--stage").trim())) === "#b8791f");
  await waitUntil(async () => (await clients()).count >= 1, 5000).catch(() => {});
  check("presence: the hub counts this tab", (await clients()).count === 1);
  const t0 = Date.now(); await sleep(2500);
  const polls = requests.filter((r) => r.t >= t0 && r.url.endsWith("/state")).length;
  check("no polling: an idle tab fetches no state (SSE pings instead)", polls === 0, `${polls} state fetches`);

  await page.locator("#terms-toggle").click();
  check("terms panel shows the term and its avoid list", (await page.locator("#terms").textContent()).includes("Avoid: submit, reply"));
  await page.locator("h1").click();

  await page.locator(".opt.rec").click();
  check("staging an option dims the rest of the card, the picked box stays full", await page.locator(".card.picked").count() === 1
    && (await page.locator(".opt.staged").evaluate((el) => getComputedStyle(el).opacity)) === "1"
    && Number(await page.locator(".opt:not(.staged)").first().evaluate((el) => getComputedStyle(el).opacity)) < 0.6
    && Number(await page.locator(".why").evaluate((el) => getComputedStyle(el).opacity)) < 0.6);
  check("staged key is grill:<sessionId>", await page.evaluate((k) => { try { return !!JSON.parse(localStorage.getItem(k)).staged.q3; } catch { return false; } }, `grill:${id}`));
  await page.locator("#thread-in").fill("Would Alpha be simpler?");
  await page.locator("#stage-thread").click();
  check("staged count 2", (await page.locator("#send").textContent()) === "Send 2 to Agent");
  await page.locator("#explore").click();
  const exploreEv = await sendNo(1);
  check("explore sends immediately as its own event", exploreEv.seq === 1 && JSON.stringify(exploreEv.actions) === JSON.stringify([{ q: "q3", type: "explore" }]), JSON.stringify(exploreEv.actions));
  await page.waitForFunction(() => document.getElementById("explore").textContent.includes("Exploring…"));
  check("explore button shows exploring and is disabled; staging untouched", await page.locator("#explore").isDisabled() && (await page.locator("#send").textContent()) === "Send 2 to Agent");
  check("footer shows the explore send as sent", (await page.locator("#staged-list").textContent()).includes("Sent #1"));
  check("nav shows staged", (await page.locator(".item.selected .mark").textContent()) === "staged");
  await page.locator("#free").fill("draft text that should survive reload");

  await page.reload();
  await page.locator(".item").first().waitFor();
  check("staging survives reload (option, thread) and the exploring state too", (await page.locator("#send").textContent()) === "Send 2 to Agent" && (await page.locator("#explore").textContent()).includes("Exploring…") && await page.locator("#explore .spin").count() === 1);
  check("staged option still highlighted after reload", await page.locator(".opt.staged").count() === 1);
  check("staged thread message still shown after reload", await page.locator(".msg.staged").count() === 1);
  check("draft text survives reload", (await page.locator("#free").inputValue()) === "draft text that should survive reload");
  check("send stays disabled while a send is pending (nothing handled yet)", await page.locator("#send").isDisabled() && (await page.locator("#send").textContent()) === "Send 2 to Agent");
  let s0 = fixture(); s0.agent = { status: "waiting", since: new Date().toISOString(), handled: 1 };
  s0.questions[2].explore = { at: now, rows: [{ option: "A", pros: ["Fast"], cons: ["Rigid"] }, { option: "B", pros: ["Balanced", "Safe"], cons: ["Slower"] }, { option: "C", pros: ["Rich"], cons: ["Complex", "Costly"] }] };
  writeState(s0);
  await page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("handled #1"));
  check("explore handled: button offers to explore again, send enabled again", (await page.locator("#explore").textContent()) === "Explore again" && await page.locator("#send").isEnabled());

  // deps link navigation + answered card + reopen
  await page.locator(".crumb a[data-go='q1']").click();
  check("deps link navigates to q1", (await page.locator(".item.selected .id").textContent()) === "Q1");
  check("chosen option is filled green with a circle check on the right, no Answered line", await page.locator(".opt.chosen").count() === 1 && (await page.locator(".opt.chosen .k").textContent()) === "B" && await page.locator(".opt.chosen .check svg circle").isVisible() && await page.locator(".opt.rec .check").isHidden() && await page.locator(".answered-line").count() === 0);
  check("chosen option background is the green fill", (await page.locator(".opt.chosen").evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(227, 238, 229)");
  check("answered card dims everything but the chosen box", await page.locator(".card.picked").count() === 1 && Number(await page.locator(".opt.rec").evaluate((el) => getComputedStyle(el).opacity)) < 0.6 && (await page.locator(".opt.chosen").evaluate((el) => getComputedStyle(el).opacity)) === "1");
  check("sidebar shows a circle check for answered questions", await page.locator(".item", { hasText: "Q1" }).locator(".mark.answered svg circle").count() === 1 && await page.locator(".item", { hasText: "Q3" }).locator(".mark svg").count() === 0);
  check("q1 thread has 2 messages", await page.locator("aside .msg").count() === 2);
  await page.locator("#reopen").click();
  check("reopen staged on q1", (await page.locator(".staged-line").textContent()).includes("reopen"));
  await page.locator("#clear-staged").click();
  check("clear removes the staged reopen", await page.locator(".staged-line").count() === 0);

  // defer on q4 (free-text question, no options)
  await page.locator(".item", { hasText: "Q4" }).click();
  check("free-text question has no option list", await page.locator(".opt").count() === 0);
  check("free-text question shows suggested text", (await page.locator(".why").textContent()).includes("Suggested."));
  await page.locator("#defer").click();
  check("send label counts 3", (await page.locator("#send").textContent()) === "Send 3 to Agent");

  check("header has a Visualize button before any visual exists", await page.locator("header #visualize").count() === 1 && (await page.locator("#visualize").textContent()) === "Visualize" && await page.locator("body.visualize").count() === 0);

  // Discussion scroll, first on a panel that cannot scroll at all: nothing there is "at the
  // bottom", so long content arriving is read from its first line. The pros and cons table is
  // the sharp case, because it renders above the thread rather than after it.
  await page.locator(".item", { hasText: "Q1" }).click();
  const msgs = page.locator("aside .msgs");
  const scrollPos = () => msgs.evaluate((el) => ({ top: el.scrollTop, room: el.scrollHeight - el.clientHeight }));
  const beforeTable = await scrollPos();
  s0.questions[0].explore = { at: now, rows: Array.from({ length: 8 }, (_, i) => ({
    option: String.fromCharCode(65 + i),
    pros: [1, 2, 3].map((k) => `Pro ${k} for option ${i + 1}, long enough to wrap in the panel.`),
    cons: [1, 2, 3].map((k) => `Con ${k} for option ${i + 1}, long enough to wrap in the panel.`),
  })) };
  writeState(s0);
  await page.waitForFunction(() => document.querySelectorAll("aside .msgs table.procon tbody tr").length === 8, null, { timeout: 5000 });
  const tablePos = await scrollPos();
  const headInView = await msgs.evaluate((el) => {
    const h = el.querySelector(".explore-head"); if (!h) return false;
    const box = el.getBoundingClientRect(), head = h.getBoundingClientRect();
    return head.top >= box.top - 1 && head.bottom <= box.bottom + 1;
  });
  check("an explore table landing in a short thread stays in view, not scrolled off the top",
    beforeTable.room === 0 && tablePos.room > 200 && tablePos.top === 0 && headInView,
    JSON.stringify({ beforeTable, tablePos, headInView }));

  await page.locator(".item", { hasText: "Q4" }).click();
  const beforeReply = await scrollPos();
  s0.questions[3].thread = [{ who: "agent", text: Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a reply taller than the panel it lands in.`).join("\n"), at: now }];
  writeState(s0);
  await page.waitForFunction(() => document.querySelectorAll("aside .msgs .msg").length === 1, null, { timeout: 5000 });
  const replyPos = await scrollPos();
  check("a long reply landing in a short thread leaves the panel at its first line",
    beforeReply.room === 0 && replyPos.room > 200 && replyPos.top === 0,
    JSON.stringify({ beforeReply, replyPos }));

  // Then on one that does scroll: the panel is rebuilt on every render, so it used to snap back
  // to the top of a long thread on each send. q1 is answered with nothing staged on it, so its
  // thread can be watched across the send that ships q3's and q4's staging.
  s0.questions[0].thread = s0.questions[0].thread.concat(Array.from({ length: 22 }, (_, i) =>
    ({ who: i % 2 ? "agent" : "user", text: `Back and forth ${i + 1}. Long enough to take a couple of lines in the panel.`, at: now })));
  writeState(s0);
  await page.locator(".item", { hasText: "Q1" }).click();
  await page.waitForFunction(() => document.querySelectorAll("aside .msgs .msg").length === 24, null, { timeout: 5000 });
  check("a long thread overflows the discussion panel", (await scrollPos()).room > 200);
  await msgs.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const wasAtBottom = await scrollPos();

  await page.locator("#send").click();
  await page.waitForFunction(() => document.getElementById("staged-list").textContent.includes("Sent #2"));
  let pos = await scrollPos();
  check("a send keeps a thread that was at the bottom at the bottom", wasAtBottom.top > 200 && pos.room - pos.top <= 32, JSON.stringify(pos));
  await msgs.evaluate((el) => (el.scrollTop = 120));
  s0.questions[0].thread.push({ who: "agent", text: "One more reply while you were reading.", at: now });
  writeState(s0);
  await page.waitForFunction(() => document.querySelectorAll("aside .msgs .msg").length === 25, null, { timeout: 5000 });
  pos = await scrollPos();
  check("a reply landing mid-thread keeps the place you were reading", Math.abs(pos.top - 120) <= 2, JSON.stringify(pos));
  await page.locator(".item", { hasText: "Q3" }).click();
  await page.locator(".item", { hasText: "Q1" }).click();
  check("another question's thread starts at the top, not where the last one sat", (await scrollPos()).top === 0);
  await page.locator(".item", { hasText: "Q4" }).click();

  const ev = await sendNo(2);
  check("events.jsonl line has 3 actions", ev.seq === 2 && ev.actions.length === 3, JSON.stringify(ev.actions));
  const kinds = ev.actions.map((a) => `${a.q}:${a.type}${a.kind ? ":" + a.kind : ""}${a.option ? ":" + a.option : ""}`).sort();
  check("action shapes", JSON.stringify(kinds) === JSON.stringify(["q3:answer:accept:B", "q3:thread", "q4:defer"]), JSON.stringify(kinds));
  check("staging cleared after send", (await page.locator("#send").textContent()) === "Send to Agent");
  check("staged-list shows sent note", (await page.locator("#staged-list").textContent()).includes("Sent #2 · waiting for the agent"));
  check("events.jsonl holds exactly sends #1 and #2, in order, for this session", events().map((e) => `${e.type}#${e.seq}@${e.session === session}`).join("|") === "send#1@true|send#2@true", JSON.stringify(events().map((e) => e.seq)));

  // pending indicators: the sent-but-unhandled work stays visible until the agent records it
  check("sidebar shows pending marks for the sent questions, not 'open'", await page.locator(".item", { hasText: "Q3" }).locator(".mark.pending .spin").count() === 1 && await page.locator(".item", { hasText: "Q4" }).locator(".mark.pending .spin").count() === 1 && await page.locator(".item", { hasText: "Q1" }).locator(".mark.pending").count() === 0);
  check("pending defer shown on the q4 card", (await page.locator(".pending-line").textContent()).includes("defer"));
  await page.locator(".item", { hasText: "Q3" }).click();
  check("pending answer shown on the sent option with a spinner", await page.locator(".opt.pending[data-opt='B'] .check .spin").count() === 1);
  check("pending thread message shown as sending", await page.locator("aside .msg.pending").count() === 1 && (await page.locator("aside .msg.pending .who").textContent()).includes("sending"));
  check("footer sent note carries a spinner", await page.locator("#staged-list .sent .spin").count() === 1);
  check("send disabled while pending even with new staging", (await (async () => { await page.locator(".opt[data-opt='A']").click(); return page.locator("#send").isDisabled(); })()));

  // agent working: disabled; after 5 min: enabled with a note
  let s = fixture(); s.agent = { status: "working", since: new Date().toISOString(), handled: 0 }; writeState(s);
  await page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("Agent working"));
  await page.locator(".item", { hasText: "Q3" }).click();
  check("send disabled while working", await page.locator("#send").isDisabled());
  check("working indicator: header progress bar and status spinner", await page.locator("header.working #progress").isVisible() && await page.locator("#agent-status .spin").count() === 1);
  const fav1 = await favicon();
  check("favicon turns to the working dot (--stage)", fav1.status === "working" && fav1.href.includes(encodeURIComponent("#b8791f")), JSON.stringify(fav1));
  s = fixture(); s.agent = { status: "working", since: new Date(Date.now() - 6 * 60 * 1000).toISOString(), handled: 0 }; writeState(s);
  await page.waitForFunction(() => !document.getElementById("send").disabled);
  check("send re-enabled after 5 minutes of working with a note", (await page.locator("#send-why").textContent()).includes("may not be listening"));

  // handled catches up: sent note clears, selection jumps to the new round's open question
  s = fixture(); s.agent = { status: "waiting", since: new Date().toISOString(), handled: 2 };
  s.questions[2].status = "answered"; s.questions[2].answer = { kind: "accept", option: "B" };
  s.questions[2].explore = { at: now, rows: [{ option: "A", pros: ["Fast"], cons: ["Rigid"] }, { option: "B", pros: ["Balanced", "Safe"], cons: ["Slower"] }, { option: "C", pros: ["Rich"], cons: ["Complex", "Costly"] }] };
  s.questions[3].status = "answered"; s.questions[3].answer = { kind: "text", text: "Short and sweet" };
  s.questions.push({ id: "q5", round: 4, deps: ["q3"], title: "Next round question", body: "New.", options: [{ k: "A", text: "Go" }], rec: { option: "A", why: "Go." }, status: "open", durable: false, updated: false, thread: [] });
  s.note = "Round 4 is the last round I can see from here.";
  writeState(s);
  await page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("handled #2"));
  check("sent note cleared when handled", !(await page.locator("#staged-list").textContent()).includes("Sent #"));
  check("agent note shown above the list", (await page.locator("nav .note").textContent()).includes("last round"));
  check("round 4 marked current", (await page.locator("nav .round.current").textContent()).includes("Round 4"));
  check("pending marks cleared once handled", await page.locator(".mark.pending").count() === 0 && await page.locator(".opt.pending").count() === 0 && await page.locator("header.working").count() === 0);
  check("finish does not flash while a question is open", await page.locator("#finish.ready").count() === 0);
  await page.locator(".item", { hasText: "Q3" }).click();
  check("pros/cons table renders in the discussion panel, one row per option", await page.locator("aside table.procon tbody tr").count() === 3 && (await page.locator("aside table.procon").textContent()).includes("Balanced") && (await page.locator("aside table.procon td.k.rec").textContent()) === "B");
  check("explore button offers to explore again once a table exists (exploring state cleared by handled)", (await page.locator("#explore").textContent()) === "Explore again" && await page.locator("#explore").isEnabled());
  check("Recommended tag turns green on the chosen box", (await page.locator(".opt.chosen.rec .tag").evaluate((el) => getComputedStyle(el).color)) === "rgb(61, 107, 74)");
  await page.locator(".item", { hasText: "Q4" }).click();
  check("free-text answer shows as a green chosen box with a check", await page.locator(".opt.chosen.text-answer").count() === 1 && (await page.locator(".opt.chosen.text-answer").textContent()).includes("Short and sweet") && await page.locator(".opt.chosen.text-answer .check").isVisible());

  // visualize: immediate event; the agent acknowledges at once and draws in the background, so grilling continues
  await page.locator("#visualize").click();
  const visEv = await sendNo(3);
  check("visualize sends immediately as its own event", visEv.seq === 3 && JSON.stringify(visEv.actions) === JSON.stringify([{ type: "visualize" }]), JSON.stringify(visEv.actions));
  await page.waitForFunction(() => document.getElementById("visualize").textContent.includes("Visualizing…"));
  check("visualize in flight: disabled with a spinner, still on the questions view", await page.locator("#visualize").isDisabled() && await page.locator("#visualize .spin").count() === 1 && await page.locator("body.visualize").count() === 0);
  // the agent acknowledges the send at once: handled = 3, a version-0 visual carrying `drawing`, no file yet
  s = fixture(); s.agent = { status: "waiting", since: new Date().toISOString(), handled: 3 };
  s.questions[2].status = "answered"; s.questions[2].answer = { kind: "accept", option: "B" };
  s.questions[3].status = "answered"; s.questions[3].answer = { kind: "text", text: "Short and sweet" };
  s.visual = { kind: "prototype", version: 0, thread: [], stale: false, drawing: { since: new Date().toISOString(), seq: 3 } };
  writeState(s);
  await page.waitForFunction(() => !document.getElementById("staged-list").textContent.includes("Sent #3"), null, { timeout: 5000 });
  check("first draw in the background: questions view stays, header keeps Visualizing…, no iframe request for v0", await page.locator("body.visualize").count() === 0 && await page.locator("#visualize").isDisabled() && (await page.locator("#visualize").textContent()).includes("Visualizing…") && !((await page.locator("#visual-frame").getAttribute("src")) || "").includes("v=0"));
  await page.locator(".item", { hasText: "Q3" }).click(); await page.locator("#clear-staged").click(); // drop the option staged on q3 while send #2 was pending
  await page.locator(".item", { hasText: "Q4" }).click();
  await page.locator("#thread-in").fill("Meanwhile, a question"); await page.locator("#stage-thread").click();
  check("send is enabled while the draw runs", await page.locator("#send").isEnabled() && (await page.locator("#send").textContent()) === "Send 1 to Agent");
  await page.locator("#send").click();
  const midEv = await sendNo(4);
  check("a send goes out during the draw", midEv.seq === 4 && midEv.actions.length === 1 && midEv.actions[0].type === "thread" && midEv.actions[0].text === "Meanwhile, a question", JSON.stringify(midEv.actions));
  await page.waitForFunction(() => document.getElementById("staged-list").textContent.includes("Sent #4"));
  check("visualize button stays Visualizing… while the mid-draw send is pending", await page.locator("#visualize").isDisabled() && (await page.locator("#visualize").textContent()).includes("Visualizing…"));
  // the agent handles the mid-draw send while the draw is still running
  s.agent = { status: "waiting", since: new Date().toISOString(), handled: 4 };
  s.questions[3].thread = [{ who: "user", text: "Meanwhile, a question", at: now }, { who: "agent", text: "Answered while drawing.", at: now }];
  writeState(s);
  await page.waitForFunction(() => !document.getElementById("staged-list").textContent.includes("Sent #4"), null, { timeout: 5000 });
  check("mid-draw send handled: reply shown, still drawing, still on the questions", (await page.locator("aside").textContent()).includes("Answered while drawing.") && await page.locator("aside .msg.pending").count() === 0 && await page.locator("body.visualize").count() === 0 && await page.locator("#visualize").isDisabled());
  // a first draw that runs over ten minutes releases the header button so the user can try again
  s.visual.drawing = { since: new Date(Date.now() - 11 * 60 * 1000).toISOString(), seq: 3 }; writeState(s);
  await page.waitForFunction(() => !document.getElementById("visualize").disabled, null, { timeout: 5000 });
  check("stuck first draw: Visualize re-enabled with a note", (await page.locator("#visualize").textContent()) === "Visualize" && ((await page.locator("#visualize").getAttribute("title")) || "").includes("over 10 minutes"));
  // the draw lands: version 1, the file, `drawing` gone → the view flips by itself
  writeFileSync(join(session, "visual.html"), "<!doctype html><title>proto</title><h1 id='proto-heading'>Prototype v1 heading</h1>");
  s.visual = { kind: "prototype", version: 1, at: new Date().toISOString(), note: "v1: first cut", thread: [], stale: false };
  writeState(s);
  await page.waitForFunction(() => document.body.classList.contains("visualize"), null, { timeout: 5000 });
  // The list stays beside the visual for hover linkage (plan T20, the approved inbox.template.html); only the card gives way.
  const vgeo = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { nav: r("nav"), visual: r("#visual") }; });
  check("view flips to the visual by itself; the list stays beside it, the card is hidden", await page.locator("nav").isVisible() && await page.locator("main").isHidden() && await page.locator("#visual-frame").isVisible() && Math.abs(vgeo.visual.left - vgeo.nav.right) < 2, JSON.stringify(vgeo));
  check("iframe src carries the version and the sandbox has no same-origin", (await page.locator("#visual-frame").getAttribute("src")).includes("v=1") && (await page.locator("#visual-frame").getAttribute("sandbox")) === "allow-scripts");
  check("strip shows the kind, version and note", (await page.locator("#visual-strip").textContent()).includes("Prototype") && (await page.locator("#visual-strip").textContent()).includes("v1: first cut"));
  check("iframe shows the agent's file", (await page.frameLocator("#visual-frame").locator("#proto-heading").textContent()) === "Prototype v1 heading");
  check("header button now toggles back to the questions", (await page.locator("#visualize").textContent()) === "Questions");
  check("right panel is the visual's feedback thread", (await page.locator("aside .head h3").textContent()).includes("Visual feedback") && await page.locator("#feedback-in").count() === 1);
  await page.locator("#feedback-in").fill("Make the list narrower");
  await page.locator("#stage-feedback").click();
  check("feedback staged: shown in the panel and in the footer", await page.locator("aside .msg.staged").count() === 1 && (await page.locator("#staged-list").textContent()).includes("visual +1 msg"));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains("visualize"), null, { timeout: 5000 });
  check("visualize view and staged feedback survive reload", await page.locator("aside .msg.staged").count() === 1 && (await page.locator("#staged-list").textContent()).includes("visual +1 msg"));
  await page.locator("#send").click();
  await page.waitForFunction(() => document.getElementById("staged-list").textContent.includes("Sent #5"));
  const fbEv = await sendNo(5);
  check("send carries the visual feedback action", fbEv.seq === 5 && fbEv.actions.some((a) => a.type === "visual-feedback" && a.text === "Make the list narrower"), JSON.stringify(fbEv.actions));
  check("pending feedback shown as sending", await page.locator("aside .msg.pending").count() === 1);
  // the agent answers the feedback at once and redraws in the background: version still 1, `drawing` set
  const v1at = s.visual.at;
  s.agent = { status: "waiting", since: new Date().toISOString(), handled: 5 };
  s.visual = { kind: "prototype", version: 1, at: v1at, note: "v1: first cut", thread: [{ who: "user", text: "Make the list narrower", at: now }, { who: "agent", text: "Redrawing with a narrower list.", at: now }], stale: false, drawing: { since: new Date().toISOString(), seq: 5 } };
  writeState(s);
  await page.waitForFunction(() => document.querySelectorAll("aside .msg").length === 2 && !document.querySelector("aside .msg.pending"), null, { timeout: 5000 });
  check("redraw in the background: iframe kept at v1, strip says regenerating, no Regenerate link, header still toggles", (await page.locator("#visual-frame").getAttribute("src")).includes("v=1") && (await page.locator("#visual-strip").textContent()).includes("regenerating…") && await page.locator("#visual-strip .spin").count() === 1 && await page.locator("#regen").count() === 0 && (await page.locator("#visualize").textContent()) === "Questions" && await page.locator("#visualize").isEnabled());
  await page.locator("#feedback-in").fill("And bigger type"); await page.locator("#stage-feedback").click();
  check("feedback composer and Send work during the redraw", await page.locator("aside .msg.staged").count() === 1 && await page.locator("#send").isEnabled() && (await page.locator("#send").textContent()) === "Send 1 to Agent");
  await page.locator("aside .msg.staged [data-rmf]").click();
  check("staged feedback removed again", await page.locator("aside .msg.staged").count() === 0);
  // a redraw that runs over ten minutes brings Regenerate back with a note; the old version stays on screen
  s.visual.drawing = { since: new Date(Date.now() - 11 * 60 * 1000).toISOString(), seq: 5 }; writeState(s);
  await page.waitForFunction(() => !!document.getElementById("regen"), null, { timeout: 5000 });
  check("stuck redraw: Regenerate re-enabled with a note, iframe still v1", ((await page.locator("#regen").getAttribute("title")) || "").includes("over 10 minutes") && (await page.locator("#visual-frame").getAttribute("src")).includes("v=1") && await page.locator("#visual-strip .spin").count() === 0);
  // the redraw lands
  s.visual = { kind: "prototype", version: 2, at: new Date().toISOString(), note: "v2: narrower list", thread: s.visual.thread, stale: false };
  writeState(s);
  await page.waitForFunction(() => (document.getElementById("visual-frame").getAttribute("src") || "").includes("v=2"), null, { timeout: 5000 });
  check("iframe reloads on a version bump; the thread shows both messages; Regenerate is plain again", (await page.locator("#visual-strip").textContent()).includes("v2: narrower list") && await page.locator("aside .msg").count() === 2 && await page.locator("aside .msg.pending").count() === 0 && await page.locator("#regen").count() === 1 && !(await page.locator("#regen").getAttribute("title")));
  s.visual = { ...s.visual, stale: true }; writeState(s);
  await page.waitForFunction(() => !!document.getElementById("visual-stale"), null, { timeout: 5000 });
  check("a stale visual says so in the strip", (await page.locator("#visual-stale").textContent()).includes("Out of date"));
  s.visual = { ...s.visual, stale: false }; writeState(s);
  await page.waitForFunction(() => !document.getElementById("visual-stale"), null, { timeout: 5000 });
  await page.locator("#visualize").click();
  check("toggling back restores the list and card", await page.locator("body.visualize").count() === 0 && await page.locator("nav .item").count() > 0 && await page.locator(".card").count() === 1 && (await page.locator("#visualize").textContent()).includes("Visual · v2"));

  // every question settled → Finish flashes; finish fires at once with whatever is staged
  await page.waitForFunction(() => document.getElementById("finish").classList.contains("ready"), null, { timeout: 5000 });
  check("finish flashes when nothing is open", await page.locator("#finish.ready").count() === 1);
  await page.locator(".item", { hasText: "Q3" }).click();
  await page.locator("#thread-in").fill("final note"); await page.locator("#stage-thread").click();
  await page.locator("#finish").click();
  check("inline confirm shown", await page.locator("#finish-yes").count() === 1);
  await page.locator("#finish-no").click();
  check("cancel keeps the finish button", await page.locator("#finish").count() === 1 && await page.locator("#finish-yes").count() === 0);
  await page.locator("#finish").click(); await page.locator("#finish-yes").click();
  const finEv = await sendNo(6);
  check("finish fires immediately, staged actions first, finish last", finEv.seq === 6 && finEv.actions.length === 2 && finEv.actions[0].type === "thread" && finEv.actions[0].text === "final note" && finEv.actions[1].type === "finish", JSON.stringify(finEv.actions));
  await page.waitForFunction(() => { const f = document.getElementById("finish"); return !!f && f.textContent.includes("Finishing…"); });
  check("finish button shows finishing; staging cleared", await page.locator("#finish").isDisabled() && await page.locator("#finish .spin").count() === 1 && (await page.locator("#send").textContent()) === "Send to Agent");

  // listener state: a stale owner heartbeat in meta.json flips the header (the hub merges owner into state)
  const metaFile = join(session, "meta.json");
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  atomic(metaFile, JSON.stringify({ ...meta, owner: { ...meta.owner, heartbeat: new Date(Date.now() - 10 * 60 * 1000).toISOString() } }));
  await page.waitForFunction(() => document.getElementById("listener").textContent.startsWith("no agent"), null, { timeout: 5000 }).catch(() => {});
  check("listener flips to 'no agent listening: Sends will queue' when the heartbeat is stale", (await page.locator("#listener").textContent()) === "no agent listening: Sends will queue" && await page.locator("#listener.off").count() === 1);
  atomic(metaFile, JSON.stringify({ ...meta, owner: { ...meta.owner, heartbeat: new Date().toISOString() } }));
  await page.waitForFunction(() => document.getElementById("listener").textContent.startsWith("agent listening"), null, { timeout: 5000 }).catch(() => {});
  check("listener flips back when the heartbeat is fresh again", (await page.locator("#listener").textContent()) === "agent listening (Claude)");

  // hub gone → banner; `ensure` restarts it on the same port → banner clears on the same URL
  const pid0 = hubInfo(home).pid;
  await stopHub(home);
  await waitUntil(() => !alive(pid0), 5000).catch(() => {});
  await page.waitForFunction(() => document.getElementById("banner").classList.contains("show"), null, { timeout: 8000 });
  check("hub-down banner", (await page.locator("#banner").textContent()) === "Hub down — reconnecting…");
  check("send disabled while gone", await page.locator("#send").isDisabled());
  check("status and favicon say the hub is down", (await page.locator("#agent-status").textContent()) === "hub down" && (await favicon()).status === "gone");
  const ens = JSON.parse(run(env, ["ensure"]));
  check("ensure restarts the hub on the same port", ens.port === port0 && ens.pid !== pid0, JSON.stringify(ens));
  await page.waitForFunction(() => !document.getElementById("banner").classList.contains("show"), null, { timeout: 12000 });
  check("banner clears when the hub is back, on the same URL", page.url() === url, page.url());
  await waitUntil(async () => (await clients()).count >= 1, 5000).catch(() => {});
  check("the new hub learns about the tab at once (presence on hello)", (await clients()).count === 1);

  // finished state
  s = fixture(); s.agent = { status: "waiting", since: new Date().toISOString(), handled: 6 };
  s.visual = { kind: "prototype", version: 2, at: new Date().toISOString(), note: "v2: narrower list", thread: [] };
  s.finished = { doc: "docs/e2e-design.md", visual: "docs/e2e-visual.html", at: new Date().toISOString() }; writeState(s);
  await page.waitForFunction(() => document.getElementById("banner").classList.contains("done"));
  check("finished banner names the doc and the visual", (await page.locator("#banner").textContent()).includes("docs/e2e-design.md") && (await page.locator("#banner").textContent()).includes("docs/e2e-visual.html"));
  check("favicon is the finished dot (--ink-3)", (await favicon()).status === "finished" && (await favicon()).href.includes(encodeURIComponent("#9a9285")));
  await page.locator("#visualize").click();
  check("finished: visual still viewable, composer and regenerate gone", await page.locator("body.visualize").count() === 1 && await page.locator("#feedback-in").count() === 0 && await page.locator("#regen").count() === 0);
  await page.locator("#visualize").click();
  check("staging locked when finished", await page.locator("#free").count() === 0 && await page.locator("#thread-in").count() === 0 && await page.locator("#finish").count() === 0);

  // layouts (D1): the header switch lists the built layouts; bare /s/<id>/ goes to the last-used one
  check("layout switch lists the built layouts, Inbox marked current", await page.locator("#layouts").isVisible() && (await page.locator("#layouts a").allTextContents()).join(",") === "Inbox,Studio" && (await page.locator("#layouts a[aria-current]").textContent()) === "Inbox");
  const p2 = await context.newPage();
  await page.evaluate(() => localStorage.setItem("grill:layout", "studio"));
  await p2.goto(url);
  await p2.waitForURL(/\/studio$/, { timeout: 5000 }).catch(() => {});
  check("bare URL redirects to the last-used built layout", p2.url() === url + "studio" && await p2.locator("#studio-stub").count() === 1, p2.url());
  await p2.goto(url + "inbox");
  await p2.locator(".item").first().waitFor();
  check("an explicit layout URL stays put and becomes the last-used layout", p2.url() === url + "inbox" && (await p2.evaluate(() => localStorage.getItem("grill:layout"))) === "inbox");
  await p2.goto(url); await p2.locator(".item").first().waitFor();
  check("bare URL stays on the Inbox when the Inbox was last used", p2.url() === url);
  await p2.evaluate(() => localStorage.setItem("grill:layout", "brief"));
  await p2.goto(url); await p2.locator(".item").first().waitFor();
  check("bare URL ignores a last-used layout that is not built", p2.url() === url);
  await p2.close();
  check("no request left 127.0.0.1 during the whole run", offHost().length === 0, offHost().join(" "));

  // The hub-down step above produces ERR_CONNECTION_REFUSED fetch failures by design.
  const real = errors.filter((e) => !e.includes("ERR_CONNECTION_REFUSED"));
  check("no console errors (besides the deliberate hub-down fetches)", real.length === 0, real.join(" | "));

  await page.locator("#layouts a", { hasText: "Studio" }).click();
  await page.waitForURL(/\/studio$/, { timeout: 5000 }).catch(() => {});
  check("the switch navigates and records the choice", page.url() === url + "studio" && (await page.evaluate(() => localStorage.getItem("grill:layout"))) === "studio");

  // ---- review fixes: escaping, two tabs on one session, sends, typing across renders, bfcache ----
  // A fresh session in its own browser profile. state.json is written directly (the hub serves it
  // as is), so an option key the patch validation would reject still reaches the page.
  const r2 = JSON.parse(run(env, ["new", "--topic", "Robust topic", "--doc", "docs/robust.md", "--agent", "claude"], { cwd: proj }));
  const rFile = join(r2.session, "state.json");
  const rBase = JSON.parse(readFileSync(rFile, "utf8"));
  const EVIL = "<img src=x onerror=window.__xss=1>";
  const rState = (handled, extra = {}) => ({
    ...rBase, agent: { status: "waiting", since: new Date().toISOString(), handled },
    questions: [
      { id: "q1", round: 1, deps: [], title: "Evil keys", body: "b", options: [{ k: EVIL, text: "evil" }, { k: "B", text: "b" }], rec: { option: "B", why: "w" }, status: "open", thread: [] },
      { id: "q2", round: 1, deps: [], title: "Second", body: "b", options: [{ k: "A", text: "a" }, { k: "B", text: "b" }], rec: { option: "A", why: "w" }, status: "open", thread: [] },
      { id: "q3", round: 1, deps: [], title: "Third", body: "b", options: [{ k: "A", text: "a" }, { k: "B", text: "b" }], rec: { option: "A", why: "w" }, status: "open", thread: [] },
    ],
    ...extra,
  });
  const writeR = (handled, extra) => atomic(rFile, JSON.stringify(rState(handled, extra), null, 2));
  writeR(0);
  const rEvents = () => { try { return readFileSync(join(r2.session, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const rSend = async (seq) => { try { await waitUntil(() => rEvents().some((e) => e.seq === seq), 6000); } catch { return { actions: [] }; } return rEvents().find((e) => e.seq === seq); };
  const rUrl = r2.url + "inbox";
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ta = await ctx3.newPage(), tb = await ctx3.newPage();
  let posts = 0;
  for (const p of [ta, tb]) p.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/send")) posts++; });
  const stagedIds = (p) => p.evaluate(() => Object.keys(window.Grill.local.staged).sort().join(","));
  const handleR = async (n) => { writeR(n); await ta.waitForFunction((k) => document.getElementById("agent-status").textContent.includes(`handled #${k}`), n, { timeout: 5000 }); };
  await ta.goto(rUrl); await ta.locator(".opt").first().waitFor();

  // 1. an option key is escaped everywhere, the footer's staged list included
  await ta.locator(".opt").first().click();
  await sleep(200);
  check("an option key with markup is shown as text in the footer, never run", !(await ta.evaluate(() => window.__xss === 1)) && await ta.locator("#staged-list img").count() === 0 && (await ta.locator("#staged-list").textContent()).includes("<img"));
  await ta.evaluate(() => window.Grill.clearStaged("q1"));

  // 2. two tabs on one session: each tab's staging survives the other's saves; a send in one tab
  //    drops the sent items in the other
  await tb.goto(rUrl); await tb.locator(".opt").first().waitFor();
  await ta.evaluate(() => window.Grill.select("q2")); await ta.locator(".opt[data-opt='A']").click();
  await tb.evaluate(() => window.Grill.select("q3")); await tb.locator(".opt[data-opt='B']").click();
  await tb.locator("#thread-in").fill("draft in tab B"); // a draft save must not drop tab A's q2
  await sleep(200);
  check("two tabs: tab B's staging and draft saves keep tab A's staging", (await stagedIds(ta)) === "q2,q3" && (await stagedIds(tb)) === "q2,q3", `${await stagedIds(ta)} | ${await stagedIds(tb)}`);
  await ta.reload(); await ta.locator(".opt").first().waitFor();
  check("two tabs: after a reload both tabs' staging is there", (await stagedIds(ta)) === "q2,q3" && (await ta.locator("#send").textContent()) === "Send 2 to Agent");
  await ta.locator("#send").click();
  const two = await rSend(1);
  check("two tabs: one Send ships both tabs' staging", two.actions.length === 2, JSON.stringify(two.actions));
  let dropped = false; try { await waitUntil(async () => (await stagedIds(tb)) === "" && (await tb.locator("#staged-list").textContent()).includes("Sent #1"), 3000); dropped = true; } catch {}
  check("two tabs: the other tab drops the sent items and shows the send as pending", dropped, `${await stagedIds(tb)} | ${await tb.locator("#staged-list").textContent()}`);
  await tb.reload(); await tb.locator(".opt").first().waitFor(); await tb.evaluate(() => window.Grill.select("q3"));
  check("two tabs: sent items are not resurrected by the other tab's later saves", (await stagedIds(tb)) === "" && (await tb.locator("#thread-in").inputValue()) === "draft in tab B");
  await handleR(1);

  // 4. a double submit sends once, and Send shows disabled at once
  await ta.evaluate(() => window.Grill.select("q2")); await ta.locator(".opt[data-opt='B']").click();
  posts = 0;
  const disabledAtOnce = await ta.evaluate(() => { window.Grill.send(); const d = document.getElementById("send").disabled; window.Grill.send(); return d; });
  await rSend(2); await sleep(500);
  check("two rapid sends make one POST", posts === 1 && rEvents().length === 2, `${posts} POSTs`);
  check("Send is disabled as soon as the POST starts", disabledAtOnce);
  await handleR(2);

  // 5. staging made while a send is in flight is kept; only what was sent is dropped
  await ta.route("**/send", async (r) => { await sleep(800); await r.continue(); });
  await ta.evaluate(() => window.Grill.select("q2")); await ta.locator(".opt[data-opt='A']").click();
  await ta.evaluate(() => { window.__sendP = window.Grill.send(); });
  await sleep(200);
  await ta.evaluate(() => { window.Grill.stageAnswer("q3", { kind: "option", option: "B" }); window.Grill.stageThread("q2", "said while sending"); });
  await ta.evaluate(() => window.__sendP);
  const mid = await rSend(3);
  const kept = await ta.evaluate(() => window.Grill.local.staged);
  check("a send in flight ships only what was staged when it started", mid.actions.length === 1 && mid.actions[0].q === "q2" && mid.actions[0].option === "A", JSON.stringify(mid.actions));
  check("staging made during the send is kept after it lands", kept.q3?.answer?.option === "B" && !kept.q2?.answer && kept.q2?.thread?.[0] === "said while sending", JSON.stringify(kept));
  await ta.unroute("**/send");
  await ta.evaluate(() => { window.Grill.clearStaged("q3"); window.Grill.removeThread("q2", 0); });
  await handleR(3);

  // 3. a failed send says so until the next successful send or staging change
  await ta.route("**/send", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "session token required" }) }));
  await ta.evaluate(() => window.Grill.select("q2")); await ta.locator(".opt[data-opt='A']").click();
  await ta.locator("#send").click();
  await sleep(1600); // the 1 s tick re-renders the send area
  check("a 401 send failure stays on screen across ticks", (await ta.locator("#send-why").textContent()) === "Send failed: session token required", await ta.locator("#send-why").textContent());
  await ta.unroute("**/send");
  await ta.route("**/send", (r) => r.fulfill({ status: 500, body: "boom" }));
  await ta.locator("#send").click();
  await sleep(1300);
  check("a 500 send failure stays on screen too", (await ta.locator("#send-why").textContent()) === "Send failed: 500", await ta.locator("#send-why").textContent());
  await ta.locator(".opt[data-opt='B']").click();
  check("a staging change clears the failure", (await ta.locator("#send-why").textContent()) === "");
  await ta.unroute("**/send");
  await ta.locator("#send").click();
  await rSend(4);
  await ta.waitForFunction(() => document.getElementById("staged-list").textContent.includes("Sent #4"), null, { timeout: 5000 }).catch(() => {});
  check("the send goes through once the hub accepts it", (await ta.locator("#send-why").textContent()) === "" && (await ta.locator("#staged-list").textContent()).includes("Sent #4"), `${await ta.locator("#send-why").textContent()} | ${await ta.locator("#staged-list").textContent()} | ${JSON.stringify(rEvents().map((e) => e.seq))}`);
  await handleR(4);

  // 10. a render does not rebuild the textarea being typed in (IME composition, undo, caret)
  await ta.evaluate(() => window.Grill.select("q3"));
  await ta.locator("#thread-in").fill(""); await ta.keyboard.type("half a thought");
  await ta.evaluate(() => { window.__ta = document.getElementById("thread-in"); });
  writeR(4, { topic: "Robust topic 2" });
  await ta.waitForFunction(() => document.getElementById("topic").textContent === "Robust topic 2", null, { timeout: 5000 });
  check("a state patch keeps the discussion textarea being typed in (same element, focus, value)", await ta.evaluate(() => document.getElementById("thread-in") === window.__ta && document.activeElement === window.__ta && window.__ta.value === "half a thought"), await ta.evaluate(() => JSON.stringify([document.getElementById("thread-in") === window.__ta, document.activeElement && (document.activeElement.id || document.activeElement.tagName), window.__ta.value, window.__ta.isConnected])));
  await ta.locator("#free").fill(""); await ta.keyboard.type("free words");
  await ta.evaluate(() => { window.__fr = document.getElementById("free"); });
  writeR(4, { topic: "Robust topic 3" });
  await ta.waitForFunction(() => document.getElementById("topic").textContent === "Robust topic 3", null, { timeout: 5000 });
  check("…and the free-text answer the same way", await ta.evaluate(() => document.getElementById("free") === window.__fr && document.activeElement === window.__fr && window.__fr.value === "free words"));
  await ta.locator("#stage-thread").click();
  check("staging the kept textarea's text still empties it", (await ta.locator("#thread-in").inputValue()) === "" && await ta.locator("aside .msg.staged").count() === 1);
  await ta.evaluate(() => window.Grill.select("q2"));
  check("another question gets its own (empty) composer", (await ta.locator("#thread-in").inputValue()) === "");

  // 9. back from the bfcache: the page refetches state
  let fetched = 0; ta.on("request", (r) => { if (r.url().endsWith("/state")) fetched++; });
  await ta.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  try { await waitUntil(() => fetched > 0, 3000); } catch {}
  check("pageshow from the bfcache refetches the state", fetched > 0);
  await ctx3.close();
} catch (e) {
  check("run finished without an exception", false, String(e && e.stack || e));
} finally {
  await browser.close();
  await cleanupHub(home);
}
const failed = results.filter((r) => !r.ok);
console.log(`page e2e: ${results.length - failed.length}/${results.length} checks passed${failed.length ? " — FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
