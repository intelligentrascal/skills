---
name: rascal-orchestrate
description: "Experimental. Build a large piece of work from a task plan with parallel workers: one worker per independent task, each in its own worktree, every task reviewed before it merges. Use when the user wants a big multi-task build run in parallel, or says orchestrate."
---

# Orchestrate (experimental)

This session is the **coordinator**. It writes no product code. It plans, dispatches, reviews, integrates and merges. Below, `<slug>` names this run and `<plan>` is the task plan's path; a ticket is one task of the plan, numbered `<N>` as in the plan.

## 1. Get the plan

If the user names a plan in `docs/plans/`, use it. Otherwise:
- **Foggy goal** (too big for one session, or the route isn't visible yet): call the Skill tool with "rascal-plan" (in Claude Code: `rascal:rascal-plan`). It charts and resolves the decisions across sessions, so this session ends with its handoff, whose **Next** continues rascal-plan on the map. Once the map has no open tickets, rascal-plan's **Next** names the build; for this run that is `/rascal:rascal-orchestrate <map>` (elsewhere `use rascal-orchestrate on <map>`).
- **Decisions settled** (with a map, read its Decisions so far first): create the integration worktree (below) first, then call the Skill tool with "rascal-planning" (in Claude Code: `rascal:rascal-planning`) and run its spec step and its **Plan** section, not **Execute**.

The integration worktree, also for a plan the user named, branched from rascal-plan's `plan/<slug>` branch when there is one (it holds the map's decisions and the CONTEXT.md and ADR updates), otherwise from the default branch: `git worktree add ../<repo>-orchestrate-<slug> -b orchestrate/<slug>` (reuse it if it exists). Work from there for the rest of the run, and run every script from it. Commit the spec and the plan there unless they're already committed.

Then ask once for a go, with a one-line recommendation (how many tasks, how many can run in parallel). That go approves the whole run through the merge. Then set up the plan's workspace, ledger and pre-flight scan as review-loop.md's **Setup** describes; the integration worktree is the isolated workspace it asks for.

## 2. Pick the batch
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 2. Pick the batch -->

A task is dispatchable when every task it must follow has merged **and** it is independent of every task already running: no shared files, no shared state, no ordering between them. Judge that from each task's **Files** section in the plan. Two tasks that both edit the same shell are not independent. Run at most **2** workers at once unless the user sets another cap. When nothing independent is left, wait for a running worker to finish.

## 3. Dispatch

For each task `<N>`:
1. In the integration worktree, record `BASE=$(git rev-parse HEAD)`.
2. Create its worktree: `git worktree add ../<repo>-<slug>-t<N> -b ticket/<slug>-t<N> $BASE`.
3. With the integration worktree as the working directory, run `bash <this skill's folder>/scripts/task-brief <plan> <N>` for the task's text.
4. Write the worker's brief from [worker-brief.md](worker-brief.md) to `<workspace>/task-<N>-dispatch.md` (`<workspace>` is the directory `sdd-workspace` printed at Setup), then dispatch one worker with that path. Choose its model per review-loop.md's **Model Selection**.
5. Record the worker's agent id in the ledger: fix rounds resume it.

Never let a worker dispatch agents of its own. A prototype task (one whose goal is a UI prototype) carries the three-variants rule word for word in its brief, and its worker loads "rascal-prototype" (in Claude Code: `rascal:rascal-prototype`) plus whichever design skills are installed.

<!-- rule:three-variants -->
## Three variants

A UI prototype shows three radically different variants, with an on-page picker, unless the user asks for one. Variants differ in layout, hierarchy and primary affordance, not just colour. A coordinator passes this rule, word for word, into every prototype worker's brief.
<!-- /rule:three-variants -->

## 4. Review each ticket
<!-- graft: superpowers skills/subagent-driven-development/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 4. Review each ticket -->

- **Build tasks:** follow [review-loop.md](review-loop.md), **The Task Loop** steps 2 to 5, with HEAD = `ticket/<slug>-t<N>`, BASE = the commit recorded at dispatch, and PLAN_FILE = `<plan>`, run from the integration worktree. A task reviewer gives two verdicts, spec compliance and quality, and failures go back to the worker through the fix loop until both pass.
- **Prototype tasks:** call the Skill tool with "rascal-review" (in Claude Code: `rascal:rascal-review`) once, with no fix loop. The user's pick among the variants is the real review: bring the picker URL up to this session as a question.

## 5. Integrate
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 5. Integrate -->

When a task passes:
1. Ask the task's latest implementer to rebase `ticket/<slug>-t<N>` onto `orchestrate/<slug>` and resolve any conflicts. The worker does this, not you. Conflict resolutions get the test run below here and the whole-branch review in step 6.
2. Run the full test suite in the ticket worktree.
3. From the integration worktree, `git merge --no-ff ticket/<slug>-t<N>`.
4. Append `Task <N>: merged` to the ledger and remove its worktree (`git worktree remove ../<repo>-<slug>-t<N>`).

Newly unblocked tasks join the next batch (step 2). On resume, integrate any task the ledger shows `complete` but not yet `merged` before dispatching more.

## 6. Finish

When every task has merged, call the Skill tool with "rascal-review" (in Claude Code: `rascal:rascal-review`) on the whole integration branch (if review-loop.md's **Final Review** already ran on it, reuse that review) and pass its **Before claiming done** gate. Every ledger `Ruling:` line and deferred minor goes in the handoff's **Decisions**. Then update the README and docs, push `orchestrate/<slug>`, open one PR into the default branch with `gh pr create`, merge it when checks pass, and remove the integration worktree.

<!-- rule:questions -->
## Questions

Number every question (Q1, Q2, …) and give a recommended answer for each. Accept compact replies: "Q3 agree", "Q1–Q4 agree", "Q2 B", "all recommendations". A question a sub-agent raises comes up to this session; never leave one inside a worker.
<!-- /rule:questions -->

<!-- rule:autonomy -->
## Autonomy

Once the user approves the plan, run to the end without check-ins. You own review, commits, the PR, merging, README and docs updates, and the handoff. Stop only for a real blocker or an action only the user can take. When the user says merge, merge. One exception: review gates the user wrote into a spec are stops; honor every one.
<!-- /rule:autonomy -->

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
