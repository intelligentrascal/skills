---
name: grill-docs-ui
description: Grill with docs, with ui. Runs Matt Pocock's grilling and domain-modeling on a local browser page instead of the terminal, keeping CONTEXT.md and ADRs current, and writes a design doc at the end. Use when the user says "grill with docs ui", "grill-docs-ui", "grill with docs in the browser", or invokes /grill-docs-ui (also "/grill-docs-ui resume").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

1. **Preflight.** Load Pocock's two skills, one call each:
   - Call the Skill tool with `grilling` (in Claude Code: `mattpocock-skills:grilling`).
   - Call the Skill tool with `domain-modeling` (in Claude Code: `mattpocock-skills:domain-modeling`).

   If either cannot be loaded, stop and tell the user to install Pocock's skills — Claude Code: `claude plugin install mattpocock-skills@mattpocock`; other agents: `npx skills add -g mattpocock/skills`. Never grill from memory.
2. Call the Skill tool with `grilling-ui` (in Claude Code: `intelligentrascal:grilling-ui`). It loads last; its Overrides table wins.
3. Follow grilling-ui **Start** with the user's topic, doc path `docs/<slug>-design.md` (the user may change it), and finish profile **docs**. For "resume", follow grilling-ui **Resume**.

`CONTEXT.md` and `docs/adr/` are the source of truth, updated during the grill as `domain-modeling` says. After every `CONTEXT.md` edit, patch the page `terms` with the terms touched in this grill only.
