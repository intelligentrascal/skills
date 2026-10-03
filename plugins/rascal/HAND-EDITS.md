# Hand edits to derived files

Every edit made to a derived file (one with a `provenance:` line) beyond `scripts/derive.mjs`'s `REF_MAP`, its `--name` rename and its provenance stamp. Sync (build step 7) re-applies these after re-deriving a file; anything not listed here or in derive.mjs's REF_MAP is a drift.

Rule blocks (`<!-- rule:… -->`) are not listed: `scripts/sync-rules.mjs` writes them. Graft sections (a heading followed by `<!-- graft: … -->`) are authored and re-added whole.

Derived files not listed here have no hand edits.

## rascal-grill-me/SKILL.md (pocock grill-me)

- `description:` rewritten: adds "in the terminal" and the trigger phrases.
- `"grilling"` → `"rascal-grilling"` with the Claude Code name.

## rascal-grill-with-docs/SKILL.md (pocock grill-with-docs)

- `description:` rewritten: CONTEXT.md and ADRs, "in the terminal", trigger phrases.
- `"grilling"`, `"domain-modeling"` → rascal names with the Claude Code names.

## rascal-grilling/SKILL.md (pocock grilling)

- Added the rule blocks `questions` and `recommend`.
- Added grafts `## Wide design space`, `## Before the doc`, `## Hand-off` (from obra brainstorming).

## rascal-tdd/SKILL.md (pocock tdd)

- The `codebase-design` pointer replaced by its gist inline (prefer a deep module; seam at its interface).
- "see the `code-review` skill" → "see the `rascal-review` skill".

## rascal-wayfinder/SKILL.md (pocock wayfinder)

- Removed `disable-model-invocation: true`.
- Tracker paragraph: picks `trackers/github.md`, `gitlab.md` or `local.md` itself instead of pointing at `/setup-matt-pocock-skills`.
- Research tickets (Ticket Types and Chart step 5): dispatch a subagent to research from primary sources and write findings to the ticket, instead of calling a `research` skill; the throwaway `research/<name>` branch is gone.
- `"prototype"` → `"rascal-prototype"`; every `"grilling"` / `"domain-modeling"` call (Ticket Types, Chart step 1, Work step 3) → rascal names.

## rascal-wayfinder/trackers/github.md, gitlab.md

- Deleted the "Pull requests as a triage surface" (github) and "Merge requests as a triage surface" (gitlab) sections.

## rascal-wayfinder/trackers/local.md

- The `Status:` line: claim state, values `open`, `claimed`, `resolved` (was triage state pointing at `triage-labels.md`).

## rascal-planning/SKILL.md (pocock to-spec)

- `description:` rewritten for spec → plan → execute; removed `disable-model-invocation: true`.
- Tracker line → write the spec to `docs/specs/<YYYY-MM-DD>-<slug>.md`; publish to the tracker only when asked.
- Process step 3: save the spec and commit it on the current branch (no tracker publish, no triage label).
- Added grafts `## Plan` (obra writing-plans) and `## Execute` (obra executing-plans).

## rascal-planning/plan-format.md (obra writing-plans)

- Announce line: "the writing-plans skill" → "the rascal-planning skill".
- **Context** line: the garbled worktree-skill sentence → "created with `git worktree add` before planning started".
- `docs/superpowers/plans/` → `docs/plans/`.
- "during brainstorming" → "during the grill".
- The "For agentic workers" header line: rascal-planning (Execute), or rascal-orchestrate for parallel tickets.
- Deleted the `## Execution Handoff` section.

## rascal-planning/executing.md (obra executing-plans)

- Stop list: "a side effect … that norms say you ask about first (a merge, a push to a shared branch, a publish)" → "that the user hasn't approved (a push or merge is approved once the user approved the plan; a publish to anything public is not)".
- When to Use: "chose inline execution at the handoff" → "are running it in this session"; dropped the `../using-superpowers/references/` pointer.
- Diagram node "systematic-debugging" → "rascal-debugging".
- Final review without a subagent tool: the self-review goes in the handoff's **Decisions** field and the run continues (was: the partner decides before merge).
- Finish: rulings and deferred minors go in the handoff's **Decisions** field (was: "your final message").
- Example: "the executing-plans skill" → "the rascal-planning skill"; `docs/superpowers/plans/` → `docs/plans/`.

## rascal-planning/scripts/task-start (obra)

- Header comment: "via subagent-driven-development's task-brief, so both skills share one workspace" → "via this skill's task-brief, in the one .rascal/sdd workspace".

## rascal-orchestrate/review-loop.md (obra subagent-driven-development)

- Line 2: a note mapping the file onto rascal-orchestrate (tasks, PLAN_FILE, HEAD/BASE, integration worktree, worker resumed in fix rounds 1-3, dispatch file as task brief, Ship step → orchestrate step 6).
- Stop list: same edit as executing.md.
- DONE status: review-package runs as `bash <this skill's folder>/scripts/review-package …` with the integration worktree as the working directory (was: "from this skill's directory").
- When-to-use diagram nodes: "subagent-driven-development" → "rascal-orchestrate", "executing-plans" → "rascal-planning (inline)".
- "Never dispatch multiple implementation subagents in parallel" → parallel implementers only on independent tickets, each in its own worktree.
- Final Review: residual load-bearing findings go in the handoff's **Decisions** field (was: when finishing-a-development-branch presents the options).
- Example: "I'm using Subagent-Driven Development to execute this plan" → "I'm using rascal-orchestrate to run this plan"; `docs/superpowers/plans/` → `docs/plans/`; `~/.config/superpowers/hooks/` → `~/.config/hooks/`.

## rascal-review/SKILL.md (obra requesting-code-review)

- `description:` adds "before claiming any work is done, fixed or passing - review the work, then prove it with fresh evidence".
- "After each task in subagent-driven development" → "After each task (rascal-planning or rascal-orchestrate)".
- Example: `docs/superpowers/plans/` → `docs/plans/`.
- Added authored section `## Without a subagent tool`.
- Added graft `## Before claiming done` (obra verification-before-completion).
