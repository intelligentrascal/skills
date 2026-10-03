#!/usr/bin/env bash
# Install rascal for Codex, OpenCode and Pi (design doc Q20): symlink every plugins/rascal/skills/*
# into $AGENTS_SKILLS_DIR (default ~/.agents/skills) and scaffold $RASCAL_HOME (default ~/.rascal).
# Installs no upstream skills. Idempotent. Exit: 0 ok, 1 refused (a real directory is in the way).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$here/../plugins/rascal/skills" && pwd)"
DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
RH="${RASCAL_HOME:-$HOME/.rascal}"

skills=()
for d in "$SRC"/*/; do skills+=("$(basename "$d")"); done
for s in "${skills[@]}"; do
  if [ -e "$DEST/$s" ] && [ ! -L "$DEST/$s" ]; then
    echo "install-rascal: $DEST/$s exists and is not a symlink; move it away and re-run (nothing was linked)" >&2; exit 1
  fi
done
mkdir -p "$DEST"
for s in "${skills[@]}"; do ln -sfn "$SRC/$s" "$DEST/$s"; done
echo "install-rascal: linked ${#skills[@]} skills into $DEST"

mkdir -p "$RH/mining" && chmod 700 "$RH"
[ -f "$RH/denylist.txt" ] || printf '%s\n' "# rascal deny-list: one literal per line (case-insensitive): client names, private project names." \
  "# Used by scripts/scrub.mjs (pre-commit) and the miner's redaction. Never commit this file." > "$RH/denylist.txt"
[ -f "$RH/preferences.md" ] || : > "$RH/preferences.md"
echo "install-rascal: $RH ready"
echo "Claude Code: claude plugin marketplace add intelligentrascal/skills && claude plugin install rascal@intelligentrascal"
