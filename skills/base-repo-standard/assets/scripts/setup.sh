#!/bin/sh
# One command after cloning: turns on the pre-commit hook and installs the pinned check tools (mise.toml, verified
# against mise.lock). For a repository with neither a package.json (whose "prepare" sets core.hooksPath:
# javascript-repo-standard) nor python-repo-standard's scripts/setup.sh (which sets it; add `mise install` there).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
git config core.hooksPath .githooks
mise install
