#!/bin/sh
# Runs the Ruff pinned in uv.lock, from this checkout's .venv, and nothing else. Not `uvx ruff`/`uv tool run ruff`/
# `pipx run ruff` (they fetch whatever version is newest), and not `uv run ruff` or a bare `ruff` (both fall back to
# PATH when the project lacks Ruff, where another version may be): without `uv sync` this fails. Used by the hook
# and CI.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/.venv/bin/ruff"
if [ ! -x "$bin" ]; then
  echo "ruff: $bin is missing; run sh scripts/setup.sh (uv sync) in $root" >&2
  exit 1
fi
want=$(awk '/^\[\[package\]\]/{p=0} /^name = "ruff"$/{p=1} p && /^version = /{gsub(/"/,"",$3); print $3; exit}' "$root/uv.lock")
have=$("$bin" --version | awk '{print $2}')
if [ -z "$want" ]; then
  echo "ruff: uv.lock has no ruff; add it: uv add --dev ruff==<version>" >&2
  exit 1
fi
if [ "$want" != "$have" ]; then
  echo "ruff: .venv has $have but uv.lock pins $want; run uv sync --frozen in $root" >&2
  exit 1
fi
exec "$bin" "$@"
