# Worker brief
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> # Worker brief -->

Fill in every field. A worker sees only this brief, the files it names, and its worktree.

```
You are a worker on Task <N>: <title>, of the plan <plan path>.
Worktree: <absolute path of ../<repo>-<slug>-t<N>>, branch ticket/<slug>-t<N>. Work only there.

## The task
Read <absolute path of the task brief from scripts/task-brief> first: it is your requirements, with the exact values to use verbatim.

## Scope
In scope: <files and modules you expect it to touch>
Do not touch: <files other running workers own; shared config>

## Constraints
<binding requirements from the spec or the plan's Global Constraints, verbatim: exact values, formats, "same layout as X">
<prototype tasks: the three-variants rule, verbatim>

## How
Load rascal-tdd for a build task, or rascal-prototype and the installed design skills for a prototype task.
Commit in small steps on your branch. Do not merge, push, or dispatch agents of your own.
When the coordinator asks, rebase your branch onto orchestrate/<slug> and resolve the conflicts.

## Questions
If you hit a decision the task doesn't settle, don't guess and don't stall. Put the question, numbered and with
your recommended answer, at the top of your report, and continue on the recommendation where it is safe to.

## Report
Write <integration worktree>/.rascal/sdd/<plan-basename>/task-<N>-report.md (an absolute path): what you built, files changed, the test command and its output,
open questions (numbered, with recommendations), and anything you couldn't do.
Return only: status (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED), commits, a one-line test summary.
```
