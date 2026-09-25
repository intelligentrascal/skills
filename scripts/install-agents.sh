#!/usr/bin/env bash
# Install the intelligentrascal skills for Codex, OpenCode and Pi (spec §5b Installation).
#
#   1. Symlinks all four skills (never a subset) into $AGENTS_SKILLS_DIR (default ~/.agents/skills).
#   2. Checks that Pocock's grilling and domain-modeling are discoverable
#      (in $AGENTS_SKILLS_DIR or ~/.pi/agent/skills); if not, prints the npx command and exits 2.
#   3. Records the copy it found in upstream.local.json .pocock.agents (spec §8). That file is
#      per-machine and gitignored, so running this never dirties the tracked upstream.json.
#   4. Prints the Codex sandbox config and checks ~/.codex/config.toml for it.
#
# Environment (all optional): HOME, AGENTS_SKILLS_DIR, REPO_ROOT (default: this repo),
# XDG_STATE_HOME (npx skills lock file location), GRILL_HOME (default ~/.intelligentrascal).
# Idempotent. Exit: 0 ok, 1 refused (a real directory is in the way), 2 Pocock's skills missing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO_ROOT:-$(cd "$here/.." && pwd)}"
DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
HELPER="$here/lib/pocock.mjs"
SKILLS="grilling-ui grill-me-ui grill-docs-ui wayfinder-ui"

command -v node >/dev/null 2>&1 || { echo "install-agents: node (20+) is required" >&2; exit 1; }

# ---- 1. link the whole skill set -------------------------------------------------------------
for s in $SKILLS; do
  [ -f "$REPO/skills/$s/SKILL.md" ] || { echo "install-agents: $REPO/skills/$s/SKILL.md not found" >&2; exit 1; }
  if [ -e "$DEST/$s" ] && [ ! -L "$DEST/$s" ]; then
    echo "install-agents: $DEST/$s exists and is not a symlink; move it away and re-run (nothing was linked)" >&2
    exit 1
  fi
done
mkdir -p "$DEST"
for s in $SKILLS; do
  ln -sfn "$REPO/skills/$s" "$DEST/$s"
done
echo "Linked $SKILLS into $DEST"

# ---- 2. Pocock's skills ----------------------------------------------------------------------
found=""
for d in "$DEST" "$HOME/.pi/agent/skills"; do
  if [ -f "$d/grilling/SKILL.md" ] && [ -f "$d/domain-modeling/SKILL.md" ]; then found="$d"; break; fi
done

# ---- 3. record the agents pin ----------------------------------------------------------------
if [ -n "$found" ]; then
  pin="$(node "$HELPER" agents-pin "$found")"
  LOCAL="$REPO/upstream.local.json"
  [ -f "$LOCAL" ] || printf '{}\n' > "$LOCAL"
  node "$HELPER" set "$LOCAL" pocock.agents "$pin"
  echo "Pocock's skills: found in $found; recorded in upstream.local.json (pocock.agents)"
else
  echo "Pocock's skills (grilling, domain-modeling) not found in $DEST or $HOME/.pi/agent/skills. Install them with:"
  echo "  npx skills add -g mattpocock/skills"
fi

# ---- 4. Codex sandbox ------------------------------------------------------------------------
root="${GRILL_HOME:-$HOME/.intelligentrascal}"
case "$root" in /*) ;; *) root="$(pwd)/$root" ;; esac
echo
echo "Codex only: the hub needs loopback networking and write access to $root. Add to ~/.codex/config.toml:"
echo "  [sandbox_workspace_write]"
echo "  network_access = true"
echo "  writable_roots = [\"$root\"]"
echo "then restart Codex."
if node "$HELPER" codex-check "$HOME/.codex/config.toml" "$root"; then
  echo "Codex sandbox: OK"
else
  echo "Codex sandbox: missing — add the block above"
fi

[ -n "$found" ] || exit 2
exit 0
