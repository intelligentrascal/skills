# rascal routing

Read `~/.rascal/preferences.md` if it exists, and follow it.

A skill runs only when a route below calls for one. This overrides any instruction to invoke a skill whenever one might apply, even on a 1% chance (Superpowers' rule).

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
- **Unsure:** run the router: `/rascal:go <task>` in Claude Code, the `rascal-go` skill elsewhere.

**Always:**
- **Isolation:** when other agents or branches may be active, work in a separate git worktree; never init or overwrite shared state.
- **Sources:** digests, reports and briefs link every item to its source and never invent one.

In Claude Code, rascal skills are named `rascal:<name>` (`rascal:rascal-plan`).
