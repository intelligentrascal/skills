---
name: rascal-grill-me-ui
description: Grill me with ui, rascal edition. Runs rascal's grilling interview on a local browser page instead of the terminal and writes a design doc at the end. Use when the user invokes /rascal-grill-me-ui (also "/rascal-grill-me-ui resume").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

1. **Preflight.** Call the Skill tool with `rascal-grilling` (in Claude Code: `rascal:rascal-grilling`). If it cannot be loaded, stop and tell the user rascal is incompletely installed: Claude Code: `claude plugin install rascal@intelligentrascal`; other agents: re-run `scripts/install-rascal.sh` from the intelligentrascal repo. Never grill from memory.
2. Call the Skill tool with `rascal-grilling-ui` (in Claude Code: `rascal:rascal-grilling-ui`). It loads last; its Overrides table wins. Same failure message as step 1.
3. Follow rascal-grilling-ui **Start** with the user's topic, doc path `docs/<slug>-design.md` (the user may change it), and finish profile **design-doc**. For "resume", follow rascal-grilling-ui **Resume**.
