---
name: javascript-repo-standard
description: >-
  Use when creating, adopting or reviewing a JavaScript/TypeScript repository (a package.json at
  its root), or when asked to set up or check its tooling: 'audit this repo', 'does it follow
  our standard', 'set up Bun/Biome/the pre-commit hook/CI', 'migrate from npm to Bun', 'add
  Turborepo to this monorepo', 'why did the hook commit my unstaged change'. Runs a script that
  checks behaviour in a fresh copy (Bun as package manager, a pinned Biome run only from
  node_modules, a pre-commit hook that never commits unstaged edits, CI that refuses unformatted
  code, Turborepo in a workspace) and fixes what fails in a worktree. Do NOT use for Python
  repositories (python-repo-standard), or for a one-off formatting run.
---

# JavaScript repo standard

Every JavaScript/TypeScript repository follows one standard, so any of them can be picked up and
worked on the same way. The script checks it; this file says how to read the result and fix it.

| Rule | Why |
|---|---|
| **Bun** is the package manager: `bun.lock` committed, `"packageManager": "bun@x.y.z"`, no other lockfile, CI installs with `bun install --frozen-lockfile` | one tool, fast installs, a lockfile everyone and CI share |
| Exact versions (`bunfig.toml`: `[install] exact = true`) | the same Biome, TypeScript and turbo on every machine |
| **Biome** formats and lints, run only through `scripts/biome.sh` | `bunx`/`npx biome` download an unrelated npm package named `biome`; `npm exec`, a bare `biome` and `bun run biome` fall back to whatever Biome is on PATH, at another version |
| A pre-commit hook, turned on by `bun install` | staged files are committed formatted |
| The hook never commits an unstaged edit | a formatter that re-stages a whole file commits what you had not staged (cases `AM`, `MM`, `RM`) |
| CI runs a check-only Biome command (`biome ci`), typecheck and tests | the hook can be skipped (`--no-verify`); CI cannot |
| A workspace (`"workspaces"` in package.json) uses **Turborepo** | cached, ordered tasks across packages |

Any hook manager is fine if it behaves: the plain `.githooks/` script in `assets/`, Husky +
lint-staged, or Lefthook with `stage_fixed: true` all pass the behaviour checks (tested). Keep
what the project already uses when it passes; do not swap it for the asset.

## Run the audit

```bash
bun <this skill>/scripts/audit.ts <repo> --ref origin/main   # what is on main
bun <this skill>/scripts/audit.ts <repo> --working-tree      # your uncommitted fix
```

With no flag it audits the committed `HEAD`. Every check reads one snapshot, copied to a temporary
directory; the repository is never touched. It needs the network (`bun install` in the copy).
Exit 0: every required check passes; 1: something fails; 2: bad usage. `--json` for a machine
report, `--no-behavior` to skip the install and hook tests.

Each line is `PASS`, `FAIL`, `WARN` or `SKIP` with a `fix:`. `FAIL` breaks the standard; `WARN`
is a gap worth fixing (linter off, ranges in dependencies, no tests in CI) but not a blocker.

What the behaviour checks do, so a failure can be reproduced by hand:

- puts a fake `biome` first on PATH; if any script or the hook runs it, `biome.pinned-only` fails;
- runs every Biome script before `bun install` (they must fail, not fall back to PATH);
- runs `bun install --frozen-lockfile`, then looks for an active pre-commit hook;
- commits probe files: one unformatted file (must end up formatted or refused), then `AM`, `MM`
  and `RM` (staged, then edited again: the edit must not be committed), then a staged file next to
  an unrelated unstaged edit (the edit stays out).

## Fix what fails

1. Work in a worktree from the latest main (the global rule): `git worktree add ../<repo>-tooling -b tooling origin/main`.
2. Fix with the `fix:` lines. The files in `assets/` are tested starting points: `scripts/biome.sh`,
   `.githooks/pre-commit`, `biome.json`, `bunfig.toml`, `package.json` (scripts and `prepare`),
   `ci.yml`, `turbo.json`. Adapt them; do not paste over a config the project tuned.
3. `bun <this skill>/scripts/audit.ts . --working-tree` until it passes, then `bun run format`
   (one formatting commit, listed in `.git-blame-ignore-revs`), typecheck and tests.
4. Commit, push, and audit once more with `--ref origin/main`.

**From npm (or pnpm/yarn) to Bun:** `bun install` (it reads the old lockfile and writes
`bun.lock`), `git rm package-lock.json`, add `packageManager`, and replace `npm ci`/`npm run`/`npx`
in CI, the Dockerfile, scripts and docs (`bun install --frozen-lockfile`, `bun run`, `bun x` only
for tools that are dependencies). Run the tests under Bun before deleting the old lockfile.

**Into a Turborepo workspace:** `bun add -d -E turbo`, `turbo.json` from `assets/` with the
repo's real tasks and outputs, root scripts as `turbo run <task>`, `.turbo` in `.gitignore`, and
internal dependencies as `"workspace:*"`.

## Traps seen in practice

- `biome migrate --write` (2.6) rewrites `"rules": { "recommended": true }` as `"preset": "none"`,
  which turns every lint rule off. The default preset is `recommended`: write `"linter": { "enabled": true }`.
- Bun does not run dependencies' lifecycle scripts (only the root package's, and those in its
  trusted list). A hook manager that installs itself from `postinstall` must be called from the root
  `prepare` (`"prepare": "husky"`, `"prepare": "lefthook install"`).
- A repository that ships Biome configs as templates must exclude them (`"!skills/*/assets"`),
  or Biome stops with "Found a nested root configuration".
- Auditing the main checkout audits its `HEAD`, which may be behind: pass `--ref origin/main`.
