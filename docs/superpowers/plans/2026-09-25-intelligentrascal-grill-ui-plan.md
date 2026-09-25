# intelligentrascal grill UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `intelligentrascal` Claude Code plugin: browser-UI versions of Pocock's `grill-me`, `grill-with-docs` and `wayfinder` (`grill-me-ui`, `grill-docs-ui`, `wayfinder-ui`) on one shared, zero-dependency Node hub, with a live Wayfinder ticket board, working in Claude Code, Codex, OpenCode and Pi.

**Architecture:** One per-user hub process (`skills/grilling-ui/hub.mjs serve`, double-forked, HTTP + one hub-wide SSE stream) serves every grill (`/s/<id>/`) and board (`/m/<projectKey>/<slug>/`) from files under `GRILL_HOME` (`~/.intelligentrascal/`). The agent writes state only through `hub.mjs patch` / `map-patch`; the page writes only sends/actions (hub appends to `events.jsonl`); the agent listens with `watch` (Claude Code Monitor) or `wait` (other agents). Three page layouts (Inbox, Brief, Studio) share `core.js` + `tokens.css`. The engine skill `grilling-ui` loads last and overrides Pocock's `grilling` output/wait rules.

**Tech Stack:** Node 20+ (ESM, `node:http`, `node:fs`, `node:test`), zero npm dependencies, no build step; vanilla HTML/CSS/JS pages (system fonts, no network); Playwright only for opt-in e2e (`PLAYWRIGHT_PKG`); bash for install/sync scripts.

**Source of truth:** `docs/superpowers/specs/2026-09-25-intelligentrascal-grill-ui-design.md` (cited below as `spec §N`). Every task names the spec sections it implements.

---

## Sources (read before porting)

Paths below are abbreviated. The scratchpad is session-scoped; if a path is gone, re-create it with the fallback command.

| Alias | Path | Fallback |
|---|---|---|
| `$JASON` | `/private/tmp/claude-501/-Users-rahil-code-skills/c42446c8-6414-4d2e-ad03-e25f9cb2e308/scratchpad/grill-with-ui` (commit `daafa1e`) | `git clone https://github.com/jasonku09/grill-with-ui /tmp/grill-with-ui && git -C /tmp/grill-with-ui checkout daafa1e` |
| `$POCOCK` | `/private/tmp/claude-501/-Users-rahil-code-skills/c42446c8-6414-4d2e-ad03-e25f9cb2e308/scratchpad/pocock-skills` (HEAD `c55ee46`) | `git clone https://github.com/mattpocock/skills /tmp/pocock-skills` |
| `$POCOCK_PIN` | `~/.claude/plugins/cache/mattpocock/mattpocock-skills/1.2.3` (installed; commit `3cca18b368ae95cdbdebbff572ccafa662551015`, also checked out in `~/.claude/plugins/marketplaces/mattpocock`) | `claude plugin install mattpocock-skills@mattpocock` |
| `$RESEARCH` | `/private/tmp/claude-501/-Users-rahil-code-skills/c42446c8-6414-4d2e-ad03-e25f9cb2e308/scratchpad/research` (`openai-codex`, `sst-opencode`, `badlogic-pi-mono`, `vercel-labs-skills`) | clone `openai/codex`, `sst/opencode`, `badlogic/pi-mono`, `vercel-labs/skills` |
| `$TASTE` | `~/.claude/plugins/cache/codeswithroh/tastemaker/a8136a09cf3b/skills/tastemaker/references/prototype-variants.md` | n/a (guidance only) |

Key port map (Jason → ours):

| Jason | Lines | Goes to |
|---|---|---|
| `server.mjs` parseArgs/print/die/writeJson | 31–49 | `lib/util.mjs` |
| `server.mjs` projectRoot/stamp | 58–69 | `lib/home.mjs` |
| `server.mjs` readEvents/lastSeq/readState/isOpen | 89–103 | `lib/events.mjs` |
| `server.mjs` sessions/pending | 105–133 | `lib/sessions.mjs` |
| `server.mjs` Origin check, send append | 166–180 | `lib/server.mjs` |
| `server.mjs` wait | 205–222 | `lib/events.mjs` |
| `server.mjs` patch/merge/stamp/validate | 245–483 | `lib/state.mjs` |
| `page.html` CSS tokens | 8–13 | `page/tokens.css` |
| `page.html` layout CSS | 14–205 | `page/inbox.html` (`<style>`) |
| `page.html` data/staging/send | 231–377 | `page/core.js` |
| `page.html` render wrapper, banner, header, status, footer, send | 378–433, 456–466, 591–628 | `page/core.js` |
| `page.html` nav/main/visual/aside/feedback renders | 435–455, 467–590 | `page/inbox.html` (inline script) |
| `SKILL.md` patch, send handling, visualize, finish, wait mode | 37–99, 132–386 | `skills/grilling-ui/SKILL.md` |
| `SKILL.md` schema | 388–428 | `skills/grilling-ui/SKILL.md` (extended) |
| `visual-brief.md` | 1–68 | `skills/grilling-ui/visual-brief.md` (+ data-q) |
| `test/server.test.mjs` | 291–612 (patch) , 102–118 (Origin), 120–157 (wait) | `test/state.test.mjs`, `test/server.test.mjs`, `test/watch.test.mjs` |
| `test/page.e2e.mjs` | 1–359 (99 checks, lines 59–352) | `test/page.e2e.mjs` |
| `design/mockups/data.js`, `*.template.html` (`/*__DATA__*/` inline slot) | all | `design/mockups/` |

---

## Decisions this plan makes where the spec is silent or ambiguous

These are binding for all tasks. Each is noted where it is used.

- **D1 URL shape.** `/s/<id>/` (bare) means "no explicit layout": the page redirects to the last-used layout (localStorage `grill:layout`) if that layout is built, else stays Inbox. Explicit layouts are `/s/<id>/inbox`, `/s/<id>/brief`, `/s/<id>/studio`. The §6 validation regex is widened to include `inbox`: `^http://127\.0\.0\.1:\d+/(s/[A-Za-z0-9-]+/(inbox|brief|studio)?|m/[A-Za-z0-9-]+/[A-Za-z0-9-]+/)$`. An unbuilt layout path 302s to `/s/<id>/inbox`.
- **D2 Ids and keys.** `sessionId` = folder basename `<YYYYMMDD-HHMMSS>-<rand4>` (4 lowercase hex), unique across all projects (`new` retries on collision). `projectKey` = basename of the git common root lower-cased with every run of non-`[a-z0-9]` replaced by `-`, then `-`, then 8 hex of sha256(absolute root) (spec §5). `mapKey` = `<projectKey>/<slug>`; `slug` is the tracker map id (GitHub/GitLab issue number) or effort slug, sanitized to `[a-z0-9-]`.
- **D3 Token and owner live in `meta.json`, not `state.json`.** Spec §5 says `state.json` records `owner` and `token`. The hub writes heartbeats while the agent patches `state.json`; two writers on one file lose updates. So each session folder holds `meta.json` `{ token, owner: { agentId, agent, heartbeat } }`, written by `new`/`resume`/`patch` (CLI) and by the hub (heartbeats), always by atomic rename. `GET /s/<id>/state` returns `state.json` with `owner` merged in (never `token`). `patch` rejects the keys `owner` and `token`.
- **D4 The hub is the only writer of `map.json`.** `map-patch` POSTs the patch to the hub, which merges/validates/writes it; claims and listener heartbeats happen in the same process, so compare-and-set is a plain synchronous check-then-write inside one event-loop turn (spec §4a).
- **D5 One hub-wide SSE stream.** `GET /events` carries tiny pings only (`event: s` `{"id"}`, `event: m` `{"key"}`, `event: hello` `{"pid","started"}`); tabs refetch `/s/<id>/state` or `/m/<key>/map` on a matching ping. This is what lets all tabs share **one** EventSource (spec §5 connection cap). Leader election uses `navigator.locks` ("grill-sse"); relay uses `BroadcastChannel("grill-sse")`.
- **D6 Presence.** Every tab sends `GET /s/<id>/presence?tab=<tabId>` (or `/m/<key>/presence`) on load and every 20 s. `/clients` = `{ count: tabs seen in the last 45 s, lastSeen, hubStarted }`. Idle-exit "no SSE client" = zero open `/events` streams.
- **D7 Hub version** = first 12 hex of sha256 over `hub.mjs` + `lib/*.mjs` (sorted). Any hub code change triggers the §5 handoff; page files are read per request and need no restart.
- **D8 Hub logging.** The hub is spawned with `stdio: "ignore"` and writes its own `logs/hub.log` through `log()` with 1 MB rotation (`hub.log.1`…`.3`), so rotation never fights an inherited fd.
- **D9 Map screen is a shared module, not a Brief-only view.** `page/map-view.js` renders the Wayfinder Map snapshot; every built layout shows it when `finished.kind === "map"`, and Brief uses it too. This keeps milestone 4 independent of the milestone 1 layout decision.
- **D10 Claim semantics.** `POST /m/<key>/claim {ticket}` succeeds only for a `frontier` ticket with no `hubClaim`; it sets `state: "claimed"`, `hubClaim: { agentId: <listener.agentId or "queued">, at, seq }` and appends a `work` event with that `seq`. A card whose claim `seq` > the map's `handled` shows "queued"; after the agent's `map-patch` it shows "claimed by <agentId>". The agent's own work-mode claims use `hub.mjs claim --map K --ticket T --agent-id A` (same CAS; exit 5 on conflict) and `--release`.
- **D11 `wait` prints every send newer than `--after` that is on disk when it wakes** (Jason printed only the first), then exits 0. The skill handles them as one batch.
- **D12 Milestone 1 decision record.** The user's checkpoint result is written to `design/mockups/decision.json` (`{"build":["brief"|"studio"...],"timings":{...},"notes":"..."}`); milestone 7 reads it.
- **D13 Agent detection env** (from agent sources): Claude Code `CLAUDECODE=1`; Codex `CODEX_THREAD_ID` or `CODEX_SANDBOX` (`$RESEARCH/openai-codex/codex-rs/protocol/src/shell_environment.rs:7`, `core/src/spawn.rs:26`); OpenCode `OPENCODE=1` (`$RESEARCH/sst-opencode/packages/opencode/src/index.ts:76`); Pi `PI_CODING_AGENT=true` (`$RESEARCH/badlogic-pi-mono/packages/coding-agent/src/cli/setup.ts:6`).

---

## File structure

```
.claude-plugin/marketplace.json, plugin.json                 (T25)
skills/grilling-ui/
  SKILL.md                    engine: override table, transport, listening, visualize, finish   (T21)
  agents/openai.yaml          Codex sidecar, allow_implicit_invocation false                     (T27)
  hub.mjs                     CLI entry: dispatches subcommands to lib/*                         (T7..)
  lib/util.mjs                parseArgs, print, die, writeJson (atomic), readJson, rand, sleep   (T7)
  lib/state.mjs               applyPatch, validateState (session state)                          (T7)
  lib/maps.mjs                applyMapPatch, validateMap, claim, release                         (T8, T33)
  lib/home.mjs                GRILL_HOME, projectRoot, projectKey, branch, assertWritable        (T9)
  lib/lifecycle.mjs           ensure, lock, spawn, handoff, health                               (T9)
  lib/log.mjs                 log() with rotation                                                (T9)
  lib/server.mjs              createHub(): HTTP routes, SSE, dir watch, presence, idle exit      (T9, T11, T12, T14, T33)
  lib/sessions.mjs            newSession, listSessions, resume, meta/owner, pending              (T10)
  lib/events.mjs              readEvents, lastSeq, watchLog (drain+tail), waitLog                (T13)
  lib/open.mjs                skipReason, URL_RE, openUrl                                        (T15)
  lib/profile.mjs             detectAgent, profile                                               (T16)
  page/tokens.css             single token set                                                   (T1)
  page/core.js                shared page core                                                   (T17–T20)
  page/inbox.html             Inbox layout                                                       (T17)
  page/brief.html             Brief layout (if chosen)                                           (T30)
  page/studio.html            Studio layout (if chosen)                                          (T31)
  page/map-view.js            Map snapshot renderer                                              (T24)
  page/board.html, board.js   ticket board                                                       (T34)
  visual-brief.md             drawing rules + data-q + verbatim listener                         (T20)
  test/*.test.mjs             node --test units                                                  (all)
  test/*.e2e.mjs              Playwright, opt-in                                                 (T17+)
  test/helpers.mjs            tmp GRILL_HOME, run CLI, start/stop hub                            (T9)
skills/grill-me-ui/SKILL.md, agents/openai.yaml                                                  (T22, T27)
skills/grill-docs-ui/SKILL.md, agents/openai.yaml                                                (T22, T27)
skills/wayfinder-ui/SKILL.md, agents/openai.yaml, upstream/wayfinder.md                          (T23, T35, T27)
upstream.json                                                                                    (T23, T28)
scripts/install-agents.sh, scripts/sync-pocock.sh                                                (T28, T37)
scripts/test/*.test.mjs                                                                          (T28, T37)
design/mockups/{data.js, build.mjs, index.html, *.template.html, *.html, shoot.mjs, decision.json} (T2–T6)
LICENSES/jason-ku-grill-with-ui.MIT, matt-pocock-skills.MIT; README.md                           (T38)
```

**Test commands used throughout**

- Units: `node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs`
- One file: `node --test skills/grilling-ui/test/<name>.test.mjs`
- E2E (opt-in): `PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node skills/grilling-ui/test/<name>.e2e.mjs` → prints `PASS n/n`, exits 0.

Every unit test runs against a fresh temp `GRILL_HOME` and stops any hub it started (`test/helpers.mjs` `stopHub(home)` via `POST /admin/shutdown`).

---

## Dependency graph and parallelism

```
M1  T1 ─► T2 ─► {T3 ∥ T4 ∥ T5} ─► T6 [HUMAN GATE: layout comparison] ───────────────► M7
M2  T7 ─► T8
    T7 ─► T9 ─► T10 ─► T11 ─► {T12 ∥ T13} ; T8+T11 ─► T14 ; T12 ─► T15 ; T7 ─► T16 (∥ anything after T7)
M3  T1+T12 ─► T17 ─► T18 ─► T19 ─► T20      (serial: all edit core.js)
M4  T13+T15+T16+T17 ─► T21 ─► {T22 ∥ T23} ; T8+T17 ─► T24
M5  T22+T23+T24 ─► T25 ─► T26 [HUMAN GATE: dogfood + Monitor wake]
M6  T22+T23 ─► T27 ; T25 ─► T28 ─► T29 [HUMAN GATE: Codex/OpenCode/Pi smoke]
M7  T6+T20 ─► {T30 ∥ T31} (each only if chosen) ─► T32
M8  T14 ─► T33 ─► T34 ─► T35 ─► T36
M9  T23+T28 ─► T37 ; everything ─► T38
```

- **Milestone 1 and milestone 2 run in parallel** (M2 does not depend on the gate). Only milestone 7 waits for T6.
- Within M2, after T11: T12, T13, T16 can run in parallel (different files); T14 after T8 and T11.
- M3 tasks are serial (shared `core.js`).
- M8 T33 (hub) can start as soon as T14 lands, in parallel with M3–M6.
- Human gates (T6, T26, T29) block their milestone's completion; mark them done only with the user's recorded result.

---

# Milestone 1 — Comparison mockups (spec §9.1, §7)

### Task 1: Repo scaffold and the shared token set

**Goal:** Create the repo skeleton and `tokens.css` (the one token set used by mockups, layouts and board), with an automated contrast check.

**Spec:** §2 layout, §7 "One token set", §1 non-goal (no dark mode).

**Depends on:** none. **Parallel with:** T7.

**Files:**
- Create: `.gitignore`, `skills/grilling-ui/page/tokens.css`, `skills/grilling-ui/test/tokens.test.mjs`

**Acceptance Criteria:**
- [ ] `tokens.css` defines on `:root`: `--bg --panel --ink --ink-2 --ink-3 --rule --accent --ok --ok-soft --stage --stage-soft --warn-soft --focus --serif --sans --mono` and spacing/radius tokens `--r1 --r2 --s1..--s6`; system fonts only (no `@import`, no `url(http`).
- [ ] Base rules for all 8 control states on `button`, `.opt`, `textarea`, `a`: default, hover, active, `:focus-visible` (2px `--focus` outline, offset 2px), disabled, selected/`[aria-pressed=true]`, staged (`.staged`), pending (`.pending`).
- [ ] `@media (prefers-reduced-motion: reduce)` block ported from `$JASON/page.html:191-205` (spinners pulse instead of rotate).
- [ ] No italic headings (`h1..h4 { font-style: normal }`), serif headings / sans body.
- [ ] Test computes WCAG contrast for the real pairings and asserts ≥ 4.5: `--ink` on `--bg` and `--panel`; `--ink-2` on `--bg`/`--panel`; `--accent` on `--panel`; `#fff` on `--accent`; `--ok` on `--ok-soft`; `--stage` text on `--stage-soft` (≥ 4.5; darken `--stage` from Jason's `#b8791f` as needed); `--ink-3` on `--panel` ≥ 3.0 (secondary meta text only, documented in a CSS comment).

**Verify:** `node --test skills/grilling-ui/test/tokens.test.mjs` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// skills/grilling-ui/test/tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../page/tokens.css", import.meta.url), "utf8");
const tok = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [["ink", "bg", 4.5], ["ink", "panel", 4.5], ["ink-2", "bg", 4.5], ["ink-2", "panel", 4.5], ["accent", "panel", 4.5], ["ok", "ok-soft", 4.5], ["stage", "stage-soft", 4.5], ["ink-3", "panel", 3.0]];
test("token pairings meet contrast", () => {
  for (const [fg, bg, min] of pairs) { assert.ok(tok[fg] && tok[bg], `missing --${fg} or --${bg}`); assert.ok(ratio(tok[fg], tok[bg]) >= min, `--${fg} on --${bg} = ${ratio(tok[fg], tok[bg]).toFixed(2)} < ${min}`); }
  assert.ok(ratio("#ffffff", tok.accent) >= 4.5, "white on --accent");
});
test("no network, no italic headings, focus-visible and reduced motion present", () => {
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/);
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /h1[^{]*\{[^}]*font-style:\s*normal/);
});
```

- [ ] **Step 2: Run it; expect FAIL** (`ENOENT ... tokens.css`).
- [ ] **Step 3: Write `tokens.css`** starting from `$JASON/page.html:8-13` values; adjust `--stage` (e.g. `#8a5a12`) and `--ink-3` until the test passes; add the control-state rules and reduced-motion block described above. `.gitignore`: `node_modules/`, `design/mockups/shots/`, `*.tmp`.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(page): shared token set with contrast test"`

---

### Task 2: Mockup data, build script and picker

**Goal:** One `data.js` (Jason's real 17-question session + a synthetic round), a build script that inlines it into each template, and a picker page (`?v=`, number keys) with a per-task stopwatch.

**Spec:** §9.1.

**Depends on:** T1. **Parallel with:** M2.

**Files:**
- Create: `design/mockups/data.js`, `design/mockups/build.mjs`, `design/mockups/index.html`

**Acceptance Criteria:**
- [ ] `data.js` defines `const SESSION` in the real state.json shape (spec §4, Jason schema `$JASON/SKILL.md:392-417`): `questions` is an **array** (convert Jason's `questions` map and `rounds` list from `$JASON/design/mockups/data.js`), all 17 questions preserved with their answers/threads/status.
- [ ] Adds round 9: 8 open questions `q18`–`q25` on the topic (plausible grill-with-ui follow-ups with 2–4 options, `rec`, `why` ≤ 2 sentences naming the cost, titles ≤ 8 words); plus two existing answered questions set to `status: "reopened"` with a thread message explaining why (use q15 and q16, since tasks 3–4 target them), and one more deferred (q23). `visual: { kind: "prototype", version: 3, stale: true, note: "v3: ..." }` and a `VISUAL_HTML` string: a small self-contained prototype whose regions carry `data-q` (at least q1, q9, q12, q15 regions) and include the linkage listener from T20 Step 3 (copy it verbatim).
- [ ] `build.mjs` reads each `*.template.html`, replaces `/*__DATA__*/` with `data.js` contents, writes `<name>.html` (Jason's slot convention, `$JASON/design/mockups/a-inbox.template.html:110`). Idempotent. Prints the files written.
- [ ] `index.html`: loads `inbox.html` / `brief.html` / `studio.html` in a full-size iframe by `?v=inbox|brief|studio`; keys `1`/`2`/`3` switch (ignored when focus is in the iframe's text fields: switching is done by parent keydown only); a small fixed panel lists the four timed tasks (spec §9.1) with Start/Stop per task per layout and a "Copy results" button producing JSON `{layout:{task1:ms,...}}` for `decision.json`.

**Verify:** `node design/mockups/build.mjs && node -e "const fs=require('fs');for(const f of ['inbox','brief','studio'])if(fs.existsSync('design/mockups/'+f+'.template.html')&&fs.readFileSync('design/mockups/'+f+'.html','utf8').includes('/*__DATA__*/'))process.exit(1)"` → exit 0 (run again after T3–T5). Open `design/mockups/index.html` in a browser: picker renders, number keys switch.

**Steps:**

- [ ] **Step 1:** Write `data.js` by converting `$JASON/design/mockups/data.js` (keep text; `questions: Object.values(...)`, add `round`, `deps` as already present). Add round 9 and the reopen/defer/stale changes.
- [ ] **Step 2:** Write `build.mjs`:

```js
// design/mockups/build.mjs — inline data.js into every *.template.html
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const data = readFileSync(join(here, "data.js"), "utf8");
for (const f of readdirSync(here).filter((n) => n.endsWith(".template.html"))) {
  const out = f.replace(".template.html", ".html");
  writeFileSync(join(here, out), readFileSync(join(here, f), "utf8").replace("/*__DATA__*/", () => data));
  console.log("wrote", out);
}
```

- [ ] **Step 3:** Write `index.html` (inline CSS using `../../skills/grilling-ui/page/tokens.css` via `<link>`; relative file link works offline).
- [ ] **Step 4:** Run the verify command; open the picker.
- [ ] **Step 5: Commit** `git commit -am "feat(mockups): data, build script, picker"` (add new files first).

---

### Task 3: Inbox mockup

**Goal:** Static-interactive Inbox mockup (Jason's list | card | discussion) on `tokens.css`, plus the hover→highlight linkage.

**Spec:** §7 Layouts (Inbox), §9.1. **Depends on:** T2. **Parallel with:** T4, T5.

**Files:** Create `design/mockups/inbox.template.html`.

**Acceptance Criteria:**
- [ ] Ported from `$JASON/design/mockups/a-inbox-clean.template.html` (layout `260px | 1fr | 33vw`), but links `../../skills/grilling-ui/page/tokens.css` and removes Google Fonts.
- [ ] Renders all rounds from `SESSION.questions`; selecting a question shows card + thread; options stage (dashed rec, staged highlight), free text stages, reopened/deferred marks, updated marker.
- [ ] Visual toggle shows `VISUAL_HTML` in `<iframe sandbox="allow-scripts" srcdoc>`, with a stale strip ("Out of date · regenerate…").
- [ ] Hovering a nav item posts `{highlight:[id]}` to the iframe; clicking a `data-q` region selects that question.
- [ ] Stacks below 760 px (port `$JASON/page.html:153-183`).

**Verify:** `node design/mockups/build.mjs`, open `design/mockups/index.html?v=inbox` at 1440 px and at 390 px width: no horizontal scroll, Q15 hover outlines its region.

**Steps:**
- [ ] **Step 1:** Copy Jason's clean template, swap tokens and data access (`SESSION.questions` array).
- [ ] **Step 2:** Add the iframe + postMessage (parent side of T20's protocol: filter `e.source === frame.contentWindow`, accept only `/^q\d+$/` ids).
- [ ] **Step 3:** Build, check both widths.
- [ ] **Step 4: Commit** `git add design/mockups/inbox.* && git commit -m "feat(mockups): inbox"`

---

### Task 4: Brief mockup

**Goal:** Document-model mockup per spec §7 Brief row.

**Spec:** §7 Layouts (Brief). **Depends on:** T2. **Parallel with:** T3, T5.

**Files:** Create `design/mockups/brief.template.html`.

**Acceptance Criteria:**
- [ ] One column max-width `68ch`; sections derived from dependency roots: for each question with `deps: []`, a section titled by that root question; every other question goes in the section of its first root ancestor (walk `deps[0]` to a root). Deferred questions in their own final section "Deferred".
- [ ] Answered question = one prose line `Title → chosen option text` (text answers show the text) + a "reopen" control.
- [ ] Open/reopened question = compact block: heading; options as a vertical list with full text; recommended option dashed and pre-selected (staged-looking); the why in one line; free-text field always visible; thread collapsed to bold first lines that expand inline on click.
- [ ] ≥ 1100 px: left jump rail (section links + open counts) and the visual as a sticky figure on the right; < 1100 px the figure sits under the header; < 760 px everything stacks.
- [ ] Hovering a question block highlights its `data-q` regions (same postMessage).

**Verify:** build; `index.html?v=brief` at 1440 / 1000 / 390 px.

**Steps:**
- [ ] **Step 1:** Write the section derivation:

```js
const rootOf = (q, byId) => { let cur = q, seen = new Set(); while (cur.deps && cur.deps.length && !seen.has(cur.id)) { seen.add(cur.id); const p = byId[cur.deps[0]]; if (!p) break; cur = p; } return cur.id; };
```
- [ ] **Step 2:** Render blocks and rail; wire hover/click linkage.
- [ ] **Step 3:** Build; check three widths.
- [ ] **Step 4: Commit** `git commit -m "feat(mockups): brief"` (after `git add`).

---

### Task 5: Studio mockup

**Goal:** Visual-first mockup per spec §7 Studio row.

**Spec:** §7 Layouts (Studio). **Depends on:** T2. **Parallel with:** T3, T4.

**Files:** Create `design/mockups/studio.template.html`.

**Acceptance Criteria:**
- [ ] Visual iframe takes ~60% width; conversation rail on the right holds one timeline grouped under sticky round headers: open question cards in full, answered cards collapsed to one line, thread messages placed by `at` time, visual feedback (`visual.thread`) in the same stream.
- [ ] One composer at the bottom of the rail with a target chip: `@qN thread`, `@qN answer`, `visual`; clicking a card sets the chip to that question; the chip is a button cycling the three targets.
- [ ] Hover card → highlight regions; click region → select card (scroll into view).
- [ ] A toggle "before first draw" shows the empty state: "Agreed so far" (bullet list derived from answered questions: `title → answer`) and a Visualize call to action.
- [ ] Stacks below 760 px (visual above rail, `height: 60vh`).

**Verify:** build; `index.html?v=studio` at 1440 / 390 px.

**Steps:**
- [ ] **Step 1:** Build timeline items: `[...questions.map(q=>({at: q.thread[0]?.at || roundStart(q.round), kind:"q", q})), ...threadMsgs, ...visual.thread]`, group by round (message round = its question's round; visual feedback = latest round at that time).
- [ ] **Step 2:** Composer + chip; linkage.
- [ ] **Step 3:** Build; check widths.
- [ ] **Step 4: Commit** `git commit -m "feat(mockups): studio"` (after `git add`).

---

### Task 6: Screenshots and the layout comparison — HUMAN GATE (blocking M7)

**Goal:** Screenshot all three at 1440 and 390 px, run the user's four timed tasks, and record which of Brief/Studio get built.

**Spec:** §9.1 ("We build only what wins. Inbox is always built."). Method: `$TASTE` (variants differ on a named axis, real content, picker with instant switching). **Depends on:** T3, T4, T5.

**Files:** Create `design/mockups/shoot.mjs`, `design/mockups/decision.json`.

**Acceptance Criteria:**
- [ ] `shoot.mjs` (Playwright via `PLAYWRIGHT_PKG`) writes `design/mockups/shots/{inbox,brief,studio}-{1440,390}.png` (full page) and asserts no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`) at each width.
- [ ] **HUMAN GATE:** the user runs the four tasks in each layout using the picker stopwatch: (1) "What did we decide about Q2 transport?", (2) answer the open round 9, (3) find which part of the visual Q15 changes, (4) push back on Q16 in free text. Randomise layout order per task.
- [ ] `decision.json` records `{ "build": [...], "timings": <picker JSON>, "notes": "<user's words>", "date": "..." }`. `build` ⊆ `["brief","studio"]` (Inbox is implicit).
- [ ] Do **not** mark this task complete until the user has given the result in chat.

**Verify:** `PLAYWRIGHT_PKG=... node design/mockups/shoot.mjs` → prints 6 paths, exit 0; `node -e "const d=require('./design/mockups/decision.json');if(!Array.isArray(d.build))process.exit(1)"` → exit 0.

**Steps:**
- [ ] **Step 1:** Write `shoot.mjs`:

```js
const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
import { mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); mkdirSync(join(here, "shots"), { recursive: true });
const browser = await chromium.launch(); let bad = 0;
for (const v of ["inbox", "brief", "studio"]) for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
  await page.goto(pathToFileURL(join(here, `${v}.html`)).href);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (over) { console.log("OVERFLOW", v, w); bad++; }
  const out = join(here, "shots", `${v}-${w}.png`); await page.screenshot({ path: out, fullPage: true }); console.log(out); await page.close();
}
await browser.close(); process.exit(bad ? 1 : 0);
```
- [ ] **Step 2:** Run it; fix overflow if any.
- [ ] **Step 3:** Present the screenshots and picker to the user; ask them to run the four tasks; wait.
- [ ] **Step 4:** Write `decision.json` from the user's result.
- [ ] **Step 5: Commit** `git add design/mockups && git commit -m "docs(mockups): layout comparison result"`

---

# Milestone 2 — Hub + CLI (spec §9.2, §5, §6, §10)

### Task 7: util + session state patch/validate (port)

**Goal:** Port Jason's patch/merge/stamp/validate into `lib/state.mjs` with the new fields, as pure functions with unit tests.

**Spec:** §4 (phase, finished.kind, map), §5 (owner rules → D3), §10 "patch … validation". **Depends on:** none. **Parallel with:** T1.

**Files:**
- Create: `skills/grilling-ui/lib/util.mjs`, `skills/grilling-ui/lib/state.mjs`, `skills/grilling-ui/hub.mjs` (dispatcher skeleton), `skills/grilling-ui/test/state.test.mjs`

**Acceptance Criteria:**
- [ ] `util.mjs` exports `parseArgs, print, die, writeJson, readJson, rand(hexChars), sleep, isObj, oneLine` (port `$JASON/server.mjs:31-49`; `die` prefix `grill:`; `writeJson` atomic temp+rename).
- [ ] `state.mjs` exports `PatchError, applyPatch(state, patch, nowIso), validateState(state)` ported from `$JASON/server.mjs:254-450` with these additions:
  - `phase` ∈ `destination|frontier|ticket` (optional); `mapKey`, `id`, `projectKey`, `cwd`, `branch` strings.
  - `finished.kind` ∈ `doc|map|no-map` (optional, default treated as `doc`).
  - `map` validated by `validateMap` (import from `maps.mjs`; until T8 lands, stub `validateMap = () => {}` in `maps.mjs`).
  - A patch containing `owner` or `token` at top level is rejected: `"owner and token are written by the hub, not by patch"`.
- [ ] All patch tests from `$JASON/test/server.test.mjs:291-572` ported as direct `applyPatch`/`validateState` calls (the CLI-level ones — stdin/`--file`/exit codes, lines 487–612 — are ported in T10).
- [ ] `hub.mjs`: shebang, `parseArgs`, a `cmds` table (own keys only, `$JASON/server.mjs:485-489`), usage message listing all subcommands of the CLI contract below.

**CLI contract (fixed here, implemented across M2):**

```
hub.mjs ensure                                             → {"port","pid","version","started","reused"}
hub.mjs serve [--port N]                                   (internal; spawned by ensure)
hub.mjs new --topic T [--doc P] [--agent A] [--phase P] [--map-key K]
                                                           → {"session","id","projectKey","agentId","url","doc"}
hub.mjs sessions [--all]                                   → one JSON line per session
hub.mjs resume [--session DIR] [--take] [--agent A]        → {"session","agentId","url","handled","pending"} | {"choose":[...]} | exit 4 {"inUse":...}
hub.mjs patch --session DIR --agent-id ID [--file P]       → {"ok":true,"questions","open","handled","bytes"}
hub.mjs pending --session DIR                              → send lines past agent.handled
hub.mjs url  (--session DIR [--ui L] | --map KEY)          → URL line
hub.mjs open (--session DIR [--ui L] | --map KEY)          → {"opened":bool,"reason"?,"url"}
hub.mjs watch (--session DIR | --map KEY) --after N --agent-id ID
hub.mjs wait  (--session DIR | --map KEY) --after N --timeout S --agent-id ID   (exit 0 sends, exit 3 timeout)
hub.mjs map-patch --map KEY [--agent-id ID] [--file P]     → {"ok":true,"tickets","url"}
hub.mjs claim --map KEY --ticket TITLE --agent-id ID [--release]   (T33; exit 5 on conflict)
hub.mjs agent-profile [--agent A] [--session DIR]          → JSON profile
```

**Verify:** `node --test skills/grilling-ui/test/state.test.mjs` → all pass.

**Steps:**
- [ ] **Step 1:** Port the tests (convert each CLI patch into `applyPatch(state, p, "2026-01-01T00:00:00.000Z")` and assert on the result / thrown `PatchError`). Add new tests:

```js
test("phase, finished.kind and map validate", () => {
  const s = base();
  assert.doesNotThrow(() => validateState({ ...s, phase: "frontier", finished: { kind: "map", at: "x" } }));
  assert.throws(() => validateState({ ...s, phase: "later" }), /phase must be one of destination\|frontier\|ticket/);
  assert.throws(() => validateState({ ...s, finished: { kind: "pdf" } }), /finished.kind must be one of doc\|map\|no-map/);
});
test("patch may not write owner or token", () => {
  assert.throws(() => applyPatch(base(), { owner: { agentId: "x" } }, NOW), /written by the hub/);
  assert.throws(() => applyPatch(base(), { token: "t" }, NOW), /written by the hub/);
});
```
- [ ] **Step 2:** Run; expect FAIL (module missing).
- [ ] **Step 3:** Port code; add checks in `validateState`:

```js
const PHASES = ["destination", "frontier", "ticket"], KINDS = ["doc", "map", "no-map"];
check(s, "phase", (v) => PHASES.includes(v), `phase must be one of ${PHASES.join("|")}`);
for (const k of ["mapKey", "id", "projectKey", "cwd", "branch"]) check(s, k, str, `${k} must be a string`);
if ("finished" in s) check(s.finished, "kind", (v) => KINDS.includes(v), `finished.kind must be one of ${KINDS.join("|")}`);
if ("map" in s) validateMap(s.map);
```
and at the top of `applyPatch`: `for (const k of ["owner", "token"]) if (k in p) bad("owner and token are written by the hub, not by patch");`
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `git add skills/grilling-ui && git commit -m "feat(hub): port patch/validate with phase, finished.kind, map"`

---

### Task 8: Map patch/validate (pure)

**Goal:** `lib/maps.mjs` with `applyMapPatch` and `validateMap` for the §4a `map` shape (used both for `map.json` and the session `state.map` snapshot).

**Spec:** §4a `map` shape; §10 "patch and map-patch validation (including `map`, `closed`…)". **Depends on:** T7.

**Files:** Modify `skills/grilling-ui/lib/maps.mjs` (replace stub); Create `skills/grilling-ui/test/maps.test.mjs`.

**Acceptance Criteria:**
- [ ] `validateMap(m)`: object; `title, link, at, destination, notes` strings (optional except `title`); `decisions`, `closed`: arrays of `{title, link?, gist?}` strings; `tickets`: array of `{title (required, unique), link?, type ∈ research|prototype|grilling|task, state ∈ frontier|blocked|claimed, blockedBy?: string[] (each must name another ticket or a closed title), assignee?: string, session?: string (http URL of the grill working it, used by T34), hubClaim?: {agentId: string, at: string, seq?: number}}`; `fog`: string[]; `outOfScope`: `{gist, link?}[]`; `listener?`: `{agentId, heartbeat}`; `handled?`: whole number. Error messages name the ticket title and field.
- [ ] `applyMapPatch(map, patch, now)`: `null` deletes; `tickets`, `closed`, `decisions` keyed by `title` (known title merges one level, `null` field deletes, new title appended; a ticket moved to `closed` in the same patch may be removed with `{"title": T, "remove": true}` in `tickets`); `fog`, `outOfScope` replaced whole; `listener` in a patch → rejected ("listener is written by the hub"); stamps `at = now` on every patch.
- [ ] Tests cover each rule plus unknown `blockedBy` rejection and duplicate titles.

**Verify:** `node --test skills/grilling-ui/test/maps.test.mjs` → pass; `node --test skills/grilling-ui/test/state.test.mjs` still passes.

**Steps:**
- [ ] **Step 1: Tests** (example):

```js
test("tickets merge by title; remove drops one; listener is hub-only", () => {
  let m = applyMapPatch({}, { title: "Map", tickets: [{ title: "A", type: "research", state: "frontier" }, { title: "B", type: "task", state: "blocked", blockedBy: ["A"] }] }, NOW);
  m = applyMapPatch(m, { tickets: [{ title: "A", remove: true }, { title: "B", state: "frontier", blockedBy: null }], closed: [{ title: "A", gist: "done" }] }, NOW);
  assert.deepEqual(m.tickets.map((t) => [t.title, t.state, t.blockedBy]), [["B", "frontier", undefined]]);
  assert.equal(m.at, NOW); validateMap(m);
  assert.throws(() => applyMapPatch(m, { listener: { agentId: "x" } }, NOW), /written by the hub/);
});
test("blockedBy must name a ticket or a closed title", () => {
  assert.throws(() => validateMap({ title: "M", tickets: [{ title: "B", type: "task", state: "blocked", blockedBy: ["Nope"] }] }), /B\.blockedBy names unknown "Nope"/);
});
```
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement (reuse `mergeOne`/`clean` style from `state.mjs`; export them from `state.mjs` if needed). **Step 4:** PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(hub): map patch and validation"` (after `git add`).

---

### Task 9: GRILL_HOME, project key, hub lifecycle (ensure / serve skeleton / handoff / idle exit)

**Goal:** One hub per user: `ensure` reuses a healthy hub with the same `{pid, started}`, otherwise takes `hub.lock` and spawns a detached hub on the remembered port; version change → handoff on the same port; idle exit; clear errors on an unwritable root or denied bind.

**Spec:** §5 Root and processes, Hub lifecycle, Crash recovery; §5b Codex sandbox; §10 ensure races, reused pid/port, handoff same port, idle exit blocked by heartbeat, unwritable GRILL_HOME / denied bind. Decisions D7, D8.

**Depends on:** T7.

**Files:**
- Create: `lib/home.mjs`, `lib/lifecycle.mjs`, `lib/log.mjs`, `lib/server.mjs` (`createHub` with `/health`, `/admin/handoff`, `/admin/shutdown`, idle timer), `test/helpers.mjs`, `test/lifecycle.test.mjs`
- Modify: `hub.mjs` (`ensure`, `serve`)

**Acceptance Criteria:**
- [ ] `home.mjs`: `grillHome()` = `GRILL_HOME` or `~/.intelligentrascal`; `projectRoot(cwd)` (port `$JASON/server.mjs:58-64`); `projectKey(cwd)` per D2; `branchOf(cwd)` (`git rev-parse --abbrev-ref HEAD`, `""` outside git); `assertWritable(home)` creates `home`, `logs/`, `grill-sessions/`, `maps/` and probes a write; on `EPERM|EACCES|EROFS` exits 1 with the Codex fix text below. No fallback location.
- [ ] `serve`: binds `127.0.0.1` on `--port` (remembered); on `EADDRINUSE` retries for 3 s (handoff in flight), then falls back to port 0; on `EPERM|EACCES` prints the Codex fix and exits 1. After listening writes `hub.json` `{port, pid, version, started, adminToken}` (atomic, mode 0600).
- [ ] `GET /health` → `{pid, started, version}`. `POST /admin/handoff` and `/admin/shutdown` require header `x-grill-admin: <adminToken>` and no foreign Origin; respond 200 then close and exit.
- [ ] `ensure` implements spec §5 steps 1–3 exactly (health must echo `hub.json`'s `{pid, started}`; lock `O_EXCL` with pid, stale only if pid dead; spawn `detached: true, stdio: "ignore"` + `unref()`; wait ≤ 10 s). Version differs → handoff, then spawn on the same port.
- [ ] Idle exit: every `GRILL_TICK_MS` (default 60 000) the hub exits if for `GRILL_IDLE_MS` (default 1 800 000) there were zero `/events` clients **and** no `meta.json` owner heartbeat younger than `GRILL_FRESH_MS` (default 180 000) in any unfinished session, **and** no fresh `map.json.listener.heartbeat`.
- [ ] `log.mjs` rotation per D8.
- [ ] Tests: two parallel `ensure` → same pid; `hub.json` pointing at a live foreign pid/port (a plain `http` server returning `{pid: other}`) is not reused; version change (`GRILL_VERSION_OVERRIDE` env honoured by `serve`/`ensure` for tests) keeps the port and changes pid; idle exit happens with `GRILL_IDLE_MS=300 GRILL_TICK_MS=100` and is blocked by a fresh heartbeat in a fake session `meta.json`; unwritable home (`chmod 500`) and denied bind print the Codex fix and exit 1 (simulate denied bind with `GRILL_TEST_BIND_ERROR=EPERM`).

Codex fix text (exact; also used by T28):

```
grill: cannot <write GRILL_HOME|bind 127.0.0.1> (<CODE>). If you are in Codex, add to ~/.codex/config.toml:
  [sandbox_workspace_write]
  network_access = true
  writable_roots = ["<abs GRILL_HOME>"]
then restart Codex. Other agents: make <abs GRILL_HOME> writable or set GRILL_HOME.
```

**Verify:** `node --test skills/grilling-ui/test/lifecycle.test.mjs` → pass; `ps aux | grep "hub.mjs serve"` after the run shows none from the test homes.

**Steps:**
- [ ] **Step 1: helpers + failing tests**

```js
// test/helpers.mjs
import { mkdtempSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process"; import { fileURLToPath } from "node:url";
export const HUB = join(dirname(fileURLToPath(import.meta.url)), "..", "hub.mjs");
export const tmp = (p) => mkdtempSync(join(tmpdir(), p));
export function mkHome(extra = {}) { const home = tmp("grill-home-"); return { home, env: { ...process.env, GRILL_HOME: home, GRILL_NO_OPEN: "1", ...extra } }; }
export const run = (env, args, opts = {}) => execFileSync(process.execPath, [HUB, ...args], { encoding: "utf8", env, ...opts }).trim();
export const runAsync = (env, args, opts = {}) => new Promise((res) => { const c = spawn(process.execPath, [HUB, ...args], { env, ...opts }); let out = "", err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d)); c.on("exit", (code) => res({ code, out: out.trim(), err: err.trim() })); });
export const hubInfo = (home) => JSON.parse(readFileSync(join(home, "hub.json"), "utf8"));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitUntil(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(25); } throw new Error("waitUntil timed out"); }
export async function stopHub(home) { try { const h = hubInfo(home); await fetch(`http://127.0.0.1:${h.port}/admin/shutdown`, { method: "POST", headers: { "x-grill-admin": h.adminToken } }); } catch {} }
```

```js
// test/lifecycle.test.mjs (excerpt)
test("two parallel ensures give one hub", async (t) => {
  const { home, env } = mkHome(); t.after(() => stopHub(home));
  const [a, b] = await Promise.all([runAsync(env, ["ensure"]), runAsync(env, ["ensure"])]);
  assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
  assert.equal(JSON.parse(a.out).pid, JSON.parse(b.out).pid);
});
test("version change hands off on the same port", async (t) => {
  const { home, env } = mkHome(); t.after(() => stopHub(home));
  const one = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "v1" }, ["ensure"]));
  const two = JSON.parse(run({ ...env, GRILL_VERSION_OVERRIDE: "v2" }, ["ensure"]));
  assert.equal(two.port, one.port); assert.notEqual(two.pid, one.pid); assert.equal(two.reused, false);
});
```
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement.** Core of `ensure`:

```js
// lib/lifecycle.mjs
export async function health(port, ms = 800) { try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } }
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function takeLock(file) {
  for (;;) {
    try { const fd = fs.openSync(file, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
    catch (e) { if (e.code !== "EEXIST") throw e; const pid = Number(fs.readFileSync(file, "utf8")) || 0; if (pid && alive(pid)) return false; fs.rmSync(file, { force: true }); }
  }
}
async function live(home) { const i = readJson(path.join(home, "hub.json")); if (!i) return null; const h = await health(i.port); return h && h.pid === i.pid && h.started === i.started ? { ...i, version: h.version } : null; }
export async function ensure({ home, version, hubPath, timeoutMs = 10_000 }) {
  const until = Date.now() + timeoutMs, lock = path.join(home, "hub.lock");
  for (;;) {
    const cur = await live(home);
    if (cur && cur.version === version) return { ...cur, reused: true };
    if (takeLock(lock)) {
      try {
        const again = await live(home);
        if (again && again.version === version) return { ...again, reused: true };
        const remembered = readJson(path.join(home, "hub.json"))?.port || 0;
        if (again) await fetch(`http://127.0.0.1:${again.port}/admin/handoff`, { method: "POST", headers: { "x-grill-admin": again.adminToken } }).catch(() => {});
        spawn(process.execPath, [hubPath, "serve", "--port", String(remembered)], { detached: true, stdio: "ignore", env: { ...process.env, GRILL_HOME: home } }).unref();
        for (; Date.now() < until; await sleep(100)) { const up = await live(home); if (up && up.pid !== again?.pid && up.version === version) return { ...up, reused: false }; }
        throw new Error("the hub did not answer /health within 10 s; see " + path.join(home, "logs", "hub.log"));
      } finally { fs.rmSync(lock, { force: true }); }
    }
    if (Date.now() > until) throw new Error("timed out waiting for another ensure to start the hub");
    await sleep(100);
  }
}
```
  `ensure` output omits `adminToken`. `serve` uses `createHub({home, version})` from `lib/server.mjs` (routes added in later tasks through a route table).
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(hub): ensure, lock, detached serve, handoff, idle exit"` (after `git add`).

---

### Task 10: Sessions — new, sessions, resume/ownership, pending, patch CLI

**Goal:** Session folders per D2/D3, ownership with heartbeat and `--take`, resume selection, `pending`, and the `patch` CLI with Jason's exit/one-line contract.

**Spec:** §5 Session identity and ownership, Security (token created by `new`); §4 doc default; §10 ownership and resume selection (incl. `--take`). **Depends on:** T9.

**Files:** Create `lib/sessions.mjs`, `test/sessions.test.mjs`; Modify `hub.mjs`.

**Acceptance Criteria:**
- [ ] `new`: runs `ensure`; creates `grill-sessions/<projectKey>/<id>/` with `state.json` `{id, topic, doc, project, projectKey, cwd, branch, created, agent:{status:"working",since}, terms:[], questions:[]}` (+ `phase`, `mapKey` when given), empty `events.jsonl`, `meta.json` `{token: rand(32), owner: {agentId: rand(12), agent, heartbeat: now}}`. `--doc` default `docs/<slug(topic)>-design.md`. Prints `{session, id, projectKey, agentId, url, doc}` (url = `http://127.0.0.1:<port>/s/<id>/`).
- [ ] `sessions [--all]`: this project's sessions newest first (port `$JASON/server.mjs:106-123`) with added `branch, cwd, ageSec, inUse` (heartbeat < `GRILL_FRESH_MS`), `owner.agent`.
- [ ] `resume`: without `--session`: unfinished sessions of this project; exactly one and not in use → pick it; otherwise print `{"choose":[rows]}` and exit 0 (skill asks the user). With `--session`: if in use and no `--take` → print `{"inUse":true,"agent":..,"ageSec":..}` exit 4; else mint a new agentId, write owner, print `{session, agentId, url, handled, pending: <count past handled>}`.
- [ ] `patch --session DIR --agent-id ID [--file P]`: port `$JASON/server.mjs:452-483` (stdin via `tty.isatty(0)` guard, one-line errors, exit 2 on rejects, exit 1 on write failure); runs `ensure` first (best effort: a hub failure prints a warning to stderr but the patch still applies); refreshes `meta.owner.heartbeat` when `--agent-id` matches the owner; if it does not match, rejects with `"session is owned by another agent (<agent>, <age>); resume --take to take it"` exit 4.
- [ ] `pending --session DIR`: port `$JASON/server.mjs:126-133`.
- [ ] CLI-level tests ported from `$JASON/test/server.test.mjs:35-61` (key/worktree), `199-289` (sessions/pending), `487-612` (patch CLI) with the new key format and `--agent-id`.

**Verify:** `node --test skills/grilling-ui/test/sessions.test.mjs` → pass.

**Steps:**
- [ ] **Step 1: Tests** (new ones; excerpt):

```js
test("resume: auto-picks one idle session; asks when two; --take overrides in-use", async (t) => {
  const { home, env } = mkHome({ GRILL_FRESH_MS: "180000" }); t.after(() => stopHub(home));
  const cwd = tmp("proj-");
  const a = JSON.parse(run(env, ["new", "--topic", "A", "--agent", "claude"], { cwd }));
  // fresh heartbeat → in use
  const r1 = await runAsync(env, ["resume", "--session", a.session], { cwd });
  assert.equal(r1.code, 4); assert.equal(JSON.parse(r1.out).inUse, true);
  const r2 = JSON.parse(run(env, ["resume", "--session", a.session, "--take", "--agent", "codex"], { cwd }));
  assert.notEqual(r2.agentId, a.agentId);
  const oldPatch = await runAsync(env, ["patch", "--session", a.session, "--agent-id", a.agentId], { cwd, input: "{\"note\":\"x\"}" });
  assert.equal(oldPatch.code, 4);
  run(env, ["new", "--topic", "B"], { cwd });
  const list = JSON.parse(run({ ...env, GRILL_FRESH_MS: "0" }, ["resume"], { cwd }));
  assert.equal(list.choose.length, 2);
});
test("projectKey: basename-hash; worktrees share it; different paths with same basename differ", () => { /* per D2 */ });
```
- [ ] **Step 2:** FAIL. **Step 3:** Implement `lib/sessions.mjs` (`newSession, listSessions, resumeSession, readMeta, writeMeta, sessionDirById(home, id)` — scans `grill-sessions/*/<id>`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(hub): sessions, ownership, resume, patch CLI"` (after `git add`).

---

### Task 11: Hub session routes, page serving, token + Origin auth

**Goal:** Serve pages/assets and session endpoints; sends require token and a same-origin (or absent) Origin and append to `events.jsonl`.

**Spec:** §5 hub serves `/s/<sessionId>/[brief|studio]`, Security, "Sends go by POST /s/<id>/send"; D1, D3; §10 token auth rejects missing/wrong token and foreign Origin. **Depends on:** T10.

**Files:** Modify `lib/server.mjs`; Create `test/server.test.mjs`; Create placeholder `page/inbox.html` (minimal `<!doctype html><!--GRILL_BOOT--><p>inbox</p>` until T17).

**Acceptance Criteria:**
- [ ] Routes: `GET /s/<id>/` and `/s/<id>/inbox|brief|studio` → layout HTML with `<!--GRILL_BOOT-->` replaced by `<script>window.GRILL=${JSON.stringify({kind:"session",id,token,base:"/s/"+id+"/",layouts:[built layouts]})}</script>`; unbuilt layout → 302 to `/s/<id>/inbox` (D1). Unknown id → 404 HTML "No such grill".
- [ ] `GET /assets/<name>` for a whitelist (`core.js, tokens.css, map-view.js, board.js`), correct content types, `cache-control: no-store`.
- [ ] `GET /s/<id>/state` → state.json with `owner` from meta.json merged, last-good fallback (port `$JASON/server.mjs:153-159`); `GET /s/<id>/visual` (port 161–165); `GET /s/<id>/events.jsonl` raw log.
- [ ] `POST /s/<id>/send`: requires `x-grill-token` equal to meta.token (401 otherwise) and Origin absent or ∈ `{http://127.0.0.1:<port>, http://localhost:<port>}` (403 otherwise, `$JASON/server.mjs:167-172`); body `{actions:[...]}` non-empty (400); appends `{type:"send", seq, at, session, actions}`; per-session seq initialised from `lastSeq` on first use; returns `{ok, seq}`.
- [ ] `POST /s/<id>/heartbeat {agentId}` (token) → updates `meta.owner.heartbeat` if agentId matches (409 otherwise).
- [ ] Tests: port `$JASON/test/server.test.mjs:63-118, 159-172` to the hub (`new` → url), plus 401 on missing/wrong token, 403 on `Origin: http://evil.example`, 403 on `Origin: null` (sandboxed iframe), seq survives hub restart.

**Verify:** `node --test skills/grilling-ui/test/server.test.mjs` → pass.

**Steps:**
- [ ] **Step 1:** Tests (token/Origin excerpt):

```js
test("send: token required; foreign or null Origin rejected; no Origin allowed with token", async (t) => {
  const { home, env } = mkHome(); t.after(() => stopHub(home));
  const s = JSON.parse(run(env, ["new", "--topic", "T"], { cwd: tmp("p-") }));
  const token = JSON.parse(readFileSync(join(s.session, "meta.json"), "utf8")).token;
  const send = (h) => fetch(s.url + "send", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ actions: [{ type: "finish" }] }) });
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ "x-grill-token": "nope" })).status, 401);
  assert.equal((await send({ "x-grill-token": token, origin: "http://evil.example" })).status, 403);
  assert.equal((await send({ "x-grill-token": token, origin: "null" })).status, 403);
  const ok = await send({ "x-grill-token": token }); assert.deepEqual(await ok.json(), { ok: true, seq: 1 });
});
```
- [ ] **Step 2:** FAIL. **Step 3:** Implement a small router in `createHub` (`[method, regex, handler]` table). **Step 4:** PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(hub): session routes, page boot, token+Origin auth"` (after `git add`).

---

### Task 12: SSE, directory watch, presence and /clients

**Goal:** Push `state` changes over the hub-wide SSE stream using a directory watch that survives atomic renames; presence tracking and `/clients`.

**Spec:** §5 Updates to the page (dir watch, SSE, no 1 s polling), §6 step 2 (`/clients`); D5, D6; §10 "directory watch still sees changes after an atomic rename", "/clients". **Depends on:** T11. **Parallel with:** T13, T16.

**Files:** Modify `lib/server.mjs`; Create `test/sse.test.mjs`.

**Acceptance Criteria:**
- [ ] `GET /events` (SSE, `text/event-stream`, `retry: 2000`): sends `event: hello` `{pid, started}` on connect, then `event: s` `{"id"}` per session change and `event: m` `{"key"}` per map change; comment keep-alive every 25 s.
- [ ] Session watchers attach lazily on the first request touching `/s/<id>/…` (`fs.watch(dir)`; filter `state.json|meta.json|visual.html`; 30 ms debounce per id).
- [ ] `GET /s/<id>/presence?tab=<t>` → 204, records `tab → now`. `GET /s/<id>/clients` → `{count, lastSeen, hubStarted}` per D6.
- [ ] Tests: an EventSource-like reader (`fetch` streaming body, parse `event:`/`data:`) sees `s` pings after two consecutive `hub.mjs patch` calls (two atomic renames); presence counts two tabs, drops after `GRILL_PRESENCE_MS` (test override 300 ms).

**Verify:** `node --test skills/grilling-ui/test/sse.test.mjs` → pass.

**Steps:**
- [ ] **Step 1:** Test helper `sseReader(url)` returning `{next(event) → Promise<data>}`; write the rename test.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (`clients` Set of responses; `broadcast(event, obj)`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(hub): SSE pings, dir watch, presence"` (after `git add`).

---

### Task 13: watch and wait (no gap), heartbeat through the hub

**Goal:** `watch` prints sends after `--after` already on disk then tails with no gap; `wait` blocks until sends exist; both heartbeat every 60 s via the hub.

**Spec:** §5 Per-agent watcher, Session ownership ("watch and wait refresh the heartbeat every 60 s through the hub"), §5b Listening; D11; §10 "`watch` has no gap between drain and tail". **Depends on:** T11. **Parallel with:** T12, T16.

**Files:** Create `lib/events.mjs`, `test/watch.test.mjs`; Modify `hub.mjs`.

**Acceptance Criteria:**
- [ ] `events.mjs` exports `readEvents, lastSeq` (port `$JASON/server.mjs:90-99`) and `tailLog(file, after, onLine)` that **installs `fs.watch` on the directory first, then drains**, tracks the byte offset, only emits complete lines with `seq > after`, dedupes by seq, and also re-drains every 1 s (safety net).
- [ ] `watch --session DIR --after N --agent-id ID`: runs `ensure`, prints each send line to stdout as it lands, never exits on its own; heartbeat `POST /s/<id>/heartbeat` every `GRILL_HEARTBEAT_MS` (default 60 000) and once at start; if the hub is down, `ensure` again.
- [ ] `wait --session DIR --after N --timeout S --agent-id ID`: same drain; prints all available lines `> N` and exits 0; exit 3 at timeout; heartbeats while waiting.
- [ ] `--map KEY` variants use `maps/<key>/events.jsonl` and `POST /m/<key>/heartbeat` (the map route lands in T14; until then, tests cover sessions only).
- [ ] Tests: lines written before start + 20 lines appended in a tight loop during startup are all printed exactly once in order; `wait` exit 0/3 (port `$JASON/test/server.test.mjs:120-157`); heartbeat updates `meta.json` (`GRILL_HEARTBEAT_MS=200`).

**Verify:** `node --test skills/grilling-ui/test/watch.test.mjs` → pass.

**Steps:**
- [ ] **Step 1:** No-gap test:

```js
test("watch: no gap between drain and tail", async (t) => {
  const { home, env } = mkHome(); t.after(() => stopHub(home));
  const s = JSON.parse(run(env, ["new", "--topic", "T"], { cwd: tmp("p-") }));
  const log = join(s.session, "events.jsonl");
  const line = (n) => JSON.stringify({ type: "send", seq: n, at: "x", actions: [{ type: "finish" }] }) + "\n";
  appendFileSync(log, line(1) + line(2));
  const w = spawn(process.execPath, [HUB, "watch", "--session", s.session, "--after", "1", "--agent-id", s.agentId], { env });
  const seen = []; let buf = ""; w.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { seen.push(JSON.parse(buf.slice(0, i)).seq); buf = buf.slice(i + 1); } });
  for (let n = 3; n <= 22; n++) { appendFileSync(log, line(n)); await sleep(5); }
  await waitUntil(() => seen.length >= 21, 5000); w.kill();
  assert.deepEqual(seen, Array.from({ length: 21 }, (_, i) => i + 2));
});
```
- [ ] **Step 2:** FAIL. **Step 3:** Implement `tailLog`:

```js
export function tailLog(file, after, onLine) {
  let pos = 0, seen = after, partial = "";
  const drain = () => {
    let fd; try { fd = fs.openSync(file, "r"); } catch { return; }
    try { const { size } = fs.fstatSync(fd); if (size < pos) pos = 0; if (size === pos) return; const b = Buffer.alloc(size - pos); fs.readSync(fd, b, 0, b.length, pos); pos = size; partial += b.toString("utf8"); }
    finally { fs.closeSync(fd); }
    let i; while ((i = partial.indexOf("\n")) >= 0) { const l = partial.slice(0, i); partial = partial.slice(i + 1); let ev; try { ev = JSON.parse(l); } catch { continue; } const n = Number(ev.seq) || 0; if (n > seen) { seen = n; onLine(l, ev); } }
  };
  const w = fs.watch(path.dirname(file), (_, name) => { if (!name || name === path.basename(file)) drain(); });
  drain(); const iv = setInterval(drain, 1000);
  return () => { w.close(); clearInterval(iv); };
}
```
- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(hub): watch and wait with heartbeat"` (after `git add`).

---

### Task 14: Map storage on the hub and `map-patch`

**Goal:** Maps live under `maps/<projectKey>/<slug>/`; `map-patch` sends patches through the hub (single writer, D4); `/m/<key>/map` and SSE `m` pings.

**Spec:** §4a Data, `<mapKey>`; §5 Security (map token); D2, D4. **Depends on:** T8, T11.

**Files:** Modify `lib/server.mjs`, `hub.mjs`; Create `test/maps-hub.test.mjs`.

**Acceptance Criteria:**
- [ ] `map-patch --map KEY|SLUG`: a bare slug is prefixed with the cwd's `projectKey`; creates `maps/<key>/` with `meta.json {token}` and empty `events.jsonl` if absent (CLI side, then the hub picks it up); reads patch from stdin/`--file`; `POST /m/<key>/patch` with token; prints `{ok, tickets, url}`; validation errors → one line, exit 2 (hub returns 400 with the message).
- [ ] Hub routes: `GET /m/<key>/` (board HTML; placeholder until T34), `GET /m/<key>/map` (map.json or 404), `POST /m/<key>/patch` (token + Origin; `applyMapPatch` + `validateMap`, atomic write, `m` ping), `POST /m/<key>/heartbeat {agentId}` (sets `listener {agentId, heartbeat}`), `GET /m/<key>/presence`, `GET /m/<key>/clients`.
- [ ] Key parsing: `/m/([a-z0-9-]+)/([a-z0-9-]+)/(map|patch|heartbeat|presence|clients|claim|action)?$`.
- [ ] Tests: create, patch twice (merge), invalid patch rejected with state unchanged, listener heartbeat shows in `/map`, bad token 401.

**Verify:** `node --test skills/grilling-ui/test/maps-hub.test.mjs` → pass.

**Steps:** write tests → FAIL → implement → PASS → **Commit** `git commit -m "feat(hub): map storage and map-patch"` (after `git add`).

---

### Task 15: `url` and `open`

**Goal:** Best-effort auto-open with the §6 skip rules, tab detection, URL validation and a no-shell spawn.

**Spec:** §6 (all steps), D1 regex; §10 "open: skip rules, URL validation (session and map URLs), GRILL_OPENER". **Depends on:** T12.

**Files:** Create `lib/open.mjs`, `test/open.test.mjs`; Modify `hub.mjs`.

**Acceptance Criteria:**
- [ ] `skipReason(env, platform)` → `"GRILL_NO_OPEN"`, `"ssh"`, `"no-display"` (linux without `DISPLAY`/`WAYLAND_DISPLAY`), or `null`.
- [ ] `URL_RE` per D1; `url` prints the URL (session: `…/s/<id>/` or `…/s/<id>/<ui>`; map: `…/m/<key>/`).
- [ ] `open`: skip → `{"opened":false,"reason":…,"url"}`; `/clients` count > 0 or `lastSeen` within 120 s → `{"opened":false,"reason":"tab-open"}`; if `hubStarted` < 3 s ago and count 0, poll `/clients` up to 3 s first; invalid URL → `reason: "invalid-url"`; spawn `[opener, url]` with `shell: false`, killed after 5 s: macOS `open`, Linux `xdg-open`, Windows `cmd /c start "" <url>`; `GRILL_OPENER` = executable path overriding the opener.
- [ ] Tests: each skip rule; regex accepts `/s/abc-1/`, `/s/abc-1/studio`, `/m/proj-1a2b3c4d/42/` and rejects `/s/../`, `/s/a/b/`, `javascript:`, `http://127.0.0.1:1/s/a/brief?x`; `GRILL_OPENER` script writes argv to a file; a present tab (presence ping) prevents opening.

**Verify:** `node --test skills/grilling-ui/test/open.test.mjs` → pass.

**Steps:** tests → FAIL → implement:

```js
export const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/(s\/[A-Za-z0-9-]+\/(inbox|brief|studio)?|m\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/)$/;
export function skipReason(env, platform) {
  if (env.GRILL_NO_OPEN === "1") return "GRILL_NO_OPEN";
  if (env.SSH_CONNECTION) return "ssh";
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "no-display";
  return null;
}
export function openerArgs(url, env, platform) {
  if (env.GRILL_OPENER) return [env.GRILL_OPENER, [url]];
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}
```
→ PASS → **Commit** `git commit -m "feat(hub): url and best-effort open"` (after `git add`).

---

### Task 16: `agent-profile`

**Goal:** Detect the agent and print exact listening/draw parameters the skill follows verbatim.

**Spec:** §5b Listening, table (limits, wake, sub-agents), Other per-agent differences; D13; §10 "agent-profile output per agent, using env fixtures". **Depends on:** T7. **Parallel with:** T11–T15.

**Files:** Create `lib/profile.mjs`, `test/profile.test.mjs`; Modify `hub.mjs`.

**Acceptance Criteria:**
- [ ] `detectAgent(env, flag)`: flag wins; else D13 env order claude → codex → opencode → pi; else `"unknown"`.
- [ ] `profile(agent, {skill, session, agentId, handled, project, topic})` returns JSON with `agent`, `mode` (`monitor|wait`), `listen` (exact tool + params, placeholders `<session> <handled> <agentId>` filled when given), `repeat` (what to do on expiry/exit 3), `draw` (`{tool, background}`), `research` (`subagent|leave-open`), `loadSkill` (how to call a skill by name), `notes` (≤ 3 lines).
- [ ] Values (verify Codex/OpenCode/Pi tool and param names against `$RESEARCH` sources while implementing — Codex: `grep -rn yield_time_ms $RESEARCH/openai-codex/codex-rs`; OpenCode: `$RESEARCH/sst-opencode/packages/opencode/src/tool/` bash tool; Pi: `$RESEARCH/badlogic-pi-mono/packages/coding-agent/src/core/tools/bash.ts` — and adjust the names in this table, keeping the timeouts):

| agent | mode | listen | repeat |
|---|---|---|---|
| claude | monitor | Monitor `{command: "node \"<skill>/hub.mjs\" watch --session <session> --after <handled> --agent-id <agentId>", description: "grill: <project> · <topic>", timeout_ms: 1800000}` | on the expiry notice, re-arm with the current `handled` |
| codex | wait | `exec_command {cmd: "node \"<skill>/hub.mjs\" wait --session <session> --after <handled> --timeout 280 --agent-id <agentId>", yield_time_ms: 30000}` with an overall 300 000 ms budget; poll the same session with `write_stdin {session_id, chars: "", yield_time_ms: 30000}` | exit 3 → start a new wait |
| opencode | wait | `bash {command: "… wait … --timeout 540 …", timeout: 600000}` | exit 3 → new wait |
| pi | wait | `bash {command: "… wait … --timeout 900 …"}` (no timeout) | exit 3 → new wait |
| unknown | wait | shell with `--timeout 480`, poll a yielded process in ≤ 60 s steps (Jason `$JASON/SKILL.md:368-377`) | exit 3 → new wait |

  `draw`: claude `Agent` (background), codex `spawn_agent`, opencode `Task`, pi/unknown `inline`. `research`: pi → `leave-open`, else `subagent`.
- [ ] Tests with env fixtures for all five plus `--agent` override; snapshot of the claude Monitor params (exact strings).

**Verify:** `node --test skills/grilling-ui/test/profile.test.mjs` → pass.

**Steps:** tests → FAIL → implement → PASS → **Commit** `git commit -m "feat(hub): agent-profile"` (after `git add`).

---

# Milestone 3 — core.js + Inbox (spec §9.3, §7)

### Task 17: core.js + Inbox at parity with Jason's e2e

**Goal:** Split Jason's `page.html` into `core.js` (shared) and `inbox.html` (layout), on the hub (SSE instead of 1 s polling), keyed staging, token sends; port Jason's e2e to pass unchanged in behaviour.

**Spec:** §7 Shared core, Tabs (§5), Inbox row; §10 E2E "staging survives reload, send, working state, finished state". **Depends on:** T1, T12.

**Files:**
- Create: `page/core.js`, `test/page.e2e.mjs`
- Modify: `page/inbox.html` (replace placeholder)

**Acceptance Criteria:**
- [ ] `core.js` (IIFE, `"use strict"`, exposes `window.Grill`) contains the port of `$JASON/page.html:231-377` (helpers, staging, pending, `sendState`, `post`, `send`, `finishNow`, `visualize`, `explore`) and `378-433, 456-466, 591-628` (render wrapper, `withInputs`, `withThreadScroll`, banner, header, status, footer, send button) with these changes:
  - fetch paths relative to `GRILL.base` (`state`, `visual`, `send`); POST adds `x-grill-token: GRILL.token`.
  - storage key `grill:<sessionId>` (spec §7); `local.view` persists per session.
  - state arrives via SSE ping → `GET state` (this task: one EventSource per tab; T18 makes it shared); `raw` text compare kept.
  - hub down: after 3 s without a successful fetch show banner "Hub down — reconnecting…", retry `/health` every 5 s, re-fetch state on recovery.
  - `document.title = "<project basename> · <topic>"`; favicon = inline SVG dot (waiting `--ok`, working `--stage`, finished `--ink-3`), updated on status change.
  - header shows project basename, branch, doc path, `phase` (when set), listener state from `S.owner.heartbeat` (< 180 s → "agent listening (<Agent>)", else "no agent listening: Sends will queue"), and a layout switch (links to built layouts from `GRILL.layouts`, current marked; writes `localStorage["grill:layout"]`).
  - layout hooks: `Grill.mount({ renderBody(), current(), select(id), move(delta), focusThread(), focusFree(), highlightTargets(id) })`; core calls `renderBody()` inside its render wrapper.
  - bare `/s/<id>/`: redirect per D1.
  - presence ping per D6.
- [ ] `inbox.html`: markup `$JASON/page.html:208-229`, CSS `14-205` minus tokens (links `/assets/tokens.css`), inline script with renders `435-455, 467-590` registered via `Grill.mount`. Loads `/assets/core.js`. Contains `<!--GRILL_BOOT-->` before the scripts.
- [ ] `test/page.e2e.mjs`: port `$JASON/test/page.e2e.mjs` — `new` + write fixture state (lines 20–33) + open `url`; all checks at lines 59–352 kept; "restart reuses the port" (335) becomes: `POST /admin/shutdown`, see hub-down banner, `hub.mjs ensure`, banner clears on the same URL; "system fonts only" also asserts no request leaves 127.0.0.1. Sends are read from `events.jsonl` (no stdout); add checks: title `<project> · <topic>`, favicon changes to working, listener text flips when `meta.json` heartbeat is made stale.

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/page.e2e.mjs` → `PASS n/n` (n ≥ 102), exit 0; units still pass.

**Steps:**
- [ ] **Step 1:** Port the e2e first against the new URLs; run → FAIL (placeholder page).
- [ ] **Step 2:** Create `core.js` by moving code per the port map; adapt paths/token/SSE.
- [ ] **Step 3:** Build `inbox.html`.
- [ ] **Step 4:** Iterate until the e2e passes; `node --test …` still green.
- [ ] **Step 5: Commit** `git commit -m "feat(page): core.js + Inbox at parity with Jason's e2e"` (after `git add`).

---

### Task 18: Shared EventSource, poll fallback, handoff reconnect

**Goal:** All tabs share one EventSource; a tab whose EventSource fails 3 times polls every 5 s; SSE reconnects across hub restart/handoff.

**Spec:** §5 Connection cap, Version change ("SSE clients reconnect by themselves"); D5; §10 E2E "hub restart and handoff with SSE reconnect", "shared EventSource across 8 tabs, with poll fallback". **Depends on:** T17.

**Files:** Modify `page/core.js`; Create `test/sse.e2e.mjs`.

**Acceptance Criteria:**
- [ ] Leader: `navigator.locks.request("grill-sse", () => new Promise(() => openES()))`; the leader relays every SSE event on `BroadcastChannel("grill-sse")` and handles it itself; followers only listen on the channel. When the leader tab closes, another acquires the lock within ~1 s.
- [ ] Each tab handles only pings for its own `id`/`key`; on `hello` with a new `{pid, started}` every tab refetches.
- [ ] 3 consecutive `error` events without an `open` → that tab switches to a 5 s poll of `state` and says so in the status tooltip; it retries SSE every 60 s.
- [ ] E2E: open 8 tabs on 3 sessions in one context → hub reports exactly 1 `/events` client (add `GET /admin/stats` → `{sse, sessions, rss}`, admin token); a patch in each session updates its tabs within 1 s; close the leader → updates continue; handoff (`GRILL_VERSION_OVERRIDE` change + `ensure`) → tabs update after reconnect on the same URL; block `/events` via `page.route` → tab falls back to polling and still updates.

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/sse.e2e.mjs` → `PASS`, exit 0; `page.e2e.mjs` still passes.

**Steps:** e2e first → FAIL → implement leader/relay/fallback in `core.js` and `/admin/stats` in `server.mjs` → PASS → **Commit** `git commit -m "feat(page): shared EventSource with poll fallback"` (after `git add`).

---

### Task 19: Keyboard layer and cheatsheet

**Goal:** Linear/Gmail-style shortcuts for all layouts (board keys land in T34), with the §7 guard rules and a `?` cheatsheet.

**Spec:** §7 Keyboard shortcuts (all rows, "Where they apply"); §10 E2E keyboard. **Depends on:** T18.

**Files:** Modify `page/core.js`, `page/inbox.html` (hooks); Create `test/keyboard.e2e.mjs`.

**Acceptance Criteria:**
- [ ] One `keydown` listener on `document`. Ignored when `e.isComposing`, when `e.ctrlKey || e.altKey` (except `Ctrl+Enter`), and when focus is in `input, textarea, [contenteditable]` — except `⌘↵/Ctrl↵` (send) and `Esc` (blur field / close overlay).
- [ ] Keys: `j/k` → `layout.move(±1)`; `1`–`4` → stage option A–D only if it exists; `a` → stage accept of `rec.option`; `r` → `layout.focusThread()`; `f` → `layout.focusFree()`; `d`/`o` → stage defer/reopen; `e` → toast "Exploring Qn… Undo" for 3 s, then `explore(id)` unless undone (`u` or click Undo); `v` → toggle visual or `visualize()`; `g` then `i/b/s/m` within 1 s → navigate to that layout (only built ones) or `/m/<mapKey>/` when `S.mapKey`; `u` → clear this question's staged action; `?` → cheatsheet overlay (table of the §7 rows) with an "Turn shortcuts off" switch stored at `localStorage["grill:keys"]="off"` (when off, only ⌘↵ and Esc remain).
- [ ] Toast and overlay are `role="status"` / `role="dialog"` with focus return.
- [ ] E2E: each shortcut's effect; `j` typed in the thread textarea types a `j`; `1` with 2 options does nothing for `3`; IME composition ignored (dispatch `keydown` with `isComposing: true`); ⌘↵ from a textarea sends; `?` opens and Esc closes; off switch persists across reload.

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/keyboard.e2e.mjs` → PASS.

**Steps:** e2e first → FAIL → implement:

```js
const inField = (el) => !!el && (el.matches("input, textarea, [contenteditable], [contenteditable] *"));
document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const send = (e.metaKey || e.ctrlKey) && e.key === "Enter";
  if (send) { e.preventDefault(); Grill.send(); return; }
  if (e.key === "Escape") { closeOverlays() || (inField(document.activeElement) && document.activeElement.blur()); return; }
  if (e.ctrlKey || e.altKey || e.metaKey || inField(document.activeElement) || keysOff()) return;
  handleKey(e);
});
```
→ PASS → **Commit** `git commit -m "feat(page): keyboard layer and cheatsheet"` (after `git add`).

---

### Task 20: Visual linkage (data-q) and visual-brief

**Goal:** Region highlighting and click-to-select between questions and the sandboxed visual, ⌘↵/Esc forwarded out of the iframe; port `visual-brief.md` with the verbatim listener.

**Spec:** §7 Visual linkage, Inbox "hovering a question highlights its `data-q` regions"; §10 "⌘↵ forwarded from the visual". **Depends on:** T19.

**Files:** Create `skills/grilling-ui/visual-brief.md`; Modify `page/core.js`, `page/inbox.html`; Modify `test/keyboard.e2e.mjs`.

**Acceptance Criteria:**
- [ ] `visual-brief.md` = `$JASON/visual-brief.md` with "grill-with-ui" → "grilling-ui", plus a section "Linking regions to questions": every region that a question decides gets `data-q="qN"`; the file must include the listener below **verbatim** before `</body>`; `grep -n 'data-q' visual.html` must return at least one hit per answered question the visual depicts.
- [ ] Parent side in `core.js`: `Grill.highlight(ids)` posts `{highlight: ids}` to `#visual-frame`; `message` handler accepts only `e.source === frame.contentWindow`, `clicked` matching `/^q\d+$/` → `layout.select(id)`; `key: "send"` → `send()`; `key: "escape"` → focus returns to the page (`document.body` → current question heading).
- [ ] Inbox: `mouseenter` on a nav item / card → `highlight([id])`; `mouseleave` → `highlight([])`.
- [ ] E2E (extend keyboard.e2e): a fixture `visual.html` containing the listener and `data-q` regions; hover Q2 → region has class `grill-hl`; click region `q3` → Q3 selected; ⌘↵ pressed with focus inside the iframe sends staged actions.

Listener (verbatim in `visual-brief.md`):

```html
<script>
/* grilling-ui linkage: copy verbatim */
(() => {
  const P = window.parent;
  const st = document.createElement("style");
  st.textContent = ".grill-hl{outline:2px solid #8a5a12;outline-offset:2px}";
  document.head.appendChild(st);
  addEventListener("message", (e) => {
    if (e.source !== P || !e.data || !Array.isArray(e.data.highlight)) return;
    const ids = e.data.highlight.filter((x) => /^q\d+$/.test(x));
    document.querySelectorAll("[data-q]").forEach((el) => el.classList.toggle("grill-hl", ids.includes(el.dataset.q)));
  });
  addEventListener("click", (e) => { const r = e.target.closest("[data-q]"); if (r) P.postMessage({ clicked: r.dataset.q }, "*"); });
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); P.postMessage({ key: "send" }, "*"); }
    else if (e.key === "Escape") P.postMessage({ key: "escape" }, "*");
  });
})();
</script>
```

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/keyboard.e2e.mjs` and `page.e2e.mjs` → PASS.

**Steps:** extend e2e → FAIL → implement → PASS → **Commit** `git commit -m "feat(page): visual linkage via data-q"` (after `git add`).

---

# Milestone 4 — Skills (spec §9.4, §3, §4)

### Task 21: `grilling-ui` SKILL.md (engine)

**Goal:** The shared engine skill: override table first, transport protocol, per-agent listening from `agent-profile`, Visualize, Finish profiles, resume, schema. No interview method.

**Spec:** §2 (grilling-ui row), §3 override table, §4, §5 (watcher, ownership), §5b portable conventions + Listening + per-agent differences, §6 step 5, §7 prompt-only rules. **Depends on:** T13, T15, T16, T17.

**Files:** Create `skills/grilling-ui/SKILL.md`; Create `skills/grilling-ui/test/skills.test.mjs`.

**Acceptance Criteria:**
- [ ] Frontmatter: `name: grilling-ui`, `description:` trigger-free ("Browser transport for the -ui grill skills: publishes rounds to a local page and listens for Sends. Loaded by grill-me-ui, grill-docs-ui and wayfinder-ui."), `user-invocable: false`.
- [ ] Sections in order:
  1. **Overrides** — the §3 table verbatim (6 rows), preceded by: "This skill loads last. Where Pocock's `grilling` or `domain-modeling` disagree with this table, this table wins."
  2. **`$SKILL`** definition verbatim from §5b rule 2; "Run commands only as `node "$SKILL/hub.mjs" …`."
  3. **Files and ownership** (state.json via `patch` only; events.jsonl page-only; visual.html via subagent; meta.json hub-only) — adapted `$JASON/SKILL.md:11-41`.
  4. **Patching** — port `$JASON/SKILL.md:43-99` with `--agent-id <agentId>`; add `phase`, `mapKey`, `map`, `finished.kind`; `owner`/`token` forbidden.
  5. **Start (called by a wrapper with topic, doc, finish profile)** — `new --topic … --doc … --agent <agent>` → patch round 1 = **the whole frontier** (override row 1) → `agent-profile --session <session>` → arm the listener exactly as printed → `open --session <session>` → print ONE line: URL, number of open questions, doc path (§6 step 5).
  6. **Listening** — per profile: monitor (re-arm on expiry with current `handled`) or wait (Jason's contract `$JASON/SKILL.md:17-41` and `354-386` verbatim, but `wait` prints every pending send, D11). "If you must stop, say the listener is inactive; Sends queue and replay on resume."
  7. **The event rule** — `$JASON/SKILL.md:132-147` + background fact-finding subagents handled like draw completions (override row 4: patch downstream questions, set `note` while pending).
  8. **Handling a send** — `$JASON/SKILL.md:149-204`, changed: round = whole frontier; title ≤ 8 words; `rec.why` ≤ 2 sentences naming the cost; a thread reply's first line is the answer; domain conflicts go in a thread reply or a reopen, never terminal prose (override row 6); terminal line only (override row 2).
  9. **Visualize** — `$JASON/SKILL.md:226-315` with the draw tool from the profile (`draw.tool`), `inline` for Pi; brief template adds "Tag regions with `data-q` and paste the linkage listener from visual-brief.md verbatim."
  10. **Terminal input** — `$JASON/SKILL.md:317-324`.
  11. **Finish** — confirmation = the user's Finish send (override row 5; open questions → Deferred / Open threads). Three profiles selected by the wrapper: `design-doc` (`$JASON/SKILL.md:326-352`, §4 sections list), `docs` (§4 grill-docs-ui rules), `wayfinder` (defer to wayfinder-ui's Finish; this skill only provides the patch shapes `finished.kind: "map"|"no-map"` and `map`). Stop the listener (Monitor TaskStop / end the wait loop); **never stop the hub**.
  12. **Resume** — `resume` (auto-pick / choose / `--take` on user say-so), `pending` drain in one patch (`$JASON/SKILL.md:118-130`), then Start steps from "agent-profile".
  13. **state.json** schema — `$JASON/SKILL.md:388-428` + `id, projectKey, cwd, branch, phase, mapKey, map, finished.kind, owner (read-only)`.
- [ ] `skills.test.mjs` asserts: frontmatter keys; the override table contains all six left-column phrases from §3; every `node "$SKILL/hub.mjs" <cmd>` mentioned is a real subcommand (parse `hub.mjs` usage); no `../` paths; no "Call the Skill tool with" lines (the engine loads nothing).

**Verify:** `node --test skills/grilling-ui/test/skills.test.mjs` → pass.

**Steps:** test → FAIL → write SKILL.md → PASS → **Commit** `git commit -m "feat(skills): grilling-ui engine skill"` (after `git add`).

---

### Task 22: `grill-me-ui` and `grill-docs-ui` wrappers

**Goal:** Two thin wrappers: preflight, load order, finish profile.

**Spec:** §1 goal 1, §3 load order + Preflight + Descriptions, §4 grill-me-ui / grill-docs-ui, §5b rule 1. **Depends on:** T21. **Parallel with:** T23.

**Files:** Create `skills/grill-me-ui/SKILL.md`, `skills/grill-docs-ui/SKILL.md`; Modify `test/skills.test.mjs`.

**Acceptance Criteria:**
- [ ] `grill-me-ui/SKILL.md` (full text; adapt only wording, not steps):

```markdown
---
name: grill-me-ui
description: Grill me with ui. Runs Matt Pocock's grilling interview on a local browser page instead of the terminal and writes a design doc at the end. Use when the user says "grill me with ui", "grill with ui", "ui grill", or invokes /grill-me-ui (also "/grill-me-ui resume").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

1. **Preflight.** Call the Skill tool with `grilling` (in Claude Code: `mattpocock-skills:grilling`). If it cannot be loaded, stop and tell the user to install Pocock's skills — Claude Code: `claude plugin install mattpocock-skills@mattpocock`; other agents: `npx skills add -g mattpocock/skills`. Never grill from memory.
2. Call the Skill tool with `grilling-ui` (in Claude Code: `intelligentrascal:grilling-ui`). It loads last; its Overrides table wins.
3. Follow grilling-ui **Start** with the user's topic, doc path `docs/<slug>-design.md` (the user may change it), and finish profile **design-doc**. For "resume", follow grilling-ui **Resume**.
```
- [ ] `grill-docs-ui/SKILL.md`: same shape; description "Grill with docs, with ui …" triggers ("grill with docs ui", "grill-docs-ui", "grill with docs in the browser"); step 1 loads `grilling` then `domain-modeling` (in Claude Code: `mattpocock-skills:domain-modeling`) as **two calls**; preflight checks both; finish profile **docs**; adds: "After every `CONTEXT.md` edit, patch the page `terms` with the terms touched in this grill only."
- [ ] Descriptions contain "ui" trigger phrases and do not contain bare "grill me" as a standalone trigger (test: every quoted trigger phrase contains "ui" or "browser").
- [ ] Tests extended: load order (grilling line precedes grilling-ui line), both name forms present, no `../`.

**Verify:** `node --test skills/grilling-ui/test/skills.test.mjs` → pass.

**Steps:** extend test → FAIL → write both files → PASS → **Commit** `git commit -m "feat(skills): grill-me-ui and grill-docs-ui wrappers"` (after `git add`).

---

### Task 23: `wayfinder-ui` (chart + work mode), vendored wayfinder, upstream pin

**Goal:** Wayfinder wrapper reading its vendored copy, with chart-mode phases, work mode (one ticket = one session), Finish tracker writes then map snapshot.

**Spec:** §2 (upstream/wayfinder.md, upstream.json), §3 wayfinder-ui row, §4 wayfinder-ui, §5b other differences (research tickets on Pi), §8 upstream.json. **Depends on:** T21. **Parallel with:** T22.

**Files:** Create `skills/wayfinder-ui/SKILL.md`, `skills/wayfinder-ui/upstream/wayfinder.md`, `upstream.json`; Modify `test/skills.test.mjs`.

**Acceptance Criteria:**
- [ ] `upstream/wayfinder.md` = byte copy of `$POCOCK_PIN/skills/engineering/wayfinder/SKILL.md` (pinned 1.2.3 / `3cca18b`).
- [ ] `upstream.json`:

```json
{ "pocock": { "plugin": "mattpocock-skills",
  "claude": { "version": "1.2.3", "commit": "3cca18b368ae95cdbdebbff572ccafa662551015" },
  "agents": null,
  "wayfinder": { "vendoredFrom": "3cca18b368ae95cdbdebbff572ccafa662551015" } } }
```
- [ ] `wayfinder-ui/SKILL.md`: description triggers "wayfinder ui", "wayfind with ui", "/wayfinder-ui", "/wayfinder-ui board <map>"; `$SKILL` line; preflight as T22 (grilling + domain-modeling); "Read `$SKILL/upstream/wayfinder.md` (same folder) and follow it, with these changes:"
  - **Chart mode:** one UI session for steps 1–2: `new --topic "<idea>" --phase destination --agent <agent>` (no `--doc`); patch `phase: "frontier"` when the destination is settled; each grill point loads `grilling` (+ `domain-modeling`) then `grilling-ui`.
  - **Finish (chart):** run steps 3–5 on the tracker (map issue, tickets, blocking edges second pass, research subagents per profile `research`; on Pi leave them open and say so). Only after those succeed: `map-patch --map <projectKey>/<slug>` with the full snapshot, then session patch `{ "mapKey", "map": <same snapshot>, "finished": { "kind": "map" } }`. No fog → `finished: { kind: "no-map" }` and tell the user in the terminal (step 2 "ask how to proceed").
  - **Work mode:** `/wayfinder-ui <map>`: load map, choose/claim one ticket (`claim --map … --ticket … --agent-id …` first, then the tracker assignee), `new --topic "<ticket title>" --phase ticket --map-key <key>`; Finish records the resolution on the tracker, updates `map-patch`, patches the session `map` + `finished.kind: "map"`. Never more than one ticket per session.
  - `mapKey` rules per D2 (§4a).
  - No design doc in either mode.
- [ ] Tests: vendored file equals the pinned file (skip if `$POCOCK_PIN` absent); upstream.json shape; SKILL.md mentions `--phase destination`, `finished`, `map-patch`, "one ticket".

**Verify:** `node --test skills/grilling-ui/test/skills.test.mjs` → pass; `cmp skills/wayfinder-ui/upstream/wayfinder.md ~/.claude/plugins/cache/mattpocock/mattpocock-skills/1.2.3/skills/engineering/wayfinder/SKILL.md` → no output.

**Steps:** test → FAIL → copy + write → PASS → **Commit** `git commit -m "feat(skills): wayfinder-ui with vendored upstream"` (after `git add`).

---

### Task 24: Map screen, phase header, no-map state

**Goal:** Render the Wayfinder Map snapshot at the end of a grill in every layout (D9), show `phase` in the header, and the "No map needed — see terminal" state.

**Spec:** §4 wayfinder-ui (Map screen, no-map), §4a last paragraph ("Snapshot at <time> · canonical: <link>", local paths as plain text), §10 E2E "the Map screen". **Depends on:** T8, T17.

**Files:** Create `page/map-view.js`, `test/map.e2e.mjs`; Modify `page/core.js`, `page/inbox.html`, `lib/server.mjs` (asset whitelist already has it).

**Acceptance Criteria:**
- [ ] `map-view.js` exports `window.MapView.render(el, map, {now})`: header (destination, "Snapshot at <time> · canonical: <link>"), sections Decisions so far (title→gist), Frontier / Blocked (with blockedBy titles) / Claimed tickets (type chip, assignee), Closed (gist), Not yet specified (fog), Out of scope. Links render as `<a>` only for `http(s):` URLs; anything else is plain text (§4a). All text escaped.
- [ ] `core.js`: when `S.finished && S.finished.kind === "map"` the layout body is replaced by the Map screen (with a "Back to questions" toggle); `no-map` shows a banner "No map needed — see terminal"; header shows `phase` label (Destination / Frontier / Ticket).
- [ ] E2E: fixture session with `finished.kind: "map"` and a map with a local path link → Map screen renders sections, the path is plain text, snapshot time shown; `no-map` fixture shows the banner; phase label visible.

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/map.e2e.mjs` → PASS.

**Steps:** e2e → FAIL → implement → PASS → **Commit** `git commit -m "feat(page): wayfinder Map screen and phase header"` (after `git add`).

---

# Milestone 5 — Claude Code install (spec §9.5, §5b Installation)

### Task 25: Plugin and marketplace manifests

**Goal:** Installable local plugin `intelligentrascal` depending on `mattpocock-skills@mattpocock`.

**Spec:** §2 `.claude-plugin/`, §5b Installation (Claude Code). **Depends on:** T22, T23, T24.

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`; Create `scripts/test/manifest.test.mjs`.

**Acceptance Criteria:**
- [ ] `plugin.json`:

```json
{
  "name": "intelligentrascal",
  "version": "0.1.0",
  "description": "Browser-UI versions of Matt Pocock's grill-me, grill-with-docs and wayfinder skills, on one shared local hub.",
  "author": { "name": "Rahil" },
  "license": "MIT",
  "keywords": ["grilling", "wayfinder", "ui"],
  "dependencies": [{ "name": "mattpocock-skills", "marketplace": "mattpocock" }]
}
```
- [ ] `marketplace.json`:

```json
{
  "name": "intelligentrascal",
  "owner": { "name": "Rahil" },
  "allowCrossMarketplaceDependenciesOn": ["mattpocock"],
  "plugins": [{ "name": "intelligentrascal", "source": "./", "description": "Grill skills with a browser UI." }]
}
```
- [ ] Skills are found by the default `skills/` scan (four folders).
- [ ] `claude plugin validate /Users/rahil/code/skills` reports no errors.
- [ ] Test parses both files and asserts names, dependency, allowlist, and that each `skills/*/SKILL.md` has matching `name`.

**Verify:** `node --test scripts/test/manifest.test.mjs` → pass; `claude plugin validate /Users/rahil/code/skills` → valid; `claude plugin marketplace add /Users/rahil/code/skills && claude plugin install intelligentrascal@intelligentrascal && claude plugin list | grep intelligentrascal` → listed, enabled.

**Steps:** test → FAIL → write manifests → PASS → validate/install → **Commit** `git commit -m "feat(plugin): plugin and marketplace manifests"` (after `git add`).

---

### Task 26: Dogfood — two concurrent grills + Monitor wake — HUMAN GATE

**Goal:** Prove the Claude Code path end to end and verify the override table is obeyed.

**Spec:** §9.5 dogfood; §10 Manual (Monitor event wakes an idle turn; Monitor expiry notice does too); §11 risks (agent ignores override table). **Depends on:** T25.

**Files:** Create `docs/superpowers/verification/2026-milestone-5-dogfood.md` (checklist results; not a design doc).

**Acceptance Criteria (human-in-the-loop, each ticked by the user):**
- [ ] In project A: `/intelligentrascal:grill-me-ui <topic>`; in project B (different repo) at the same time: `/intelligentrascal:grill-docs-ui <topic>`. One hub (`cat ~/.intelligentrascal/hub.json` pid constant; `ps` shows one `hub.mjs serve`), two `watch` processes.
- [ ] The browser opened by itself for each; the URL line was also printed.
- [ ] Round 1 contained the whole frontier; the terminal shows only one status line per send (no ❓/➡️ rounds).
- [ ] A Send made while the Claude turn is idle wakes it (Monitor event) and is handled; leaving it idle past the Monitor timeout (temporarily set `timeout_ms` to 60 000 via a patched profile env `GRILL_MONITOR_MS=60000` supported by `agent-profile`) produces an expiry notice that re-arms with the current `handled`.
- [ ] Tabs show `<project> · <topic>` and status favicons; closing Claude in project B flips its page to "no agent listening" within 3 min; `/intelligentrascal:grill-docs-ui resume` picks it up and replays queued Sends.
- [ ] Finish in A writes `docs/<slug>-design.md` with all §4 sections; B updates `CONTEXT.md`/ADRs and its doc has "see CONTEXT.md" Terms and ADR-linked Locked decisions.
- [ ] Defects found are fixed (separate commits) before the gate is marked done.

**Verify:** the verification file lists every box with the user's ✓ and date.

**Steps:**
- [ ] **Step 1:** Add `GRILL_MONITOR_MS` override to `lib/profile.mjs` (unit test in `profile.test.mjs`), commit.
- [ ] **Step 2:** Walk the user through the checklist; record results.
- [ ] **Step 3: Commit** `git add docs/superpowers/verification && git commit -m "docs: milestone 5 dogfood results"`

---

# Milestone 6 — Multi-agent (spec §9.6, §5b)

### Task 27: Codex `openai.yaml` sidecars

**Goal:** Codex UI metadata and invocation policy for all four skills.

**Spec:** §2 (`agents/openai.yaml`), §5b Installation (sidecars), rule 3; Pocock convention `$POCOCK/.agents/invocation.md`. **Depends on:** T22, T23. **Parallel with:** T28.

**Files:** Create `skills/{grilling-ui,grill-me-ui,grill-docs-ui,wayfinder-ui}/agents/openai.yaml`; Modify `test/skills.test.mjs`.

**Acceptance Criteria:**
- [ ] `grilling-ui/agents/openai.yaml`:

```yaml
interface:
  display_name: "Grilling UI (engine)"
  short_description: "Browser transport for the -ui grill skills"
policy:
  allow_implicit_invocation: false
```
- [ ] Wrappers: `interface.display_name` "Grill Me (UI)", "Grill With Docs (UI)", "Wayfinder (UI)" and short descriptions; **no** `policy` block (they are model-invocable by their "ui" triggers, spec §3 Descriptions).
- [ ] Test parses the YAML with a tiny line parser (no deps) and asserts the above.

**Verify:** `node --test skills/grilling-ui/test/skills.test.mjs` → pass.

**Steps:** test → FAIL → files → PASS → **Commit** `git commit -m "feat(skills): Codex openai.yaml sidecars"` (after `git add`).

---

### Task 28: `install-agents.sh` and Codex sandbox check

**Goal:** One script to install the skill set for Codex, OpenCode and Pi; check Pocock's skills; record the agents pin; print/check the Codex sandbox config.

**Spec:** §5b Installation steps 1–4, Codex sandbox; §8 `upstream.json.agents`; §10 Manual "install-agents.sh on a clean ~/.agents/skills". **Depends on:** T25. **Parallel with:** T27.

**Files:** Create `scripts/install-agents.sh` (chmod +x), `scripts/test/install-agents.test.mjs`.

**Acceptance Criteria:**
- [ ] Honors `HOME` and `AGENTS_SKILLS_DIR` (default `$HOME/.agents/skills`) so tests run in a temp HOME.
- [ ] Step 1: `ln -sfn "$REPO/skills/<s>" "$DEST/<s>"` for **all four** skills (never a subset); refuses (exit 1) if a non-symlink directory with one of those names exists.
- [ ] Step 2: finds `grilling` and `domain-modeling` in `$DEST` or `$HOME/.pi/agent/skills`; if missing prints `npx skills add -g mattpocock/skills` and exits 2 after linking.
- [ ] Step 3: records `upstream.json.pocock.agents = { "dir": <where found>, "skillFolderHash": <from the skills lock file>, "contentSha": <sha256 of grilling+domain-modeling SKILL.md> }`. Lock file: `$XDG_STATE_HOME/skills/.skill-lock.json` else `$HOME/.agents/.skill-lock.json` (`$RESEARCH/vercel-labs-skills/src/skill-lock.ts:7,64-70`); missing lock → `skillFolderHash: null`. JSON edited with `node -e` (no jq dependency).
- [ ] Step 4: prints the exact Codex config block from T9; checks `$HOME/.codex/config.toml` for `network_access = true` under `[sandbox_workspace_write]` and `~/.intelligentrascal` (expanded) in `writable_roots`; prints "Codex sandbox: OK" or "Codex sandbox: missing — add the block above".
- [ ] Idempotent (second run: same links, no errors).
- [ ] Test: temp HOME with fake `~/.agents/skills/grilling/SKILL.md` + `domain-modeling/SKILL.md` and a lock file → exit 0, 4 symlinks to the repo, `upstream.json` updated (test copies the repo's `upstream.json` to a temp repo root via `REPO_ROOT` env override); without Pocock skills → exit 2 with the npx hint; codex config present/missing messages.

**Verify:** `node --test scripts/test/install-agents.test.mjs` → pass; `bash -n scripts/install-agents.sh` → no output.

**Steps:** test → FAIL → script → PASS → **Commit** `git commit -m "feat(scripts): install-agents for Codex, OpenCode, Pi"` (after `git add`).

---

### Task 29: Smoke runs on Codex, OpenCode, Pi — HUMAN GATE

**Goal:** Verify install, listening discipline and the full grill loop on each non-Claude agent.

**Spec:** §9.6 smoke runs; §10 Manual; §11 risks (Codex sandbox, wait-mode discipline). **Depends on:** T27, T28.

**Files:** Create `docs/superpowers/verification/2026-milestone-6-smoke.md`; fixes as needed.

**Acceptance Criteria (human-in-the-loop, per agent):**
- [ ] `scripts/install-agents.sh` on a clean `~/.agents/skills` (move the old dir aside first) → links + pin recorded.
- [ ] **Codex** (with sandbox config): without the config, `grill-me-ui` fails with the exact T9 fix text; with it, the page opens, a Send is handled via `exec_command` wait + `write_stdin` polling, exit 3 re-waits, the turn is not ended while listening; `agent-profile` output matched what the model did.
- [ ] **OpenCode** (`OPENCODE=1`): wait with `timeout: 600000`; two Sends handled; Visualize draws via Task tool.
- [ ] **Pi**: wait with no timeout; Esc kills only the wait (hub still up: `curl 127.0.0.1:<port>/health`); resume replays queued Sends; Visualize draws inline; a wayfinder chart Finish leaves research tickets open and says so.
- [ ] Any parameter-name mismatch found is fixed in `lib/profile.mjs` + test (separate commit).

**Verify:** verification file with per-agent ✓ and versions (`codex --version`, `opencode --version`, `pi --version`).

**Steps:** walk through with the user; record; **Commit** `git add docs/superpowers/verification && git commit -m "docs: milestone 6 smoke results"`

---

# Milestone 7 — Brief and/or Studio (spec §9.7, §7) — conditional on T6

Read `design/mockups/decision.json`. Do T30 only if `build` contains `"brief"`, T31 only if it contains `"studio"`. Skipped tasks are marked completed with note "not chosen in T6". If neither is chosen, do only the layout-precedence part of T32.

### Task 30: Brief layout (if chosen)

**Goal:** Production Brief layout on `core.js`, from the winning mockup.

**Spec:** §7 Brief row, Keyboard, Visual linkage; D9 (Map screen reuse). **Depends on:** T6, T20. **Parallel with:** T31.

**Files:** Create `page/brief.html`; Modify `lib/server.mjs` (layout listed in `GRILL.layouts` when the file exists — already generic).

**Acceptance Criteria:**
- [ ] Behaviour of `design/mockups/brief.template.html` (T4 criteria) driven by live `S` via `Grill.mount`; all core semantics (staging, pending, working, finished banner, explore table inline under the block, visualize, feedback composer under the sticky figure).
- [ ] Hooks: `current()` = focused block; `move(±1)` walks open/reopened blocks then answered lines in document order; `select(id)` scrolls the block into view and focuses its heading (`tabindex=-1`); `focusThread()` expands the thread and focuses its composer; `focusFree()` focuses the free-text field.
- [ ] Reopen control on an answered line stages `reopen`.
- [ ] When `finished.kind === "map"`, renders via `MapView` (D9).

**Verify:** covered by T32 e2e.

**Steps:** port mockup markup/CSS → wire to core → manual check at 1440/1000/390 → **Commit** `git commit -m "feat(page): Brief layout"` (after `git add`).

---

### Task 31: Studio layout (if chosen)

**Goal:** Production Studio layout on `core.js`.

**Spec:** §7 Studio row, Keyboard (`r`/`f` set the chip), Visual linkage. **Depends on:** T6, T20. **Parallel with:** T30.

**Files:** Create `page/studio.html`.

**Acceptance Criteria:**
- [ ] Behaviour of T5 criteria on live state; composer target chip stages `thread` (`@qN thread`), `answer` text (`@qN answer`), or `visual-feedback` (`visual`).
- [ ] Hooks: `move` walks cards in the timeline; `focusThread()`/`focusFree()` set the chip and focus the composer; clicking a region selects its card.
- [ ] Before the first draw: "Agreed so far" + Visualize CTA; during first draw: "Drawing the first version…".

**Verify:** covered by T32 e2e.

**Steps:** port → wire → manual check → **Commit** `git commit -m "feat(page): Studio layout"` (after `git add`).

---

### Task 32: Layout e2e and layout precedence

**Goal:** One e2e flow per built layout; D1/§6 precedence (explicit `--ui` > last used > Inbox).

**Spec:** §6 Layout precedence; §7 Switching layouts ("by path, nothing written to state"); §10 "one flow per built layout". **Depends on:** T30 and/or T31 (whichever ran).

**Files:** Create `test/layouts.e2e.mjs`.

**Acceptance Criteria:**
- [ ] Per built layout: stage an option with `1`, write a thread message, send, handled patch shows the reply, `g i` switches to Inbox with staged work intact (localStorage `grill:<id>`), `state.json` unchanged by switching.
- [ ] Precedence: fresh profile, bare URL → Inbox; visit `/brief` then bare URL → redirected to `/brief`; `hub.mjs url --ui inbox` → `/inbox` stays Inbox; an unbuilt layout path → 302 to `/inbox`.

**Verify:** `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/layouts.e2e.mjs` → PASS.

**Steps:** write e2e → run → fix → **Commit** `git commit -m "test(page): layout flows and precedence"` (after `git add`).

---

# Milestone 8 — Ticket board (spec §9.8, §4a)

### Task 33: Claim compare-and-set, actions, map watch/wait

**Goal:** Hub endpoints for board actions and atomic claims; CLI `claim`; `watch/wait --map` with listener heartbeat.

**Spec:** §4a Actions, Board watcher, Work-this-ticket hand-off steps 1–4, Concurrency; D4, D10; §10 "claim compare-and-set: two concurrent claims give one winner". **Depends on:** T14.

**Files:** Modify `lib/maps.mjs` (`claim`, `release`), `lib/server.mjs`, `hub.mjs`; Create `test/claim.test.mjs`.

**Acceptance Criteria:**
- [ ] `claim(map, title, who, now, seq)` / `release(map, title, agentId)` pure functions per D10 (404 unknown, 409 not frontier or already claimed; release only by the claimant or when `agentId` matches `hubClaim.agentId`).
- [ ] `POST /m/<key>/claim {ticket}` (token + Origin): synchronous read → `claim` → write → append `{type:"work", seq, at, ticket}` to `events.jsonl` → `m` ping; returns `{ok, seq, hubClaim}` or the error code.
- [ ] `POST /m/<key>/action {type:"refresh"}` appends `{type:"refresh", seq, at}`.
- [ ] `hub.mjs claim --map K --ticket T --agent-id A [--release]` → exit 0 / 5 (conflict, prints `{"conflict":…}`) / 4 (unknown).
- [ ] `watch --map K` / `wait --map K` tail `maps/<key>/events.jsonl` and heartbeat `POST /m/<key>/heartbeat` (sets `listener`); `map.json.handled` is advanced by the agent through `map-patch` (`handled` allowed in map patches).
- [ ] Tests: 20 concurrent `fetch` claims on one ticket → exactly one 200, 19 × 409; claims on two different tickets both succeed; CLI claim conflict exit 5; release then re-claim works; `wait --map` returns the work event.

**Verify:** `node --test skills/grilling-ui/test/claim.test.mjs` → pass.

**Steps:** tests → FAIL → implement → PASS → **Commit** `git commit -m "feat(hub): board claim CAS, actions, map watch"` (after `git add`).

---

### Task 34: Board page

**Goal:** `/m/<mapKey>/` board with columns, freshness header, listener state, Refresh and Work actions, keyboard.

**Spec:** §4a Columns, header, board freshness, Actions, "agent listening"/"no agent listening: requests queue", "claimed by <agentId>", "grilling now →"; §7 keyboard (`j/k` cards, `w` work, `g m`); §5 Tabs. **Depends on:** T33, T24 (map-view shared styles).

**Files:** Create `page/board.html`, `page/board.js`; Modify `page/core.js` (factor SSE/presence/keyboard base so `board.js` can reuse: `Grill.transport` and `Grill.keys`), `lib/server.mjs` (board route serves `board.html` with `GRILL={kind:"map",key,token,base}`).

**Acceptance Criteria:**
- [ ] Columns: Frontier · In progress (claimed) · Blocked · Done; Fog and Out of scope below. Card: title, type chip, blockedBy titles, assignee, link (http(s) only as anchor); Done cards show `gist`.
- [ ] Header: destination; "Updated <relative time> · canonical: <link>" (age re-rendered every 30 s); listener state from `listener.heartbeat` (< 180 s).
- [ ] Frontier card: "Work this ticket" button (+ `w`) → `POST claim`; on 200 the card moves to In progress showing "queued" until `seq <= map.handled`, then "claimed by <agentId>"; if the ticket later carries a `session` link (`tickets[].session` URL, allowed by `validateMap` as an http URL) show "grilling now →". 409 → toast "Already claimed by …".
- [ ] Refresh button → `POST action refresh`, shows "refresh requested" until the next map update.
- [ ] Title `<project> · <map title>`; favicon; SSE + presence via shared transport; `j/k`, `w`, `g i/b/s` (back to last grill session if `?from=<id>`), `?` cheatsheet.
- [ ] Map screen (T24) links to the board: "Open board →".

**Verify:** covered by T36 e2e; manual check at 1440/390.

**Steps:** factor transport/keys → board page → **Commit** `git commit -m "feat(page): Wayfinder ticket board"` (after `git add`).

---

### Task 35: `wayfinder-ui` board mode and board watcher

**Goal:** `/wayfinder-ui board <map>` opens the board, arms a watcher on the map event log, and handles Work/Refresh as a hand-off (exactly one ticket per session).

**Spec:** §4a Board watcher, Work-this-ticket hand-off, Concurrency (GitHub/GitLab assignee canonical; release hub claim on conflict), Entry points; §5b Listening. **Depends on:** T34, T23.

**Files:** Modify `skills/wayfinder-ui/SKILL.md`, `skills/grilling-ui/SKILL.md` (map event rule), `lib/profile.mjs` (`--map` listen params), `test/profile.test.mjs`, `test/skills.test.mjs`.

**Acceptance Criteria:**
- [ ] `agent-profile --map KEY` prints listen params for `watch --map` / `wait --map` (same modes/timeouts as sessions); Monitor description `board: <project> · <map title>`.
- [ ] wayfinder-ui SKILL.md "Board" section: open (`open --map`), arm the watcher per profile, map-patch after **every** Wayfinder step (chart, claim, resolve, graduate fog, rule out of scope) and on Refresh (re-read tracker → full snapshot `map-patch` with `handled`).
- [ ] Map event rule (in grilling-ui, mirrored from the send event rule): a `work` line is user input; drain **only the first** unhandled `work` event: claim on the tracker (GitHub/GitLab assignee; local-markdown `Status: claimed`), `map-patch` `{tickets:[{title, assignee, session: <url>}], handled: <seq>}`, then start work mode for that ticket in a new grill session. Later `work` events stay queued for the next `/wayfinder-ui board` or `/wayfinder-ui <map>` session. If the tracker shows another assignee: `claim --release`, `map-patch` the real assignee, tell the user.
- [ ] Tests: profile map params; SKILL.md contains "exactly one", "claim --release", "map-patch".

**Verify:** `node --test skills/grilling-ui/test/profile.test.mjs skills/grilling-ui/test/skills.test.mjs` → pass.

**Steps:** tests → FAIL → edit → PASS → **Commit** `git commit -m "feat(skills): wayfinder-ui board mode and watcher"` (after `git add`).

---

### Task 36: Board e2e and concurrency test

**Goal:** Board render/Refresh/Work e2e; 5 sessions + 1 board on one hub with RSS budget.

**Spec:** §10 E2E "the board (render, Refresh, Work → claimed)", §10 Concurrency (5 sessions + 1 board across 2 fake projects; sends land in the right `events.jsonl`; RSS < 80 MB); §5 Resource budget. **Depends on:** T35.

**Files:** Create `test/board.e2e.mjs`, `test/concurrency.test.mjs`.

**Acceptance Criteria:**
- [ ] E2E: map with 2 frontier, 1 blocked, 1 closed, fog, out-of-scope → columns correct; Refresh appends a `refresh` event; `w` on a frontier card → card in In progress "queued" → simulated agent `map-patch` with `handled` → "claimed by <agentId>"; second tab clicking the same ticket gets the conflict toast; listener text flips with heartbeat age; local path link is plain text.
- [ ] Concurrency (unit, no browser): 2 temp projects, 5 sessions (`new`), 1 map; 50 sends spread randomly with correct tokens in parallel → each `events.jsonl` has exactly its own sends with contiguous seqs; 8 SSE readers connected; `GET /admin/stats` `rss` < 80 MB.

**Verify:** `node --test skills/grilling-ui/test/concurrency.test.mjs` → pass; `PLAYWRIGHT_PKG=… node skills/grilling-ui/test/board.e2e.mjs` → PASS.

**Steps:** write → run → fix → **Commit** `git commit -m "test: board e2e and hub concurrency"` (after `git add`).

---

# Milestone 9 — Sync, README, licenses (spec §9.9, §8)

### Task 37: `sync-pocock.sh`

**Goal:** Report and apply Pocock upstream changes safely: diffs per install, ahead-of-release warning, loud failures, wayfinder three-way merge, tests, pin bump, nothing committed.

**Spec:** §8 all bullets; §11 "Pocock restructures his skills". **Depends on:** T23, T28.

**Files:** Create `scripts/sync-pocock.sh`, `scripts/test/sync-pocock.test.mjs`.

**Acceptance Criteria:**
- [ ] Inputs (env-overridable for tests): `CLAUDE_PLUGINS=${CLAUDE_PLUGINS:-$HOME/.claude/plugins}`, `POCOCK_MARKETPLACE=$CLAUDE_PLUGINS/marketplaces/mattpocock` (git repo), `REPO_ROOT`.
- [ ] Claude install: read `installed_plugins.json` `mattpocock-skills@mattpocock[0]` `{version, gitCommitSha, installPath}`; if ≠ `upstream.json.pocock.claude`, for each of `grilling, domain-modeling, grill-me, grill-with-docs, wayfinder` print `git -C $POCOCK_MARKETPLACE diff <pinned>..<installed> -- skills/**/<name>/` (fetch the pinned commit if missing: `git fetch origin <sha>`).
- [ ] Agents install: if `upstream.json.pocock.agents` exists and the current `contentSha` differs, print `diff -u` of the SKILL.md files between the Claude pinned copy (`git show <pinned>:<path>`) and the agents copy; print both versions; note editing the npx copy is unsupported.
- [ ] Warn when `git -C $POCOCK_MARKETPLACE rev-list --count <installed>..origin/main` > 0 (after `git fetch -q origin main`; offline → skip with a note).
- [ ] Fail (exit 3, message naming the skill) if a delegated skill folder is missing/renamed at the installed version, or `grilling`/`domain-modeling` gained `disable-model-invocation: true` in SKILL.md or `allow_implicit_invocation: false` in `agents/openai.yaml`.
- [ ] Wayfinder: `git merge-file -L ours -L base -L theirs skills/wayfinder-ui/upstream/wayfinder.md <base tmp> <theirs tmp>` with base = pinned, theirs = installed; conflicts left marked, exit status reported.
- [ ] Run `node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs`; on success bump `upstream.json` pins (claude and, if present, agents, and `wayfinder.vendoredFrom`); never `git commit`.
- [ ] Test: builds a fake marketplace git repo with two commits (v1 pin, v2 installed) in a temp dir, fake `installed_plugins.json`, temp REPO_ROOT copy → asserts diff printed, merge applied, pins bumped, and a v3 where `grilling` gains `disable-model-invocation: true` exits 3.

**Verify:** `node --test scripts/test/sync-pocock.test.mjs` → pass; `bash -n scripts/sync-pocock.sh`.

**Steps:** test → FAIL → script → PASS → **Commit** `git commit -m "feat(scripts): sync-pocock"` (after `git add`).

---

### Task 38: README, licenses, final verification

**Goal:** Document install/usage per agent, record provenance and licenses, and run the full suite.

**Spec:** §2 (LICENSES, README), §5b Installation (README says disabling Pocock disables ours; Codex config), §8 (Jason provenance `daafa1e` in LICENSES and README only), §12 Deferred. **Depends on:** all.

**Files:** Create `README.md`, `LICENSES/jason-ku-grill-with-ui.MIT`, `LICENSES/matt-pocock-skills.MIT`.

**Acceptance Criteria:**
- [ ] `LICENSES/jason-ku-grill-with-ui.MIT` = `$JASON/LICENSE` text + header line "Forked once from https://github.com/jasonku09/grill-with-ui at commit daafa1e". `LICENSES/matt-pocock-skills.MIT` = Pocock's LICENSE (`$POCOCK/LICENSE`) + "Vendored: skills/wayfinder-ui/upstream/wayfinder.md".
- [ ] README sections: What it is (3 skills + board); Install — Claude Code (`claude plugin marketplace add ~/code/skills`, `claude plugin install intelligentrascal@intelligentrascal`, `/reload-plugins` after edits; dependency on `mattpocock-skills@mattpocock`; "if Pocock's plugin is disabled, Claude Code disables this one too"); Codex / OpenCode / Pi (`scripts/install-agents.sh`, `npx skills add -g mattpocock/skills`, the exact Codex config block); Usage (commands, resume, board, keyboard `?`); Runtime (`~/.intelligentrascal`, one hub, env vars `GRILL_HOME GRILL_NO_OPEN GRILL_OPENER`, logs); Upstream sync (`scripts/sync-pocock.sh`); Development (test commands, e2e with `PLAYWRIGHT_PKG`); Provenance (Jason fork at `daafa1e`, one-time; Pocock tracked); Deferred (§12).
- [ ] Full suite green; e2e suites green with Playwright; `claude plugin validate .` clean.

**Verify:**
- `node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs` → all pass
- `for f in skills/grilling-ui/test/*.e2e.mjs; do PLAYWRIGHT_PKG=… node "$f" || exit 1; done` → all PASS
- `claude plugin validate /Users/rahil/code/skills` → valid

**Steps:** write files → run all verifies → **Commit** `git add README.md LICENSES && git commit -m "docs: README and licenses"`

---

## Spec coverage checklist

| Spec | Tasks |
|---|---|
| §1 goals 1–7 | T21–T23 (1), T15 (2), T23/T37 (3), T3–T5/T17/T30–T31 (4), T9–T13/T36 (5), T16/T27–T29 (6), T33–T35/T19 (7) |
| §2 layout | T1, T7–T16, T21–T25, T27–T28, T37–T38 |
| §3 composition, overrides, preflight, descriptions | T21, T22, T23 |
| §4 per-wrapper output | T21 (Finish profiles), T22, T23, T24 |
| §4a board | T8, T14, T33, T34, T35, T36 |
| §5 runtime | T9–T14, T17–T18 |
| §5b multi-agent | T16, T21, T27, T28, T29 |
| §6 auto-open | T15, T21 |
| §7 page, layouts, keyboard, linkage, prompt rules | T1, T17–T20, T24, T30–T32, T34, T21 |
| §8 upstream sync | T23, T28, T37 |
| §9 milestones | M1–M9 in order |
| §10 testing | unit: T7–T16, T33, T36; e2e: T17–T20, T24, T32, T36; concurrency: T36; manual: T26, T29 |
| §11 risks | T9 (sandbox msg), T13/T26 (Monitor), T16/T29 (wait discipline), T37 (restructure), T26 (override table) |
| §12 deferred | README (T38) |

---

## Execution notes (amendments made while executing; binding)

- **E1 Visual direction (Rahil).** Inbox = Jason's page exactly (`tokens.css` = Jason's `:root`; sub-AA pairs are documented exceptions in `tokens.test.mjs`). Studio = Apple + Craft theme (`theme-studio.css`, `design/mockups/DESIGN.md`), designed with the tastemaker and hallmark skills. This replaces T1's darkened `--stage`/`--ink-3` values and T3's "links tokens.css / dashed rec" criteria for Inbox.
- **E2 T6 result.** A screenshot-driven agent usability run (`design/mockups/usability-results.json`) recommended Studio; Rahil then chose **Inbox** ("inbox design is the winner"). `decision.json` `build: []`: T30, T31 and T32 are skipped (D1 redirects are covered by `page.e2e`). Inbox-applicable UX notes from `decision.json.notes` still apply where they don't change Jason's look.
- **E3 T8 claims.** `tickets[].hubClaim` in a map patch is rejected (including `null`); only `applyMapPatch(…, { hub: true })` (claim/release) writes it; a ticket removed and re-added in one patch keeps its `hubClaim`; `handled` only increases; a title may not be in both `tickets` and `closed`.
- **E4 T9 lifecycle.** Handoff only to newer code (`codeTime`), lock staleness by age as well as pid, hub cwd = `GRILL_HOME`, Host header check, `GRILL_HOME` 0700 (spec §5 updated).
- **E5 T16 profile values** were verified against sources (`docs/superpowers/verification/agent-profile-sources.md`): Codex `exec_command` has no `timeout_ms`; OpenCode's sub-agent tool id is `task` and is foreground unless `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`; Pi `bash` `timeout` is in seconds; unknown agents leave research open. Spec §5b updated.
- **E6 Playwright.** E2E scripts honour `PLAYWRIGHT_CHANNEL` (e.g. `chrome`) when Playwright's bundled browser isn't installed.
