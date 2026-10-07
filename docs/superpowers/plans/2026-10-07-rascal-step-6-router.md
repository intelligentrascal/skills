# rascal step 6: router and routing note — Implementation Plan

> **For agentic workers:** execute task by task with rascal-planning (Execute); each behaviour goes test-first with rascal-tdd; finish with rascal-review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent on the machine routes each task the same way: a short, generated routing note in its global instruction file says when to just do the task, which workflow fits which trigger, and which canonical skill owns each method; `/rascal:go <task>` routes explicitly.

**Architecture:**
- **Generator.** `scripts/routing-note.mjs` reads `plugins/rascal/workflows.json` (the workflow list and the canonical table), each listed skill's `description:` (its "Use when…" sentence becomes the one-line trigger) and `plugins/rascal/rules/routing.md`, and writes `plugins/rascal/routing-note.md`. It also fills the same routes into `rascal-go/SKILL.md` between `<!-- routing-note -->` markers, so the router and the note can't disagree. `--check` runs from pre-commit.
- **Installer.** `routing-note.mjs install <file>` / `remove <file>` writes or removes the note between `<!-- rascal:routing-note:begin -->` / `<!-- rascal:routing-note:end -->` markers, backing the file up to `<file>.rascal-bak` before any change. `scripts/install-rascal.sh` calls it once per agent whose config directory exists.
- **Router.** `plugins/rascal/skills/rascal-go/` (model-invocable, self-contained) plus `plugins/rascal/commands/go.md`, so Claude Code exposes it as `/rascal:go <task>`.

**Tech Stack:** Node 22+ (ESM, `node:test`), bash.

**Spec:** `docs/rj-skills-pack-design.md` Q10, Q11, Q20, Q23, Q25, Q35 step 6, Q36; `docs/rascal-v1-design.md` Q12, Q14 and its new section "Step 6: router and routing note" (the rulings below).

**Test command:**

```bash
node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs plugins/rascal/test/*.test.mjs
```

---

## Decisions made while planning (not in the design docs)

1. **`install-rascal.sh` owns the note, not `install-agents.sh`.** Q20 names `install-agents.sh`, but that script is intelligentrascal's (it links the -ui skills and Pocock's). Step 5 made `install-rascal.sh` rascal's installer; mixing the two would make installing grill-ui edit global instruction files. *Cost if wrong:* a rename later; behaviour is the same.
2. **Per-agent files**, verified on this machine (2026-10-07): Claude Code `~/.claude/CLAUDE.md`; Codex `$CODEX_HOME/AGENTS.md` (default `~/.codex`); OpenCode `$XDG_CONFIG_HOME/opencode/AGENTS.md` (default `~/.config/opencode`). OpenCode reads `~/.claude/CLAUDE.md` only while it has no AGENTS.md, so when that CLAUDE.md holds the user's own rules and OpenCode has no AGENTS.md, OpenCode is skipped and gets the note through the fallback (changed after review: creating the file would have dropped those rules from OpenCode); Pi `$PI_CODING_AGENT_DIR/AGENTS.md` (default `~/.pi/agent`, per Pi's `docs/configuration.md`). The note is written only for agents whose config directory exists; the others are skipped by name. *Cost if wrong:* a missed agent shows up in the Q36 probe.
3. **One backup per file, `<file>.rascal-bak`,** taken only when the file exists and its content would change. Re-running with an unchanged note writes nothing. Content outside the markers is never touched; a begin marker without an end marker (or the reverse) is refused, exit 1, nothing written. *Cost if wrong:* the backup reflects the state just before the latest change, not the first install; content outside the markers is identical in both, so nothing is lost.
4. **`/rascal:go` is a plugin command** (`plugins/rascal/commands/go.md`) that loads the `rascal-go` skill with the task. Skill folders must stay `rascal-*` (a bare `go` skill in `~/.agents/skills` would collide), and Claude Code names plugin skills `/rascal:<folder>`. Other agents use `rascal-go` directly. *Cost if wrong:* Claude Code drops plugin commands; the skill still answers `/rascal:rascal-go`.
5. **The workflow list lives in `plugins/rascal/workflows.json`**, with the canonical table. Triggers come from each skill's description (its "Use when/for" sentence), so editing a description updates the note on the next generate. *Cost if wrong:* none beyond moving the list.
6. **The note names skills by their bare names and says how Claude Code spells them** (`rascal:<name>`), since one text serves four agents.
7. **The 1% override is unconditional.** It is harmless where Superpowers isn't installed. Wording: a skill runs only when a route below calls for one, overriding any rule that says to use a skill on even a small chance it applies.
8. **Retro nudge, date half only.** The router reads `~/.rascal/state.json` `lastRetro`; when it is missing or 14+ days old it ends its route line with one nudge. The 15-sessions half needs the miner, which lives in `rascal-retro`'s folder; self-contained skills don't reach into another skill's folder. *Cost if wrong:* a busy fortnight nudges late.
9. **Chains the router may pick** are written into `rascal-go`: bug → `rascal-debugging` then `rascal-tdd` (regression test) then `rascal-review`; a design question with no build → `rascal-grilling`. Anything else with design in it goes to a workflow.

## File structure

```
.githooks/pre-commit                                 MODIFY  + routing-note --check
README.md                                            MODIFY  routing section
docs/rascal-v1-design.md                             MODIFY  step-6 rulings section
docs/rj-skills-pack-design.md                         MODIFY  Q35 build-order status
plugins/rascal/.claude-plugin/plugin.json            MODIFY  0.3.0
plugins/rascal/workflows.json                        CREATE
plugins/rascal/routing-note.md                       CREATE  (generated)
plugins/rascal/commands/go.md                        CREATE
plugins/rascal/skills/rascal-go/SKILL.md             CREATE
plugins/rascal/skills/rascal-go/agents/openai.yaml   CREATE
plugins/rascal/test/router.test.mjs                  CREATE
scripts/routing-note.mjs                             CREATE
scripts/install-rascal.sh                            MODIFY  note per agent, --no-note, --remove-note
scripts/test/routing-note.test.mjs                   CREATE
scripts/test/install-rascal.test.mjs                 MODIFY
docs/superpowers/verification/2026-10-07-routing-probe.md  CREATE  Q36 record
```

## Tasks

- [x] **Task 1: generator.** `workflows.json`; `routing-note.mjs` builds the note (≤30 lines, all five workflows with their triggers, canonical table, routing.md rules, preferences line, 1% override, `/rascal:go`), writes `routing-note.md` and the `rascal-go` block, `--check` exits 1 on drift. Tests: line count, contents, trigger extraction, check mode.
- [x] **Task 2: install / remove a note in a file.** Markers, backup, idempotence, outside content untouched, unbalanced markers refused. Tests with temp files.
- [x] **Task 3: router skill and command.** `rascal-go` (named-skill first, route, one-line announcement, run, nudge), `commands/go.md`, `openai.yaml`; plugin tests.
- [x] **Task 4: install-rascal.sh per agent.** Fake-HOME tests: present agents get the note, absent ones are skipped, env overrides honoured, `--no-note`, `--remove-note`.
- [x] **Task 5: pre-commit, docs, version.** Hook line; README; design docs; 0.3.0; `claude plugin validate --strict`.
- [x] **Task 6: review, real install, Q36 probe.** Fresh-context review; run the installer for real; one probe per agent; record results.
