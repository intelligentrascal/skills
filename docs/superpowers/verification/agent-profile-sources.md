# agent-profile: source verification (2026-09-25)

Every value `skills/grilling-ui/lib/profile.mjs` prints, checked against the agent's source.
`$RESEARCH` = `/private/tmp/claude-501/-Users-rahil-code-skills/c42446c8-6414-4d2e-ad03-e25f9cb2e308/scratchpad/research`.

| Agent | Source | Commit / version |
|---|---|---|
| Claude Code | own tool schema (Monitor) + live env of this session | Claude Code 2.1.282 |
| Codex | `$RESEARCH/openai-codex` (newer than `$RESEARCH/codex` @ `c98e263`) | `b35a7afbe83d72af4607c67732ab4dade38bacb7` (main, 2026-09-25); installed `codex-cli 0.153.4`, whose binary strings match the tool descriptions quoted below |
| OpenCode | `$RESEARCH/sst-opencode` (same commit as `$RESEARCH/opencode`) | `34aa427434b054afcce7184764aa681159b5d769`, package 1.18.32; not installed locally |
| Pi | `$RESEARCH/badlogic-pi-mono` (same commit as `$RESEARCH/pi-mono`) | `8930b9ec0b9299d4e48da2d9e0b7009f5f54391d`, coding-agent 0.87.1; not installed locally |

Paths below are relative to `codex-rs/` (Codex), `packages/opencode/` (OpenCode), `packages/coding-agent/` (Pi).

## Detection env (D13)

| Agent | Plan | Verified | Citation |
|---|---|---|---|
| Claude Code | `CLAUDECODE=1` | ✓ `CLAUDECODE=1` in a Claude Code Bash tool shell | `env` in this session |
| Codex | `CODEX_THREAD_ID` or `CODEX_SANDBOX` | ✓ `CODEX_THREAD_ID` is inserted into every `exec_command` process env; `CODEX_SANDBOX=seatbelt` only under the macOS Seatbelt sandbox (not Linux, not `danger-full-access`), so `CODEX_THREAD_ID` is the dependable one. Codex also sets `CODEX_SESSION_ID` and `CODEX_VERSION` | `protocol/src/shell_environment.rs:7`; `core/src/unified_exec/process_manager.rs:1452-1456`; `core/src/exec_env.rs:41-49`; `core/src/spawn.rs:26`; `core/src/sandboxing/mod.rs:177-178` |
| OpenCode | `OPENCODE=1` | ✓ (also `AGENT=1`, `OPENCODE_PID`); the bash tool spreads `process.env` into the shell env | `src/index.ts:75-77`; `src/tool/shell.ts:423` |
| Pi | `PI_CODING_AGENT=true` | ✓ (also `AI_AGENT=pi`; RPC mode sets it too) | `src/cli/setup.ts:6-7`; `src/rpc-entry.ts:7` |

## Listen parameters

| Agent | Plan value | Verified value | Citation |
|---|---|---|---|
| Claude | `Monitor {command, description, timeout_ms: 1800000}` | ✓ `command`, `description` (required), `timeout_ms` (required; default 300000; min 1000; values above 1800000 are capped to 1800000). `GRILL_MONITOR_MS` overrides it, clamped to 1000..1800000 | Monitor tool schema, Claude Code 2.1.282 |
| Codex start | `exec_command {cmd, yield_time_ms: 30000}` "with an overall 300 000 ms budget" (spec: `timeout_ms: 300000`) | `exec_command {cmd, yield_time_ms: 30000}`. **No `timeout_ms` exists** on the default (unified exec, interactive) tool; the schema is `cmd, workdir, tty, yield_time_ms, max_output_tokens, shell, login` with `additionalProperties: false`. `yield_time_ms` defaults to 10000 and is clamped to 250..30000. `timeout_ms` exists only on the one-shot variant used when managed policy disables unified exec (default 10000, process killed on timeout). The wait's own `--timeout 280` bounds the process | `core/src/tools/handlers/shell_spec.rs:30-34,35-63,96,108-112`; `core/src/unified_exec/mod.rs:73-78,218-224`; `core/src/tools/handlers/unified_exec.rs:36-39,62-64`; `core/src/tools/handlers/unified_exec/exec_command.rs:312-320,484-500`; `core/src/tools/spec_plan.rs:1108-1116`; `features/src/lib.rs:978-981` (unified_exec on by default) |
| Codex poll | `write_stdin {session_id, chars: "", yield_time_ms: 30000}` | ✓ `session_id` (number, required), `chars`, `yield_time_ms`, `max_output_tokens`. Empty polls are clamped to 5000..`background_terminal_max_timeout` (default 300000: this is the "300 000 ms" in the plan, a poll ceiling, not a process timeout). 30000 kept (Jason's bounded-steps rule) | `shell_spec.rs:117-157` (desc :134); `core/src/unified_exec/process_manager.rs:1018-1026`; `config/src/config_toml.rs:339-341` |
| OpenCode | `bash {command, timeout: 600000}`, `--timeout 540` | ✓ tool id `bash`; params `command`, `timeout` (ms, positive int), `workdir`. Default 120000 (env `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`). **No hard max** in this source (spec says "hard max 10 min"); 600000 was used first; the T29 smoke run showed the model sometimes omits `timeout`, so the profile now uses `--timeout 110` with `timeout: 120000` (inside the 2-min default) | `src/tool/shell/id.ts:16`; `src/tool/shell/prompt.ts:15-23`; `src/tool/shell.ts:347,540-564,615-618`; `src/effect/runtime-flags.ts:53` |
| Pi | `bash {command}` (no timeout), `--timeout 900` | ✓ tool `bash`; params `command`, optional `timeout` **in seconds**, "no default timeout" (max 2147483.647 s) | `src/core/tools/bash.ts:22-23,25-35,38-41,384` |
| unknown | shell, `--timeout 480`, poll ≤ 60 s | kept (Jason's generic wait mode) | `$JASON/SKILL.md:354-386` |

## Draw / research / skill loading

| Agent | Plan | Verified | Citation |
|---|---|---|---|
| Claude | `Agent` (background) | ✓ | Claude Code tool list |
| Codex | `spawn_agent` | ✓ `spawn_agent` (in namespace `multi_agent_v1` for v1; `multi_agent` feature on by default) | `core/src/tools/handlers/multi_agents_spec.rs:14,85,127`; `features/src/lib.rs:1312-1315` |
| OpenCode | `Task` | **`task`** (lowercase id). Its `background` param only works with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` (or `OPENCODE_EXPERIMENTAL`); otherwise the call fails, so the profile prints `background: false` unless that flag is set | `src/tool/task.ts:24,56-61,97-100`; `src/effect/runtime-flags.ts:4,10-13,43` |
| Pi | inline, research `leave-open` | ✓ no sub-agent tool in `src/core/tools/` (bash, edit, find, grep, ls, read, write, powershell) | `src/core/tools/` |
| Skill loading | Claude Skill tool; Codex `skills.read`/`$name`; OpenCode `skill`; Pi reads file | Claude: Skill tool. Codex: open the listed `SKILL.md` path (`skills.read` only for executor/cloud packages). OpenCode: `skill {name}`. Pi: read tool on the listed `<location>` | `ext/skills/src/catalog_prompt.rs:8-12`; `src/tool/skill.ts:8-13`; `src/core/skills.ts:365,376` |

## Deviations from the plan table

1. Codex: no `timeout_ms` in `listen` (it is not a parameter of the interactive `exec_command`); the 300000 ms figure is documented as the `write_stdin` poll ceiling.
2. OpenCode draw tool is `task`, and `background` is `false` unless the experimental flag is on.
3. `unknown` research is `leave-open` (it draws inline, so no sub-agent tool can be assumed); the plan said `subagent` for everyone but Pi.
4. `<skill>` and `<session>` are double-quoted in every command, so paths with spaces work.
