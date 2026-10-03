#!/usr/bin/env bash
# Cross-agent smoke test (docs/rascal-v1-design.md, Q4): run one fixed prompt in each installed agent CLI
# from its own scratch directory, and flag any agent that gave no usable reply. Maintainer tool, not a skill.
#   scripts/smoke-agents.sh [--prompt <text>] [--expect <text>] [--skill <name>]
#                           [--agents "claude codex opencode pi"] [--timeout <seconds>]
# An agent "replied" only when it exits 0 and its stdout contains the expected text.
#   --expect <text>  text the reply must contain. Default PONG with the default prompt; with --prompt and
#                    no --expect, any non-empty stdout counts.
#   --skill <name>   fixed skill prompt: asks the agent to use skill <name> and reply with its frontmatter
#                    name; expects <name>. Checks that skills load in each CLI.
# Lines: replied | NO REPLY (exit N) | WRONG REPLY (exit 0) | skipped (not installed).
# Exit: 0 every installed agent replied, 1 at least one did not, 2 usage.
set -uo pipefail
prompt='Reply with exactly the word PONG and nothing else.'
agents="claude codex opencode pi"
timeout_s=180
expect=""; expect_set=0
while [ $# -gt 0 ]; do
  case "$1" in --prompt|--expect|--skill|--agents|--timeout) [ $# -ge 2 ] || { echo "smoke-agents: $1 needs a value" >&2; exit 2; } ;; esac
  case "$1" in
    --prompt) prompt="$2"; shift 2; [ "$expect_set" = 1 ] || expect="" ;;
    --expect) expect="$2"; expect_set=1; shift 2 ;;
    --skill) prompt="Use the $2 skill. Reply with exactly the value of its frontmatter name field and nothing else."; expect="$2"; expect_set=1; shift 2 ;;
    --agents) agents="$2"; shift 2 ;;
    --timeout) timeout_s="$2"; shift 2 ;;
    *) echo "smoke-agents: unknown option $1" >&2; exit 2 ;;
  esac
done

[ "$expect_set" = 1 ] || [ "$prompt" != 'Reply with exactly the word PONG and nothing else.' ] || expect="PONG"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/rascal-smoke.XXXXXX")"
# macOS has no coreutils timeout: fork, put the child in its own process group, and on alarm kill the whole group.
with_timeout() {
  perl -e '
    my $t = shift; my $pid = fork();
    if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127; }
    $SIG{ALRM} = sub { kill -9, $pid; waitpid($pid, 0); exit 142; };
    alarm $t; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@"
}
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
    </dev/null >"$scratch/$a.out" 2>"$scratch/$a.err"
  code=$?
  out="$(cat "$scratch/$a.out")"
  if [ "$code" -ne 0 ] || [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
    printf '%-9s NO REPLY (exit %s)\n' "$a" "$code"; fail=1
  elif [ -n "$expect" ] && ! printf '%s' "$out" | grep -qF -- "$expect"; then
    printf '%-9s WRONG REPLY (exit %s)\n' "$a" "$code"; fail=1
  else
    printf '%-9s replied\n' "$a"
  fi
done
echo "logs: $scratch"
exit $fail
