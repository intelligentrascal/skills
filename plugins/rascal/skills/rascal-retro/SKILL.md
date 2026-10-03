---
name: rascal-retro
description: Mine the user's past agent sessions (Claude Code, Claude desktop, Codex, OpenCode, Cursor) for repeated workflows, corrections and preferences, then grill the user on what to change. "/rascal-retro --all" is the seed pass that chooses rascal's v1 workflows. Use when the user invokes /rascal-retro or the router's retro nudge fires.
disable-model-invocation: true
---

`$SKILL` = the folder containing this SKILL.md: `${CLAUDE_SKILL_DIR}` in Claude Code, otherwise the directory of the path you were shown for this file.

Mining output is private. Everything you write in this skill goes under `~/.rascal/mining/`, outside any repo, except the grill's design doc, which is public and must contain only generic findings.

## 1. Extract

Run `node "$SKILL/mine.mjs" extract` (add `--all` for the seed pass). It prints one JSON line per source. Exit 3 means a source looks broken: tell the user which one in one line and continue with the others. Never open raw transcripts yourself; the digest is the only input.

## 2. Scope

- Seed pass (`--all`): every record. Run `node "$SKILL/mine.mjs" stats` and `node "$SKILL/mine.mjs" list`.
- Incremental: `since="$(node "$SKILL/mine.mjs" last-retro)"`, then `node "$SKILL/mine.mjs" stats --since "$since"` and `node "$SKILL/mine.mjs" list --since "$since"`. If `list` prints nothing, say there is nothing new since `$since` and stop.

## 3. Analyze

Split the `list` paths into slices of about 25 records. For each slice, launch one subagent (in parallel where the agent supports it; otherwise run the slices yourself, one at a time). Give it the brief in `$SKILL/analyst-brief.md`, its slice of paths, and the `stats` JSON. Each returns findings as JSON.

Merge the findings: findings with the same `kind` and near-identical `summary` combine, with evidence lists unioned. Treat `plugin:name` and `name` as the same skill (agents record namespaced and bare names). Rank by evidence count. Drop findings backed by a single session unless they are `correction` or `preference` with strong wording.

## 4. Write findings (local)

Write `~/.rascal/mining/findings-<YYYY-MM-DD>.md`:
- a header with the `stats` summary;
- **Generic findings**, by kind;
- **Personal findings**, each with its evidence ids.

This file is never committed.

## 5. Grill

Load `rascal-grill-me-ui` (in Claude Code: `rascal:rascal-grill-me-ui`) and follow it with:

- **Seed pass:** topic "rascal v1: workflows and canonical skills from the seed retro", doc path `docs/rascal-v1-design.md`. Round 1 is the whole frontier:
  1. Which candidate workflows become v1 workflows: one question per `workflow` finding, recommending yes or no by evidence count.
  2. For each concept (TDD, debugging, review, planning, grilling): which upstream skill rascal's canonical skill derives from (Pocock, Superpowers/obra, Superpowers extended-cc, pstack). Recommend from `skill` usage counts and `correction` findings.
  3. The "just do it" rule: a proposed one-sentence rule drawn from `no-skill-pattern` findings.
  4. Whether the wayfinder × playbook experiment is in v1 (design doc Q29).
  5. One question per `personal` finding: adopt it into `~/.rascal/preferences.md`? The question text quotes no client names, paths or private details; refer to the finding id in `findings-<date>.md`.
- **Incremental:** topic "rascal retro <date>: proposed changes". One question per generic proposal (a skill edit, a new workflow) and one per personal finding.

The design doc goes in the repo. Write it with generic findings only. Personal answers are applied by appending accepted entries to `~/.rascal/preferences.md` (one bullet each, with the date), never to the doc.

## 6. Close

After the grill's Finish, run `node "$SKILL/mine.mjs" mark-retro`. Print one line: the findings file, the design doc, and how many preferences were added.
