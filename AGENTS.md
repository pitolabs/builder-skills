# AGENTS.md

## Tests that edit a template asset

Renovate bumps the version pins inside `skills/*/assets/` (pytest, ruff, …). A test that adapts an asset for its
fixture must not match those pins literally: a `.replace` that no longer matches changes nothing, and the test then
fails somewhere unrelated (ruff 0.17.5, November 2026: `setup.sh failed … os error 2`, because pre-commit was never
added). Edit through a helper that ignores versions and throws when it changed nothing, as `withPreCommit` in
`test/python-repo-standard.test.ts` does, and give the helper a pure-string test with other pins.

Proof: `bun test test/python-repo-standard.test.ts`.

## Instructions: sources and built files

Harnesses read `instructions/<env>/AGENTS.md` (laptops link `macos`, every PitoBox links `pitobox` on its own), built
by `scripts/instructions.ts` from `instructions/AGENTS.md` plus the layer `instructions/<env>.md`. Edit only the
sources and rebuild in the same commit. A rule that names a path, a tool or an app of one machine goes in that
machine's layer; one that holds everywhere goes in `AGENTS.md`. A layer starts with `## Environment: <name>`:
`scripts/check-load.sh` asks each harness for that heading. Renaming or removing a layer breaks the links on every
machine of that environment (a PitoBox then runs without instructions), so add the new one first and move the links.

Proof: `bun test test/instructions.test.ts`, then `sh scripts/check-load.sh` on the machine.
