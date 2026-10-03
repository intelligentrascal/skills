---
name: rascal-plan
description: Plan a piece of work before building it. Chart it if it's too big for one session, grill it to a shared understanding, and keep the domain language current. Use when the user wants to plan, scope or think through work, or names an issue to plan.
---

# Plan

A workflow: wayfinder → grill → domain model. It ends in decisions written down, not code. `rascal-feature` runs it first; it also runs alone.

## 1. Chart, only if there's fog

If the work is bigger than one agent session can hold, or the route to it isn't visible yet, call the Skill tool with "rascal-wayfinder" (in Claude Code: `rascal:rascal-wayfinder`) and chart the map. If the user named an issue, start from it. Skip this step when the work is one clear decision.

Charting is one session's work: after it, stop and end with the handoff (even when another workflow called this one), its **Next** `/rascal:rascal-plan <map>` (elsewhere `use rascal-plan on <map>`). Invoked with a map, resolve exactly one ticket (rascal-wayfinder's **Work through the map**; a grilling ticket goes through step 2), record it as step 3 says, then end with the handoff; **Next** is the same command while the map has open tickets, and the build once it has none: `/rascal:rascal-feature <map>`, or `/rascal:rascal-orchestrate <map>` for a large parallel build (elsewhere `use rascal-feature on <map>`).

With a map, work on a `plan/<slug>` branch (create it from the default branch the first time): its decisions, CONTEXT.md and ADR updates and any local map files live there between sessions. When other agents may be active in this checkout, give that branch its own worktree (`git worktree add ../<repo>-plan-<slug> plan/<slug>`).

## 2. Grill with docs

Call the Skill tool twice, for "rascal-grilling" and "rascal-domain-modeling" (in Claude Code: `rascal:rascal-grilling`, `rascal:rascal-domain-modeling`). Grill the work, or the current ticket, to a shared understanding. Keep CONTEXT.md and the ADRs current as terms and hard-to-reverse decisions settle. When the user wants the browser page instead of the terminal, call "rascal-grill-docs-ui" (in Claude Code: `rascal:rascal-grill-docs-ui`) instead.

## 3. Write it down

When the user confirms the shared understanding:
- with a map: resolve the ticket as rascal-wayfinder describes (record the decision, close the ticket, update the map), then commit CONTEXT.md, the ADRs and any local map files on `plan/<slug>`;
- without one: write the design doc to `docs/<slug>-design.md`, then commit it: on a new `plan/<slug>` branch when the checkout is on the default branch, otherwise on the current branch.

<!-- rule:questions -->
## Questions

Number every question (Q1, Q2, …) and give a recommended answer for each. Accept compact replies: "Q3 agree", "Q1–Q4 agree", "Q2 B", "all recommendations". A question a sub-agent raises comes up to this session; never leave one inside a worker.
<!-- /rule:questions -->

<!-- rule:recommend -->
## Recommend

When a phase ends or a choice comes up, give one recommended action and its reason, ready to approve. List alternatives only when asked.
<!-- /rule:recommend -->

<!-- rule:handoff -->
## Handoff

End with this block, filled in, and nothing after it:

**Done:** <one line: what now exists>
**Git:** <branch> · committed <yes/no> · pushed <yes/no> · PR <url or none> · merged <yes/no>
**Where:** <full, untruncated path or URL of every artifact>
**Try it:** <exact command to launch or test it, with the seed data the user needs>
**Docs:** <README and docs updated (which files), or "none needed" and why>
**Decisions:** <every ruling you made on the user's behalf and every deferred minor finding, or "none">
**Needs you:** <only what the user must do themselves (credentials, settings you can't reach); "nothing" otherwise>
**Next:** <one recommended next step, its reason, and the exact command to start it>

When another rascal workflow called this one, skip the block and return to it.
<!-- /rule:handoff -->
