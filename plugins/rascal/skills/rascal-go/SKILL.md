---
name: rascal-go
description: The rascal router. Looks at a task and picks how to do it (just do it, a rascal workflow, one canonical skill, or a short chain), says which in one line, then does it. Use when the user invokes /rascal:go or rascal-go with a task, or when you are unsure which rascal route a task needs.
---

# Go

The task is whatever followed the command (`/rascal:go <task>`, or `use rascal-go on <task>`). With no task, ask for one in a single line and stop.

## 1. Pick the route

Read `~/.rascal/preferences.md` if it exists; it can change how a route runs, never which routes exist. Then take the first route that fits:

<!-- routing-note -->
**Route every task before starting it.** First match wins:
- **Named skill:** when the user names a skill or slash command, invoke it before anything else. If it can't be found, say so and offer to install it; never quietly substitute another.
- **Just do it:** if the task is a chore with no design decision in it (setup, housekeeping, a quick fix, or a run that follows its own spec), just do it.
- **Workflow:** otherwise, when its trigger fits, run the workflow:
  - `rascal-plan`: when the user wants to plan, scope or think through work, or names an issue to plan.
  - `rascal-feature`: when the user wants something built, added or changed that needs design decisions.
  - `rascal-ui`: for a new page, screen, flow or visual redesign; not for small UI tweaks.
  - `rascal-scheduled-runbook`: when the user creates or edits a scheduled task, or a recurring run keeps failing the same way.
  - `rascal-orchestrate`: when the user wants a big multi-task build run in parallel, or says orchestrate.
- **One method only:** use rascal's canonical skill, never another pack's: TDD `rascal-tdd` · debugging `rascal-debugging` · review `rascal-review` · planning `rascal-planning` · grilling `rascal-grilling`.

**Always:**
- **Isolation:** when other agents or branches may be active, work in a separate git worktree; never init or overwrite shared state.
- **Sources:** digests, reports and briefs link every item to its source and never invent one.
<!-- /routing-note -->

Chains the router may pick, when one method is not enough and no workflow fits:

- **A bug** whose cause isn't obvious: `rascal-debugging` → `rascal-tdd` (a failing regression test first, then the fix) → `rascal-review`.
- **A design question with nothing to build yet:** `rascal-grilling` alone. If the user then wants it built, `rascal-feature`.
- **Finished work to check:** `rascal-review` alone.

Choosing between routes:

- A chore stays a chore even when it touches many files; a one-line change that needs a design decision is not a chore.
- Between `rascal-plan` and `rascal-feature`: the user wants code at the end → feature (it runs plan first); only decisions → plan.
- A small UI tweak (copy, spacing, one colour) is a chore, not `rascal-ui`.

## 2. Say it in one line

Before doing anything else, write exactly one line:

`Route: <just do it | rascal-<workflow> | rascal-<skill> | a → b → c> — <the reason, in a few words>`

If `~/.rascal/state.json` has no `lastRetro`, or it is 14 or more days old, append ` · retro due: /rascal:rascal-retro` (elsewhere `use rascal-retro`) to that line. Never run the retro yourself.

## 3. Run it

- **Just do it:** do the task now, with no skill.
- **A workflow or skill:** call the Skill tool with its name (in Claude Code: `rascal:<name>`, e.g. `rascal:rascal-feature`), passing the task, and follow it to its end. Agents without a Skill tool open that skill's SKILL.md from the rascal skills folder and follow it.
- **A chain:** run each skill in order, carrying the previous one's result into the next.

If the chosen skill can't be found, say which one and that rascal is incompletely installed (Claude Code: `claude plugin install rascal@intelligentrascal`; other agents: re-run `scripts/install-rascal.sh` from the intelligentrascal repo), then stop. Never substitute another pack's skill.
