---
name: rascal-grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---
<!-- provenance: pocock skills/productivity/grilling/SKILL.md @ 3cca18b368ae95cdbdebbff572ccafa662551015 -->

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

<!-- rule:questions -->
## Questions

Number every question (Q1, Q2, …) and give a recommended answer for each. Accept compact replies: "Q3 agree", "Q1–Q4 agree", "Q2 B", "all recommendations". A question a sub-agent raises comes up to this session; never leave one inside a worker.
<!-- /rule:questions -->

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

## Wide design space
<!-- graft: superpowers skills/brainstorming/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## Wide design space -->

Before round 1, if the topic could reasonably go two or more very different ways (what to build, not just how to build it), propose 2–3 approaches in one short message. Give each its shape, what it's good at, what it costs, and your recommendation. The user's pick becomes the root of the design tree. Skip this when the topic is already one framed decision.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Before the doc
<!-- graft: superpowers skills/brainstorming/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## Before the doc -->

When a design doc or spec is written from this grill, re-read it before handing it over and fix what you find inline: no placeholders ("TBD", "TODO", "decide later"), no two sections that contradict each other, no requirement that reads two ways, and nothing the grill settled missing from it.

## Hand-off
<!-- graft: superpowers skills/brainstorming/SKILL.md @ 8ca22dba9a94f28898bbce59f2537ff4d87c747d -> ## Hand-off -->

End with one recommended next step. When there's something to build, that's `rascal-planning`, with the doc's path. Otherwise name what the decision unblocks. When a rascal workflow called this grill, return to it instead.

<!-- rule:recommend -->
## Recommend

When a phase ends or a choice comes up, give one recommended action and its reason, ready to approve. List alternatives only when asked.
<!-- /rule:recommend -->
