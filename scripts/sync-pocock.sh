#!/usr/bin/env bash
# Report and apply Matt Pocock's upstream skill changes (spec §8). Never commits.
#
#   1. Warns when upstream main is ahead of the installed Claude plugin release (skipped offline).
#   2. Claude install: if installed_plugins.json differs from upstream.json .pocock.claude, prints
#      the diff of grilling, domain-modeling, grill-me, grill-with-docs and wayfinder between them.
#   3. Fails loudly (exit 3) if a delegated skill is missing/renamed at the installed version, or
#      grilling/domain-modeling gained disable-model-invocation: true (SKILL.md) or
#      allow_implicit_invocation: false (agents/openai.yaml); same checks on the agents copy.
#   4. Agents copy (upstream.json .pocock.agents, written by install-agents.sh): if its content
#      changed, prints diff -u against the Claude pinned copy.
#   5. Three-way merges skills/wayfinder-ui/upstream/wayfinder.md (ours) with Pocock's pinned
#      (base) and installed (theirs) wayfinder. Conflicts are left marked (exit 4).
#   6. Runs the tests, then bumps the pins in upstream.json. Nothing is committed.
#
# Environment (all optional): CLAUDE_PLUGINS (~/.claude/plugins), POCOCK_MARKETPLACE
# ($CLAUDE_PLUGINS/marketplaces/mattpocock, a git checkout), REPO_ROOT (this repo), HOME,
# XDG_STATE_HOME, SYNC_TEST_CMD (replaces the test command), SYNC_WAYFINDER_DONE=1 (skip the
# merge after resolving its conflicts by hand).
# Exit: 0 ok, 1 environment error, 3 upstream restructured / invocation changed,
#       4 wayfinder merge conflicts, 5 tests failed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO_ROOT:-$(cd "$here/.." && pwd)}"
CLAUDE_PLUGINS="${CLAUDE_PLUGINS:-$HOME/.claude/plugins}"
MKT="${POCOCK_MARKETPLACE:-$CLAUDE_PLUGINS/marketplaces/mattpocock}"
HELPER="$here/lib/pocock.mjs"
U="$REPO/upstream.json"
OURS="$REPO/skills/wayfinder-ui/upstream/wayfinder.md"
DELEGATED="grilling domain-modeling grill-me grill-with-docs wayfinder"
INVOCABLE="grilling domain-modeling"
export GIT_TERMINAL_PROMPT=0

die() { local code="$1"; shift; echo "sync-pocock: $*" >&2; exit "$code"; }
g() { git -C "$MKT" "$@"; }
json() { node "$HELPER" get "$U" "$1"; }
tmpd="$(mktemp -d "${TMPDIR:-/tmp}/sync-pocock.XXXXXX")"
trap 'rm -rf "$tmpd"' EXIT

command -v node >/dev/null 2>&1 || die 1 "node (20+) is required"
[ -f "$U" ] || die 1 "$U not found"
g rev-parse --git-dir >/dev/null 2>&1 || die 1 "$MKT is not a git checkout of mattpocock/skills (set POCOCK_MARKETPLACE)"

pin_version="$(json pocock.claude.version)"
pin_commit="$(json pocock.claude.commit)"
wf_base="$(json pocock.wayfinder.vendoredFrom)"
agents_dir="$(json pocock.agents.dir)"
agents_sha="$(json pocock.agents.contentSha)"
[ -n "$pin_commit" ] || die 1 "upstream.json has no pocock.claude.commit"

inst="$(node "$HELPER" installed "$CLAUDE_PLUGINS/installed_plugins.json" mattpocock-skills@mattpocock)" \
  || die 1 "mattpocock-skills@mattpocock is not in $CLAUDE_PLUGINS/installed_plugins.json (claude plugin install mattpocock-skills@mattpocock)"
IFS="$(printf '\t')" read -r inst_version inst_commit inst_path <<EOF
$inst
EOF

has_commit() { g cat-file -e "$1^{commit}" 2>/dev/null; }
need_commit() {
  has_commit "$1" || g fetch -q origin "$1" 2>/dev/null || true
  has_commit "$1" || die 1 "commit $1 is not in $MKT and could not be fetched (offline?)"
}
# Folder of <name>/SKILL.md under skills/ at a commit (Pocock groups skills in bucket folders).
skill_dir() {
  { g ls-tree -r --name-only "$1" -- skills | grep -E "(^|/)$2/SKILL\.md$" || true; } | head -n 1 | sed 's#/SKILL\.md$##'
}
frontmatter() { awk 'NR == 1 && /^---/ { f = 1; next } f && /^---/ { exit } f'; }
problems=""
problem() { problems="$problems$1"$'\n'; }
# check_invocation <label> <SKILL.md text> <openai.yaml text>
check_invocation() {
  if printf '%s\n' "$2" | frontmatter | grep -Eq '^disable-model-invocation:[[:space:]]*true'; then
    problem "$1 gained disable-model-invocation: true (the -ui wrappers can no longer load it)"
  fi
  if printf '%s\n' "$3" | grep -Eq '^[[:space:]]*allow_implicit_invocation:[[:space:]]*false'; then
    problem "$1 gained allow_implicit_invocation: false in agents/openai.yaml"
  fi
}

need_commit "$pin_commit"
need_commit "$inst_commit"

# ---- 1. upstream ahead of the installed release ----------------------------------------------
if g -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 fetch -q origin main 2>/dev/null; then
  ahead="$(g rev-list --count "$inst_commit..origin/main")"
  if [ "$ahead" -gt 0 ]; then
    echo "WARNING: upstream main is $ahead commit(s) ahead of the installed release $inst_version; those changes are unreleased (claude plugin update mattpocock-skills@mattpocock when a release lands)."
  fi
else
  echo "note: could not fetch origin main (offline?); skipped the upstream-ahead check"
fi

# ---- 2. Claude install vs its pin -------------------------------------------------------------
claude_changed=0
if [ "$inst_commit" != "$pin_commit" ] || [ "$inst_version" != "$pin_version" ]; then
  claude_changed=1
  echo "== Claude plugin: pinned $pin_version ($pin_commit) -> installed $inst_version ($inst_commit)"
  for s in $DELEGATED; do
    a="$(skill_dir "$pin_commit" "$s")"; b="$(skill_dir "$inst_commit" "$s")"
    echo "--- $s"
    paths="$a"
    if [ -n "$b" ] && [ "$b" != "$a" ]; then paths="$paths $b"; fi
    if [ -n "$paths" ]; then
      # shellcheck disable=SC2086 # a space-separated list of repo paths (Pocock's paths have no spaces)
      g --no-pager diff --no-color "$pin_commit..$inst_commit" -- $paths
    fi
  done
else
  echo "== Claude plugin: installed $inst_version matches the pin"
fi

# ---- 3. restructure / invocation checks at the installed version ------------------------------
for s in $DELEGATED; do
  d="$(skill_dir "$inst_commit" "$s")"
  if [ -z "$d" ]; then problem "delegated skill '$s' is missing or was renamed at $inst_version ($inst_commit)"; continue; fi
  case " $INVOCABLE " in *" $s "*)
    check_invocation "$s" "$(g show "$inst_commit:$d/SKILL.md")" "$(g show "$inst_commit:$d/agents/openai.yaml" 2>/dev/null || true)" ;;
  esac
done

agents_changed=0
if [ -n "$agents_dir" ]; then
  case "$agents_dir" in "~") adir="$HOME" ;; "~/"*) adir="$HOME/${agents_dir#\~/}" ;; *) adir="$agents_dir" ;; esac
  missing=0
  for s in $INVOCABLE; do
    if [ ! -f "$adir/$s/SKILL.md" ]; then problem "agents copy: '$s' is missing from $adir"; missing=1; continue; fi
    y=""; [ -f "$adir/$s/agents/openai.yaml" ] && y="$(cat "$adir/$s/agents/openai.yaml")"
    check_invocation "agents copy: $s" "$(cat "$adir/$s/SKILL.md")" "$y"
  done
  if [ "$missing" = 0 ]; then
    cur="$(node "$HELPER" content-sha "$adir")"
    if [ "$cur" != "$agents_sha" ]; then
      agents_changed=1
      echo "== agents copy ($adir): contentSha $agents_sha -> $cur"
      echo "   Claude plugin pin: mattpocock-skills $pin_version ($pin_commit); installed: $inst_version ($inst_commit)"
      echo "   agents copy: skillFolderHash $(json pocock.agents.skillFolderHash) (recorded)"
      for s in $INVOCABLE; do
        d="$(skill_dir "$pin_commit" "$s")"
        if [ -n "$d" ]; then g show "$pin_commit:$d/SKILL.md" > "$tmpd/pin-$s.md"; else : > "$tmpd/pin-$s.md"; fi
        diff -u --label "claude-pin:$s/SKILL.md" --label "agents:$s/SKILL.md" "$tmpd/pin-$s.md" "$adir/$s/SKILL.md" || true
      done
      echo "   Note: editing the npx skills copy is unsupported; update it with npx skills add -g mattpocock/skills."
    fi
  fi
fi

if [ -n "$problems" ]; then
  printf '%s' "$problems" | sed 's/^/sync-pocock: FAIL: /' >&2
  echo "sync-pocock: Pocock's skills changed shape; update the -ui wrappers before syncing. Nothing was applied." >&2
  exit 3
fi

if [ "$claude_changed" = 0 ] && [ "$agents_changed" = 0 ] && [ "$wf_base" = "$inst_commit" ]; then
  echo "Nothing to sync."
  exit 0
fi

# ---- 5. wayfinder three-way merge -------------------------------------------------------------
if [ "$wf_base" != "$inst_commit" ] && [ "${SYNC_WAYFINDER_DONE:-}" != "1" ]; then
  need_commit "$wf_base"
  bd="$(skill_dir "$wf_base" wayfinder)"; td="$(skill_dir "$inst_commit" wayfinder)"
  g show "$wf_base:$bd/SKILL.md" > "$tmpd/base.md"
  g show "$inst_commit:$td/SKILL.md" > "$tmpd/theirs.md"
  set +e
  git merge-file -L ours -L base -L theirs "$OURS" "$tmpd/base.md" "$tmpd/theirs.md"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "== wayfinder: merged $wf_base..$inst_commit into skills/wayfinder-ui/upstream/wayfinder.md (clean)"
  elif [ "$rc" -gt 0 ] && [ "$rc" -lt 128 ]; then
    echo "== wayfinder: git merge-file exit $rc: $rc conflict(s) left marked in skills/wayfinder-ui/upstream/wayfinder.md"
    echo "Resolve them, then re-run with SYNC_WAYFINDER_DONE=1 to run the tests and bump the pins."
    exit 4
  else
    die 1 "git merge-file failed (exit $rc)"
  fi
elif [ "$wf_base" != "$inst_commit" ]; then
  echo "== wayfinder: merge skipped (SYNC_WAYFINDER_DONE=1)"
fi

# ---- 6. tests, then pins ----------------------------------------------------------------------
cmd="${SYNC_TEST_CMD:-node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs}"
echo "== running tests: $cmd"
if ! (cd "$REPO" && POCOCK_PIN="$inst_path" bash -c "$cmd"); then
  echo "sync-pocock: tests failed; pins not bumped (changes are left in the working tree for review)" >&2
  exit 5
fi

node "$HELPER" set "$U" pocock.claude "{\"version\":\"$inst_version\",\"commit\":\"$inst_commit\"}"
node "$HELPER" set "$U" pocock.wayfinder.vendoredFrom "\"$inst_commit\""
if [ -n "$agents_dir" ]; then
  pin="$(node "$HELPER" agents-pin "$adir")"
  node "$HELPER" set "$U" pocock.agents "$pin"
  # keep the recorded dir exactly as install-agents.sh wrote it
  node "$HELPER" set "$U" pocock.agents.dir "\"$agents_dir\""
fi
echo "== pins bumped in upstream.json (claude $inst_version, wayfinder $inst_commit${agents_dir:+, agents}). Nothing committed; review with git diff."
