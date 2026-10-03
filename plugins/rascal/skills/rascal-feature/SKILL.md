---
name: rascal-feature
description: Build a feature end to end. Plan it, spec it, write a task plan, execute it, then push, open a PR and merge. Use when the user wants something built, added or changed that needs design decisions. Chores with no design decision in them don't need this.
---

# Feature

A workflow: branch → plan → spec → task plan → execute → ship. Invoked as `execute <plan path>`, work in the worktree that holds that plan (step 1) and start at step 4. Invoked with a map whose tickets are all resolved, branch from its `plan/<slug>` branch (step 1), read the map's decisions, and start at step 3.

## 1. Branch

Create a git worktree on a new branch: `git worktree add ../<repo>-<slug> -b <slug>`, branched from `plan/<slug>` when rascal-plan made one. If it already exists (a resumed run), reuse it. Every later step runs there.

## 2. Plan

Call the Skill tool with "rascal-plan" (in Claude Code: `rascal:rascal-plan`) and run it to a shared understanding. Skip it when the user arrives with a design doc or spec already agreed; read that instead. The user confirming the shared understanding (or approving the spec they brought) approves the whole run through the merge; tell them in one line: "From here I run to the merge."

## 3. Spec and task plan

Call the Skill tool with "rascal-planning" (in Claude Code: `rascal:rascal-planning`). Write the spec from the grill, then have a fresh agent write the task plan from the spec (rascal-planning's **Plan** section). Commit each on the branch once it's written.

## 4. Execute

Execute the task plan with rascal-planning's **Execute** section, in this worktree. If this session's context is already heavy (a long grill), stop here with the handoff instead. Make **Next** the command that resumes in a fresh session, with the plan's absolute path in the worktree: `/rascal:rascal-feature execute <plan path>` in Claude Code, `use rascal-feature to execute <plan path>` elsewhere.

## 5. Ship

Call the Skill tool with "rascal-review" (in Claude Code: `rascal:rascal-review`). Review the branch and pass its **Before claiming done** gate. If executing.md's final whole-branch review already ran, reuse its review package and verdict and run only the gate. Then:
1. Update the README and docs for what changed.
2. Push the branch and open a PR with `gh pr create`, its body linking the spec and the plan.
3. Merge when checks pass (the user approved the plan; see Autonomy). If you can't, leave the PR open and say why in the handoff.
4. Remove the worktree (`git worktree remove ../<repo>-<slug>`).

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
