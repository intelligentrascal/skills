---
name: grilling-ui
description: "Browser transport for the -ui grill skills: publishes rounds to a local page and listens for Sends. Loaded by grill-me-ui, grill-docs-ui and wayfinder-ui."
user-invocable: false
---

# grilling-ui

The grill runs on a local browser **page**. You publish each round to it with `patch`; the user answers there and presses **Send**; a **listener** hands you each Send. Pocock's `grilling` (and `domain-modeling`) supply the interview method. This skill supplies only the transport.

## Overrides

This skill loads last. Where Pocock's `grilling` or `domain-modeling` disagree with this table, this table wins.

| Pocock's `grilling` says | Under grilling-ui |
|---|---|
| Ask the whole frontier per round | Kept. Each round = every unblocked question, published as question cards via `patch`. |
| "Format a round like so: ❓ … ➡️ …" | Replaced: print nothing to the terminal but the one status line per send. |
| "Wait for the user's answers" | Return to listening (see **Listening**). |
| Dispatch sub-agents for facts, don't block | Kept. Run them in the background. Their completion notice is handled like a draw completion: patch downstream questions, set `note` while pending. |
| Done when the frontier is empty; don't act until the user confirms | Confirmation = the user's **Finish** send. Finish with open questions records them under Deferred / Open threads. |
| `domain-modeling`: "call out conflicts immediately" | As a thread reply on the affected question, or by reopening it. Never as terminal prose. |

## `$SKILL`

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file. Use its absolute path.

Run commands only as `node "$SKILL/hub.mjs" …`. Run `new`, `resume` and `sessions` from the project directory: they read the project from the working directory. Every command starts the shared hub (one per user, serving every page) when it is down. Never start or stop the hub yourself.

## Files and ownership

`new` and `resume` print a session folder, `<session>`, and your owner id, `<agentId>`. Pass `--agent-id <agentId>` to every `patch`, `agent-profile` and listener. The folder holds:

- `state.json`: **yours**. Questions, recommendations, thread replies, statuses, agent status. Read it freely; change it only through `patch`, never with a file-write or edit tool. A whole-file write puts the entire state into this conversation on every send (about 60 KB after twenty sends); a patch carries only what changed.
- `events.jsonl`: **the page's**. One line per Send, appended by the hub.
- `visual.html`: **yours**, drawn by a subagent (see **Visualize**).
- `meta.json`: **the hub's**. Token and owner heartbeat.

Another agent can take the session (`resume --take`, on its user's say-so). Then your `patch` exits 4 and your listener prints `{"type":"taken"}` or exits 4: stop listening and tell the user. Take a session back only when the user says so.

## Patching

```sh
node "$SKILL/hub.mjs" patch --session "<session>" --agent-id <agentId> <<'GRILL_PATCH'
{ …only what changed… }
GRILL_PATCH
```

The quoted delimiter keeps the shell from expanding anything inside. `--file <path>` reads the patch from a file instead, for harnesses where heredocs are awkward. The patch merges, validates and swaps `state.json` atomically, so the page sees one consistent update per patch. It prints one line, `{"ok":true,"questions":12,"open":3,"handled":14,"bytes":41233}`, never the state.

| Exit | Meaning | Do |
|---|---|---|
| 0 | applied | continue |
| 2 | patch rejected; `state.json` unchanged | fix the patch from the one-line error and run it again |
| 4 | you are not the owner | stop listening, tell the user |
| 1 | write failure | report the error line |

The patch is shaped like `state.json` (schema at the end):

- `null` deletes a key, at any level: `"answer": null`, `"drawing": null`, `"visual": null`.
- `agent` and `visual` merge one level: keys you give replace those keys; the rest stay.
- `questions` is keyed by `id`. A known id merges one level: each field you give replaces that field whole (`rec`, `answer`, `options`, `deps`, `explore`). An unknown id is a new question, appended; it needs `round`, `title` and `rec` (give `body` and `options` too); `status: "open"`, `deps: []`, `options: []`, `thread: []`, `durable: false` and `updated: false` are filled in. An unknown id without `title` is an error, not a new question. Ids are case-sensitive: `q7`, never `Q7`.
- `thread` (on a question and on `visual`) and `visual.queued` append: list only the new messages or bullets.
- `terms` is keyed by `term`: a known term is replaced whole, a new one appended.
- Every other key is replaced whole: `note`, `doc`, `finished`, `phase` (`destination|frontier|ticket`), `mapKey`, `map`.
- `owner` and `token` are rejected: the hub writes them.

**Never write the current time; `patch` stamps every time you leave out**: `agent.since` whenever you give `agent.status`, `at` on each appended message, `explore.at`, `visual.at` when `version` changes, `visual.drawing.since` and `finished.at`. A time you give always wins; give one only when copying it from a send line (a user's thread message takes the send's `at`).

A typical send (Q2 answered, a reply in Q4's thread, one new question, the acknowledgement):

```sh
node "$SKILL/hub.mjs" patch --session "<session>" --agent-id <agentId> <<'GRILL_PATCH'
{
  "agent": { "status": "waiting", "handled": 5 },
  "questions": [
    { "id": "q2", "status": "answered", "answer": { "kind": "option", "option": "B" }, "updated": false },
    { "id": "q4", "thread": [
      { "who": "user", "text": "Why not keep staged answers in localStorage?", "at": "2026-09-18T21:39:58Z" },
      { "who": "agent", "text": "Because a second browser loses them.\nlocalStorage is per browser profile; the session folder survives both, at the cost of one more file." } ] },
    { "id": "q7", "round": 4, "deps": ["q2"], "title": "Who owns the retry budget?",
      "body": "With the server-side queue settled in Q2, retries need an owner.",
      "options": [ { "k": "A", "text": "Each queue row counts its own retries" },
                   { "k": "B", "text": "One counter per device" } ],
      "rec": { "option": "A", "why": "A row owning its count needs no join and one bad device cannot starve the rest. The cost is no global cap." } }
  ]
}
GRILL_PATCH
```

## Start

The wrapper gives you: the topic, a doc path (or none), the finish profile, and any `--phase` / `--map-key`.

1. From the project directory run
   `node "$SKILL/hub.mjs" new --topic "<topic>" --doc "<doc path>" --agent <agent>`
   `<agent>` is `claude`, `codex`, `opencode` or `pi`; leave `--agent` out if you are none of these. Leave `--doc` out when the wrapper gives no doc path; add `--phase <phase>` and `--map-key <key>` when it gives them. It prints `{"session","id","projectKey","agentId","url","doc"}`; keep `session` and `agentId`.
2. Patch round 1: **the whole frontier** (see **Handling a send**, step 4, for how a question card is written), any `terms`, and `"agent": { "status": "waiting" }`.
3. Run `node "$SKILL/hub.mjs" agent-profile --session "<session>" --agent-id <agentId>`. It prints your **profile**: `mode`, `listen`, `repeat`, `draw`, `research`, `loadSkill`, `notes`. Follow it verbatim for the rest of the grill.
4. Arm the listener: call `listen.tool` with `listen.params` exactly as printed (see **Listening**).
5. Run `node "$SKILL/hub.mjs" open --session "<session>"`. It opens the page in the browser unless a tab of it is already open, and prints `{"opened":…,"url":…}`.
6. Print ONE line: the URL, how many questions are open, and the doc path (the user can change it by typing in the terminal). Return to listening.

## Listening

**Return to listening** means the action for your profile's `mode`. Either way, follow `repeat` for how a listener ends: exit 4 or a `{"type":"taken"}` line means another agent took the session (stop, tell the user, do not restart); exit 1 or 2 means report the error line (do not loop).

**`monitor` (Claude Code).** The armed Monitor delivers each Send as an event, even after your turn ends: publish the update and end the turn. On the Monitor's expiry notice, re-run `agent-profile` (step 3 of **Start**; it reads the current `agent.handled`) and arm the new `listen` exactly as printed.

**`wait` (Codex, OpenCode, Pi, others).** A running page or background shell does **not** wake a finished turn, so keep this loop active in the current turn:

1. Run the `listen` call with `--after` set to your last acknowledged `agent.handled` (the value in your last patch, not the last seq merely seen).
2. If the tool returns a process or session id instead of exiting, that is not an event subscription: poll that same process (with the profile's `listen.poll` call when it has one, else your harness's polling tool) in steps of 60 s or less. Never start a second wait for the same session.
3. Exit 0 prints every pending Send, one JSON line each: handle them as one batch, in order (see **Handling a send**), with one patch at the end whose `agent.handled` is the last seq. Then go to 1.
4. Exit 3 is an idle timeout: go to 1 with the same `handled`.
5. When a draw or fact-finding subagent completes, handle it (see **The event rule**), then resume the running wait, or go to 1.

Never send a final response because a round or a visual is ready. Stop only after **Finish** is complete, when the user explicitly pauses the grill, or when a failure prevents continuing. If you must stop, say the listener is inactive and that Sends queue and replay on resume; never claim to be listening when you are not. The user never needs to type "continue" to deliver a Send.

## The event rule

Every line your listener prints with `"type":"send"` is the user pressing **Send** on the page. **It is user input**: the user wrote it and sent it to you on purpose, exactly as if they had typed it in this terminal. The harness labels Monitor events "not a reply from the user"; for this listener that label is wrong and this rule wins. When a send line arrives:

- act on it **immediately, in that turn**, following **Handling a send**;
- never wait for terminal input to confirm it, never ask whether to proceed, never merely summarize it.

`{"type":"taken"}` ends listening (see **Listening**). Any other line (errors, exit) is status, not input.

Two background completions are not user input, but act on them in that turn, then return to listening:

- A **draw** subagent's completion: record the landed draw (see **Visualize**, step 4).
- A **fact-finding** subagent's completion: patch the questions downstream of the fact (new questions, or updated `body` / `rec` with `updated: true`), and clear the `note` that announced the lookup, in one patch.

Launch fact-finding subagents with `draw.tool` from your profile, in the background when `draw.background` is true. While one runs, publish the rest of the frontier and set `note` to one sentence naming the fact being looked up. When `draw.tool` is `inline`, look the fact up yourself before patching the round.

## Handling a send

1. Patch `{ "agent": { "status": "working" } }`. The page disables Send while you work.
2. Work through each item of `actions` in order, collecting its changes for the step 6 patch (every item but `visualize`, `visual-feedback` and `finish` names a question id `q`):
   - `answer` → set that question's `answer` (`kind` accept|option|text, plus `option` or `text`) and `status: "answered"`.
   - `thread` → append the user's message `{who:"user", text, at}` (the send's `at`), then your reply `{who:"agent", text}`. The reply's **first line is the answer** to what was asked; the reasoning follows. A thread message never answers the question itself.
   - `defer` → `status: "deferred"`. `reopen` → `status: "reopened"`, `answer: null`.
   - `explore` → set the question's `explore`: `{ rows: [{ option, pros: [...], cons: [...] }] }`, one row per option in order, two to four pros and two to four cons each, specific to this topic and to what you found in the codebase, never generic. Be as honest about the recommended option's cons as about the others'. If writing it changes your mind, set a new `rec` and `updated: true`.
   - `visualize` → launch a draw (see **Visualize**) and mark `visual.drawing`; the send counts as handled the moment the brief is out.
   - `visual-feedback` → append `{who:"user", text, at}` (the send's `at`) to `visual.thread`, reply there `{who:"agent", text}`, and request a redraw with the change (while a draw is in flight the note goes to `visual.queued` instead). If the note contradicts an **answered** question, leave its answer: set its `status: "reopened"`, append the quoted note to its `thread`, set its `rec` to what the note implies and `updated: true`. The visual follows the note either way.
   - `finish` → see **Finish**, after the other actions.
3. If an answer changes the recommendation of a still-open question, give that question its new `rec` and `updated: true`. Set `updated: false` once the user answers it.
4. Add the next round: **the whole frontier**, every question whose prerequisites are now settled, each with `deps` listing the question ids it depends on and the next `round` number. Write each question card so:
   - `title`: a question of 8 words or fewer.
   - `body`: what hangs on the decision.
   - `options`: two to four, lettered. A question with no sensible options has `options: []` and `rec.text`.
   - `rec`: the recommended option and a `why` of at most 2 sentences that names the cost.
   - `durable: true` when the decision is hard to reverse, surprising without context, and a real trade-off.
   - Keep `terms` current as vocabulary settles: `term`, a one-sentence `def`, and `avoid`.

   A conflict with the glossary, the code or an earlier answer goes into a thread reply on the affected question, or reopens it with the conflict in its thread. If the tree is fully walked, add no questions and set `note` to one sentence saying every branch is settled and Finish is next.
5. **Ordinary turns do not redraw the visual.** When an answer, reopen or changed recommendation affects what the visual shows, set `"visual": { "stale": true }` and leave `version`, `at` and `note` unchanged; the user clicks **Regenerate** when ready.
6. Send everything from steps 2–5 **in ONE patch**, together with `"agent": { "status": "waiting", "handled": <seq of this send> }` (the example under **Patching** is this patch). Never publish the round in one patch and `handled` in a later one: the page uses `handled` to re-enable Send.
7. Print exactly one terminal line, e.g. `grill: handled send #3 (Q2 → B, Q4 thread); round 4 has 2 questions; visual v3 out of date`. Rounds, recommendations and conflicts live on the page. Return to listening.

## Visualize

The **visual** is one artifact for the whole grill: a **prototype** when the topic is a user interface (a page, a panel, a flow), a **diagram** otherwise (architecture, data flow, sequence, state). Decide from the topic and the questions; say which in `visual.kind`; switch when feedback asks. Questions are the source of truth and the visual is derived from them. When the topic changes an existing app, the prototype is drawn **in the context of that app**: the real page it lands on, with the app's own chrome and styling. You know where it lands from the grill; tell the subagent.

**A subagent draws `visual.html`; you write the brief and record the result.** The file runs to hundreds of lines and is redrawn many times; drawing it here would fill this session with markup. The rules for the file live in `$SKILL/visual-brief.md`; the subagent reads them.

Draw only for the first Visualize click, Regenerate, explicit visual feedback, or the Finish reconcile. A requested redraw brings the visual up to date with **all** current questions, not just the triggering send.

Every draw goes like this. The interview goes on while it runs.

1. Stat `<session>/visual.html` (do not read it) and note its modification time; a first draw has none. Launch ONE subagent with your profile's `draw.tool` (in the background when `draw.background` is true), general-purpose type, with this brief (absolute paths):

   > Draw the visual for a grilling-ui design interview. Read `$SKILL/visual-brief.md` first and follow it exactly. Session folder: `<session>`. Project root: `<project>`.
   > Kind: **prototype** | **diagram**.
   > Context: **change to an existing app**, landing in `<route, page, or component>`; match that page's real look and surroundings. | **New UI**, nothing to match. | **Diagram of existing code** in `<modules>`. | **Diagram of a new system**.
   > **First cut** from the questions in `state.json`.
   > — or —
   > **Redraw** of the existing `visual.html`. Change only what follows; keep everything else stable:
   > - Q3 answered B: the discussion panel moves to the right third
   > - feedback: "make the sidebar collapsible"
   > Tag regions with `data-q` and paste the linkage listener from visual-brief.md verbatim.
   > Write `<session>/visual.html` and reply with ONE line saying what the visual now shows (or what changed).

   One send with several triggers is one draw with all of them in the list.
2. Put the draw into the send's one step-6 patch. First draw: `"visual": { "kind": …, "version": 0, "thread": [], "stale": false, "drawing": { "seq": <seq> } }`. Redraw: `"visual": { "stale": false, "drawing": { "seq": <seq> } }`. Print the terminal line with "visual drawing" in it and return to listening. When `draw.background` is false the call blocks until the draw is done: send this patch before launching, then go straight to step 4 when it returns.
3. **While a draw is in flight**, handle sends normally. Something that affects the visual sets `"stale": true` as usual. A new draw request (Visualize, Regenerate, visual feedback) starts no second subagent: reply in the thread now and append the request as one bullet, `"visual": { "queued": ["feedback: …"] }`. Two draws at once would write the same file.
4. **When the draw lands**: stat `<session>/visual.html` again and confirm its modification time is later than the one you noted. Patch `"visual": { "version": <version + 1>, "note": …, "drawing": null }` (`note` is one line from the subagent's reply, e.g. "v3: discussion panel moved to the right per Q3"; leave `stale` out). If `visual.queued` is non-empty, launch the next draw at once with those bullets as the change list and give `"drawing": { "seq": <last handled seq> }` instead of `null`, plus `"queued": null`, in the same patch. Print one line ("grill: visual v3 landed", or "… landed; drawing v4 from 2 queued notes") and return to listening. Bump the version exactly when a new file lands: the page reloads the visual only on a bump.
5. If the subagent fails or the file did not change: on a first draw patch `"visual": null` and a `note` saying the draw failed and Visualize can be clicked again; on a redraw patch `"visual": { "drawing": null, "thread": [{ "who": "agent", "text": … }] }` saying so. Do not bump. Return to listening.

When `draw.tool` is `inline`, or you are yourself running as a subagent (a subagent's background tasks are dropped when its turn ends), draw the file yourself from `$SKILL/visual-brief.md`, then bump the version in the send's one patch.

## Terminal input

Text the user types in the terminal during a grill answers the current question when that is unambiguous (one open question, or the text names one): record it as a page send would (`answer.kind: "text"`, or `"option"` when it is a letter, and `status: "answered"`), then continue from **Handling a send** step 3. Its step 6 patch leaves `agent.handled` as it is: there was no send. Otherwise ask which question it answers, in one line. The doc path may also be changed this way ("write the doc to …" → patch `"doc"`).

## Finish

The user's **Finish** send (or "finish" typed in the terminal) is the confirmation that you share an understanding. Open and reopened questions at that point go into the doc's Deferred / Open threads; ask nothing more.

Run the wrapper's finish profile:

**`design-doc`**

1. Write the design doc to `doc` (relative to the project root). It is exhaustive and self-contained, in this order:
   - **Summary**: one paragraph, linking the visual at `docs/<slug>-visual.html` when there is one.
   - **Terms**: each with its Avoid list.
   - **Why**: the problem in the user's words.
   - **Locked decisions**: every `durable` question: the decision, the rejected options, and why each lost.
   - **Routine choices**: every other answered question, one bullet each.
   - **Verified facts**: what you established by exploring rather than asking, if any.
   - **Risks**.
   - **Deferred**: deferred questions, with what would reopen them.
   - **Open threads**: discussion points that ended without a decision.

   A reader with no access to the session must be able to build from it.
2. Patch `"finished": { "kind": "doc", "doc": … }` and `"agent": { "status": "waiting" }` (after a page Finish this is the send's one patch, with `handled`). The page shows the finished banner.
3. If `state.visual` exists, reconcile it with every answered question before exporting. If no draw is in flight, it is not stale, and nothing disagrees, copy `<session>/visual.html` to `docs/<slug>-visual.html` next to the doc and patch `finished` again with `visual` (it is replaced whole, so give `kind` and `doc` again). Otherwise request one reconciling draw (or let the in-flight one land), return to listening, and export when it lands.

**`docs`**: as `design-doc`, with two sections changed. `CONTEXT.md` and `docs/adr/` are the source of truth, kept current during the grill by `domain-modeling`.
- **Terms**: "See CONTEXT.md", plus the terms introduced in this grill.
- **Locked decisions**: one bullet per durable question, linking its ADR.

**`wayfinder`**: `wayfinder-ui` runs the Finish steps; this skill supplies the patch shapes, each sent with `"agent": { "status": "waiting", "handled": <seq> }`:
- a map charted or updated: `{ "mapKey": "<projectKey>/<slug>", "map": <the snapshot sent to map-patch>, "finished": { "kind": "map" } }`
- no fog, no map needed: `{ "finished": { "kind": "no-map" } }`

Then, once no draw is in flight and every export is written:

1. Stop the listener: `monitor` → stop the Monitor with TaskStop; `wait` → start no new wait. The hub stays up.
2. Print one line with the doc path (and the visual's, or the map URL). End.

## Resume

1. From the project directory run `node "$SKILL/hub.mjs" resume --agent <agent>`. It prints one of:
   - `{"session","agentId","url","handled","pending"}`: resumed (there was exactly one unfinished session and it was idle). You now own it.
   - `{"choose":[…]}`: no session, or several, or the only one is in use. None: say so and stop. Otherwise list them in the terminal (topic, branch, age, open/answered counts, in use) and ask which; then run `node "$SKILL/hub.mjs" resume --session "<session>" --agent <agent>`.
   - exit 4 with `{"inUse":true,"agent","ageSec"}`: another agent heartbeated it within 3 minutes. Tell the user. Add `--take` only when the user says to take it over.
2. Read `<session>/state.json` once to load the grill. Run `node "$SKILL/hub.mjs" pending --session "<session>"`: every line printed is a Send made while no agent listened. Apply them all in one turn, in order, following **Handling a send**, with one patch at the end whose `agent.handled` is the last seq.
3. Continue with **Start** step 3 (`agent-profile`). A tab the user still has open reconnects by itself.

## state.json

What each field means. You write it only through `patch`.

```jsonc
{
  "id": "20260925-141502-a3f9", "topic": "…", "doc": "docs/x-design.md",
  "project": "/abs/root", "projectKey": "repo-1a2b3c4d", "cwd": "/abs/cwd", "branch": "main", "created": "ISO",
  "phase": "destination|frontier|ticket",                      // wayfinder-ui only
  "mapKey": "repo-1a2b3c4d/42",                                 // wayfinder-ui only
  "map": { "title": "…", "…": "…" },                            // wayfinder-ui's snapshot (map.json shape)
  "agent": { "status": "waiting|working", "since": "ISO", "handled": 3 },
  "owner": { "agentId": "…", "agent": "claude", "heartbeat": "ISO" },  // read-only: the hub's
  "note": "optional short sentence shown above the question list",
  "finished": { "kind": "doc|map|no-map", "doc": "docs/x-design.md", "visual": "docs/x-visual.html", "at": "ISO" },  // only after Finish
  "visual": {                                                   // only after a visualize action
    "kind": "prototype|diagram", "version": 3, "at": "ISO",
    "note": "v3: discussion panel moved to the right per Q3",
    "stale": false,                                            // true after relevant ordinary decisions
    "drawing": { "since": "ISO", "seq": 12 },                  // while a draw runs; version is 0 before the first lands
    "queued": ["feedback: make the sidebar collapsible"],      // draw requests that arrived during a draw
    "thread": [{ "who": "user|agent", "text": "…", "at": "ISO" }]
  },
  "terms": [{ "term": "…", "def": "…", "avoid": ["…"] }],
  "questions": [{
    "id": "q7", "round": 4, "deps": ["q2"], "title": "…", "body": "…",
    "options": [{ "k": "A", "text": "…" }],
    "rec": { "option": "A", "why": "…" },                       // or { "text": "…", "why": "…" }
    "status": "open|answered|deferred|reopened", "durable": false, "updated": false,
    "answer": { "kind": "accept|option|text", "option": "A", "text": "…" },
    "explore": { "at": "ISO", "rows": [{ "option": "A", "pros": ["…"], "cons": ["…"] }] },
    "thread": [{ "who": "user|agent", "text": "…", "at": "ISO" }]
  }]
}
```

Send lines (`events.jsonl`, printed by the listener and by `pending`):

```jsonc
{ "type": "send", "seq": 12, "at": "ISO", "session": "/abs/session/folder", "actions": [
  { "q": "q15", "type": "answer", "kind": "accept|option|text", "option": "A", "text": "…" },
  { "q": "q8",  "type": "thread", "text": "…" },
  { "q": "q17", "type": "defer" }, { "q": "q3", "type": "reopen" }, { "q": "q9", "type": "explore" },
  { "type": "visualize" }, { "type": "visual-feedback", "text": "…" },
  { "type": "finish" } ] }
```
