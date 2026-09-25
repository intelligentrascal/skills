---
name: grill-me-ui
description: Grill me with ui. Runs Matt Pocock's grilling interview on a local browser page instead of the terminal and writes a design doc at the end. Use when the user says "grill me with ui", "grill with ui", "ui grill", or invokes /grill-me-ui (also "/grill-me-ui resume").
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

1. **Preflight.** Call the Skill tool with `grilling` (in Claude Code: `mattpocock-skills:grilling`). If it cannot be loaded, stop and tell the user to install Pocock's skills — Claude Code: `claude plugin install mattpocock-skills@mattpocock`; other agents: `npx skills add -g mattpocock/skills`. Never grill from memory.
2. Call the Skill tool with `grilling-ui` (in Claude Code: `intelligentrascal:grilling-ui`). It loads last; its Overrides table wins. If it cannot be loaded, stop and tell the user this plugin is incompletely installed: Claude Code: `claude plugin install intelligentrascal@intelligentrascal`; other agents: re-run `scripts/install-agents.sh` from the intelligentrascal repo. Pocock's skills are not the cause.
3. Follow grilling-ui **Start** with the user's topic, doc path `docs/<slug>-design.md` (the user may change it), and finish profile **design-doc**. For "resume", follow grilling-ui **Resume**.
