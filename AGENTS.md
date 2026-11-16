# AGENTS.md

## Tests that edit a template asset

Renovate bumps the version pins inside `skills/*/assets/` (pytest, ruff, …). A test that adapts an asset for its
fixture must not match those pins literally: a `.replace` that no longer matches changes nothing, and the test then
fails somewhere unrelated (ruff 0.17.5, November 2026: `setup.sh failed … os error 2`, because pre-commit was never
added). Edit through a helper that ignores versions and throws when it changed nothing, as `withPreCommit` in
`test/python-repo-standard.test.ts` does, and give the helper a pure-string test with other pins.

Proof: `bun test test/python-repo-standard.test.ts`.
