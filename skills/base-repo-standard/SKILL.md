---
name: base-repo-standard
description: >-
  Use for the defaults every repository gets, whatever its language and whether it is public
  or private: Renovate on the shared pitolabs/renovate-config preset, Dependabot alerts,
  SHA-pinned actions with read-only workflow permissions, the mise-pinned gitleaks, jactionlint,
  zizmor, shellcheck and osv-scanner run as CI checks, a gitleaks pre-commit hook, baselines
  that expire - 'set up a new repo', 'add Renovate to this repo', 'is Renovate running here',
  'pin the actions', 'CI says zizmor/osv-scanner failed', 'enable automerge', 'install the
  check tools'. Runs an audit script that tests it in a fresh copy and fixes what fails in a
  worktree. NOT for the package manager, formatter or tests (javascript-repo-standard,
  python-repo-standard), NOT for personal data in a public repo (public-repo-standard), NOT for
  bumping one dependency by hand, NOT for PitoRouter's CLIProxyAPI bump
  (update-cliproxyapi-version).
---

# Base repo standard

Every repository follows this standard, then the one for its language (`javascript-repo-standard`,
`python-repo-standard`), then `public-repo-standard` if it is public. The script checks it; this file says how to read
the result and fix it.

| Rule | Why |
|---|---|
| `renovate.json` extends `local>pitolabs/renovate-config` | one dependency policy for every repository, changed in one place (the preset repository's README says what it sets) |
| `renovate.json` also extends `local>pitolabs/renovate-config:automerge`, and CI runs the repository's tests on pull requests | patch, pin and digest-pin updates of dependencies at 1.0 or later and the weekly lockfile refresh merge themselves on green CI, so PRs do not pile up; green CI means something only if the tests run on the PR |
| Dependabot alerts on | GitHub's advisory feed; Renovate reads it (`vulnerabilityAlerts`) and opens the fix at once, outside its schedule and hourly limit |
| Workflows: top-level `permissions: contents: read`, every `uses:` a commit SHA with a `# vX.Y.Z` comment, `persist-credentials: false` on checkouts | a compromised step gets a read-only token; a tag can be moved to other code, a SHA cannot; a persisted token sits in `.git/config` for every later step |
| `mise.toml` pins gitleaks, jactionlint, zizmor, shellcheck and osv-scanner; `mise.lock` holds each download's sha256 per platform | the same binaries on every machine and in CI; a download that differs from the lock fails instead of running |
| CI's `base` job runs the four `check:` tasks (below) | the hook can be skipped and a machine may lack mise; CI cannot be skipped |
| A pre-commit hook runs gitleaks on the staged changes | a secret is refused before it is a commit; on GitHub Free, private repositories have no secret scanning or push protection |
| Accepted findings expire: `osv-scanner.toml` ignores carry a date at most 90 days ahead and a reason | an ignore without an end date is a check switched off for good |
| The organization requires two-factor authentication | the one org-level prerequisite (OpenSSF OSPS Baseline AC-01.01); a stolen password alone then opens no repository |

The checks, each a task in `mise.toml` (`mise run check` runs all four):

| Task | Tool | Catches |
|---|---|---|
| `check:secrets` | gitleaks over every commit (`.gitleaks.toml` adds rules when present) | a token or key anywhere in the history |
| `check:workflows` | jactionlint's `correctness` profile (what actionlint checks: syntax, expressions, runner labels, action inputs, shellcheck on `run:` steps), then zizmor | workflow errors, unquoted shell, template injection, unpinned actions, write permissions, persisted credentials, known-vulnerable actions (online) |
| `check:shell` | shellcheck on tracked `*.sh` and `.githooks/*` | quoting and portability bugs in scripts |
| `check:vulns` | osv-scanner over every lockfile | known vulnerabilities, transitive ones included, in `bun.lock` and `uv.lock` too (GitHub's dependency graph reads neither) |

## Run the audit

The script and `assets/` sit next to this SKILL.md; installed as the builder-skills README says, that is
`~/.config/opencode/skills/base-repo-standard/`.

```bash
audit=~/.config/opencode/skills/base-repo-standard/scripts/audit.ts
bun "$audit" <repo> --ref origin/main   # what is on main
bun "$audit" <repo> --working-tree      # your uncommitted fix
```

It needs `bun`, `git`, `mise` (`brew install mise`) and `gh` (logged in; `--offline` skips the GitHub settings), and
the network. With no flag it audits the committed `HEAD`, copied to a temporary directory; the repository is never
touched. Exit 0: every required check passes; 1: something fails; 2: bad usage. `--json` for a machine report,
`--no-behavior` to skip the runs below. Each line is `PASS`, `FAIL`, `WARN` or `SKIP` with a `fix:`.

What the behaviour checks do, so a failure can be reproduced by hand:

- `mise install` in the copy, then `mise run check:workflows`, `check:shell` and `check:vulns` there (zizmor offline:
  `ZIZMOR_OFFLINE=true`; CI runs its online audits);
- gitleaks over the repository's own history, read-only: origin's branches and the audited commit, what CI scans;
- turns the hooks on the way a clone does (`scripts/setup.sh`, else `bun install`, else `core.hooksPath .githooks`),
  commits a clean file (must go through: a hook that refuses everything proves nothing), then a generated GitHub
  token (must be refused).

The GitHub checks: Dependabot alerts on, an open Dependency Dashboard issue by Renovate (it has run), and the
organization's 2FA requirement.

## Fix what fails

1. Work in a worktree from the latest main (the global rule).
2. Copy from `assets/`:
   - `mise.toml` (keep tools the repository already pins there) and `renovate.json` (it extends `:automerge`: the
     audit fails until CI runs the repository's tests on pull requests, so add them first);
   - `.githooks/pre-commit`, or its two lines first in an existing hook. A public repository's
     `privacy-scan.sh --staged` line already runs the same scan: nothing to add there;
   - `scripts/setup.sh` only for a repository with neither a `package.json` (its `prepare` sets `core.hooksPath`)
     nor python-repo-standard's `scripts/setup.sh`; in that one, add `mise install`.
3. `mise lock --platform linux-x64,macos-arm64` and commit `mise.lock`. Never edit it by hand.
4. CI: paste the job in `assets/ci-base.yml` into `.github/workflows/ci.yml`, add top-level
   `permissions: contents: read` to every workflow (grant writes per job), and pin every `uses:` to a SHA:
   `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`, keeping the tag as a `# vX.Y.Z` comment.
5. `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts`.
6. `mise run check`, then deal with each finding:
   - **osv-scanner:** update the dependency (a transitive one: refresh the lockfile). When it has to wait, an
     `osv-scanner.toml` in the lockfile's own directory (osv-scanner reads only that one: a root file does not cover
     `infra/bun.lock`) with a dated ignore:

     ```toml
     [[IgnoredVulns]]
     id = "GHSA-xxxx-xxxx-xxxx"
     ignoreUntil = 2026-12-05 # at most 90 days ahead
     reason = "transitive via @pulumi/pulumi; weekly lockFileMaintenance PR pending"
     ```

   - **zizmor:** fix the workflow; a finding that is accepted goes in `.github/zizmor.yml` under
     `rules.<rule>.ignore`, with a comment saying why (zizmor has no expiry, so the audit lists them).
   - **gitleaks:** rotate the secret at its provider first. Then rewrite the commits, or add the finding's
     fingerprint to `.gitleaksignore`: the history keeps the old value, so only a dead one may stay.
7. `bun "$audit" . --working-tree` until it passes; commit, push, audit once more with `--ref origin/main`.

**Bumping a tool:** Renovate's `mise` manager opens the PR. By hand: edit the version in `mise.toml`, run the
`mise lock` line above, commit both.

## Renovate

The preset extends Renovate's `config:best-practices`, which pins Docker images and actions by digest, sends config
migration PRs, flags abandoned packages, holds npm releases for three days and refreshes lockfiles weekly. On top, it
holds PyPI releases three days too, labels majors `major-update`, and labels digest updates (same tag, new content:
an upstream re-push) `upstream-repush` and never automerges them. Repository-specific managers and groups stay in the
repository's `renovate.json`.

**Automerge is part of the standard**, in `extends`:

- `local>pitolabs/renovate-config:automerge` (required): patch, pin and digest-pin updates of dependencies at 1.0 or
  later, and the weekly lockfile refresh, merge once CI is green, so these PRs do not pile up. It is only safe where CI
  runs the repository's tests on pull requests, so the audit fails without the tests as well as without the preset: add
  the tests to CI first. Digest updates (`upstream-repush`), minors, majors and 0.x dependencies still wait for a human.
- `local>pitolabs/renovate-config:automerge-minor` (optional, opt-in): minors too. Only where a minor cannot reach
  production unseen (e2e tests, an upstream guard).

How it runs: the Mend-hosted app runs every few hours (about 4) and automerges one PR per branch per run; the others
wait for the next run. To run it now, tick the checkbox at the bottom of the Dependency Dashboard issue.

A PR that bumps a tool in `mise.toml` may arrive without a regenerated `mise.lock`; the `base` job then fails at
`mise install --locked` (red, never an unverified binary). Check out the branch, run the `mise lock` line, push.

## Traps seen in practice

- Mend's app installed for all repositories puts each one in **Silent mode**: it scans but opens no PR and no
  dashboard. The preset sets `mode: full`; if no Dependency Dashboard issue appears after two runs, turn it off by
  hand: developer.mend.io → the repository → Settings → Dependencies → Silent mode off, Automated PRs on.
- `prHourlyLimit` (default 2) held PRs back for hours; the preset sets it to 0.
- osv-scanner exits 128 when there is no lockfile to scan; the task treats that as "nothing to scan", not a failure.
- GitHub's dependency graph does not read `bun.lock` or `uv.lock`, so Dependabot alerts cover only what
  `package.json` names directly; osv-scanner reads the lockfiles.
- Secret scanning and push protection are paid features on private repositories of a GitHub Free organization:
  the gitleaks hook and `check:secrets` are the only secret checks there.
- zizmor flags actions pinned by tag. A tag is a pointer: in March 2026, `aquasecurity/trivy-action` tags were
  re-pushed to other commits, so every workflow using them by tag ran new code. Hence SHAs, and digest updates that
  wait for a human.
- mise trusts a restored tool cache as-is, without the `mise.lock` check; hence `cache: false` on `jdx/mise-action`.
- Keep `mise.toml` to `[tools]` and `[tasks]`: `[env]`, templates or path versions make mise ask for `mise trust` in
  every clone, in CI and in the audit's copy.
- actionlint (`rhysd/actionlint`) stalled after 1.7.12 (March 2026): it does not know newer runner labels such as
  `ubuntu-26.04`, so Renovate's runner bump failed CI. jactionlint is its maintained fork; its `correctness` profile
  reported the same findings as actionlint on every pitolabs repository. The task passes `--profile correctness`,
  which wins over any config file: the default profile (what a bare `jactionlint` runs, also with an `actionlint.yaml`
  that sets no profile) adds security and policy rules, zizmor's job here plus `concurrency:` and `timeout-minutes` on
  every workflow.
- Renovate edits the file that names a version, not the source it is generated from (a `requirements.txt` exported
  from `uv.lock`, a compose file rendered by a script): the PR fails the regeneration check every time, so automerge
  never takes it, and with no such check it ships a combination CI never tested. Do not commit generated files that
  carry versions; when one must stay, add a `customManagers` regex for its source with the same `depName`, so both
  change in one PR.
- Auditing the main checkout audits its `HEAD`, which may be behind: pass `--ref origin/main`.
