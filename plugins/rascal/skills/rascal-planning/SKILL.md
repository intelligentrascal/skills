---
name: rascal-planning
description: Plan work after the design is agreed: write the spec from the conversation, then a bite-sized task plan, then execute it task by task. Use when a grill or design discussion is done and the work needs a spec, a plan, or executing.
---
<!-- provenance: pocock skills/engineering/to-spec/SKILL.md @ 3cca18b368ae95cdbdebbff572ccafa662551015 -->

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

Write the spec to `docs/specs/<YYYY-MM-DD>-<slug>.md`. Publish it to the issue tracker as well only when the user asks; the tracker docs are in rascal-wayfinder's `trackers/` folder.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below, save it to that path, and commit it on the current branch (a calling workflow has already branched).

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>

## Plan
<!-- graft: superpowers skills/writing-plans/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## Plan -->

Once the spec is saved, a fresh agent writes the task plan from the spec alone. Dispatch a subagent with the spec path and [plan-format.md](plan-format.md); without a subagent tool, re-read only the spec and write it yourself. The plan goes to `docs/plans/<YYYY-MM-DD>-<slug>.md`; commit it on the current branch once it's written. Then go straight to **Execute** below without asking, unless a calling workflow says otherwise.

## Execute
<!-- graft: superpowers skills/executing-plans/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## Execute -->

Execute the plan with [executing.md](executing.md), in a git worktree on its own branch (rascal-feature's, or a new one), without check-ins between tasks. Its scripts are in this skill's `scripts/` folder. For a plan with many independent tasks, the user may run `rascal-orchestrate` instead.
