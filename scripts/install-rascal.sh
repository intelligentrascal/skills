#!/usr/bin/env bash
# Install rascal for Codex, OpenCode and Pi (design doc Q20), or with --pack <dir|git-url|zip> link a third-party skill pack into ~/.agents/skills and ~/.claude/skills (rascal v1 Q34).
# Default mode: symlink every plugins/rascal/skills/*
# into $AGENTS_SKILLS_DIR (default ~/.agents/skills), scaffold $RASCAL_HOME (default ~/.rascal), and write the
# routing note (Q10, Q23) into each agent's global instruction file, for every agent whose config directory exists:
#   Claude Code ${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md      Codex ${CODEX_HOME:-~/.codex}/AGENTS.md
#   OpenCode ${XDG_CONFIG_HOME:-~/.config}/opencode/AGENTS.md   Pi ${PI_CODING_AGENT_DIR:-~/.pi/agent}/AGENTS.md
# The note sits between rascal markers; nothing outside them changes, and the file is first copied to <file>.rascal-bak.
#   --no-note       link and scaffold only
#   --remove-note   only take the note out of every agent's file
# Installs no upstream skills. Idempotent. Exit: 0 ok, 1 refused (a real directory or broken markers in the way).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$here/../plugins/rascal/skills" && pwd)"
DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
RH="${RASCAL_HOME:-$HOME/.rascal}"

CLAUDE_DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

# Routing note, per agent: "<agent>|<config dir>|<instruction file name>".
note_targets() {
  printf '%s\n' "claude|${CLAUDE_CONFIG_DIR:-$HOME/.claude}|CLAUDE.md" "codex|${CODEX_HOME:-$HOME/.codex}|AGENTS.md" \
    "opencode|${XDG_CONFIG_HOME:-$HOME/.config}/opencode|AGENTS.md" "pi|${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}|AGENTS.md"
}
# $1 = install | remove. Agents without a config directory are skipped, never created.
routing_note() {
  command -v node >/dev/null 2>&1 || { echo "install-rascal: node (20+) is required for the routing note; re-run with --no-note to skip it" >&2; exit 1; }
  local rc=0 agent dir file
  while IFS='|' read -r agent dir file; do
    if [ ! -d "$dir" ]; then echo "install-rascal: routing note: $agent skipped ($dir not found)"; continue; fi
    node "$here/routing-note.mjs" "$1" "$dir/$file" || rc=1
    if [ "$1" = install ] && [ -f "$dir/AGENTS.override.md" ]; then
      echo "install-rascal: warning: $dir/AGENTS.override.md exists; $agent reads it instead of $file, so the note won't load there" >&2
    fi
  done < <(note_targets)
  return $rc
}

note=1
case "${1:-}" in
  --no-note) note=0 ;;
  --remove-note) routing_note remove || exit 1; exit 0 ;;
esac

# --pack <dir|git-url|zip>: link a third-party skill pack into both skill dirs (rascal v1 Q34).
if [ "${1:-}" = "--pack" ]; then
  src="${2:?usage: install-rascal.sh --pack <dir|git-url|zip>}"
  mkdir -p "$RH/packs"
  lsrc="$(printf '%s' "$src" | tr '[:upper:]' '[:lower:]')"
  # Same repo, different spelling: compare URLs without a trailing "/" or ".git".
  norm() { local u="${1%/}"; printf '%s' "${u%.git}"; }
  case "$lsrc" in
    *.zip|*.zip\?*)
      zpath="${src%%\?*}"
      case "$lsrc" in
        http://*|https://*) name="$(printf '%s' "${zpath#*://}" | tr '/:' '--' | sed 's/\.[zZ][iI][pP]$//')" ;;
        *) zbase="$(basename "$zpath")"; name="${zbase%.[zZ][iI][pP]}" ;;
      esac
      root="$RH/packs/$name"
      # A pack folder remembers its source; a different source with the same name is refused before anything is removed.
      if [ -f "$root/.rascal-pack-source" ] && [ "$(cat "$root/.rascal-pack-source")" != "$src" ]; then
        echo "install-rascal: pack $root came from $(cat "$root/.rascal-pack-source"), not $src (nothing was linked)" >&2; exit 1
      fi
      zf="$src"
      case "$lsrc" in
        http://*|https://*)
          zf="$(mktemp "${TMPDIR:-/tmp}/rascal-pack.XXXXXX")"
          curl -fsSL -o "$zf" "$src" || { rm -f "$zf"; echo "install-rascal: download failed: $src" >&2; exit 1; } ;;
      esac
      rm -rf "$root"; mkdir -p "$root"; unzip -q "$zf" -d "$root"; printf '%s' "$src" > "$root/.rascal-pack-source"
      case "$lsrc" in http://*|https://*) rm -f "$zf" ;; esac ;;
    https://*|http://*|git@*|file://*|*.git)
      trimmed="${src%/}"; trimmed="${trimmed%.git}"
      name="$(printf '%s' "$trimmed" | tr ':' '/' | awk -F/ '{n=0; for(i=1;i<=NF;i++) if($i!="") a[++n]=$i; if(n>=2) print a[n-1] "-" a[n]; else print a[n]}')"
      root="$RH/packs/$name"
      if [ -d "$root/.git" ]; then
        have="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
        if [ "$(norm "$have")" != "$(norm "$src")" ]; then
          echo "install-rascal: pack $root already holds a clone of $have, not $src (nothing was linked)" >&2; exit 1
        fi
        git -C "$root" pull -q --ff-only
      else git clone -q "$src" "$root"; fi ;;
    *)
      root="$(cd "$src" && pwd)" ;;
  esac
  links=()
  while IFS= read -r f; do links+=("$(dirname "$f")"); done < <(find "$root" -maxdepth 4 -name SKILL.md -not -path '*/.git/*' | sort)
  [ ${#links[@]} -gt 0 ] || { echo "install-rascal: no SKILL.md found in $src" >&2; exit 1; }
  for i in "${!links[@]}"; do
    for j in "${!links[@]}"; do
      if [ "$i" -lt "$j" ] && [ "$(basename "${links[$i]}")" = "$(basename "${links[$j]}")" ]; then
        echo "install-rascal: two skills named $(basename "${links[$i]}") in one pack: ${links[$i]} and ${links[$j]} (nothing was linked)" >&2; exit 1
      fi
    done
  done
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
if [ "$note" = 1 ]; then routing_note install || exit 1; fi
echo "Claude Code: claude plugin marketplace add intelligentrascal/skills && claude plugin install rascal@intelligentrascal"
