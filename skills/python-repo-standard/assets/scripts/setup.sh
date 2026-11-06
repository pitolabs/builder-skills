#!/bin/sh
# One command after cloning: installs the locked environment (Python, dependencies, Ruff), turns on the pre-commit
# hook and installs the pinned check tools (mise.toml, base-repo-standard). uv has no install-time hook like npm's
# "prepare", so this script is the entry point the README names.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# --locked, not --frozen: --frozen installs from uv.lock without checking it still matches pyproject.toml.
uv sync --locked
git config core.hooksPath .githooks
mise install
