#!/bin/sh
# Which of this repository's skills, and whether its instructions (instructions/<env>/AGENTS.md: the shared title and
# this environment's "## Environment: …" heading), each installed agent harness actually loads, asked in a fresh
# process (a running session keeps what it read at start). Harnesses that are not installed are skipped. The
# prompt-based probes make one small model call each; "?" means the harness could not answer (e.g. not logged in).
# Exit 1 if an installed harness misses a skill, the instructions or the environment layer.
# Usage: sh scripts/check-load.sh [macos|pitobox]   (default: macos on macOS, pitobox as the user pitobox)
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp" || exit 1 # outside any project, so only user-level skills count

# Each harness is named after its command (opencode, claude, omo, omp), so "installed" is `command -v <harness>`.
ask() { # <harness> <command...>: one skill name per line into $tmp/<harness>
  h=$1
  shift
  if ! command -v "$h" >/dev/null 2>&1; then
    echo missing >"$tmp/$h.missing"
    return
  fi
  # An empty answer is a harness hiccup (opencode api sometimes returns nothing), not "no skills": try again.
  for _ in 1 2 3; do
    "$@" 2>/dev/null | sed 's/[^A-Za-z0-9:-]//g' | tr '[:upper:]' '[:lower:]' >"$tmp/$h" || true
    [ -s "$tmp/$h" ] && return
    sleep 2
  done
}
# No `opencode reload` first: `opencode api` reads the skill folders afresh, and right after a reload it answers nothing.
ask opencode sh -c "opencode api GET /api/skill | jq -r '.data[].id'"
ask claude sh -c "claude -p x --output-format stream-json --verbose | jq -r 'select(.subtype==\"init\") | .skills[]'"
ask omo omo -p --no-tools 'List every <name> in your <available_skills>, one per line, nothing else.'
ask omp omp -p --max-cost=0.5 'List every skill name in your skills list, one per line, nothing else. Do not use tools.'

# The instructions: asked by their title and by the environment layer's heading, which no other file has.
env=${1:-}
if [ -z "$env" ]; then
  if [ "$(uname)" = Darwin ]; then env=macos; elif [ "$(id -un)" = pitobox ]; then env=pitobox; fi
fi
[ -n "$env" ] && [ -f "$root/instructions/$env.md" ] || {
  echo "check-load: name the environment, one of instructions/<env>.md (macos, pitobox, …)" >&2
  exit 2
}
title=$(sed -n '1s/^# *//p' "$root/instructions/AGENTS.md")
layer=$(sed -n '1s/^## *//p' "$root/instructions/$env.md")
said() { # <key> <heading> <harness> <command...>: yes / no / ? into $tmp/<harness>.<key>
  key=$1 heading=$2 h=$3
  shift 3
  command -v "$h" >/dev/null 2>&1 || return
  q="Does any instruction or context file you were given contain the heading \"$heading\"? Answer only yes or no."
  # Only a bare yes or no counts: "Not logged in" must read as "could not ask", not as "no".
  a=$("$@" "$q" 2>/dev/null | sed '/^[[:space:]]*$/d' | tail -n 1 | tr '[:upper:]' '[:lower:]' | tr -cd '[:lower:]')
  case $a in
    yes | no) echo "$a" ;;
    *) echo "?" ;;
  esac >"$tmp/$h.$key"
}
for k in instructions layer; do
  if [ "$k" = instructions ]; then heading=$title; else heading=$layer; fi
  said "$k" "$heading" opencode opencode run
  said "$k" "$heading" claude claude -p
  said "$k" "$heading" omo omo -p --no-tools
  said "$k" "$heading" omp omp -p --max-cost=0.3
done
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
answers() { # <label> <key>: one row of yes / NO / ? / -
  printf '%-28s' "$1"
  for h in $harnesses; do
    if [ -f "$tmp/$h.missing" ]; then
      mark="-"
    else
      case $(cat "$tmp/$h.$2" 2>/dev/null) in
        yes) mark="yes" ;;
        no)
          mark="NO"
          status=1
          ;;
        *) mark="?" ;;
      esac
    fi
    printf '%-10s' "$mark"
  done
  echo
}
answers "(instructions)" instructions
answers "(environment: $env)" layer
echo "(- : not installed here; ? : could not ask, e.g. not logged in)"
exit $status
