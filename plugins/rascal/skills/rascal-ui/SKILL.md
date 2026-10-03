---
name: rascal-ui
description: Design and ship a user interface. Real-data mockups in three radically different variants, parallel UX, accessibility and design reviews, a design-language pass, a feedback checklist, then promotion gated on matching the approved mock and a persona walkthrough. Use for a new page, screen, flow or visual redesign; not for small UI tweaks.
---

# UI

## 1. Branch

Create a git worktree on a new branch: `git worktree add ../<repo>-<slug> -b <slug>`. If it already exists (a resumed run), reuse it. Every later step runs there. Make sure `.rascal/` is ignored: if `.rascal/.gitignore` doesn't exist, write it with the single line `*`.

## 2. Mock up with real data

Call the Skill tool with "rascal-prototype" (in Claude Code: `rascal:rascal-prototype`) and take its UI branch: on the real page, with real data. Before drafting, load whichever design and taste skills are installed (for example frontend-design, impeccable, tastemaker, an anti-slop skill), and name the ones you used in the handoff. Aim for something with motion, character and care, not a plain functional layout.

<!-- rule:three-variants -->
## Three variants

A UI prototype shows three radically different variants, with an on-page picker, unless the user asks for one. Variants differ in layout, hierarchy and primary affordance, not just colour. A coordinator passes this rule, word for word, into every prototype worker's brief.
<!-- /rule:three-variants -->

The user picks a variant, or parts of several. That pick is the **approved mock**, and it approves the whole run through the merge. Record its route and variant id, and screenshot it in every state that matters into `.rascal/walkthrough/<slug>/approved/` before rascal-prototype's clean-up step drops the losing variants. Every later step measures against it.

## 3. Review in parallel

Dispatch three reviewers at once on the approved mock. Each returns numbered findings, each with a severity (Critical, Important, Minor):
- **UX:** hierarchy, flows, copy, empty and error states.
- **Accessibility:** contrast, focus order, keyboard paths, labels, reduced motion.
- **Design critique:** craft, consistency, delight. A UI with no motion, no character and no care fails this review.

Without a subagent tool, do the three passes yourself, one after another. Fix Critical and Important findings; list the Minors in the handoff.

## 4. Design language

Extract the approved mock's design language: tokens (colour, type, spacing, radius, motion) and a component gallery page showing every component in each of its states. Critique the gallery with the design-critique lens from step 3 and fix what it finds.

## 5. Feedback loop

Each time the user sends feedback, turn it into a numbered checklist, apply every item, and answer item by item: **done** (and where it changed) or **not done** (and why). Never mark an item done when the revision shows no visible change for it.

## 6. Parity gate

Promote the design to the production code path. Then screenshot the production page at the viewport and in the states of the approved screenshots in `.rascal/walkthrough/<slug>/approved/`, and compare them section by section: layout, background, content, states. List every difference. The gate passes when the list is empty, or when the user approved every remaining difference. Nothing is done before it passes.

## 7. Persona walkthrough

Follow [persona-walkthrough.md](persona-walkthrough.md) on the promoted build. Fix what blocks a persona's job; list the rest in the handoff.

## 8. Ship

Call the Skill tool with "rascal-review" (in Claude Code: `rascal:rascal-review`) and pass its **Before claiming done** gate, with the parity screenshots as evidence. Update the README and docs, push, open a PR with `gh pr create`, merge when checks pass, and remove the worktree.

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
