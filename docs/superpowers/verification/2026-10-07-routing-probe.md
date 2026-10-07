# Routing probe (pack design Q36), 2026-10-07

Does the routing note take effect on each agent, and does Superpowers' "use a skill on even a 1% chance" bootstrap override it?

**Setup.** The note (rascal 0.3.0, `plugins/rascal/routing-note.md`) was installed with `node scripts/routing-note.mjs install <file>` into each agent's global instruction file. None of the four files existed before, so each was created and no backup was needed. One probe per agent, run by `scripts/smoke-agents.sh` from a scratch directory outside any repo:

> Do not run any tools or take any action. Using only the instructions you were given before this message, classify two tasks. Task A: 'rename the variable foo to bar in utils.js'. Task B: 'add user accounts with OAuth login to the web app'. Also C: the exact path of the preferences file your standing instructions tell you to read (NONE if none). Reply in exactly one line and nothing else: A=<route> B=<route> C=<path>, where a route is just-do-it or the exact name of the one skill or workflow you would invoke first.

Correct answers depend on the note: A is a chore (just-do-it), B needs design decisions (`rascal-feature`), and only the note names `~/.rascal/preferences.md`.

| Agent | Version | File | Superpowers bootstrap present | Reply | Note took effect |
|---|---|---|---|---|---|
| Claude Code CLI | 2.1.292 | `~/.claude/CLAUDE.md` | yes: `superpowers-extended-cc` 5.2.8 loaded, with its SessionStart hook | `A=just-do-it B=rascal:rascal-feature C=~/.rascal/preferences.md` | yes; the note beat the bootstrap |
| Codex | 0.153.4 | `~/.codex/AGENTS.md` | no (its only SessionStart hook is unrelated) | `A=just-do-it B=rascal-feature C=~/.rascal/preferences.md` | yes |
| OpenCode | 1.18.34 | `~/.config/opencode/AGENTS.md` | no | `A=just-do-it B=rascal-feature C=~/.rascal/preferences.md` | yes |
| Pi | 0.99.2 | `~/.pi/agent/AGENTS.md` | no | `A=just-do-it B=rascal-feature C=~/.rascal/preferences.md` | yes |

**Codex note.** The first Codex run got no reply: the model set in `~/.codex/config.toml` is rejected for a ChatGPT-account login (HTTP 400), before the model sees any prompt. The same probe re-run with `-m gpt-5.6-sol` gave the reply above. Fixing the configured model is the user's call.

**Not covered.** The Claude desktop app injects Superpowers itself; it can't be driven from a script, so it is untested. Its Claude Code sessions read the same `~/.claude/CLAUDE.md`, and the CLI result above (bootstrap loaded, note followed) is the closest evidence.
