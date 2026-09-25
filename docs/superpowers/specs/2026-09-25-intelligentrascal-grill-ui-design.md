# intelligentrascal grill UI plugin: design

Date: 2026-09-25 · Status: draft for review · Owner: Rahil

Browser-UI versions of Matt Pocock's `grill-me`, `grill-with-docs` and `wayfinder` skills,
packaged as a Claude Code plugin. Started from a one-time fork of Jason Ku's
[`grill-with-ui`](https://github.com/jasonku09/grill-with-ui) (MIT). Pocock's skills are
the only upstream we track. Everything in the UI and transport layer is ours.

Reviewed adversarially twice before this draft (architecture and UI). Their findings are
folded in below.

## 1. Goals and non-goals

**Goals**

1. Three user-facing skills:
   - `/intelligentrascal:grill-me-ui`
   - `/intelligentrascal:grill-docs-ui`
   - `/intelligentrascal:wayfinder-ui`

   Each runs Pocock's interview method, with the conversation on a local browser page
   instead of the terminal.
2. The agent opens the page in the default browser itself (best effort) and still prints the URL.
3. Pocock's updates flow in: live delegation where possible, a sync script for the rest.
4. The page is built for fast shared understanding: what the agent is saying, the
   discussions, and the visuals. It ships in three layouts: Inbox, Brief and Studio.
5. Many concurrent grills (several agents, projects, repos or worktrees) run seamlessly on
   minimal resources.

**Non-goals**

- Tracking Jason's repo after the fork.
- Supporting agents other than Claude Code. The `wait` command stays as a cheap fallback
  but is not a supported path.
- Rendering Wayfinder tickets in the UI beyond the end-of-grill map snapshot.
- Dark mode. Keyboard shortcuts beyond Jason's ⌘↩.

## 2. Repository layout (`~/code/skills`)

```
.claude-plugin/
  marketplace.json          marketplace "intelligentrascal" → plugin at ./
  plugin.json               plugin "intelligentrascal"; dependencies: ["mattpocock-skills"]
skills/
  grilling-ui/              shared engine; user-invocable: false
    SKILL.md                transport protocol + override table (no interview method)
    hub.mjs                 the shared server (HTTP + SSE) and CLI
    lib/                    state.mjs (patch/validate), sessions.mjs, open.mjs
    page/
      core.js               poll/SSE, staging, send, header/footer/banner (from Jason's page.html)
      inbox.html            Jason's layout on core.js
      brief.html            document layout
      studio.html           visual-first layout
      tokens.css            the single shared token set
    visual-brief.md         drawing rules for the Visualize subagent (+ data-q tagging)
    test/
  grill-me-ui/SKILL.md
  grill-docs-ui/SKILL.md
  wayfinder-ui/
    SKILL.md
    upstream/wayfinder.md   vendored copy of Pocock's wayfinder SKILL.md (see §8)
upstream.json               { pocock: { plugin: "mattpocock-skills", version, commit } }
scripts/sync-pocock.sh
design/mockups/             static comparison mockups (build step 1)
LICENSES/                   jason-ku-grill-with-ui.MIT, matt-pocock-skills.MIT
README.md
```

- Every command in a SKILL.md uses `${CLAUDE_SKILL_DIR}`.
- The plugin is installed from the local marketplace. Edits go live after `/reload-plugins`.

## 3. Skill composition and instruction precedence

Pocock's `grill-me`, `grill-with-docs` and `wayfinder` carry `disable-model-invocation: true`,
so the agent cannot call them. `grilling` and `domain-modeling` are model-invocable, so we
call them live.

| Wrapper | Loads, **in this order** |
|---|---|
| `grill-me-ui` | `mattpocock-skills:grilling` → `intelligentrascal:grilling-ui` |
| `grill-docs-ui` | `grilling` → `mattpocock-skills:domain-modeling` → `grilling-ui` |
| `wayfinder-ui` | reads `upstream/wayfinder.md` (vendored) → then at each grill point, `grilling` (+ `domain-modeling`) → `grilling-ui` |

`grilling-ui` always loads **last**. Its first section is an explicit override table:

| Pocock's `grilling` says | Under grilling-ui |
|---|---|
| Ask the whole frontier per round | Kept. Each round = every unblocked question, published as question cards via `patch`. |
| "Format a round like so: ❓ … ➡️ …" | Replaced: print nothing to the terminal but the one status line per send. |
| "Wait for the user's answers" | Return to listening (Monitor re-arm, §5). |
| Dispatch sub-agents for facts, don't block | Kept. Run them in the background. Their completion notice is handled like a draw completion: patch downstream questions, set `note` while pending. |
| Done when the frontier is empty; don't act until the user confirms | Confirmation = the user's **Finish** send. Finish with open questions records them under Deferred / Open threads. |
| `domain-modeling`: "call out conflicts immediately" | As a thread reply on the affected question, or by reopening it. Never as terminal prose. |

**Preflight.** Each wrapper begins with: if the Skill tool reports a `mattpocock-skills:*`
skill as unknown, stop and tell the user to run `claude plugin install
mattpocock-skills@mattpocock`. Do not grill from memory.

**Descriptions.** Wrapper descriptions include "with ui" trigger phrases, so plain "grill me"
still goes to Pocock's terminal skill. `grilling-ui` has no trigger phrases.

## 4. Per-wrapper output

- **grill-me-ui.** Finish writes the design doc (`docs/<slug>-design.md`, path editable) with
  Jason's sections:
  - Summary
  - Terms
  - Why
  - Locked decisions
  - Routine choices
  - Verified facts
  - Risks
  - Deferred
  - Open threads

  If there is a visual, it is exported to `docs/<slug>-visual.html`.
- **grill-docs-ui.** `CONTEXT.md` and `docs/adr/` are the source of truth, updated during the
  grill by `domain-modeling`.
  - Page `terms` mirror only the terms touched in this grill. The agent patches them after
    each `CONTEXT.md` edit.
  - The Finish doc's **Terms** section is "see CONTEXT.md" plus the terms introduced here.
  - **Locked decisions** has one bullet per durable question, linking its ADR.
  - The remaining sections are unchanged.
- **wayfinder-ui.**
  - **Chart mode:** one UI session covers step 1 (destination) and step 2 (breadth-first
    frontier) as consecutive rounds. `state.phase` is `destination`, then `frontier`, and is
    shown in the header.
  - **Finish** runs Wayfinder steps 3–5 on the tracker: create the map and the tickets, wire
    the blocking edges, and fire the research subagents. Only after those tracker writes
    succeed does it patch a `map` snapshot and set `finished.kind: "map"`. The page then
    shows the Map screen (Brief layout).
  - If step 2 surfaces no fog, Finish sets `finished.kind: "no-map"` and the page says
    "No map needed — see terminal".
  - **Work mode:** one ticket = one UI session (`phase: "ticket"`, topic = the ticket title).
    Finish records the resolution on the tracker and shows the updated map snapshot.
  - No design doc in either mode.

`map` snapshot (an index, never a store; validated by the hub):

```jsonc
"map": { "title": "…", "link": "url-or-path", "at": "ISO",
  "destination": "…", "notes": "…",
  "decisions": [{ "title": "…", "link": "…", "gist": "…" }],
  "tickets":   [{ "title": "…", "link": "…", "type": "research|prototype|grilling|task",
                  "state": "frontier|blocked|claimed", "blockedBy": ["title"] }],
  "fog": ["…"], "outOfScope": [{ "gist": "…", "link": "…" }] }
```

The Map screen always shows "Snapshot at <time> · canonical: <link>". Local file paths render
as plain text.

## 5. Runtime: one shared hub, many grills

### Processes

- **Hub (`hub.mjs serve`).** One per user per plugin version.
  - Node, no dependencies.
  - Binds `127.0.0.1` on a port remembered in `~/.intelligentrascal/hub.json`
    (`{port, pid, version, started}`).
  - Serves every session at `/s/<sessionId>/` (and `/s/<id>/brief`, `/s/<id>/studio`).
- **Per-agent watcher.** A Monitor whose command is `tail -n0 -F <session>/events.jsonl`,
  with `timeout_ms: 1800000`, described as `grill: <project> · <topic>`. It costs almost
  nothing. On expiry the agent runs `hub.mjs pending` (to drain anything missed) and re-arms.
- No per-grill server process.

### Hub lifecycle

- `hub.mjs ensure`:
  1. Reads `hub.json`.
  2. If the hub pid is alive, answers `GET /health` and has the same `version`, it reuses it.
  3. Otherwise it takes an exclusive lock (`O_EXCL` on `hub.lock`, stale after 10 s), spawns
     the hub detached with its output going to `hub.log`, and waits for `/health`.

  Two agents starting at once therefore get one hub.
- **Version skew.** A newer plugin version starts its own hub on a new port and rewrites
  `hub.json`. The old hub keeps serving its sessions and exits when idle.
- **Idle exit.** The hub exits when no session has been active for 30 minutes. A session
  counts as active if it has an SSE client, a `patch`/`send` event, or an unfinished status
  touched in the last 30 minutes.
- **Crash recovery.** Any CLI call (`patch`, `url`, `open`) first runs `ensure`. The page
  reconnects its SSE on its own, and state lives on disk.

### Session identity and ownership

- **Folder:** `~/.intelligentrascal/grill-sessions/<project-key>/<YYYYMMDD-HHMMSS>-<rand4>/`.
  `GRILL_HOME` overrides the root.
- **`<project-key>`** is the git common root with slashes turned into dashes (worktrees share
  it). Outside git it is the working directory.
- **`state.json`** records `cwd`, `branch`, and `owner: { sessionAgent: <claude session id if
  available, else agent pid>, heartbeat }`. The agent refreshes the heartbeat on every patch.
  The hub treats a session with a heartbeat under 30 minutes old, or with a live watcher, as
  **in use**.
- **Resume:**
  - Lists unfinished sessions for this project with topic, branch, cwd, age, open/answered
    counts, and an **in use** flag.
  - Auto-picks only when there is exactly one session and it is not in use.
  - Otherwise asks.
  - Never silently attaches to a session another live agent owns.

### Updates to the page

- The hub watches each session's `state.json` (`fs.watch`, with a 2 s stat fallback) and
  pushes `state` events over SSE (`/s/<id>/events`). No 1-second polling.
- The page falls back to a 5 s poll only if SSE fails.
- Sends go by `POST /s/<id>/send`. The hub appends to that session's `events.jsonl`. Jason's
  Origin check (reject cross-origin and `null`) is kept.

### Tabs

- Title: `<project> · <topic>`.
- Favicon: an SVG dot for status (waiting, working, finished).
- The header shows the project, the branch and the doc path.

### Resource budget

One hub at about 40 MB RSS total, whatever the number of grills. One `tail` per active grill.
Idle tabs cost nothing.

## 6. Auto-open (`hub.mjs open --session DIR [--ui inbox|brief|studio]`)

1. Skip and print `{"opened":false,"reason":…}` when:
   - `GRILL_NO_OPEN=1` is set;
   - `SSH_CONNECTION` is set;
   - on Linux, neither `DISPLAY` nor `WAYLAND_DISPLAY` is set.
2. Ask the hub `GET /s/<id>/clients` → `{count, lastSeen}`. If a tab is connected, or one was
   seen in the last 120 s, don't open (this covers resume). After a hub restart, wait up to 3 s
   for an existing tab to reconnect before deciding.
3. Validate the URL against `^http://127\.0\.0\.1:\d+/s/[\w-]+/(brief|studio)?$`.
4. Spawn without a shell, with a 5 s time limit:
   - macOS: `open <url>`
   - Linux: `xdg-open <url>`
   - Windows: `cmd /c start "" <url>`

   The spawn command can be overridden with `GRILL_OPENER` (used by the tests).
5. The skill always prints the URL line as well.

## 7. The page: three layouts on one core

- **Shared core (`core.js`, taken from Jason's page.html).** It covers:
  - the SSE client;
  - staging in localStorage, keyed `grill:<sessionId>` so switching layouts mid-session
    keeps staged work;
  - Send, disabled while the agent works, with the 5-minute stuck-agent re-enable;
  - `explore` and `visualize` sent immediately;
  - the Finish confirm;
  - the header, status, footer and finished banner.

  All three layouts share Jason's semantics: staging survives reload, one Send = one turn,
  the updated/rec-changed marker, deferred and reopened questions.
- **Switching layouts.** By path, with a header switch. The last choice is remembered in
  localStorage. Nothing is written to state.
- **One token set (`tokens.css`).**
  - System fonts: serif headings, sans body.
  - No network.
  - Contrast checked on the real pairings.
  - All 8 control states, `:focus-visible`, reduced motion.
  - No italic headings, no re-drawn chrome.
  - Stacks below 760 px.

### Layouts

| Layout | Model | Details |
|---|---|---|
| **Inbox** | Queue | Jason's list \| card \| discussion. Added: hovering a question highlights its `data-q` regions in the visual. |
| **Brief** | Document | One column (~68ch), with sections derived from dep roots (each section is titled by its root question). Answered question = one prose line `title → chosen option` with a reopen control. Open or reopened question = a compact block: heading, full-text options as a vertical list, the recommendation dashed and pre-selected, the why in one line, a free-text field always visible, and the thread collapsed to bold first lines that expand inline. Deferred questions get their own section. At 1100 px and wider there is a left jump rail and the visual as a sticky figure on the right; below that the figure sits under the header. Also used for the Wayfinder Map screen. |
| **Studio** | Visual-first conversation | The visual iframe takes about 60%. A conversation rail shows everything in one timeline, grouped under sticky round headers: question cards in full, answered cards collapsed to one line, thread messages placed by `at`, and visual feedback in the same stream. One composer with a target chip (`@q15` / `visual`). Hovering a card highlights its regions; clicking a region selects its card. Before the first draw, the main area shows "agreed so far" (derived from the answers) and a Visualize call to action. |

### Visual linkage

The only visual-brief addition is:

- Regions carry `data-q="qN"`.
- The visual includes a verbatim listener of about 12 lines:
  - parent → child: `{highlight:[ids]}`
  - child → parent: `{clicked:id}`
- The parent filters `e.source === frame.contentWindow` and treats payloads as ids only.

If the subagent forgets the tags, linking silently does nothing.

### Prompt-only rules (no schema change)

- A question title is a question of ≤ 8 words.
- `rec.why` is ≤ 2 sentences and names the cost.
- A thread reply's first line is the answer.

## 8. Upstream sync (Pocock only)

- `upstream.json` pins the installed `mattpocock-skills` **version** (from
  `~/.claude/plugins/installed_plugins.json`) and its commit.
- `scripts/sync-pocock.sh`:
  1. Reads the installed version. If it differs from the pin, diffs `grilling`,
     `domain-modeling`, `grill-me`, `grill-with-docs` and `wayfinder` between the pinned
     cache (or a git checkout of the pinned commit) and the installed version, and prints it.
  2. Warns if upstream `main` is ahead of the installed release (a
     `claude plugin update mattpocock-skills` is available).
  3. Fails loudly if a delegated skill was renamed or removed, or if `grilling` or
     `domain-modeling` gained `disable-model-invocation`.
  4. Wayfinder: runs a three-way `git merge-file` of our `upstream/wayfinder.md` (ours),
     Pocock's pinned version (base) and his new version (theirs). Conflicts are left marked.
  5. Runs the tests, bumps the pin, and leaves everything uncommitted for review.
- Jason's code is a one-time fork. Its provenance (commit `daafa1e`) is recorded in
  `LICENSES/` and the README only.

## 9. Delivery order

1. **Comparison mockups (cheap).**
   - Static `design/mockups/{inbox,brief,studio}.html` driven by one `data.js`: Jason's real
     17-question session, plus a synthetic round of 8 open questions with two reopened, one
     deferred and a stale visual.
   - A picker page (`?v=`, number keys), screenshotted at 1440 px and 390 px.
   - The user runs four timed tasks in each:
     1. What did we decide about X?
     2. Answer the open round.
     3. Find which part of the visual Q15 changes.
     4. Push back on Q16 in free text.
   - We build only what wins. Inbox is always built.
2. Hub + CLI (`ensure`, `new`, `patch`, `url`, `open`, `pending`, `sessions`, `wait`), with tests.
3. `core.js` + Inbox, reaching parity with Jason's e2e test.
4. `grilling-ui` SKILL.md (override table, listening, Visualize, Finish), then the three wrappers.
5. Brief and/or Studio (per step 1), and the Map screen.
6. `sync-pocock.sh`, the README, licenses, and local marketplace install.
7. A live dogfood grill in two projects at once.

## 10. Testing

- **Unit** (`node --test`): patch/validate (including `map`, `phase`, `owner`), hub `ensure`
  racing (two parallel ensures give one hub), idle exit, version skew, `/clients`, `open`
  skip rules and URL validation with `GRILL_OPENER`, session ownership and resume selection,
  SSE push on patch.
- **E2E** (Playwright, opt-in via `PLAYWRIGHT_PKG`): staging survives reload, send, working
  state, hub restart with SSE reconnect, finished state, the Map screen, and one flow per
  built layout.
- **Concurrency:** 5 sessions across 2 fake projects on one hub. Check sends land in the
  right `events.jsonl` and that RSS stays under 80 MB.
- **Manual:** confirm that a `tail -F` Monitor event wakes an idle Claude Code turn on the
  current build, and that a Monitor expiry notice does too.

## 11. Risks

- **Monitor semantics may change again.** Mitigation: the watcher is a plain `tail`, the
  `pending` drain runs on every re-arm, and the `wait` fallback remains.
- **Pocock restructures his skills.** The sync script fails loudly, and the wrappers'
  preflight stops rather than improvises.
- **The agent ignores the override table.** Mitigation: `grilling-ui` loads last, and each
  row is concrete. Verify this in the dogfood grill.
- **SSE through a corporate proxy or extension.** Poll fallback.
- **Graceful degradation of `data-q` tagging** depends on the drawing subagent following the brief.

## 12. Deferred

- A dark theme.
- Keyboard shortcuts.
- A Wayfinder ticket board.
- Codex and other agents.
- Publishing the plugin to a public marketplace.
