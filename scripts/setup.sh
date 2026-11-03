#!/bin/sh
# One command after cloning: the locked Bun and Python environments, and the pre-commit hook (bun install's
# "prepare" turns it on).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
bun install --frozen-lockfile
uv sync --frozen
