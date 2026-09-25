---
name: wayfinder-ui
description: Wayfinder with ui. Runs Matt Pocock's wayfinder with its grills on a local browser page, charting a large effort as a map of decision tickets on the issue tracker or working one ticket of an existing map. Use when the user says "wayfinder ui", "wayfind with ui", or invokes "/wayfinder-ui" (also "/wayfinder-ui <map>", "/wayfinder-ui board <map>").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

`$ENGINE` = grilling-ui's `$SKILL` (the folder of grilling-ui's SKILL.md). Run hub commands as grilling-ui does, `node "$ENGINE/hub.mjs" …`, from the project directory. Other skills wayfinder names (`research`, `prototype`) are Pocock's: in Claude Code, `mattpocock-skills:<name>`.

1. **Preflight.** Load Pocock's two skills, one call each:
   - Call the Skill tool with `grilling` (in Claude Code: `mattpocock-skills:grilling`).
   - Call the Skill tool with `domain-modeling` (in Claude Code: `mattpocock-skills:domain-modeling`).

   If either cannot be loaded, stop and tell the user to install Pocock's skills — Claude Code: `claude plugin install mattpocock-skills@mattpocock`; other agents: `npx skills add -g mattpocock/skills`. Never grill from memory.
2. Call the Skill tool with `grilling-ui` (in Claude Code: `intelligentrascal:grilling-ui`). It loads last; its Overrides table wins. If it cannot be loaded, stop and tell the user this plugin is incompletely installed: Claude Code: `claude plugin install intelligentrascal@intelligentrascal`; other agents: re-run `scripts/install-agents.sh` from the intelligentrascal repo. Pocock's skills are not the cause. Wherever wayfinder says to call the Skill tool for "grilling" and "domain-modeling", they are already loaded: run that grill on the page through grilling-ui.
3. Read `$SKILL/upstream/wayfinder.md` (same folder) and follow it, with these changes:

No design doc in either mode.

## The map key and snapshot

- `<mapKey>` = `<projectKey>/<slug>`. `<slug>` is the tracker's map issue number (GitHub, GitLab) or the effort slug (local-markdown tracker), lowercase `[a-z0-9-]`. `--map <slug>` run from the project directory expands to the full key; `new` prints `projectKey`, and `map-patch` prints a `url` ending `/m/<mapKey>/`.
- A **snapshot** is the whole map as the tracker has it now, shaped like this (every field but `title` optional):

  ```jsonc
  { "title": "<map issue title>", "link": "<map URL or path>", "destination": "…", "notes": "…",
    "decisions":  [{ "title": "…", "link": "…", "gist": "…" }],
    "tickets":    [{ "title": "…", "link": "…", "type": "research|prototype|grilling|task",
                     "state": "frontier|blocked|claimed", "blockedBy": ["<ticket title>"], "assignee": "…" }],
    "closed":     [{ "title": "…", "link": "…", "gist": "…" }],
    "fog": ["<each Not yet specified item>"], "outOfScope": [{ "gist": "…", "link": "…" }] }
  ```

  Leave out `hubClaim` and `listener`: the hub writes them.
- Publish it with:

  ```sh
  node "$ENGINE/hub.mjs" map-patch --map <mapKey> --agent-id <agentId> <<'MAP_PATCH'
  { …snapshot… }
  MAP_PATCH
  ```

  `tickets`, `closed` and `decisions` merge by title, so a ticket that left `tickets` (closed, deleted, ruled out of scope) also needs `{ "title": "…", "remove": true }` in `tickets`. Every other key is replaced whole. `--agent-id` is optional. Exit 2 means the patch was rejected: fix it and run it again.
- Publish the snapshot after **every** Wayfinder step (chart, claim, resolve, graduate fog, rule out of scope) and on a board **Refresh**. The board is only as fresh as your last snapshot.
- A ticket the tracker shows open, unblocked and unassigned goes in as `"state": "frontier"`, but a hub claim on it keeps it claimed on the board. Before publishing, read the hub's copy with `node "$ENGINE/hub.mjs" map --map <mapKey>`. For each such ticket with a `hubClaim` whose `seq` is absent or at most the map's `handled`, run `node "$ENGINE/hub.mjs" claim --release --map <mapKey> --ticket "<title>" --agent-id <that hubClaim.agentId>`. A higher `seq` is a queued board click waiting for a session: leave it.

## Chart mode (`/wayfinder-ui` with a loose idea)

One page session covers wayfinder steps 1 and 2.

1. Follow grilling-ui **Start** with topic `<idea>`, no doc path, `--phase destination`, and finish profile **wayfinder**. Its rounds name the destination (step 1).
2. When the destination is settled, patch `"phase": "frontier"` together with the first breadth-first round (step 2), and keep grilling on the same page.
3. **Finish (chart)**, on the user's Finish send:
   - **No fog surfaced** (step 2's "no map needed"): patch `{ "finished": { "kind": "no-map" } }` per grilling-ui **Finish**, stop the listener, and ask in the terminal how the user would like to proceed.
   - **Otherwise** run steps 3–5 on the tracker: create the map, create the tickets, wire the blocking edges in a second pass, then the research tickets per your profile's `research`: `subagent` → fire the research subagents (step 5) with `draw.tool`; `leave-open` → leave them open for a later session and say so in the terminal.
   - **Only after those tracker writes succeed**: `map-patch` the full snapshot, then patch the session `{ "mapKey": "<mapKey>", "map": <the same snapshot>, "finished": { "kind": "map" } }` per grilling-ui **Finish**. If a tracker write fails, report it; publish no map the tracker does not hold.
   - Print one line with the map `url`. Charting resolves no ticket (step 6).

## Work mode (`/wayfinder-ui <map>`)

**Exactly one ticket per session**; the next ticket is a new `/wayfinder-ui <map>` session. Research tickets are the one exception wayfinder allows.

1. Load the map from the tracker (step 1) and `map-patch --map <slug>` its snapshot (no `--agent-id` yet). The printed `url` gives `<mapKey>`.
2. Choose the ticket (step 2). A board click queued earlier goes first: run `node "$ENGINE/hub.mjs" agent-profile --agent <agent> --map <mapKey>` and keep its `agentId` as `<boardAgentId>`, then `node "$ENGINE/hub.mjs" wait --map <mapKey> --timeout 1 --agent-id <boardAgentId>`. Exit 0 prints the queued lines: handle them per grilling-ui **Board events**; a `work` line that hands you its ticket also does steps 2–3 here, so continue at step 4. Otherwise (exit 3, or no hand-off) choose per wayfinder. Follow grilling-ui **Start** step 1 with topic `<ticket title>`, no doc path, `--phase ticket` and `--map-key <mapKey>`, keeping `agentId`.
3. **Claim it, before any work:**
   1. `node "$ENGINE/hub.mjs" claim --map <mapKey> --ticket "<ticket title>" --agent-id <agentId>`. Exit 5 prints `{"conflict":…}`: another session has it. Choose the next frontier ticket, patch the session `topic` to its title, and claim again.
   2. Assign it on the tracker (wayfinder's claim). If the tracker already shows another assignee, release the hub claim with `node "$ENGINE/hub.mjs" claim --release --map <mapKey> --ticket "<ticket title>" --agent-id <agentId>`, `map-patch` that ticket with the real `assignee`, and go back to 3.1 with the next frontier ticket.
4. Continue grilling-ui **Start** from step 2, finish profile **wayfinder**: resolve the ticket on the page (step 3), zooming into related tickets as needed.
5. **Finish (work)**, on the user's Finish send: record the resolution on the tracker (steps 4–5: resolution comment, close, Decisions-so-far pointer, new tickets, graduated fog, out-of-scope rulings). Only after those writes succeed: `map-patch` the updated snapshot (the resolved ticket removed from `tickets` and added to `closed` with its `gist`), then patch the session `{ "mapKey": "<mapKey>", "map": <the same snapshot>, "finished": { "kind": "map" } }` per grilling-ui **Finish**. Print one line with the map `url`.

## Board mode (`/wayfinder-ui board <map>`)

The board, `/m/<mapKey>/`, shows the map and queues two requests for a watching agent: **Refresh** and **Work this ticket**. This mode watches until a Work request hands it **exactly one** ticket; the session then becomes a work-mode session for that ticket.

1. Load the map from the tracker and `map-patch --map <slug>` its snapshot. The printed `url` gives `<mapKey>`.
2. `node "$ENGINE/hub.mjs" agent-profile --agent <agent> --map <mapKey>` prints your board profile and an `agentId`. Keep it as `<boardAgentId>` and pass `--agent-id <boardAgentId>` to every later `agent-profile --map`, `claim` and `map-patch` in this mode.
3. Arm the watcher: call `listen.tool` with `listen.params` exactly as printed, and follow its `repeat` (grilling-ui **Listening**, with board lines in place of sends).
4. `node "$ENGINE/hub.mjs" open --map <mapKey>`.
5. Print ONE line: the board URL and "watching for board requests".
6. Handle every board line per grilling-ui **Board events**. The `work` line that hands you a ticket ends board mode.
