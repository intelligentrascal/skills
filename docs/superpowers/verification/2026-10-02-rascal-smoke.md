# rascal steps 1–3 smoke runs (plan Task 13)

Date: 2026-10-02. Run by Claude while executing `docs/superpowers/plans/2026-10-02-rascal-steps-1-3.md`
(Rahil delegated execution and sign-off). Versions: Claude Code `2.1.288`, `codex-cli 0.153.4`,
Node `26.8.1`. OpenCode and Pi were not run.

Every check ran without touching the user's real setup. Claude Code loaded rascal with
`--plugin-dir plugins/rascal` and installed nothing. For Codex, `scripts/install-rascal.sh` linked
the 8 rascal skills into `~/.agents/skills`, with `RASCAL_HOME` set to a temp dir. The links were
removed after the run, leaving `~/.agents/skills` as it was. The hub ran with a temp `GRILL_HOME`.

| Check | Result |
|---|---|
| `claude plugin validate --strict .` and `--strict plugins/rascal` | ✓ both pass |
| `install-rascal.sh` (real run): links + `RASCAL_HOME` scaffold + Claude Code install line | ✓ "linked 8 skills"; re-run and refusal paths covered by `scripts/test/install-rascal.test.mjs` |
| **Claude Code**: `/rascal:rascal-grill-me how should I name my new cat` (headless `-p`) | ✓ one Skill call, `rascal:rascal-grilling` (not Pocock's); printed a ❓/➡️ round |
| **Codex**: "Use the rascal-grill-me skill …" (`codex exec -s read-only`) | ✓ read `rascal-grill-me/SKILL.md` then `rascal-grilling/SKILL.md`, nothing else; printed a ❓/➡️ round. Needed `-m gpt-5.5`: the configured `gpt-6-sol` is rejected for this ChatGPT account (environment, not rascal) |
| **One hub for both plugins**: `ensure` from `skills/grilling-ui`, then from `rascal-grilling-ui` | ✓ same version `77fbd053c575`; rascal's call returned `reused: true` with no `stale` |
| `rascal-grilling-ui` `new` + `url`: page serves | ✓ HTTP 200 |
| `rascal-grill-me-ui` in an interactive session: page opens, one Send handled | **not run**: needs a live session with a browser. The transport is byte-identical to intelligentrascal's (`sync-transport --check`), which passed this check in the milestone 6 smoke. The seed retro (`/rascal:rascal-retro --all`) runs this skill end to end |
| `mine.mjs extract` on this machine | ✓ exit 0, all five sources, `failed: 0` (see below) |
| Digest privacy: no home path or email in any `digest/**` record | ✓ 0 hits (the username in prose needs the local deny-list, as designed) |

`mine.mjs extract` (temp `RASCAL_HOME`):

| Source | found | written | unchanged | empty | failed |
|---|---|---|---|---|---|
| claude-cli | 69 | 65 | 1 | 3 | 0 |
| claude-desktop | 40 | 40 | 0 | 0 | 0 |
| codex | 13 | 9 | 0 | 4 | 0 |
| opencode | 3 | 3 | 0 | 0 | 0 |
| cursor | 15 | 15 | 0 | 0 | 0 |

`stats`: 132 sessions; 62% used no skill, 5% one, 33% two or more. `grilling → domain-modeling`
is among the top pairs (8), as the design doc's verified facts predicted. One skill can appear
under both its namespaced and its bare name (`mattpocock-skills:grilling` and `grilling`). The
retro's merge step treats these as one skill.

Defects found during execution and fixed in the same task (the plan's code had them):

1. Desktop sessions were double-counted. Each session also keeps a CLI-format copy under
   `.claude/projects/` with a **different** session id, so deduping by id never fired. The miner
   now reads `audit.jsonl` only.
2. Codex guardian-review subagent rollouts share the parent's `session_id`. Their "user" turns are
   agent prompts (211 and 125 turns, beside the user's 10). They are now counted as empty. Cursor
   `subagents/` transcripts (11 of 26 files) are now skipped, as Claude's already were.
3. Claude metadata-only stubs (`ai-title`, `continued-in`) counted as `failed`. They now count as
   `empty`.
4. When two files share an id, the first one seen won. The copy with more turns now wins, and the
   counts still add up to `found`.
5. Redaction missed a bare macOS home dir (`"cwd": "/Users/<name>"`, no trailing slash). It is now
   caught. A bare `/home/<name>` is still not caught, because prose like `hub/home/write` would be
   a false positive.
6. The generated `rascal-grilling-ui` description was written as an unquoted YAML scalar containing
   `: `, which is invalid frontmatter. It is now quoted.
7. Task 4's "loads the transport last" test was wrong: `rascal:rascal-grilling` is a prefix of
   `rascal:rascal-grilling-ui`. The test now matches the closing backtick.
8. `rascal-grill-docs-ui` kept intelligentrascal's "patch the page `terms` after every
   `CONTEXT.md` edit" paragraph, which the plan's text had dropped.

## Code review (after the smoke runs)

A reviewer subagent read `cea26cb..HEAD` against the plan. Fixed, each with a regression test:

- **Privacy (critical).** Redaction and the scrub missed the dashed project slug
  (`-Users-<name>-…`, all over Claude and Cursor paths) and `C:\Users\<name>\`. Adding the slug
  pattern turned up two real leaks in older docs (`/private/tmp/…/-Users-<name>-…`), which are now
  redacted. Redaction also left a private key's body and END line in the digest; it now removes
  the whole block.
- **`[user]` substitution.** It replaced the first occurrence of the name anywhere in the match, so a
  name inside `Users` or `home` leaked. It now rebuilds the result as prefix + `[user]`.
- **Tokens.** Now also caught: `sk-proj-…`/`sk-svcacct-…` keys, Google `AIza…` keys and every
  `xox?-` Slack token.
- **`.scrub-allow`.** A literal no longer allows a shorter hit inside it (an allowed email literal
  used to allow a deny-listed name). An empty literal is an error. Explicit paths now resolve
  against the repo root, so globs match when the scrub runs from a subdirectory.
- **Parser-break detection.**
  - A renamed user-line type produced turn-less "empty" records with exit 0, and the cursor then
    marked them done for good. Turn-less records that have assistant turns (and no slash command)
    now count as suspect.
  - The 10% threshold is now taken over the sessions attempted this run, not over all found.
  - Empty sessions are only written to the cursor when the source looks healthy.
- **Dedupe across runs.** A later, smaller copy never replaces a larger digest record.
- **`extract --all`** keeps `extractedAt` for unchanged records, so the next incremental retro
  doesn't re-read everything.
- **`list`/`stats`** no longer crash on stray files such as `.DS_Store`.
- **`stats`** counts distinct skills per session, not invocations.
- **Compaction summaries** (`isCompactSummary`, "This session is being continued…") are not user turns.
- **`sync-transport`** mirrors every file in `skills/grilling-ui` except `test/`, `SKILL.md`,
  `agents/` and dotfiles. A new upstream file is now drift instead of being silently skipped.
- **`rascal-retro`**: an incremental run with no earlier retro stops and points at `--all`.

Not changed:
- **Seeding the deny-list with the login name.** The marketplace description names Rahil on
  purpose, so this stays the user's choice.
- **The scrub skipping UTF-16 files, and file modes in the drift check.** Low value.
- **The hook's `--check` reading the working tree rather than the index.** This is by design (Q34).

After the fixes, `mine.mjs extract` on this machine still exits 0 with `failed: 0`, no false
suspects, and no home paths or slugs in the digest.
