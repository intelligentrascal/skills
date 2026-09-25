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
6. Works in Claude Code, Codex, OpenCode and Pi (§5b).
7. A live Wayfinder ticket board with actions (§4a) and keyboard shortcuts (§7).

**Non-goals**

- Tracking Jason's repo after the fork.
- Dark mode.
- A hub that talks to issue trackers itself. The agent stays the only tracker client.

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

### 4a. Wayfinder ticket board

A page at `/m/<mapId>/` that lives as long as the map, independent of any single grill.

- **Columns:** Frontier · In progress (claimed) · Blocked · Done. Fog and Out of scope sit
  below the columns. Each card shows the title, a type chip, `blockedBy` titles, the assignee,
  and a link. Done cards show the one-line gist from Decisions so far. The header shows the
  destination and "Updated <time> · canonical: <link>".
- **Data:** the agent is the only tracker client. It writes
  `~/.intelligentrascal/maps/<map-key>/map.json` through `hub.mjs map-patch`, using the §4
  `map` schema plus `closed` tickets. It does this after every Wayfinder step (chart, claim,
  resolve, graduate fog, rule out of scope) and on a board **Refresh** request.
  - `<map-key>` = project key + tracker map id.
  - The hub pushes changes over SSE, exactly as it does for grills.
- **Actions** (appended to `maps/<map-key>/events.jsonl`; the same event rule as grill sends):
  - **Work this ticket** (frontier cards only) and **Refresh**.
  - A listening agent handles **Work this ticket** by running Wayfinder work mode on that
    ticket: claim it, then open a new grill session linked from the card ("grilling now →").
  - When no agent is listening, the board says so and the action stays queued. Starting
    `/wayfinder-ui <map>` drains the queue first.
  - Concurrency: two agents taking the same ticket is prevented by Wayfinder's own claim
    (assign first). The second agent sees it claimed on refresh and reports that on the card.
- **Entry points:**
  - `/wayfinder-ui board <map>` opens the board and listens for its actions.
  - The end-of-grill Map screen links to it.
  - `hub.mjs open --map <map-key>`.

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

## 5b. Multi-agent support: Claude Code, Codex, OpenCode, Pi

Research summary (primary sources, September 2026):

| | Claude Code | Codex CLI | OpenCode | Pi |
|---|---|---|---|---|
| Reads `~/.agents/skills` | no (plugin / `~/.claude/skills`) | yes | yes (also `~/.claude/skills`) | yes (not `~/.claude/skills`) |
| Loading a skill | Skill tool, `plugin:name` namespace | SKILL.md injected; `$name` mention or model reads file | `skill` tool, flat names | model reads the file; `/skill:name` |
| Skill directory exposed as | `${CLAUDE_SKILL_DIR}` | `<path>` of SKILL.md in context | "Base directory for this skill: …" | `<location>` of SKILL.md |
| Blocking command limit | Bash max 10 min | exec default 10 s, `timeout_ms` overridable; background terminal 5 min | shell default 2 min, overridable | no default timeout |
| Wakes on an external event | Monitor (≤ 30 min, re-arm) | no (app-server `turn/start` via SDK only) | server API `session.prompt` | RPC mode / extension |
| Background sub-agent | Agent tool | `spawn_agent` / `wait_agent` | Task tool | none (example extension) |
| Sandbox | optional | Seatbelt / Landlock (workspace-write): loopback allowed, writes outside the workspace blocked | none | none |

### Installation

- **Claude Code:** the plugin, via the local marketplace. Pocock's skills come from his plugin.
- **Codex, OpenCode, Pi:** `scripts/install-agents.sh` symlinks the four skill folders into
  `~/.agents/skills/` (one location all three read). Pocock's skills are installed there with
  `npx skills add mattpocock/skills`, which gives them flat names (`grilling`,
  `domain-modeling`). The script checks for them and prints the command if they're missing.
- **Avoiding duplicates:** OpenCode also reads `~/.claude/skills`, but we never install there,
  so there are no duplicate names.
- Codex extras (`allow_implicit_invocation: false` for `grilling-ui`, display names) go in
  `agents/openai.yaml` sidecars, following Pocock's convention.

### Portable SKILL.md conventions

1. **The skill's own directory.** Written once at the top of every SKILL.md:
   "`$SKILL` = the folder containing this SKILL.md (Claude Code: `${CLAUDE_SKILL_DIR}`;
   otherwise the directory of the SKILL.md path shown to you)." All commands use
   `node "$SKILL/../grilling-ui/hub.mjs" …`. The four folders are always installed side by
   side, so `../grilling-ui` resolves in both layouts.
2. **Loading another skill.** Wrappers say "load the `grilling` skill: Claude Code
   `mattpocock-skills:grilling`; OpenCode's `skill` tool with `grilling`; otherwise read
   `grilling/SKILL.md` from your skills list." `grilling-ui` is loaded **by path**
   (`$SKILL/../grilling-ui/SKILL.md`) everywhere, so it can be hidden from model
   auto-invocation on every agent.
3. **Frontmatter:** only `name` and `description` are portable. `user-invocable: false`
   (Claude Code) and `disable-model-invocation: true` (Pi) on `grilling-ui` are harmless where
   they're ignored.

### Listening: one contract, three transports

The hub's event log is the source of truth everywhere. How an agent hears about a Send is chosen
at start by `hub.mjs agent-profile` (detects the agent from env or an explicit `--agent`) and
recorded in `state.agent.transport`:

- **`monitor` (Claude Code):** as in §5. `tail -F` Monitor, re-armed on expiry, and a
  `pending` drain on every re-arm.
- **`wait` (Codex, Pi, and OpenCode's baseline):** Jason's wait-mode contract, kept
  verbatim. `hub.mjs wait --after N --timeout S` blocks until the next send.
  - S is set per agent by the profile: Codex 240 s with `timeout_ms: 300000`; OpenCode 100 s
    under its 2-minute default, or longer when the call passes `timeout`; Pi 480 s.
  - Exit 3 means re-issue the wait.
  - The agent keeps the turn alive and never ends it while listening.
  - If it has to stop, it says the listener is inactive; Sends queue up and are replayed on
    resume.
- **`push` (OpenCode, optional adapter):** when OpenCode's server port and session id are
  known, the hub also POSTs each Send to `/api/session/<id>/prompt` with `delivery: "queue"`,
  so the agent doesn't have to hold a turn open. Wait mode stays as the fallback.
- **Pi:** a small Pi extension (`adapters/pi/`) that calls `session.prompt` on a Send is the
  equivalent push path. It is an optional adapter, built after the baseline.

The page shows the transport and whether a listener is live ("agent listening" / "agent not
listening: Sends will queue"), taken from the watcher heartbeat or the wait process.

### Per-agent differences handled in `grilling-ui`

- **Visualize draws:** the Agent tool (Claude Code), the Task tool (OpenCode) or
  `spawn_agent` (Codex) runs in the background. Pi has no sub-agent, so it draws inline,
  following Jason's existing rule.
- **Codex sandbox:** `workspace-write` blocks writes to `~/.intelligentrascal`.
  - `hub.mjs ensure` probes whether it can write there. If not, it uses
    `$TMPDIR/intelligentrascal-$USER`, which is writable under the sandbox, and warns once
    that sessions there don't survive a reboot.
  - The README documents adding `~/.intelligentrascal` to Codex's `writable_roots`.
  - A detached hub may be killed when Codex's command ends. The profile then runs `serve` in
    a Codex background terminal and re-ensures it on every wait loop.
- **Auto-open under a sandbox:** best effort (§6). The URL is always printed.
- **Keyboard, board and layouts:** agent-independent (page only).

### Testing across agents

- A scripted smoke test per agent, run manually: start a grill, send twice from the page,
  check the agent handled both, run Visualize, then Finish.
- `agent-profile` unit tests use env fixtures.
- The Codex sandbox fallback is tested with an unwritable `GRILL_HOME`.

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

### Keyboard shortcuts (all layouts and the board)

Linear/Gmail style. Shortcuts are inactive while focus is in a text field, apart from ⌘↵
and Esc. `?` opens a cheatsheet overlay.

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous question (board: card) |
| `1`–`4` | Pick option A–D (staged) |
| `a` | Accept the recommendation |
| `r` | Focus the thread composer for this question |
| `f` | Focus free-text answer |
| `d` / `o` | Defer / reopen |
| `e` | Explore deeper (sends immediately) |
| `v` | Toggle the visual / Visualize |
| `g` then `i` / `b` / `s` / `m` | Switch to Inbox / Brief / Studio / Map board |
| `u` | Unstage this question's staged action |
| `⌘↵` | Send (from anywhere) |
| `Esc` | Leave the text field / close the overlay |
| `w` (board) | Work this ticket |

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
5. Brief and/or Studio (per step 1), the Map screen, the ticket board, and keyboard shortcuts.
6. `sync-pocock.sh`, the README, licenses, local marketplace install, and `install-agents.sh`.
6b. Multi-agent profiles (`agent-profile`, wait-mode tuning, Codex sandbox fallback), then the optional OpenCode and Pi push adapters.
7. A live dogfood grill in two projects at once, plus a smoke run on Codex, OpenCode and Pi.

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
- Publishing the plugin to a public marketplace.
