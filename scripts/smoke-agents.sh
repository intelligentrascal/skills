#!/usr/bin/env bash
# Cross-agent smoke test (docs/rascal-v1-design.md, Q4): run one fixed prompt in each installed agent CLI
# from its own scratch directory, and flag any agent that gave no reply. Maintainer tool, not a skill.
#   scripts/smoke-agents.sh [--prompt <text>] [--agents "claude codex opencode pi"] [--timeout <seconds>]
# Exit: 0 every installed agent replied, 1 at least one gave no reply, 2 usage.
set -uo pipefail
prompt='Reply with exactly the word PONG and nothing else.'
agents="claude codex opencode pi"
timeout_s=180
while [ $# -gt 0 ]; do
  case "$1" in
    --prompt) prompt="$2"; shift 2 ;;
    --agents) agents="$2"; shift 2 ;;
    --timeout) timeout_s="$2"; shift 2 ;;
    *) echo "smoke-agents: unknown option $1" >&2; exit 2 ;;
  esac
done

scratch="$(mktemp -d "${TMPDIR:-/tmp}/rascal-smoke.XXXXXX")"
# perl alarm: macOS has no coreutils timeout by default.
with_timeout() { perl -e 'alarm shift; exec @ARGV or exit 127' "$@"; }
invoke() {
  case "$1" in
    claude) claude -p "$prompt" ;;
    codex) codex exec --skip-git-repo-check "$prompt" ;;
    opencode) opencode run "$prompt" ;;
    pi) pi -p "$prompt" ;;
    *) "$1" -p "$prompt" ;;
  esac
}

fail=0
for a in $agents; do
  if ! command -v "$a" >/dev/null 2>&1; then printf '%-9s skipped (not installed)\n' "$a"; continue; fi
  mkdir -p "$scratch/$a"
  ( cd "$scratch/$a" && with_timeout "$timeout_s" bash -c "$(declare -f invoke); prompt=\"\$1\"; invoke $a" _ "$prompt" ) \
    >"$scratch/$a.out" 2>"$scratch/$a.err"
  code=$?
  if [ -n "$(tr -d '[:space:]' <"$scratch/$a.out")" ]; then
    printf '%-9s replied\n' "$a"
  else
    printf '%-9s NO REPLY (exit %s)\n' "$a" "$code"; fail=1
  fi
done
echo "logs: $scratch"
exit $fail
