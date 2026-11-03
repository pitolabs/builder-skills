---
name: audit-python-project
description: >-
  Use when creating, adopting or reviewing a Python repository (pyproject.toml, requirements*.txt
  or .py sources at its root), or when asked to set up or check its tooling: 'audit this repo',
  'does it follow our standard', 'set up uv/Ruff/the pre-commit hook/CI', 'migrate from pip or
  requirements.txt to uv', 'why did the hook commit my unstaged change'. Runs a script that checks
  behaviour in a fresh copy (uv with a committed uv.lock and .python-version, a pinned Ruff run
  only from .venv, a pre-commit hook that never commits unstaged edits, CI that refuses
  unformatted code) and fixes what fails in a worktree. Do NOT use for JavaScript/TypeScript
  repositories (audit-javascript-project), or for a one-off formatting run.
---

# Audit a Python project

Every Python repository follows one standard, so any of them can be picked up and worked on the
same way. The script checks it; this file says how to read the result and fix it. It is the
JavaScript standard's counterpart: uv where that one has Bun, Ruff where it has Biome.

| Rule | Why |
|---|---|
| **uv** manages packages and Python: `pyproject.toml`, `uv.lock` and `.python-version` committed; no Poetry/Pipenv/PDM files; a `requirements.txt` only as `uv export` output | one tool, fast installs, the same interpreter and lockfile everywhere |
| **Ruff** formats and lints, pinned (`ruff==x.y.z` in a dependency group), run only through `scripts/ruff.sh` | `uvx ruff`/`uv tool run ruff`/`pipx run ruff` fetch the newest Ruff; `uv run ruff` and a bare `ruff` fall back to whatever is on PATH when the project lacks it |
| `scripts/setup.sh` after a clone: `uv sync --frozen` and turns the hook on | uv has no install-time hook like npm's `prepare`; this is the one command the README names |
| The pre-commit hook formats staged files and never commits an unstaged edit | a formatter that re-stages a whole file commits what you had not staged (cases `AM`, `MM`, `RM`) |
| CI: `uv sync --frozen`, `ruff format --check`, `ruff check` (no `--fix`), tests | the hook can be skipped (`--no-verify`); CI cannot |

Any hook manager is fine if it behaves. The plain `.githooks/` script in `assets/` formats and
commits. The `pre-commit` framework (tested, with a `repo: local` hook calling `scripts/ruff.sh`)
never commits unstaged edits but refuses a file it reformatted, leaving a re-add to the person:
the audit reports that as `WARN`, not `FAIL`. Keep what the project already uses when it passes.

## Run the audit

```bash
uv run <this skill>/scripts/audit.py <repo> --ref origin/main   # what is on main
uv run <this skill>/scripts/audit.py <repo> --working-tree      # your uncommitted fix
```

With no flag it audits the committed `HEAD`. Every check reads one snapshot, copied to a temporary
directory; the repository is never touched. It needs the network (`scripts/setup.sh` in the copy).
Exit 0: every required check passes; 1: something fails; 2: bad usage. `--json` for a machine
report, `--no-behavior` to skip setup and the hook tests. Without a `pyproject.toml` it still runs
every other check, so one report lists the whole migration.

Each line is `PASS`, `FAIL`, `WARN` or `SKIP` with a `fix:`. `FAIL` breaks the standard; `WARN`
is a gap worth fixing (no tests in CI, unpinned direct dependencies) but not a blocker.

The behaviour checks put a fake `ruff` first on PATH (if anything runs it, the repo would run any
Ruff), run `sh scripts/setup.sh`, look for an active pre-commit hook, then commit probe files: an
unformatted one (must end up formatted, or be refused), `AM`, `MM` and `RM` (staged, then edited
again: the edit must not be committed), and a staged file next to an unrelated unstaged edit.

## Fix what fails

1. Work in a worktree from the latest main (the global rule): `git worktree add ../<repo>-tooling -b tooling origin/main`.
2. Fix with the `fix:` lines. The files in `assets/` are tested starting points: `pyproject.toml`
   (dependency group, `[tool.ruff]`), `.python-version`, `scripts/ruff.sh`, `scripts/setup.sh`,
   `.githooks/pre-commit`, `ci.yml`. Adapt them; do not paste over a config the project tuned.
3. `uv run <this skill>/scripts/audit.py . --working-tree` until it passes, then one formatting
   commit (`sh scripts/ruff.sh format .`, listed in `.git-blame-ignore-revs`) and the tests.
4. Commit, push, and audit once more with `--ref origin/main`.

**From requirements.in/requirements.txt (pip, pip-tools, `uv pip compile`) to a uv project:**
`uv init --bare`, `uv add -r requirements.in` (the direct dependencies, keeping their pins),
`uv python pin <the version production runs>`, `uv add --dev ruff==<version> pytest==<version>`,
`[tool.uv] package = false` for an application. Then change every installer: the Dockerfile
(`uv sync --frozen --no-dev`, or `uv export --frozen --no-dev -o requirements.txt` if the image
must stay on pip), CI and docs. Compare `uv tree` with the old file before deleting it.

## Traps seen in practice

- `uv run ruff` with Ruff missing from the project runs the `ruff` on PATH: it looks pinned and is not.
- A hook that splits `$staged` on spaces breaks on paths with spaces; the asset says so. If the repo
  has such paths, use a hook manager that passes file lists safely (pre-commit, Lefthook).
- Auditing the main checkout audits its `HEAD`, which may be behind: pass `--ref origin/main`.
