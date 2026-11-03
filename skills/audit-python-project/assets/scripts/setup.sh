#!/bin/sh
# One command after cloning: installs the locked environment (Python, dependencies, Ruff) and turns on the
# pre-commit hook. uv has no install-time hook like npm's "prepare", so this script is the entry point the README names.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
uv sync --frozen
git config core.hooksPath .githooks
