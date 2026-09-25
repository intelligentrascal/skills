// End-to-end check of the keyboard layer (plan T19; spec §7 Keyboard shortcuts, §10 E2E keyboard)
// and the visual linkage (plan T20; spec §7 Visual linkage, §10 "⌘↵ forwarded from the visual")
// on the Inbox, against a real hub. Needs Playwright:
//   PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/keyboard.e2e.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's bundled Chromium.
import { readFileSync, writeFileSync, renameSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkHome, run, tmp, cleanupHub, waitUntil, sleep } from "./helpers.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, "..", "page");

// The shipped page files, plus a stub Studio so `g s` has a second built layout to go to.
const pageDir = tmp("grill-kb-page-");
for (const f of ["inbox.html", "core.js", "tokens.css", "map-view.js"]) { try { symlinkSync(join(PAGE, f), join(pageDir, f)); } catch {} }
writeFileSync(join(pageDir, "studio.html"), `<!doctype html><meta charset="utf-8"><title>studio stub</title><!--GRILL_BOOT--><p id="studio-stub">studio stub</p>`);
const { home, env } = mkHome({ GRILL_PAGE_DIR: pageDir });
const proj = tmp("grill-kb-proj-");

const created = JSON.parse(run(env, ["new", "--topic", "Keys topic", "--doc", "docs/keys.md", "--agent", "claude"], { cwd: proj }));
const { session, url, id } = created;
const stateFile = join(session, "state.json");
const base = JSON.parse(readFileSync(stateFile, "utf8"));
const now = new Date().toISOString();
const MAP_KEY = "keys-proj-0123abcd/7";
const st = {
  ...base,
  mapKey: MAP_KEY,
  agent: { status: "waiting", since: now, handled: 0 },
  questions: [
    { id: "q1", round: 1, deps: [], title: "Answered one", body: "Done.", options: [{ k: "A", text: "First" }, { k: "B", text: "Second" }], rec: { option: "A", why: "Because." }, status: "answered", durable: false, updated: false, answer: { kind: "option", option: "B" }, thread: [] },
    { id: "q2", round: 2, deps: ["q1"], title: "Deferred one", body: "Parked.", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "Sure." }, status: "deferred", durable: false, updated: false, thread: [] },
    { id: "q3", round: 3, deps: ["q1"], title: "Open with three", body: "Pick one.", options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }, { k: "C", text: "Gamma" }], rec: { option: "B", why: "Beta." }, status: "open", durable: false, updated: false, thread: [] },
    { id: "q4", round: 3, deps: [], title: "Free text", body: "No options.", options: [], rec: { text: "Short", why: "Simple." }, status: "open", durable: false, updated: false, thread: [] },
  ],
};
const atomic = (file, text) => { writeFileSync(file + ".e2e-tmp", text); renameSync(file + ".e2e-tmp", file); };
const writeState = () => atomic(stateFile, JSON.stringify(st, null, 2));
writeState();
const events = () => { try { return readFileSync(join(session, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
async function sendNo(seq, ms = 6000) {
  try { await waitUntil(() => events().some((e) => e.seq === seq), ms); } catch { return { actions: [] }; }
  return events().find((e) => e.seq === seq);
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); if (!ok) console.log("FAIL", name, extra); };
const sel = async () => (await page.locator(".item.selected .id").textContent()) || "";
const staged = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)).staged; } catch { return {}; } }, `grill:${id}`);
const active = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : ""; });
const press = async (k) => { await page.keyboard.press(k); await sleep(30); };
// Let the agent "handle" everything sent so far, so Send is enabled again.
async function handleAll() {
  const last = events().reduce((m, e) => Math.max(m, e.seq || 0), 0);
  st.agent = { status: "waiting", since: new Date().toISOString(), handled: last }; writeState();
  await page.waitForFunction((n) => document.getElementById("agent-status").textContent.includes(`handled #${n}`), last, { timeout: 5000 });
}

try {
  await page.goto(url);
  await page.locator(".item").first().waitFor();
  await page.locator("h1").click(); // focus on the page, not in a field
  check("the toast's live region exists (empty, role=status) before the first toast", await page.evaluate(() => { const t = document.getElementById("grill-toast"); return !!t && t.getAttribute("role") === "status" && t.getAttribute("aria-live") === "polite" && t.textContent === "" && !t.classList.contains("show"); }));

  // j / k
  check("starts on the first open question", (await sel()) === "Q3");
  await press("j"); check("j → next question", (await sel()) === "Q4");
  await press("k"); await press("k"); check("k → previous question (twice)", (await sel()) === "Q2");
  await press("j");

  // 1–4 only map to options that exist
  await press("1");
  check("1 stages option A", (await staged()).q3?.answer?.option === "A" && (await staged()).q3.answer.kind === "option" && await page.locator(".opt.staged[data-opt='A']").count() === 1);
  await press("2");
  check("2 on the recommended option stages it as an accept", (await staged()).q3?.answer?.option === "B" && (await staged()).q3.answer.kind === "accept");
  await press("4");
  check("4 with three options does nothing", (await staged()).q3?.answer?.option === "B");
  await page.locator(".item", { hasText: "Q1" }).click(); await page.locator("h1").click();
  await press("3");
  check("3 on a question with two options does nothing", !(await staged()).q1);
  // o / d
  await press("o");
  check("o stages reopen on an answered question", (await staged()).q1?.reopen === true && (await page.locator(".staged-line").textContent()).includes("reopen"));
  await press("u");
  check("u unstages this question", !(await staged()).q1 && await page.locator(".staged-line").count() === 0);
  await press("d");
  check("d does nothing on a question that is not open", !(await staged()).q1);
  await page.locator(".item", { hasText: "Q3" }).click(); await page.locator("h1").click();
  await press("u");
  check("u clears the staged answer on Q3", !(await staged()).q3);
  await press("a");
  check("a stages accept of the recommendation", (await staged()).q3?.answer?.kind === "accept" && (await staged()).q3.answer.option === "B");
  await press("d");
  check("d stages defer (replacing the answer)", (await staged()).q3?.defer === true && !(await staged()).q3.answer);
  await press("d");
  check("d again unstages the defer", !(await staged()).q3);
  await page.locator(".item", { hasText: "Q4" }).click(); await page.locator("h1").click();
  await press("a");
  check("a does nothing without a recommended option", !(await staged()).q4);
  await press("e");
  check("e does nothing on a question without options", await page.locator("#grill-toast.show").count() === 0);
  await page.locator(".item", { hasText: "Q3" }).click(); await page.locator("h1").click();

  // r / f focus fields synchronously; keys typed there are text; Esc leaves the field
  await press("r");
  check("r focuses this question's thread composer", (await active()) === "thread-in");
  await page.keyboard.type("jk1a");
  check("j/k/1/a typed in the thread textarea are text, not shortcuts", (await page.locator("#thread-in").inputValue()) === "jk1a" && (await sel()) === "Q3" && !(await staged()).q3);
  await press("Escape");
  check("Esc leaves the text field", (await active()) !== "thread-in");
  await press("f");
  check("f focuses the free-text answer, and the f is not typed", (await active()) === "free" && (await page.locator("#free").inputValue()) === "");
  await press("Escape");
  await page.locator("#thread-in").fill("");
  await page.locator("h1").click();

  // IME composition and modifier keys are ignored
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", isComposing: true, bubbles: true })));
  check("keydown during IME composition is ignored", (await sel()) === "Q3");
  await press("Alt+j"); await press("Control+j");
  check("Alt/Ctrl + key is left to the browser", (await sel()) === "Q3");

  // e: toast with Undo, 3 s, then the explore send
  await press("e");
  check("e shows the undo toast (role=status)", await page.locator("#grill-toast.show[role='status']").count() === 1 && (await page.locator("#grill-toast").textContent()).includes("Exploring Q3…") && await page.locator("#grill-toast button", { hasText: "Undo" }).count() === 1);
  await press("u");
  check("u undoes the explore", await page.locator("#grill-toast.show").count() === 0);
  await press("e");
  await page.locator("#grill-toast button").click();
  check("clicking Undo undoes the explore", await page.locator("#grill-toast.show").count() === 0);
  await sleep(3500);
  check("an undone explore never sends", events().length === 0, JSON.stringify(events()));
  await press("e");
  const ex = await sendNo(1, 6000);
  check("after 3 s, e sends explore as its own event", ex.seq === 1 && JSON.stringify(ex.actions) === JSON.stringify([{ q: "q3", type: "explore" }]), JSON.stringify(ex.actions));
  await page.waitForFunction(() => !document.querySelector("#grill-toast.show"), null, { timeout: 3000 }).catch(() => {});
  check("the toast is gone once the explore is sent", await page.locator("#grill-toast.show").count() === 0);
  await handleAll();

  // ⌘↵ / Ctrl↵ send from a textarea
  await press("a");
  await page.locator("#thread-in").click();
  await page.keyboard.type("typed then sent");
  await press("Control+Enter");
  const s2 = await sendNo(2);
  check("Ctrl↵ from the thread textarea sends the staged answer", s2.seq === 2 && s2.actions.some((a) => a.type === "answer" && a.option === "B"), JSON.stringify(s2.actions));
  await handleAll();
  await page.locator("h1").click();
  await press("2");
  await page.locator("#free").click();
  await press("Meta+Enter");
  const s3 = await sendNo(3);
  check("⌘↵ from the free-text field sends", s3.seq === 3 && s3.actions.some((a) => a.type === "answer" && a.option === "B"), JSON.stringify(s3.actions));
  await handleAll();
  await page.locator("h1").click();

  // v: Visualize when there is no visual, then toggles
  await press("v");
  const s4 = await sendNo(4);
  check("v with no visual sends visualize", s4.seq === 4 && JSON.stringify(s4.actions) === JSON.stringify([{ type: "visualize" }]), JSON.stringify(s4.actions));
  writeFileSync(join(session, "visual.html"), "<!doctype html><title>v</title><h1>Visual</h1>");
  st.visual = { kind: "prototype", version: 1, at: new Date().toISOString(), note: "v1", thread: [], stale: false };
  await handleAll();
  await page.waitForFunction(() => document.body.classList.contains("visualize"), null, { timeout: 5000 });
  await page.locator("h1").click();
  await press("v");
  check("v toggles back to the questions", await page.locator("body.visualize").count() === 0);
  await press("v");
  check("v toggles to the visual", await page.locator("body.visualize").count() === 1);
  await press("v");

  // Esc closes the terms panel
  await page.locator("#terms-toggle").click();
  await press("Escape");
  check("Esc closes the terms panel", await page.locator("#terms.show").count() === 0);

  // ? cheatsheet: dialog, focus moves in and returns, Esc closes
  await page.locator("#terms-toggle").focus();
  await press("Shift+?");
  check("? opens the cheatsheet (role=dialog)", await page.locator("#grill-keys[role='dialog'][aria-modal='true']").isVisible() && (await page.locator("#grill-keys").textContent()).includes("Explore deeper"));
  check("focus moves into the cheatsheet", await page.evaluate(() => document.getElementById("grill-keys").contains(document.activeElement)));
  await press("j");
  check("shortcuts do not fire behind the open cheatsheet", (await sel()) === "Q3");
  await press("Escape");
  check("Esc closes the cheatsheet", await page.locator("#grill-keys").isHidden());
  check("focus returns to where it was", (await active()) === "terms-toggle");
  await page.locator("#keys-help").click();
  check("the footer's ⌘↩ hint opens the cheatsheet too", await page.locator("#grill-keys").isVisible());
  await page.mouse.click(5, 5);
  check("clicking outside closes it", await page.locator("#grill-keys").isHidden());
  check("the cheatsheet lists only built layouts for g", (await page.locator("#grill-keys").textContent()).includes("Inbox / Studio / Map board"));

  // g then i/b/s/m
  await page.locator("h1").click();
  await press("g"); await press("b");
  await sleep(300);
  check("g b does nothing when Brief is not built", page.url() === url);
  await press("g"); await sleep(1100); await press("s");
  await sleep(300);
  check("g, then s after more than 1 s, does nothing", page.url() === url);
  await press("g"); await press("s");
  await page.waitForURL(/\/studio$/, { timeout: 5000 }).catch(() => {});
  check("g s goes to the built Studio layout", page.url() === url + "studio");
  await page.goto(url + "inbox"); await page.locator(".item").first().waitFor(); await page.locator("h1").click();
  await press("g"); await press("m");
  await page.waitForURL(/\/m\//, { timeout: 5000 }).catch(() => {});
  check("g m goes to the map board when the session has a mapKey", new URL(page.url()).pathname === `/m/${MAP_KEY}/`, page.url());
  await page.goto(url); await page.locator(".item").first().waitFor(); await page.locator("h1").click();

  // the off switch: persists across reload, leaves only ⌘↵ and Esc
  await press("Shift+?");
  await page.locator("#grill-keys-off").check();
  check("the off switch is stored in localStorage grill:keys", (await page.evaluate(() => localStorage.getItem("grill:keys"))) === "off");
  await press("Escape");
  await page.reload(); await page.locator(".item").first().waitFor(); await page.locator("h1").click();
  const before = await sel();
  await press("j"); await press("Shift+?");
  check("with shortcuts off (after reload), j and ? do nothing", (await sel()) === before && await page.locator("#grill-keys.keys-sheet:not([hidden])").count() === 0);
  await page.locator(".opt[data-opt='A']").click();
  await page.locator("h1").click();
  await press("Control+Enter");
  const s5 = await sendNo(5);
  check("with shortcuts off, Ctrl↵ still sends", s5.seq === 5, JSON.stringify(s5));
  await handleAll();
  await page.locator("#keys-help").click();
  check("the cheatsheet shows the switch on", await page.locator("#grill-keys-off").isChecked());
  await page.locator("#grill-keys-off").uncheck();
  await press("Escape");
  check("Esc still works with the switch focused, and turning it back on clears the key", await page.locator("#grill-keys").isHidden() && (await page.evaluate(() => localStorage.getItem("grill:keys"))) === null);
  await page.locator("h1").click();
  await press("j");
  check("shortcuts work again", (await sel()) !== before);

  // ---- visual linkage (plan T20): the fixture visual carries visual-brief.md's listener verbatim ----
  const brief = readFileSync(join(here, "..", "visual-brief.md"), "utf8");
  const listener = brief.slice(brief.indexOf("<script>\n/* grilling-ui linkage"), brief.indexOf("</script>", brief.indexOf("/* grilling-ui linkage")) + "</script>".length);
  check("visual-brief.md carries the linkage listener", listener.startsWith("<script>") && listener.includes("grill-hl") && listener.includes('key: "send"'));
  writeFileSync(join(session, "visual.html"), `<!doctype html><title>linked</title><body style="font:16px sans-serif">
<h1 id="vh">Linked visual</h1>
<div id="r2" data-q="q2" style="padding:20px;margin:10px;border:1px dashed #999">Region two (assumed · Q2 open)</div>
<div id="r3" data-q="q3" style="padding:20px;margin:10px;border:1px solid #999">Region three</div>
${listener}
</body>`);
  st.visual = { kind: "prototype", version: 2, at: new Date().toISOString(), note: "v2 linked", thread: [], stale: false };
  writeState();
  await page.waitForFunction(() => (document.getElementById("visual-frame").getAttribute("src") || "").includes("v=2"), null, { timeout: 5000 });
  if (!(await page.locator("body.visualize").count())) { await page.locator("h1").click(); await press("v"); }
  const fr = page.frameLocator("#visual-frame");
  await fr.locator("#r3").waitFor();
  const hl = (rid) => fr.locator(rid).evaluate((el) => el.classList.contains("grill-hl"));
  const hlSoon = async (rid, want) => { try { await waitUntil(async () => (await hl(rid)) === want, 2000); return true; } catch { return false; } };
  check("the list stays visible beside the visual", await page.locator("nav").isVisible() && await page.locator("body.visualize").count() === 1);
  await page.locator(".item", { hasText: "Q2" }).hover();
  check("hovering Q2 in the list outlines its region (grill-hl)", await hlSoon("#r2", true) && !(await hl("#r3")));
  await page.locator("header h1").hover();
  const selNow = (await sel()).toLowerCase();
  check("leaving the list outlines the selected question's region again", await hlSoon("#r2", selNow === "q2") && await hlSoon("#r3", selNow === "q3"));
  await page.locator(".item", { hasText: "Q1" }).click();
  await fr.locator("#r3").click();
  check("clicking region q3 in the visual selects Q3", await (async () => { try { await waitUntil(async () => (await sel()) === "Q3", 2000); return true; } catch { return false; } })());
  check("the selected question's region is outlined", await hlSoon("#r3", true) && !(await hl("#r2")));
  await page.evaluate(() => window.postMessage({ clicked: "q2" }, "*"));
  await sleep(200);
  check("a message that does not come from the visual frame is ignored", (await sel()) === "Q3");
  await page.locator("h1").click();
  await press("1");
  check("staged an option from the visual view", (await staged()).q3?.answer?.option === "A");
  await fr.locator("#vh").click();
  check("focus is inside the visual", (await active()) === "visual-frame" || (await active()) === "IFRAME");
  const nSends = events().length;
  await press("Meta+Enter");
  const sv = await sendNo(nSends + 1);
  check("⌘↵ pressed inside the visual sends the staged actions", sv.seq === nSends + 1 && sv.actions.some((a) => a.q === "q3" && a.type === "answer" && a.option === "A"), JSON.stringify(sv.actions));
  await handleAll();
  await fr.locator("#vh").click();
  await press("Escape");
  check("Esc inside the visual returns focus to the page", !["visual-frame", "IFRAME"].includes(await active()), await active());
  await press("v");
  check("…so shortcuts work again at once (v back to the questions)", await page.locator("body.visualize").count() === 0);
  await page.locator(".item", { hasText: "Q2" }).hover();
  await page.locator(".card").hover();
  check("hovering the card outlines the card's question (Q3)", await hlSoon("#r3", true) && !(await hl("#r2")));

  // ---- review fixes ----
  await page.locator("h1").click();
  if (await page.locator("body.visualize").count()) await press("v");
  await page.evaluate(() => window.Grill.select("q3")); await page.locator("h1").click();
  if ((await staged()).q3) await press("u");
  // g then a key that is not a destination: the key acts as it would have
  await press("g"); await press("j");
  check("g then j: the j is not swallowed", (await sel()) === "Q4");
  await press("k");
  // ⌘↵ auto-repeat does not send again
  await press("1");
  let n0 = events().length;
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, repeat: true, bubbles: true, cancelable: true })));
  await sleep(600);
  check("an auto-repeated Ctrl↵ does not send", events().length === n0);
  await press("u");

  // e twice: one explore waits at a time
  n0 = events().length;
  await press("e"); await sleep(300); await press("e");
  check("a second e keeps one toast", await page.locator("#grill-toast.show").count() === 1 && (await page.locator("#grill-toast").textContent()).includes("Exploring Q3…"));
  await sleep(3800);
  const exs = events().slice(n0);
  check("pressing e twice sends one explore", exs.length === 1 && exs[0].actions[0].type === "explore", JSON.stringify(exs.map((e) => e.actions)));
  await handleAll();
  // the gate is checked again when the timer fires
  n0 = events().length;
  await press("e");
  st.agent = { status: "working", since: new Date().toISOString(), handled: n0 }; writeState();
  await page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("Agent working"), null, { timeout: 5000 });
  await sleep(3300);
  check("an explore whose gate closed during the undo window is not sent, and says so", events().length === n0 && (await page.locator("#grill-toast").textContent()).includes("was not sent"), await page.locator("#grill-toast").textContent());
  await handleAll();

  // a visual that posts {key:"send"} / {key:"escape"} by itself (not while focused) does nothing
  await press("1");
  n0 = events().length;
  writeFileSync(join(session, "visual.html"), `<!doctype html><title>pushy</title><h1 id="vh">Pushy visual</h1><script>
const go = () => { parent.postMessage({ key: "send" }, "*"); parent.postMessage({ key: "escape" }, "*"); };
go(); setTimeout(go, 300); setTimeout(go, 700);
</script>`);
  st.visual = { kind: "prototype", version: 3, at: new Date().toISOString(), note: "v3 pushy", thread: [], stale: false }; writeState();
  await page.waitForFunction(() => (document.getElementById("visual-frame").getAttribute("src") || "").includes("v=3"), null, { timeout: 5000 });
  if (!(await page.locator("body.visualize").count())) { await page.locator("h1").click(); await press("v"); }
  await page.frameLocator("#visual-frame").locator("#vh").waitFor();
  await sleep(1200);
  check("a visual cannot send by posting {key:'send'} while it does not have focus", events().length === n0, JSON.stringify(events().slice(n0).map((e) => e.actions)));
  await page.locator("h1").click(); await press("v");
  await press("u");

  // options are keyboard radios: Tab-reachable, Enter/Space stage, focus survives the render
  const opt = (k) => page.locator(`.opt[data-opt='${k}']`);
  check("options are radios in a radiogroup, reachable with Tab", (await opt("A").getAttribute("role")) === "radio" && (await opt("A").getAttribute("tabindex")) === "0" && (await page.locator(".opts").getAttribute("role")) === "radiogroup");
  await opt("A").focus();
  await press("Enter");
  const focusedOpt = () => page.evaluate(() => { const a = document.activeElement; return a && a.classList.contains("opt") ? a.dataset.opt : a ? a.id || a.tagName : ""; });
  check("Enter on a focused option stages it, and focus stays on it after the render", (await staged()).q3?.answer?.option === "A" && (await focusedOpt()) === "A" && (await opt("A").getAttribute("aria-checked")) === "true");
  await page.keyboard.press("Tab"); await sleep(30);
  await press(" ");
  check("Tab then Space stages the next option", (await staged()).q3?.answer?.option === "B" && (await focusedOpt()) === "B");
  check("keyboard focus shows a ring", await page.evaluate(() => { const a = document.activeElement; return a.matches(":focus-visible") && getComputedStyle(a).outlineStyle === "solid"; }));
  st.note = "A note that re-renders the page."; writeState();
  await page.waitForFunction(() => !!document.querySelector("nav .note"), null, { timeout: 5000 });
  check("focus on an option survives a state patch's render", (await focusedOpt()) === "B");
  await opt("A").click();
  check("a mouse click shows no focus ring (Jason's look)", await page.evaluate(() => { const a = document.activeElement; return !!a && a.dataset.opt === "A" && !a.matches(":focus-visible") && getComputedStyle(a).outlineStyle === "none"; }));
  await page.locator("h1").click(); await press("u");

  // Dogfood regression: 8 questions over rounds 1–3 at 796×726; from Q8, `a` then `k` ×4 then `2`,
  // each pressed without a pause, must stage accept on Q8 and option B on Q4. Run with focus parked
  // on "Add to discussion" (where the dogfood had it: it follows from question to question) and
  // with the pointer resting on the list, whose rows are rebuilt under it on every key.
  await handleAll();
  const O2 = [{ k: "A", text: "Local time" }, { k: "B", text: "UTC" }];
  const O3 = [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }, { k: "C", text: "Gamma" }];
  const q8 = (qid, round, status, extra = {}) => ({ id: qid, round, deps: [], title: `Question ${qid}`, body: "Pick one.", options: qid === "q4" || qid === "q8" ? O2 : O3, rec: { option: "A", why: "Simplest." }, status, durable: false, updated: false, thread: [], ...extra });
  delete st.visual; delete st.note;
  st.questions = [
    q8("q1", 1, "answered", { answer: { kind: "accept", option: "A" } }), q8("q2", 1, "answered", { answer: { kind: "option", option: "B" } }),
    q8("q3", 2, "answered", { answer: { kind: "accept", option: "A" } }),
    q8("q4", 3, "open", { thread: [{ who: "user", text: "Do we need UTC?", at: now }, { who: "agent", text: "Probably not.", at: now }] }),
    q8("q5", 3, "open"), q8("q6", 3, "open"), q8("q7", 3, "open"), q8("q8", 3, "open"),
  ];
  writeState();
  await page.setViewportSize({ width: 796, height: 726 });
  await page.waitForFunction(() => document.querySelectorAll("nav .item").length === 8, null, { timeout: 5000 });
  for (const variant of ["focus on Add to discussion", "pointer resting on the list"]) {
    await page.evaluate((k) => localStorage.removeItem(k), `grill:${id}`);
    await page.reload(); await page.locator(".item").first().waitFor();
    await page.locator(".item", { hasText: "Q8" }).click();
    if (variant.startsWith("focus")) { await page.locator("#stage-thread").focus(); await page.keyboard.press("Escape"); }
    else { const b = await page.locator("nav").boundingBox(); await page.mouse.move(b.x + 60, b.y + b.height / 2); }
    await page.keyboard.press("a");
    for (let i = 0; i < 4; i++) await page.keyboard.press("k");
    await page.keyboard.press("2");
    const s8 = await staged();
    check(`Q8: a, k ×4, 2 without pauses stages accept on Q8 and B on Q4 (${variant})`, (await sel()) === "Q4" && s8.q8?.answer?.kind === "accept" && s8.q4?.answer?.option === "B"
      && (await page.locator("#staged-list").textContent()).startsWith("2 staged") && await page.locator('.opt.staged[data-opt="B"]').count() === 1, `${await sel()} ${JSON.stringify(s8)}`);
  }

  const real = errors.filter((e) => !e.includes("404"));
  check("no console errors", real.length === 0, real.join(" | "));
} catch (e) {
  check("run finished without an exception", false, String(e && e.stack || e));
} finally {
  await browser.close();
  await cleanupHub(home);
}
const failed = results.filter((r) => !r.ok);
console.log(`keyboard e2e: ${results.length - failed.length}/${results.length} checks passed${failed.length ? " — FAILED: " + failed.map((f) => f.name).join("; ") : ""}`);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
