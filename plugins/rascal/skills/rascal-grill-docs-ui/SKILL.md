---
name: rascal-grill-docs-ui
description: Grill with docs, with ui, rascal edition. Runs rascal's grilling and domain-modeling on a local browser page, keeping CONTEXT.md and ADRs current, and writes a design doc at the end. Use when the user invokes /rascal-grill-docs-ui (also "/rascal-grill-docs-ui resume").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

1. **Preflight.** Load rascal's two skills, one call each:
   - Call the Skill tool with `rascal-grilling` (in Claude Code: `rascal:rascal-grilling`).
   - Call the Skill tool with `rascal-domain-modeling` (in Claude Code: `rascal:rascal-domain-modeling`).

   If either cannot be loaded, stop and tell the user rascal is incompletely installed: Claude Code: `claude plugin install rascal@intelligentrascal`; other agents: re-run `scripts/install-rascal.sh` from the intelligentrascal repo. Never grill from memory.
2. Call the Skill tool with `rascal-grilling-ui` (in Claude Code: `rascal:rascal-grilling-ui`). It loads last; its Overrides table wins. Same failure message as step 1.
3. Follow rascal-grilling-ui **Start** with the user's topic, doc path `docs/<slug>-design.md` (the user may change it), and finish profile **docs**. For "resume", follow rascal-grilling-ui **Resume**.

`CONTEXT.md` and `docs/adr/` are the source of truth, updated during the grill as `rascal-domain-modeling` says. After every `CONTEXT.md` edit, patch the page `terms` with the terms touched in this grill only.
