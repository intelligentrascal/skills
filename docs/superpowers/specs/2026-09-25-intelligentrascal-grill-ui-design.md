# intelligentrascal grill UI plugin: design

Date: 2026-09-25 · Status: draft for review (rev 2, after 3 adversarial reviews) · Owner: Rahil

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
  marketplace.json          marketplace "intelligentrascal" → plugin at ./ (allows deps from "mattpocock")
  plugin.json               plugin "intelligentrascal"; depends on mattpocock-skills@mattpocock
skills/
  grilling-ui/              shared engine; user-invocable: false
    SKILL.md                transport protocol + override table (no interview method)
    agents/openai.yaml      Codex: allow_implicit_invocation false
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
scripts/install-agents.sh   Codex / OpenCode / Pi install (§5b)
design/mockups/             static comparison mockups (build step 1)
LICENSES/                   jason-ku-grill-with-ui.MIT, matt-pocock-skills.MIT
README.md
```

- Commands are only run by `grilling-ui`, as `node "$SKILL/hub.mjs" …` (`$SKILL` is defined portably, §5b).
- The plugin is installed from the local marketplace. Edits go live after `/reload-plugins`.

## 3. Skill composition and instruction precedence

Pocock's `grill-me`, `grill-with-docs` and `wayfinder` carry `disable-model-invocation: true`,
so the agent cannot call them. `grilling` and `domain-modeling` are model-invocable, so we
call them live.

| Wrapper | Loads, **in this order** |
|---|---|
| `grill-me-ui` | `mattpocock-skills:grilling` → `intelligentrascal:grilling-ui` |
| `grill-docs-ui` | `grilling` → `mattpocock-skills:domain-modeling` → `grilling-ui` |
| `wayfinder-ui` | reads its own `upstream/wayfinder.md` (vendored, same folder) → then at each grill point, `grilling` (+ `domain-modeling`) → `grilling-ui` |

`grilling-ui` always loads **last**. Its first section is an explicit override table:

| Pocock's `grilling` says | Under grilling-ui |
|---|---|
| Ask the whole frontier per round | Kept. Each round = every unblocked question, published as question cards via `patch`. |
| "Format a round like so: ❓ … ➡️ …" | Replaced: print nothing to the terminal but the one status line per send. |
| "Wait for the user's answers" | Return to listening (Monitor re-arm, §5). |
| Dispatch sub-agents for facts, don't block | Kept. Run them in the background. Their completion notice is handled like a draw completion: patch downstream questions, set `note` while pending. |
| Done when the frontier is empty; don't act until the user confirms | Confirmation = the user's **Finish** send. Finish with open questions records them under Deferred / Open threads. |
| `domain-modeling`: "call out conflicts immediately" | As a thread reply on the affected question, or by reopening it. Never as terminal prose. |

All loading is by name, following Pocock's convention: "Call the Skill tool with `grilling`
(in Claude Code: `mattpocock-skills:grilling`)". See §5b.

**Preflight.** Each wrapper begins by checking that Pocock's skills can be loaded. If
`grilling` can't be loaded, the agent stops and tells the user how to install it:
- Claude Code: `claude plugin install mattpocock-skills@mattpocock`
- other agents: `npx skills add -g mattpocock/skills`

It never grills from memory.

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

A page at `/m/<mapKey>/` that lives as long as the map, independent of any single grill.
**The board is only as fresh as the last agent step.** The agent is the only tracker client
(§1 non-goal), so between agent runs the board shows the last snapshot, with its age in the
header.

- **Columns:** Frontier · In progress (claimed) · Blocked · Done. Fog and Out of scope sit
  below the columns.
  - Each card shows the title, a type chip, `blockedBy` titles, the assignee, and a link.
  - Done cards show their `gist`.
  - The header shows the destination and "Updated <time> · canonical: <link>".
- **`<mapKey>`:**
  - For a GitHub or GitLab tracker: `<projectKey>/<tracker-map-id>`.
  - For the local-markdown tracker: `<projectKey>/<effort-slug>`.
- **Data:** `~/.intelligentrascal/maps/<mapKey>/map.json`, written only by the agent through
  `hub.mjs map-patch` (same merge and validation rules as `patch`).
  - The agent writes it after every Wayfinder step (chart, claim, resolve, graduate fog,
    rule out of scope) and on a board **Refresh** request.
  - The hub pushes changes over SSE.
- **Actions** go to `maps/<mapKey>/events.jsonl` and follow the same event rule as grill sends:
  - **Refresh** re-reads the tracker and re-patches.
  - **Work this ticket** (frontier cards only).
- **Board watcher.** `/wayfinder-ui board <map>` opens the board and arms a watcher on the
  map's event log (Claude Code: a Monitor on `hub.mjs watch --map <mapKey>`; other agents:
  `wait --map`). It records a heartbeat in `map.json.listener`, and the board shows
  "agent listening" or "no agent listening: requests queue".
- **Work this ticket is a hand-off, not a dispatch** (respects Wayfinder's "one ticket per
  session"):
  1. Clicking queues a request.
  2. The hub does an atomic claim: compare-and-set on `map.json`
     (`POST /m/<mapKey>/claim`, first request wins). The card shows "claimed by <agentId>"
     at once.
  3. The listening agent that drains it runs Wayfinder work mode on **exactly one** ticket:
     it claims it on the tracker, then opens a new grill session linked from the card
     ("grilling now →").
  4. Further clicks stay queued and are shown as such. The next `/wayfinder-ui board` or
     `/wayfinder-ui <map>` session takes the next one.
- **Concurrency.**
  - The hub's compare-and-set is authoritative for claims started from the board, because
    two worktrees on the local-markdown tracker have separate copies of the map file and
    could otherwise both claim.
  - For GitHub and GitLab, the tracker assignee remains the canonical claim. A losing agent
    sees the conflict on refresh and releases its hub claim.
- **Entry points:** `/wayfinder-ui board <map>`, a link from the end-of-grill Map screen,
  and `hub.mjs open --map <mapKey>`.

`map` (an index, never a store; validated by the hub):

```jsonc
"map": { "title": "…", "link": "url-or-path", "at": "ISO",
  "destination": "…", "notes": "…",
  "decisions": [{ "title": "…", "link": "…", "gist": "…" }],
  "tickets":   [{ "title": "…", "link": "…", "type": "research|prototype|grilling|task",
                  "state": "frontier|blocked|claimed", "blockedBy": ["title"],
                  "assignee": "…", "hubClaim": { "agentId": "…", "at": "ISO" } }],
  "closed":    [{ "title": "…", "link": "…", "gist": "…" }],
  "fog": ["…"], "outOfScope": [{ "gist": "…", "link": "…" }],
  "listener": { "agentId": "…", "heartbeat": "ISO" } }
```

The end-of-grill Map screen uses the same data and always shows
"Snapshot at <time> · canonical: <link>". Local file paths render as plain text.

## 5. Runtime: one shared hub, many grills

### Root and processes

- **One root:** `GRILL_HOME`, default `~/.intelligentrascal/`. There is no silent fallback
  location. If the root isn't writable (e.g. the Codex sandbox), commands fail with the exact
  fix (§5b).
  - `hub.json`: `{port, pid, version, started}`
  - `hub.lock`
  - `logs/hub.log`: rotated at 1 MB, 3 files kept
  - `grill-sessions/`
  - `maps/`
- **Hub (`hub.mjs serve`).** Exactly one per user.
  - Node, no dependencies.
  - Binds `127.0.0.1` on the port remembered in `hub.json`. The first start picks a free
    port and remembers it.
  - Serves grills at `/s/<sessionId>/[brief|studio]` and boards at `/m/<mapKey>/`.
  - It is started double-forked (`setsid` / detached + `unref`, with stdio redirected), so
    it outlives the agent's command, the agent itself, and agents that kill their children's
    process tree (Pi on Esc).
- **Per-agent watcher (Claude Code).** A Monitor running
  `node hub.mjs watch --session DIR --after <handled>`, with `timeout_ms: 1800000`, described
  as `grill: <project> · <topic>`.
  - `watch` is a few lines: it prints any sends after `<handled>` that are already in the
    log, then tails the file for new lines. There is no gap between the drain and the tail.
  - On expiry the agent re-arms it with its current `handled`.
- No per-grill server process.

### Hub lifecycle

- **`hub.mjs ensure`:**
  1. Reads `hub.json`, then calls `GET /health` on that port. It reuses the hub only if the
     response echoes the same `{pid, started}` as `hub.json` (this protects against a reused
     pid or port).
  2. Otherwise it takes `hub.lock` (`O_EXCL`, contents = its own pid). The lock is stale if
     that pid is dead, or if the lock file is older than the ensure timeout + 20 s (30 s by
     default), which covers a pid reused by an unrelated process. A stale lock is renamed to
     `hub.lock.stale-<pid>-<rand>` and deleted only if it is still the file judged stale
     (same contents and mtime); otherwise it is put back. Then `ensure` retries.
  3. It spawns the hub on the remembered port and waits up to 10 s for `/health`.

  Two agents starting at once therefore get one hub.
- **Version change (plugin update).** `/health` and `hub.json` carry `version` (a hash of the
  hub code) and `codeTime` (the newest mtime over the same files). `ensure` replaces the
  running hub only when `version` differs **and** the caller's `codeTime` is greater;
  otherwise it reuses the running hub, prints `"stale": true` and warns on stderr, so two
  installed copies (plugin cache and `~/.agents/skills`) never hand off back and forth. To
  replace it, `ensure` calls `POST /admin/handoff` on the old hub (loopback only, admin
  token from `hub.json`); if that fails it sends SIGTERM to the `/health`-verified pid and
  waits up to 3 s for the port. The new hub starts detached with its working directory set
  to `GRILL_HOME` and binds the **same port**. SSE clients reconnect by themselves, and
  URLs never change mid-grill.
- **Idle exit.** The hub exits after 30 minutes with no SSE client **and** no fresh agent
  heartbeat in any unfinished session or map listener. It never exits while an agent is
  waiting or watching, because watchers heartbeat through the hub (see ownership).
- **Crash recovery.**
  - Every CLI call (`patch`, `map-patch`, `url`, `open`, `watch`, `wait`) runs `ensure` first.
  - The page shows "hub down — reconnecting…" and retries `/health` every 5 s.
  - It reconnects on the same port. State lives on disk.

### Session identity and ownership

- **Folder:** `grill-sessions/<projectKey>/<YYYYMMDD-HHMMSS>-<rand4>/`.
- **`<projectKey>`:** the basename of the git common root, `-`, then the first 8 hex of the
  sha256 of its absolute path, so different paths can't collide. Worktrees share it. Outside
  git it uses the working directory.
- **`state.json`:**
  - Records `cwd`, `branch`, and `owner: { agentId, agent: "claude|codex|opencode|pi", heartbeat }`.
  - `agentId` is a random id minted by `new`/`resume` and passed on every later command. An
    agent can't reliably read its own session id.
  - `watch` and `wait` refresh the heartbeat every 60 s through the hub, and so does every
    `patch`.
- **In use:** a heartbeat under 3 minutes old.
  - After an agent crash, a session stays "in use" for at most 3 minutes.
  - `resume --take` lets the user override the flag explicitly.
- **Resume:**
  - Lists unfinished sessions for this project with topic, branch, cwd, age, open/answered
    counts, and the in-use flag.
  - Auto-picks only when there is exactly one session and it is not in use. Otherwise it asks.

### Security

- Each session and map gets a random **token**, created by `new` (or the first `map-patch`)
  and stored in `meta.json` (mode 0600), not `state.json`, because the hub also writes
  heartbeats there. The served page embeds it, and CLI calls read it from disk.
- `POST /s/<id>/send`, `/m/<key>/…` and `/admin/*` require the token header and a matching
  (or absent) Origin (Jason's check, kept); `Origin: null` is rejected.
- Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding
  guard). `GRILL_HOME` is created with mode 0700.
- The visual is served with `Content-Security-Policy: sandbox allow-scripts`, so opening it
  in its own tab cannot reach the page's token.
- An unrelated local process or web page can't inject sends or claims.

### Updates to the page

- The hub watches each session's **folder** (`fs.watch` on the directory, filtered by
  filename). Jason's atomic rename replaces the file's inode, which breaks a file-level
  watch on macOS.
- It pushes `state` events over SSE (`/s/<id>/events`). There is no 1-second polling.
- **Connection cap.** HTTP/1.1 allows about 6 connections per origin, and all tabs share the
  hub's origin.
  - Tabs of the same browser share **one** EventSource through `BroadcastChannel` (a leader
    tab relays to the others).
  - Any tab whose EventSource fails 3 times falls back to a 5 s poll.
- Sends go by `POST /s/<id>/send`; the hub appends to that session's `events.jsonl`.

### Tabs

- Title: `<project> · <topic>`.
- Favicon: an SVG status dot (waiting, working, finished).
- The header shows the project, the branch, the doc path, and the listener state.

### Resource budget

One hub at about 40 MB RSS total, whatever the number of grills. One small `watch` process
per active Claude Code grill. Idle tabs cost nothing.

## 5b. Multi-agent support: Claude Code, Codex, OpenCode, Pi

Verified against each agent's source (September 2026):

| | Claude Code | Codex CLI | OpenCode | Pi |
|---|---|---|---|---|
| Skill discovery | plugin / `~/.claude/skills` | `~/.agents/skills`, project `.agents/skills` | `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills` | `~/.agents/skills`, `~/.pi/agent/skills` |
| `npx skills add -g` puts Pocock's skills in | n/a (use the plugin) | `~/.agents/skills` | `~/.agents/skills` | `~/.pi/agent/skills` |
| Loading a skill | Skill tool | `skills.read` / `$name` | `skill` tool | model reads the file; `/skill:name` |
| Skill dir exposed as | `${CLAUDE_SKILL_DIR}` | `<path>` of SKILL.md | "Base directory for this skill" | `location` of SKILL.md |
| Model command limits | Bash ≤ 10 min | `exec_command` `yield_time_ms` 250–30 000 (no per-call timeout); empty `write_stdin` polls clamp 5 000–300 000 ms | `bash` `timeout` in ms, default 2 min, no hard max in source; no model background jobs | `bash` `timeout` optional, in seconds, no default; Esc kills the process tree |
| Wake on external event | Monitor (≤ 30 min, re-arm) | none | none built in (server API needs `opencode serve`) | none built in |
| Background sub-agent | Agent tool | `spawn_agent` | `task` tool (foreground unless `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`) | none |
| Sandbox | optional | Seatbelt/Landlock; **localhost blocked by default** | none | none |

### Installation

- **Claude Code:** the plugin, installed from the local marketplace.
  - `plugin.json` declares `{"name":"mattpocock-skills","marketplace":"mattpocock"}` as a
    dependency.
  - Our `marketplace.json` sets `allowCrossMarketplaceDependenciesOn: ["mattpocock"]`.
  - If Pocock's plugin is disabled, Claude Code disables ours too; the README says so.
- **Codex, OpenCode, Pi:** `scripts/install-agents.sh`:
  1. Symlinks the **whole** `skills/` set (all four folders together, never one wrapper on
     its own) into `~/.agents/skills/`, which all three agents read.
  2. Checks that Pocock's `grilling` and `domain-modeling` are discoverable (in
     `~/.agents/skills` or `~/.pi/agent/skills`). If not, it prints
     `npx skills add -g mattpocock/skills`.
  3. Records the version it found in `upstream.json.agents` (§8).
  4. For Codex, prints the sandbox config below and checks whether it's present.
- Codex sidecars (`agents/openai.yaml`) set `policy.allow_implicit_invocation: false` on
  `grilling-ui` and give display names, following Pocock's convention. Codex parses and
  enforces these.

### Portable SKILL.md conventions

1. **Loading another skill, always by name.** Use Pocock's own convention: *"Call the Skill
   tool with `grilling`."* One skill per instruction. This includes `grilling-ui`: nothing
   loads by path.
   - Claude Code resolves plugin names on its own; the wrappers name
     `mattpocock-skills:grilling` there, and the flat name everywhere else.
   - The single sentence covers both: *"Call the Skill tool with `grilling` (in Claude Code:
     `mattpocock-skills:grilling`)."*
2. **The skill's own directory.** Each SKILL.md defines it once:
   - "`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code,
     otherwise the directory of the path you were shown for this file."
   - Only `grilling-ui` runs commands, and always as `node "$SKILL/hub.mjs" …` inside its own
     folder. There are no `../` paths.
3. **Frontmatter:** only `name` and `description` are portable.
   - Hiding `grilling-ui` from auto-invocation uses `user-invocable: false` (Claude Code),
     the `openai.yaml` policy (Codex), and a trigger-free description (OpenCode, Pi).
   - It stays loadable by name everywhere.

### Listening

The hub's event log is the source of truth. `hub.mjs agent-profile [--agent X]` detects the
agent (from env, or the explicit flag) and prints **exact** tool-call parameters, which the
skill follows verbatim. Push adapters are out of scope (§12).

- **Claude Code (`monitor`):** a Monitor on `hub.mjs watch` (§5), re-armed on expiry.
- **Codex (`wait`, background terminal):**
  - Start `hub.mjs wait --after N --timeout 280` with `exec_command` and
    `yield_time_ms: 30000` (Codex has no per-call timeout; the wait's own `--timeout` bounds
    each run).
  - Exec yields after 30 s, so the model polls the same terminal in ≤ 30 s steps until it
    exits. This is Jason's "poll in bounded steps" rule.
  - Exit 3 means start a new wait.
- **OpenCode (`wait`):** `hub.mjs wait --after N --timeout 540` with the shell tool's
  `timeout: 600000` (10 minutes; the source has no hard max, but 10 minutes keeps turns short).
- **Pi (`wait`):** `hub.mjs wait --after N --timeout 900` with no tool timeout. Pressing Esc
  kills only the wait; the hub survives because it is double-forked.
- **All wait modes:** this is Jason's listener contract, kept.
  - Keep the turn alive and never end it while listening.
  - If the agent must stop, it says the listener is inactive; Sends queue up and are
    replayed on resume.
- **The page** shows the listener state from the heartbeat: "agent listening (Codex)" or
  "no agent listening: Sends will queue".

### Codex sandbox (one-time setup; documented and detected)

- The hub needs loopback networking and write access to `GRILL_HOME`, and Codex's
  `workspace-write` sandbox denies both by default.
- `install-agents.sh` and the README give the exact `~/.codex/config.toml` lines:
  `[sandbox_workspace_write] network_access = true` plus `writable_roots` including
  `~/.intelligentrascal`.
- `ensure` catches `EPERM`/`EACCES` on bind or write and prints those lines, instead of
  failing obscurely.

### Other per-agent differences (handled in `grilling-ui`)

- **Visualize draws:** the Agent tool (Claude Code), the Task tool (OpenCode) or
  `spawn_agent` (Codex) in the background. Pi draws inline (Jason's existing rule).
- **Wayfinder research tickets at Finish:** background sub-agents where they exist. On Pi
  they are left as open `research` tickets for a later session, and the terminal says so.
- **Auto-open:** best effort (§6). The URL is always printed.
- **Layouts, keyboard and board:** agent-independent.

## 6. Auto-open (`hub.mjs open --session DIR [--ui inbox|brief|studio] | --map KEY`)

1. Skip and print `{"opened":false,"reason":…}` when:
   - `GRILL_NO_OPEN=1` is set;
   - `SSH_CONNECTION` is set;
   - on Linux, neither `DISPLAY` nor `WAYLAND_DISPLAY` is set.
2. Ask the hub `GET /s/<id>/clients` (or `/m/<key>/clients`) → `{count, lastSeen}`. If a tab
   is connected, or one was seen in the last 120 s, don't open. After a hub restart, wait up
   to 3 s for an existing tab to reconnect before deciding.
3. Validate the URL against
   `^http://127\.0\.0\.1:\d+/(s/[A-Za-z0-9-]+/(brief|studio)?|m/[A-Za-z0-9/-]+/)$`.
4. Spawn without a shell, with a 5 s time limit:
   - macOS: `open <url>`
   - Linux: `xdg-open <url>`
   - Windows: `cmd /c start "" <url>`

   The spawn command can be overridden with `GRILL_OPENER` (tests).
5. The skill always prints the URL line as well.

**Layout precedence:** an explicit `--ui` beats the layout last used (remembered in
localStorage), which beats Inbox.

## 7. The page: three layouts on one core

- **Shared core (`core.js`, taken from Jason's page.html).** It covers:
  - the SSE client (a shared EventSource plus poll fallback, §5);
  - staging in localStorage, keyed `grill:<sessionId>` so switching layouts mid-session
    keeps staged work;
  - Send, disabled while the agent works, with the 5-minute stuck-agent re-enable;
  - `explore` and `visualize` sent immediately (Jason's semantics);
  - the Finish confirm;
  - the header, status, listener state, footer, finished banner, and the hub-down state;
  - the keyboard layer.

  All three layouts share Jason's semantics: staging survives reload, one Send = one turn,
  the updated/rec-changed marker, deferred and reopened questions.
- **Switching layouts:** by path, with a header switch. Nothing is written to state.
- **Visual direction (Rahil, 2026-09-25).** Inbox and the board use Jason's page exactly:
  `tokens.css` holds Jason's `:root` values verbatim, and pairs below WCAG AA with those
  values are documented exceptions in `test/tokens.test.mjs`. Studio layers
  `theme-studio.css` (Apple DESIGN.md + Craft inspired, system fonts, recorded in
  `design/mockups/DESIGN.md`) on top of the same token names. Shared rules:
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
| **Studio** | Visual-first conversation | The visual iframe takes about 60%. A conversation rail shows everything in one timeline, grouped under sticky round headers: question cards in full, answered cards collapsed to one line, thread messages placed by `at`, and visual feedback in the same stream. One composer with a target chip (`@qN thread`, `@qN answer`, `visual`). Hovering a card highlights its regions; clicking a region selects its card. Before the first draw, the main area shows "agreed so far" (derived from the answers) and a Visualize call to action. |

**Built (milestone 1 result, `design/mockups/decision.json`):** Inbox and Studio. Brief was
not built; the Wayfinder Map screen is the shared `map-view.js` module (plan D9), which
every built layout uses.

### Keyboard shortcuts (all layouts and the board)

Linear/Gmail style.

**Where they apply:**
- A single `keydown` listener on `document`.
- Ignored while focus is in an `input`, `textarea` or `[contenteditable]`, apart from ⌘↵
  and Esc.
- Ignored during IME composition (`isComposing`), and when Ctrl or Alt is held (browser and
  OS shortcuts win).
- `1`–`4` only map to options that exist.
- `?` opens a cheatsheet overlay. The cheatsheet has an off switch for screen-reader users,
  remembered in localStorage.

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous question (board: card) |
| `1`–`4` | Pick option A–D (staged) |
| `a` | Accept the recommendation (staged) |
| `r` | Thread composer for this question (Studio: chip `@qN thread`) |
| `f` | Free-text answer (Studio: chip `@qN answer`) |
| `d` / `o` | Defer / reopen (staged) |
| `e` | Explore deeper (sends immediately, like the button; shows a 3 s undo toast first) |
| `v` | Toggle the visual / Visualize |
| `g` then `i` / `b` / `s` / `m` | Switch to Inbox / Brief / Studio / Map board |
| `u` | Unstage this question's staged action |
| `⌘↵` / `Ctrl↵` | Send, from anywhere, including while focus is inside the visual (forwarded, see below) |
| `Esc` | Leave the text field / close the overlay / return focus from the visual |
| `w` (board) | Work this ticket |

### Visual linkage

The visual-brief additions are:

- Regions carry `data-q="qN"`.
- The visual includes a verbatim listener of about 15 lines:
  - parent → child: `{highlight:[ids]}`
  - child → parent: `{clicked:id}` and `{key:"send"|"escape"}`. A sandboxed iframe traps
    keydown, so ⌘↵ and Esc have to be forwarded out.
- The parent filters `e.source === frame.contentWindow` and treats payloads as ids or keys
  only.

If the subagent forgets the tags, linking silently does nothing.

### Prompt-only rules (no schema change)

- A question title is a question of ≤ 8 words.
- `rec.why` is ≤ 2 sentences and names the cost.
- A thread reply's first line is the answer.

## 8. Upstream sync (Pocock only)

- **`upstream.json`:**
  - `claude`: the installed `mattpocock-skills` plugin version (from
    `~/.claude/plugins/installed_plugins.json`) and its commit. This is authoritative for
    Claude Code.
  - `agents`: the version/commit of the `npx skills` copy that `install-agents.sh` found,
    used by Codex, OpenCode and Pi.
  - The two can diverge. The script reports both, and editing the `npx skills` copy is
    unsupported.
- **`scripts/sync-pocock.sh`:**
  1. For each install (Claude plugin, agents copy): if it differs from its pin, diffs
     `grilling`, `domain-modeling`, `grill-me`, `grill-with-docs` and `wayfinder` between
     the pinned and the installed version, and prints it.
  2. Warns if upstream `main` is ahead of the installed releases.
  3. Fails loudly if a delegated skill was renamed or removed, or if `grilling` or
     `domain-modeling` gained `disable-model-invocation` or
     `allow_implicit_invocation: false`.
  4. Wayfinder: runs a three-way `git merge-file` of our `upstream/wayfinder.md` (ours),
     Pocock's pinned version (base) and his new version (theirs). Conflicts are left marked.
  5. Runs the tests, bumps the pins, and leaves everything uncommitted for review.
- Jason's code is a one-time fork. Its provenance (commit `daafa1e`) is recorded in
  `LICENSES/` and the README only.

## 9. Delivery order (one plan, milestones in order)

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
2. **Hub + CLI:** `ensure`, `new`, `resume`, `patch`, `map-patch`, `url`, `open`, `pending`,
   `sessions`, `watch`, `wait`, `agent-profile`. Covers tokens, handoff, idle exit and
   directory watch, with tests.
3. **`core.js` + Inbox**, reaching parity with Jason's e2e test, plus the keyboard layer.
4. **`grilling-ui` SKILL.md** (override table, listening per agent profile, Visualize,
   Finish), then the three wrappers, including the Wayfinder phases and the Map screen.
5. **Claude Code install:** plugin and marketplace manifests. Dogfood: two concurrent grills
   in two projects.
6. **Multi-agent:** `install-agents.sh`, the `openai.yaml` sidecars, Codex sandbox detection,
   and smoke runs on Codex, OpenCode and Pi.
7. **Brief and/or Studio** (per milestone 1).
8. **Ticket board:** board page, board watcher, claim compare-and-set, Work/Refresh actions.
9. **`sync-pocock.sh`, README, licenses.**

## 10. Testing

- **Unit** (`node --test`):
  - patch and map-patch validation (including `map`, `closed`, `phase`, `owner`);
  - `ensure` races (two parallel ensures give one hub), a reused pid or port, and the
    version handoff keeping the same port;
  - idle exit is blocked by an agent heartbeat;
  - directory watch still sees changes after an atomic rename;
  - token auth rejects a missing or wrong token and a foreign Origin;
  - `/clients`;
  - `open`: skip rules, URL validation (session and map URLs), `GRILL_OPENER`;
  - ownership and resume selection (including `--take`);
  - `watch` has no gap between drain and tail;
  - `agent-profile` output per agent, using env fixtures;
  - a clear message on an unwritable `GRILL_HOME` or a denied bind;
  - claim compare-and-set: two concurrent claims give one winner.
- **E2E** (Playwright, opt-in via `PLAYWRIGHT_PKG`):
  - staging survives reload, send, working state, finished state;
  - hub restart and handoff with SSE reconnect;
  - the shared EventSource across 8 tabs, with poll fallback;
  - keyboard: each shortcut, ignored in text fields, ⌘↵ forwarded from the visual;
  - the Map screen, and the board (render, Refresh, Work → claimed);
  - one flow per built layout.
- **Concurrency:** 5 sessions and 1 board across 2 fake projects on one hub. Check sends
  land in the right `events.jsonl` and RSS stays under 80 MB.
- **Manual:**
  - a `watch` Monitor event wakes an idle Claude Code turn, and a Monitor expiry notice
    does too;
  - smoke runs on Codex (with sandbox config), OpenCode and Pi;
  - `install-agents.sh` on a clean `~/.agents/skills`.

## 11. Risks

- **Codex sandbox networking.** The hub doesn't work under Codex's default sandbox.
  Mitigation: a documented one-time config change and exact error messages. If the user
  can't change the config, Codex is unsupported.
- **Monitor semantics may change again.** Mitigation: `watch` has no gap, is re-armed on
  expiry, and wait mode remains.
- **Wait-mode discipline on non-Claude agents.** Models may end the turn instead of
  re-waiting. Mitigation: `agent-profile` prints the exact calls, and Jason's listener
  contract is kept verbatim. Verify in the smoke runs.
- **Pocock restructures his skills.** The sync script fails loudly, and the wrappers'
  preflight stops rather than improvises.
- **The agent ignores the override table.** Mitigation: `grilling-ui` loads last, and each
  row is concrete. Verify this in the dogfood grill.
- **The board is stale between agent runs.** By design; the header shows its age.
- **Graceful degradation of `data-q` tagging** depends on the drawing subagent following the
  brief.

## 12. Deferred

- A dark theme.
- Push adapters (OpenCode `prompt_async` via `opencode serve`, a Pi extension). Wait mode
  covers these agents; revisit if it feels clunky.
- Publishing the plugin to a public marketplace.
