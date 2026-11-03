#!/bin/sh
# Which of this repository's skills each installed agent harness actually loads, asked in a fresh process (a running
# session keeps the list it read at start). Harnesses that are not installed are skipped. The prompt-based probes
# (Claude Code, OmO, omp) make one small model call each. Exit 1 if an installed harness misses a skill.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp" || exit 1 # outside any project, so only user-level skills count

ask() { # <harness> <command...>: one skill name per line into $tmp/<harness>
  h=$1
  shift
  if ! command -v "$1" >/dev/null 2>&1; then
    echo missing >"$tmp/$h.missing"
    return
  fi
  "$@" 2>/dev/null | sed 's/[^A-Za-z0-9:-]//g' | tr '[:upper:]' '[:lower:]' >"$tmp/$h" || true
}
# No `opencode reload` first: `opencode api` reads the skill folders afresh, and right after a reload it answers nothing.
ask opencode sh -c "opencode api GET /api/skill | jq -r '.data[].id'"
ask claude sh -c "claude -p x --output-format stream-json --verbose | jq -r 'select(.subtype==\"init\") | .skills[]'"
ask omo omo -p --no-tools 'List every <name> in your <available_skills>, one per line, nothing else.'
ask omp omp -p --max-cost=0.5 'List every skill name in your skills list, one per line, nothing else. Do not use tools.'

harnesses="opencode claude omo omp"
printf '%-28s' skill
for h in $harnesses; do printf '%-10s' "$h"; done
echo
status=0
for d in "$root"/skills/*/; do
  s=$(basename "$d")
  printf '%-28s' "$s"
  for h in $harnesses; do
    if [ -f "$tmp/$h.missing" ]; then
      mark="-"
    elif grep -qx -- "$s" "$tmp/$h"; then
      mark="yes"
    else
      mark="NO"
      status=1
    fi
    printf '%-10s' "$mark"
  done
  echo
done
echo "(- : not installed here)"
exit $status
