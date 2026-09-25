# intelligentrascal

Browser-UI versions of [Matt Pocock's](https://github.com/mattpocock/skills) grilling skills, for
Claude Code, Codex, OpenCode and Pi.

| Skill | What it does |
|---|---|
| `grill-me-ui` | Pocock's `grill-me` interview on a local page instead of the terminal; writes a design doc on Finish. |
| `grill-docs-ui` | Pocock's `grill-with-docs` on the page; keeps `CONTEXT.md` and ADRs current as terms and decisions settle. |
| `wayfinder-ui` | Pocock's `wayfinder` with its grills on the page: chart a large effort as a map of decision tickets, work one ticket, or run a live **ticket board**. |
| `grilling-ui` | Internal engine the three above load last. Not invoked directly. |

The interview method stays Pocock's: each wrapper loads his `grilling` (and `domain-modeling`)
skill first, then `grilling-ui` swaps the terminal transport for the page. Every round shows the
whole question frontier as cards; you stage answers, discuss in per-question threads, ask for a
visual, and press **Send**. The terminal shows one status line per Send.

One small local hub (plain Node, no dependencies, no build step) serves every grill and board you
have open, across projects and agents, at `http://127.0.0.1:<port>/`.

## Install

Requires [Node.js](https://nodejs.org) 20 or newer and Matt Pocock's skills (installed below).

### Claude Code

```bash
claude plugin marketplace add mattpocock/skills
claude plugin marketplace add intelligentrascal/skills
claude plugin install intelligentrascal@intelligentrascal
```

This installs Pocock's `mattpocock-skills` plugin too, as a dependency. Then, in Claude Code:
`/intelligentrascal:grill-me-ui <topic>`. If Pocock's plugin is disabled, Claude Code disables
this one too. Update later with `claude plugin marketplace update intelligentrascal` and
`claude plugin update intelligentrascal`.

### Codex, OpenCode, Pi

```bash
git clone https://github.com/intelligentrascal/skills ~/intelligentrascal-skills
npx skills add mattpocock/skills -g --skill grilling domain-modeling research prototype
~/intelligentrascal-skills/scripts/install-agents.sh
```

`install-agents.sh` symlinks the four skills into `~/.agents/skills` (override with
`AGENTS_SKILLS_DIR`), where Codex, OpenCode and Pi all find them; checks that Pocock's `grilling`
and `domain-modeling` are installed (exit 2 with the `npx` hint if not); records their version
in a local, gitignored `upstream.local.json` (so your clone stays clean); and checks the Codex
sandbox. It is safe to re-run; `git pull` in the clone
updates the skills in place. Then ask your agent to "grill me with ui about <topic>".

**Codex** needs loopback networking and write access to the hub's folder. Add to
`~/.codex/config.toml` (the script prints this block with your path) and restart Codex:

```toml
[sandbox_workspace_write]
network_access = true
writable_roots = ["/Users/<you>/.intelligentrascal"]
```

Without it, the first command fails with exactly this fix in the error message.

## Usage

| You say | What happens |
|---|---|
| `/grill-me-ui <topic>` (or "grill me with ui") | New grill; the page opens by itself and the URL is printed. |
| `/grill-docs-ui <topic>` | Same, with docs mode (`CONTEXT.md`, ADRs). |
| `/grill-me-ui resume`, `/grill-docs-ui resume` | Picks up an unfinished grill in this project and replays Sends queued while no agent was listening. If another agent holds it, you are asked before it is taken over. |
| `/wayfinder-ui` | Charts a new map (destination → frontier) on your issue tracker. |
| `/wayfinder-ui <map>` | Works one ticket of an existing map (exactly one ticket per session). |
| `/wayfinder-ui board <map>` | Opens the live board and listens for **Work this ticket** and **Refresh**. |

**On the page:** pick options, write free-text answers or push back in a question's thread,
defer or reopen questions, ask for a visual (drawn as a sandboxed HTML prototype whose regions
highlight when you hover the question they belong to), then **Send**. Nothing reaches the agent
until you Send; staged work survives a reload. **Finish** asks the agent to write the output
(design doc, docs updates, or a Wayfinder map snapshot).

**Keyboard** (`?` shows the cheatsheet and has an off switch):

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous question (board: card) |
| `1`–`4` | Pick option A–D |
| `a` | Accept the recommendation |
| `r` / `f` | Thread reply / free-text answer |
| `d` / `o` | Defer / reopen |
| `e` | Explore deeper (3 s undo toast) |
| `v` | Toggle the visual / Visualize |
| `u` | Unstage this question |
| `g` then `i` / `m` | Inbox / the map's board |
| `w` (board) | Work this ticket |
| `⌘↵` / `Ctrl↵` | Send, from anywhere |
| `Esc` | Leave the field / close the overlay |

Shortcuts never fire while you are typing in a field, during IME composition, or with Ctrl/Alt held.

**Ticket board** (`/m/<project>/<map>/`): Frontier · In progress · Blocked · Done columns, plus
fog and out-of-scope. The issue tracker stays canonical; the board is a live snapshot the agent
refreshes after every Wayfinder step. A card you ask to work shows "queued" until an agent takes
it, then "claimed by …" and a link to the grill working it.

## Runtime

- Everything lives under `~/.intelligentrascal/` (`GRILL_HOME` to move it): `hub.json`,
  `grill-sessions/<project>/<id>/` (`state.json`, `events.jsonl`, `visual.html`, `meta.json`),
  `maps/<project>/<map>/`, `logs/hub.log` (rotated at 1 MB).
- One hub per user. Any command starts it if it is down; it exits after 30 minutes with no open
  tab and no listening agent. Updating the plugin hands off to the new code on the same port, so
  open tabs keep working.
- Only loopback requests with the right `Host` are served; Sends and claims need the session's or
  map's token and a same-origin request.
- All tabs share one live connection to the hub; a tab that can't get one polls every 5 s.

| Variable | Effect |
|---|---|
| `GRILL_HOME` | Hub folder (default `~/.intelligentrascal`). |
| `GRILL_NO_OPEN=1` | Never open a browser; the URL is still printed. SSH sessions and Linux without a display skip opening too. |
| `GRILL_OPENER` | Executable used to open URLs instead of `open` / `xdg-open` / `start`. |

The hub CLI (`node skills/grilling-ui/hub.mjs` prints usage) is what the skills call; you rarely
need it by hand.

## Upstream sync

For maintainers. Only Pocock's skills are tracked: `upstream.json` pins the Claude plugin
version/commit and the vendored wayfinder, and the gitignored `upstream.local.json` holds this
machine's pin of the `~/.agents` copy (written by `install-agents.sh`).

```bash
scripts/sync-pocock.sh   # from a clone of this repo
```

It prints what changed upstream since the pin for each skill we delegate to, warns when upstream
`main` is ahead of the installed release, fails loudly if a skill was renamed or stopped being
model-invocable, three-way merges the vendored `skills/wayfinder-ui/upstream/wayfinder.md`, runs
the tests, and bumps the pins (the agents pin only ever in `upstream.local.json`). It never commits. After resolving wayfinder conflicts by hand, run
it again with `SYNC_WAYFINDER_DONE=1`.

## Development

```bash
node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs
claude plugin validate --strict .
```

Browser tests are opt-in and need Playwright (`PLAYWRIGHT_CHANNEL=chrome` uses your installed
Chrome if Playwright's own browser isn't installed):

```bash
for f in skills/grilling-ui/test/*.e2e.mjs; do
  PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs PLAYWRIGHT_CHANNEL=chrome node "$f" || break
done
```

Design docs: `docs/superpowers/specs/` (spec), `docs/superpowers/plans/` (implementation plan and
execution notes), `docs/superpowers/verification/` (agent source checks, dogfood and smoke-run
records). Layout mockups and the comparison that picked Inbox are in `design/mockups/`.

## Provenance and licenses

- The page and hub started as a one-time fork of Jason Ku's
  [grill-with-ui](https://github.com/jasonku09/grill-with-ui) at commit `daafa1e`; the Inbox page
  keeps his design exactly. It is not tracked upstream.
  ([LICENSES/jason-ku-grill-with-ui.MIT](LICENSES/jason-ku-grill-with-ui.MIT))
- Matt Pocock's skills are loaded, not copied, except the vendored wayfinder text.
  ([LICENSES/matt-pocock-skills.MIT](LICENSES/matt-pocock-skills.MIT))

## Not yet

- A dark theme.
- Push adapters (OpenCode `prompt_async`, a Pi extension); wait mode covers those agents today.
- Publishing to a public marketplace.
