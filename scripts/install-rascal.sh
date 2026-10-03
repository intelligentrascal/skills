#!/usr/bin/env bash
# Install rascal for Codex, OpenCode and Pi (design doc Q20), or with --pack <dir|git-url|zip> link a third-party skill pack into ~/.agents/skills and ~/.claude/skills (rascal v1 Q34).
# Default mode: symlink every plugins/rascal/skills/*
# into $AGENTS_SKILLS_DIR (default ~/.agents/skills) and scaffold $RASCAL_HOME (default ~/.rascal).
# Installs no upstream skills. Idempotent. Exit: 0 ok, 1 refused (a real directory is in the way).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$here/../plugins/rascal/skills" && pwd)"
DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
RH="${RASCAL_HOME:-$HOME/.rascal}"

CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

# --pack <dir|git-url|zip>: link a third-party skill pack into both skill dirs (rascal v1 Q34).
if [ "${1:-}" = "--pack" ]; then
  src="${2:?usage: install-rascal.sh --pack <dir|git-url|zip>}"
  mkdir -p "$RH/packs"
  case "$src" in
    https://*|git@*|file://*|*.git)
      name="$(basename "${src%.git}")"; root="$RH/packs/$name"
      if [ -d "$root/.git" ]; then git -C "$root" pull -q --ff-only; else git clone -q "$src" "$root"; fi ;;
    *.zip)
      name="$(basename "$src" .zip)"; root="$RH/packs/$name"
      rm -rf "$root"; mkdir -p "$root"; unzip -q "$src" -d "$root" ;;
    *)
      root="$(cd "$src" && pwd)" ;;
  esac
  links=()
  while IFS= read -r f; do links+=("$(dirname "$f")"); done < <(find "$root" -maxdepth 4 -name SKILL.md -not -path '*/.git/*' | sort)
  [ ${#links[@]} -gt 0 ] || { echo "install-rascal: no SKILL.md found in $src" >&2; exit 1; }
  for d in "$DEST" "$CLAUDE_DEST"; do
    for s in "${links[@]}"; do
      t="$d/$(basename "$s")"
      if [ -e "$t" ] && [ ! -L "$t" ]; then echo "install-rascal: $t exists and is not a symlink (nothing was linked)" >&2; exit 1; fi
      if [ -L "$t" ] && [ "$(readlink "$t")" != "$s" ]; then echo "install-rascal: $t already links to $(readlink "$t") (nothing was linked)" >&2; exit 1; fi
    done
  done
  for d in "$DEST" "$CLAUDE_DEST"; do mkdir -p "$d"; for s in "${links[@]}"; do ln -sfn "$s" "$d/$(basename "$s")"; done; done
  names="$(for s in "${links[@]}"; do basename "$s"; done | paste -sd, - | sed 's/,/, /g')"
  echo "install-rascal: linked ${#links[@]} skills from $src into $DEST and $CLAUDE_DEST: $names"
  exit 0
fi

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
