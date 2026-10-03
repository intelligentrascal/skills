---
name: rascal-orchestrate
description: "Experimental. Build a large piece of work with parallel agents: chart it into tickets, then coordinate one worker per independent ticket, each in its own worktree, reviewing every ticket before merging it. Use when the user wants a big multi-ticket build run in parallel, or says orchestrate."
---

# Orchestrate (experimental)

This session is the **coordinator**. It writes no product code. It charts, dispatches, reviews, integrates and merges.

## 1. Chart

Call the Skill tool with "rascal-wayfinder" (in Claude Code: `rascal:rascal-wayfinder`). Chart the goal into tickets, or work from the map the user names. Decision tickets go through a grill first (call "rascal-plan", in Claude Code: `rascal:rascal-plan`); build and prototype tickets are dispatchable. Snapshot the map to `.rascal/maps/<map>.md` (with `.rascal/.gitignore` containing `*`) and refresh it after each merge.

## 2. Pick the batch
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 2. Pick the batch -->

A ticket is dispatchable when it is unblocked on the map **and** independent of every ticket already running: no shared files, no shared state, no ordering between them. Read each candidate's likely files before deciding. Two unblocked UI tickets that both edit the same shell are not independent. Run at most **2** workers at once unless the user sets another cap. When nothing independent is left, wait for a running worker to finish.

## 3. Dispatch

For each ticket:
1. Claim it on the tracker (rascal-wayfinder's claim).
2. Create its worktree: `git worktree add ../<repo>-<ticket> -b ticket/<ticket>`.
3. Write its brief from [worker-brief.md](worker-brief.md) to `.rascal/sdd/<map>/ticket-<ticket>-brief.md`, then dispatch one worker with that path. Choose its model per review-loop.md's **Model Selection**.

Never let a worker dispatch agents of its own. For prototype tickets, the brief carries the three-variants rule word for word, and the worker loads "rascal-prototype" (in Claude Code: `rascal:rascal-prototype`) plus whichever design skills are installed.

<!-- rule:three-variants -->
## Three variants

A UI prototype shows three radically different variants, with an on-page picker, unless the user asks for one. Variants differ in layout, hierarchy and primary affordance, not just colour. A coordinator passes this rule, word for word, into every prototype worker's brief.
<!-- /rule:three-variants -->

## 4. Review each ticket
<!-- graft: superpowers skills/subagent-driven-development/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 4. Review each ticket -->

- **Build tickets:** follow [review-loop.md](review-loop.md), **The Task Loop** steps 2 to 5. A task reviewer gives two verdicts, spec compliance and quality, and failures go back to the implementer through the fix loop until both pass. Fast models implement; the reviewer gets a stronger one.
- **Prototype tickets:** call the Skill tool with "rascal-review" (in Claude Code: `rascal:rascal-review`) once, with no fix loop. The user's pick among the variants is the real review: bring the picker URL up to this session as a question.

## 5. Integrate
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## 5. Integrate -->

When a ticket passes:
1. Rebase its branch on the current base and run the full test suite.
2. Check for conflicts with what merged since dispatch, then merge.
3. Update and close the ticket on the tracker, recording what was decided.
4. Remove its worktree.

Then re-read the map: newly unblocked tickets join the next batch (step 2).

## 6. Finish

When the map's tickets are closed, review the whole branch with rascal-review and pass its **Before claiming done** gate. Then update the README and docs, push, open the PR and merge, and close the map.

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
**Needs you:** <only what the user must do themselves (credentials, settings you can't reach); "nothing" otherwise>
**Next:** <one recommended next step, its reason, and the exact command to start it>

When another rascal workflow called this one, skip the block and return to it.
<!-- /rule:handoff -->
