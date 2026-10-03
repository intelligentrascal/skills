# Worker brief
<!-- graft: superpowers skills/dispatching-parallel-agents/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> # Worker brief -->

Fill in every field. A worker sees only this brief and its worktree.

```
You are a worker on ticket <ticket>: <title>.
Worktree: <absolute path>, branch ticket/<ticket>. Work only there.

## The ticket
<the ticket body, verbatim>

## Scope
In scope: <files and modules you expect it to touch>
Do not touch: <files other running workers own; shared config>

## Constraints
<binding requirements from the spec or map, verbatim: exact values, formats, "same layout as X">
<prototype tickets: the three-variants rule, verbatim>

## How
Load rascal-tdd for a build ticket, or rascal-prototype and the installed design skills for a prototype ticket.
Commit in small steps on your branch. Do not merge, push, or dispatch agents of your own.

## Questions
If you hit a decision the ticket doesn't settle, don't guess and don't stall. Put the question, numbered and with
your recommended answer, at the top of your report, and continue on the recommendation where it is safe to.

## Report
Write <worktree>/.rascal/report-<ticket>.md: what you built, files changed, the test command and its output,
open questions (numbered, with recommendations), and anything you couldn't do.
Return only: status (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED), commits, a one-line test summary.
```
