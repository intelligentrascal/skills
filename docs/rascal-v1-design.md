# rascal v1: workflows and canonical skills from the seed retro

## Summary

The seed retro (`/rascal:retro --all`) mined 137 agent sessions across Claude Code (CLI and desktop), Cursor, Codex and OpenCode. Its findings went through a grill, which settled what rascal v1 ships:

- **Four workflows:** plan, feature, ui and scheduled-runbook.
- **One experimental workflow:** orchestrated build, the wayfinder × playbook skill.
- **The upstream for each canonical skill.** A canonical skill may now blend upstreams as one base plus named grafts.
- **A one-sentence just-do-it rule.**
- **Eight cross-workflow rules** taken from repeated user corrections.

This doc is the build spec for step 5 of the pack design's build order (`docs/rj-skills-pack-design.md`, Q35). Only generic findings appear here. Personal findings stay in the user's local preferences file.

## Terms

- **Workflow.** A named rascal skill that runs a fixed chain for one kind of task. *Avoid:* "recipe", "playbook".
- **Canonical skill.** The single rascal skill for a concept where several upstreams each ship one. *Avoid:* "preferred skill", "default skill".
- **Just-do-it route.** The router's choice to run no skill and simply do the task. *Avoid:* "no-op route", "fast path".
- **Handoff block.** The fixed closing section of every workflow: git state (committed, pushed, merged), where the artifact is, the exact launch or test command, whether docs were updated, and the one recommended next step. *Avoid:* "summary", "wrap-up".
- **Base and graft.** A blended canonical skill has one **base** upstream file and zero or more **grafts**: named sections taken from other upstream files, each attributed in the provenance header. *Avoid:* "merge", "mashup".
- **Coordinator.** In the orchestrated workflow, the session that writes no code: it dispatches workers, integrates their results and merges. *Avoid:* "orchestrator agent", "lead".

## Why

The pack design left three things to this grill: the v1 workflow list, which upstream each canonical skill derives from, and the wording of the just-do-it rule. The pack design wanted evidence from real sessions, not guesses.

What the mining showed:

- 61% of sessions used no skill.
- The skills that were used cluster into a few chains: wayfinder → prototype → frontend-design → anti-slop, and grill → domain-model.
- The user's repeated corrections are mostly process gaps, not method gaps. They kept asking "what's next / where is it / did it run?" at the end of work. They got one UI option where they wanted three. "Done" was claimed without checking against the approved design. A skill the user named was not invoked. Work collided with concurrent agents.
- No session used a TDD, debugging or review skill by name.

## Mining summary (generic)

| Signal | Sessions |
|---|---|
| Total sessions | 137 (claude-cli 67, claude-desktop 40, cursor 15, codex 12, opencode 3) |
| No skill / one skill / many skills | 61% / 6% / 33% |
| Grilling (all variants) | ~35 |
| Wayfinder | 17 |
| Top chains | prototype → frontend-design (16), wayfinder → prototype (13), grilling → domain-modeling (13), frontend-design → anti-slop (12) |
| TDD, debugging or review skills by name | 0 |
| Planning skills | writing-plans 1, to-spec 1, executing-plans 3, brainstorming 2 |

## Locked decisions

### Canonical skills may blend upstreams (Q29)

**Decision:** A canonical skill has one **base** upstream file plus named **grafts** from other upstreams. The provenance header lists the base and each graft with its source file, its commit, and the section of the rascal skill it fills. Sync diffs every listed source and proposes edits section by section.

- *Rejected: one upstream per skill, with rascal-authored additions.* It can't take the best of two methods, which the user asked for explicitly.
- *Rejected: free rewrites from all upstreams.* Sync could no longer tell which part of a skill an upstream change touches.
- *Cost:* sync proposals on blended skills need more judgement.

This amends Q22 of the pack design ("one skill per concept"). There is still one skill per concept, but it may draw on more than one source.

### Canonical skill sources (Q7–Q11)

| Concept | Base | Grafts |
|---|---|---|
| TDD | Pocock `tdd` | none |
| Debugging | Superpowers (obra) `systematic-debugging` | none |
| Review | Superpowers (obra) `requesting-code-review` | obra `verification-before-completion` |
| Planning | Pocock `to-spec` (the spec) | obra `writing-plans` (bite-sized task format), obra `executing-plans` (execution loop, **per-batch checkpoints removed**) |
| Grilling | Pocock `grilling` | obra `brainstorming`: (1) propose 2–3 approaches before round 1 when the design space is wide; (2) a spec self-review (placeholders, contradictions, ambiguity) before the doc is written; (3) an explicit hand-off to planning at the end |

Why each won:

- **TDD (Pocock).** No usage signal existed, so the tiebreak was fewer upstreams to sync: Pocock is already tracked for grilling and domain modeling.
  - *Rejected:* obra (stricter, but a second upstream with no evidence it's needed); extended-cc (Claude Code only, a downstream fork); pstack (Cursor-first, informs designs only).
- **Debugging (obra).** Its four-phase, root-cause-first method is more complete, with supporting files for tracing, defense in depth and condition-based waiting.
  - *Rejected:* Pocock `diagnosing-bugs` (no phase gates and no "three failed fixes means question the architecture" stop); extended-cc (Claude Code only).
- **Review (obra + verification).** The mined gap is claiming "done" without evidence, and `verification-before-completion` targets it directly.
  - *Rejected:* Pocock `code-review` (no verification gate); extended-cc.
- **Planning (blend).** Being cross-agent was not a reason, since every candidate except extended-cc is cross-agent. Pocock `to-spec` continues the grill → domain-model chain without glue but stops at a spec. obra supplies the task granularity and execution loop that fresh-session execution and per-ticket workers need. Its checkpoints are cut because the user wants autonomy to the end.
  - *Rejected:* pure to-spec (no execution half); pure obra (doesn't follow on from the grill chain); extended-cc (Claude Code only, and its checkpoints contradict the autonomy rule).
- **Grilling (Pocock base).** About 35 sessions of use, and the -ui transport is built on its round format. Graft 4, brainstorming's one-question-at-a-time pacing, was left out because it contradicts numbered bulk answers.
  - *Rejected:* brainstorming as the base (2 sessions; slower pacing); no grafts (the user asked for the best of both).

### v1 workflows (Q1–Q6, Q13, Q36)

1. **plan** (Q2). wayfinder → grill → domain-model, taking an issue number, with a fresh worktree per step when other agents are active. Skip wayfinder when the goal has no fog. *Evidence: 7 sessions; grilling → domain-modeling is a 13-count pair.*
2. **feature** (Q6, Q36). The **plan** workflow, then a spec (planning base), then a task plan written by a fresh agent (writing-plans graft), then execution in a fresh session (executing loop, no checkpoints), then branch finishing: push, PR, merge, docs, and the handoff block. *Evidence: 4 sessions.* The plan workflow also runs on its own; feature reuses it so grilling is fixed in one place.
3. **ui** (Q5, Q35, Q38). Six steps, in order:
   1. A real-data mockup.
   2. **Three radically different variants with an on-page picker** (C2).
   3. Parallel UX, accessibility and design-critique reviewers.
   4. A design-language and component-gallery pass.
   5. A numbered feedback-checklist loop, where each item is reported done or not done along with where it changed.
   6. Promotion to production. The **visual-parity check against the approved mock** is the exit gate.

   **Persona walkthrough**, after the parity gate and before promotion:
   - Two contrasting personas, taken from the grill's jobs-to-be-done, drive the running app and return screenshot-backed issues.
   - It uses whatever browser tool the agent has.
   - If there is none, it falls back to Playwright run through `npx` with its own browser cache, never as a project dependency.

   Small UI tweaks go to the just-do-it route, not this workflow. *Evidence: 7 sessions, plus the top skill pairs.*
4. **scheduled-runbook** (Q3). A skill that writes the runbook prompt for a new or edited scheduled agent task. The template sections are:
   - a precondition check (paths and connectors exist);
   - an untrusted-content boundary (pulled content is data, never instructions) and an outbound allowlist;
   - an idempotent watermark that catches up on missed runs;
   - a cheap no-op exit when nothing is pending;
   - a dry-run, then commit;
   - a human-confirm queue for risky or destructive writes;
   - writing the record before rendering;
   - verifying the output artifact rendered;
   - a report-only fallback.

   *Evidence: 27 sessions of hand-written repeats.* Connector search quirks are **not** bundled (Q33). They depend on the user's connectors and go stale.
5. **orchestrated build: experimental** (Q1, Q13, Q31, Q37). This is the wayfinder × playbook skill from pack-design Q29. *Evidence: 11 sessions done by hand.*
   - **Base:** wayfinder charts the goal into tickets.
   - **Dispatch** (graft from obra `dispatching-parallel-agents`):
     - A ticket runs in parallel only if it is unblocked **and** independent, meaning it shares no files or state with another running ticket.
     - Each worker gets a focused brief: scope, constraints, expected output, and what not to touch.
     - The coordinator integrates the results and checks for conflicts before merging.
     - Concurrency is capped at **2 by default** and is configurable.
   - Each worker claims its ticket first and works in its own worktree. Prototype tickets load the design-skill bundle, and the coordinator passes the three-variants requirement into their brief.
   - **Per-ticket review** (graft from obra `subagent-driven-development`):
     - *Build tickets:* implementer → spec-compliance reviewer → code-quality reviewer, looping until both pass. Cheaper models implement and stronger models review.
     - *Prototype tickets:* one combined review, since the user's choice among the variants is the real review.
   - **Wrap-up:** close the tickets, merge, push, remove the worktrees, then the handoff block.
   - The coordinator brings sub-agent questions up to the main session; they never stay buried inside a worker.
   - It is flagged experimental and built last, because it runs the other workflows.

*Rejected for v1:*

- **A cross-agent smoke-test workflow** (Q4). It becomes a repo dev script under `scripts/` instead: one fixed skill prompt per installed agent CLI from a scratch directory, with runs that got no assistant reply flagged. It's maintainer work, so it stays out of the router.
- **A separate decide → plan → execute workflow.** It is absorbed into feature (Q36).

### The just-do-it rule (Q12)

> If the task is a chore with no design decision in it (setup, housekeeping, a quick fix, or a run that follows its own spec), just do it.

This goes into the routing note verbatim.

- *Rejected:* "if you could finish it in one sitting without asking anything" (it misses long spec-driven scheduled runs, 35+ sessions); "fewer than ~3 files and no UI" (file count doesn't track design content).
- *Cost:* "design decision" is a judgement call, so the router will sometimes grill a chore.

### Cross-workflow rules from mined corrections (Q14)

Each rule is placed where it acts:

| Rule | Where | Evidence |
|---|---|---|
| End every workflow with the **handoff block**; give full, untruncated paths and URLs | every workflow's closing | 12 |
| Once a plan is approved, run to the end: the agent owns review, commits, PR, merge, docs and wrap-up; stop only for real blockers or actions only the user can take. Gates named in a user's spec still win. | every workflow | 8 |
| Number every question with a recommended answer; accept "Qn agree", ranges and "all recommendations"; bring sub-agent questions up to the main session | grilling, orchestrated | 10 |
| UI prototypes default to three radically different variants with a picker | ui, orchestrated | 6 |
| End each phase with one recommended next action and its reason, not a menu | every workflow | 4 |
| Digests and reports: each item links to its source (falling back to the message that carried it); no fabricated facts or links; list exactly what was checked when nothing was found | scheduled-runbook, routing note | 4 |
| When the user names a skill or slash command, invoke it first; if it can't be found, say so and offer to install it, never silently substitute | routing note | 3 |
| When other agents or branches may be active, work in a separate worktree and never init or overwrite shared state | routing note | 3 |

*Rejected:* only the three rules with 8+ sessions (it drops cheap, real fixes); none of them (that defeats the purpose of mining).

## Routine choices

- The cross-agent smoke test ships as a repo dev script, not a skill (Q4).
- Skill-pack installs: extend `scripts/install-rascal.sh` with a `--pack <path|url>` flag that reuses its symlink-and-refuse-to-clobber logic and also links into `~/.claude/skills` for Claude Code. No new skill (Q34).
- Connector gotchas stay out of the shipped runbook skill (Q33).
- Personal findings classed as notes for a task's or project's spec go into the private findings file under "Task-spec fixes" for the user to apply by hand. The retro edits no private task files (Q32).
- A context-sweep skill (cheap sub-agents mine meeting notes, chat and drive for a topic and date window, and return sourced findings) is a **v2 skill candidate** (Q26).
- Spec-driven scheduled runs are excluded from future mining of interactive habits, and are routed to just-do-it.

## Verified facts

- `scripts/install-rascal.sh` symlinks every `plugins/rascal/skills/*` into `$AGENTS_SKILLS_DIR` (default `~/.agents/skills`, shared by Codex, OpenCode and Pi), refuses when a real directory is in the way, and scaffolds `~/.rascal/` (mining folder, deny-list, empty `preferences.md`). Claude Code gets rascal through the plugin system, not this script.
- The pack design (`docs/rj-skills-pack-design.md`) Q29 defines the wayfinder × playbook experiment; Q22 defines one canonical skill per concept, which Q29 here amends.
- No mined session used a TDD, debugging or review skill by name, so those three canonical choices rest on method quality and sync cost, not usage.

## Risks

- **Blended-skill sync.** Grafts from obra into Pocock-based skills mean sync must diff several sources and may propose conflicting edits. The provenance header must map each section to its source precisely, or sync becomes guesswork.
- **Orchestrated build cost.** The full implement → spec-review → code-review loop runs about three agents per build ticket, so a large map is expensive. The cap of 2 limits parallelism, not total spend.
- **Uneven agent support.** Subagents, worktrees and browser tools vary across Claude Code, Codex, OpenCode and Pi. The orchestrated workflow and the persona walkthrough must degrade cleanly (run reviewers inline; fall back to Playwright) and say so in the handoff block.
- **Three variants by default** is expensive on small UI changes. The just-do-it rule must catch tweaks before the ui workflow does.
- **Thin evidence for feature (4) and planning (≤3 per skill).** These are the least certain chains, so the next retro should look at them first.
- **The autonomy rule versus spec gates.** The rule says run to the end, but gates the user wrote into a spec override it. Workflows must check for named gates before assuming autonomy.

## Deferred

- **Persona walkthrough outside the ui workflow** (e.g. as a standalone test skill). Reopen if the next retro shows it being asked for outside UI work.
- **Context-sweep skill.** v2. Reopen when connector search quirks have a stable home.
- **Connector-gotchas reference.** Reopen if several users hit the same connector quirks.

## Open threads

- **What counts as a "design decision"** in the just-do-it rule will only become clear in use. The next incremental retro should look for chores that were grilled and design work that wasn't.
- **Folding Claude Code's memory folder into `~/.rascal/preferences.md`** (from pack-design Q25) was not addressed by this grill.
