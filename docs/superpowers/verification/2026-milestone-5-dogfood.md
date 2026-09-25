# Milestone 5 dogfood — Claude Code (T26)

Date: 2026-09-25. Claude Code 2.1.282, Node 26, macOS. Plugin loaded from the worktree
(`--plugin-dir`, and followed from the files in the coordinating session). Real
`~/.intelligentrascal`.

Rahil delegated this gate to Claude ("you are my eyes and ears"). How each role was played:

- **Project A** (`proj-a`, a fresh git repo): the coordinating Claude Code session acted as the
  agent, loading Pocock's `grilling` with the Skill tool and following `grill-me-ui` →
  `grilling-ui` verbatim, listening with the real Monitor tool.
- **Project B** (`proj-b`, a second git repo with `CONTEXT.md`): a separate headless Claude Code
  process, `claude -p --plugin-dir <worktree> "/intelligentrascal:grill-docs-ui tagging recipes by diet"`.
- **The user**: Claude drove both pages in a browser (keyboard shortcuts, clicks), as a user would.

| Check | Result |
|---|---|
| Two grills at once in two repos share one hub (`hub.json` pid constant; one `hub.mjs serve`; two `watch` processes) | ✓ pid 44472, one serve, two watchers |
| The browser opened by itself for each; the URL line was printed | ✓ A opened the default browser (`open` → `opened:true`); B called the opener (`GRILL_OPENER` log shows its URL) |
| B loaded `grilling`, then `domain-modeling`, then `intelligentrascal:grilling-ui` | ✓ (stream log) |
| Round 1 held the whole frontier; the terminal shows one status line per send, no ❓/➡️ rounds | ✓ A: 4 questions, B: 4; no ❓/➡️ in any assistant text. B printed one extra line during Start ("Round 1 is on the page; arming the listener now."), fixed by tightening `grilling-ui` Start |
| A Send made while the Claude turn is idle wakes it (Monitor event) and is handled | ✓ A: 3 sends, each woke the idle turn; B (headless) also woke and handled its send |
| Monitor expiry re-arms with the current `handled` (`GRILL_MONITOR_MS=60000`) | ✓ expiry notice after 1 min; `agent-profile` re-run; re-armed Monitor delivered the next send |
| Tabs show `<project> · <topic>` and status favicons | ✓ "proj-a · Due dates and reminders for the todo CLI", "proj-b · tagging recipes by diet" |
| Closing Claude in B flips its page to "no agent listening" within 3 min | ✓ flipped ~3 min after the last heartbeat. Defect: the status still also said "Agent waiting for you" → fixed (status now says no agent is listening) |
| A Send made with no agent queues; `/intelligentrascal:grill-docs-ui resume` picks it up and replays it | ✓ seq 2 queued; the resumed headless session replayed it, updated `CONTEXT.md`, wrote ADR 0003, re-armed its Monitor; the open tab reconnected by itself |
| Finish in A writes `docs/<slug>-design.md` with all §4 sections | ✓ Summary, Terms, Why, Locked decisions (durable Q1/Q3/Q7 with rejected options), Routine choices, Verified facts, Risks, Deferred, Open threads |
| B updates `CONTEXT.md`/ADRs; its doc has "see CONTEXT.md" Terms and ADR-linked Locked decisions | ✓ `CONTEXT.md` modified, ADRs 0001–0003, Terms "See CONTEXT.md" + new terms, each locked decision links its ADR |
| Listener stops at Finish; hub stays up | ✓ both watchers gone, hub still serving |

Other observations:

- A thread draft typed but not added with "Add to discussion" is not sent (Jason's behaviour; the
  footer counts only staged items, and the draft stays in the box across updates).
- A number key pressed immediately after four rapid `k` presses was dropped once (the next press
  worked) → investigated and fixed with a regression check (see the commit after this record).

Defects found were fixed in separate commits before this gate was marked done.
