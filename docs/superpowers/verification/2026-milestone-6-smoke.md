# Milestone 6 smoke runs — Codex, OpenCode (T29)

Date: 2026-09-25. Rahil delegated this gate to Claude and asked to skip Pi. Versions:
`codex-cli 0.153.4` (model from `~/.codex/config.toml`), `opencode 1.18.32` (free model
`opencode/big-pickle`, no key), Pi `0.87.1` installed but **not run** (no free model: OpenCode's
free tier rejects non-OpenCode clients, and no provider key is on the machine).

Setup: `npx skills add mattpocock/skills -g -a codex opencode pi --skill grilling domain-modeling
research prototype -y`, then `scripts/install-agents.sh` → four symlinks in `~/.agents/skills`,
agents pin recorded, "Codex sandbox: missing — add the block above". Codex runs used
`codex exec -s workspace-write` with the sandbox block passed per run through `-c` (Rahil's
`~/.codex/config.toml` was not edited). The user side was driven in a browser.

| Check | Result |
|---|---|
| install-agents on a clean `~/.agents/skills`: links + pin | ✓ |
| **Codex** without the sandbox block fails with the exact T9 fix text | ✓ `grill: cannot write GRILL_HOME (EPERM). If you are in Codex, add to ~/.codex/config.toml: …` |
| **Codex** with it: page opens (`open` → opener), a Send is handled via `exec_command` `wait` + polling, exit 3 re-waits with the same `--after`, the turn is not ended while listening | ✓ send #1 handled, one status line; `wait --after 1` exited 3 at 280 s and a new `wait --after 1` started; Finish wrote `docs/rss-feeds-design.md` (all sections) and the run ended |
| `agent-profile` output matched what the model did (Codex) | ✓ after fix: `--agent codex`, `wait … --timeout 280` |
| **OpenCode** (`OPENCODE=1`): loads grill-me-ui → grilling → grilling-ui, wait via `bash`, Send handled, Finish | ✓ send #1 handled (round 2 added), Finish wrote `docs/short-link-aliases-design.md`, run ended |
| OpenCode `timeout` parameter | ✗→fixed: the model passed `timeout: 600000` on one of three waits and omitted it on the others (OpenCode default 2 min would kill a 540 s wait). Profile now `--timeout 110` with `timeout: 120000` |
| Visualize via OpenCode `task` tool | not exercised (the grill was finished after one round to keep the free-model run short) |
| **Pi** | skipped (see above); profile values are verified against Pi's source only (`agent-profile-sources.md`) |

Defects found and fixed (separate commits):

1. `grilling-ui/agents/openai.yaml` had `allow_implicit_invocation: false`. Codex then leaves the
   skill out of the model's context entirely (only a user's `$grilling-ui` reaches it), so the
   wrappers could not load it and the model reported Pocock's skills as missing. Policy removed;
   wrappers now say how to reinstall when `grilling-ui` is missing.
2. Codex launched from a Claude Code terminal inherits `CLAUDECODE=1`; `agent-profile` detected
   `claude` and printed Monitor params. Detection now checks Codex/OpenCode/Pi markers first, and
   the skills pass `--agent` explicitly.
3. On the sandbox error, Codex worked around it by setting `GRILL_HOME` to a project folder. The
   skill now says to stop and show the fix verbatim, never to set `GRILL_HOME` itself.
4. OpenCode wait timing (above).

Observation: in the in-app Browser pane, a keypress right after a navigation or click was dropped
twice; it never reproduced under Playwright (20 runs with concurrent state writes, plus the
keyboard e2e regression check), so it is attributed to the pane's input injection.
