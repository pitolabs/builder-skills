# AGENTS.md

## This repository is public

Everything here is published, the instructions included, and the history keeps what a later commit removes. The rule
is the section "Public repositories: nothing personal, nothing internal" of `instructions/AGENTS.md`: no person, what
they did or when; no host, secret location, private tool or how a server is locked down. What one machine needs
(paths, installed tools, where repositories go) is not shared either: it lives in a private repository, which adds it
after `instructions/AGENTS.md` on that machine. Here goes only what holds everywhere. The privacy hooks catch secrets
and blocklisted strings only: read the staged diff yourself before committing.

## Tests that edit a template asset

Renovate bumps the version pins inside `skills/*/assets/` (pytest, ruff, …). A test that adapts an asset for its
fixture must not match those pins literally: a `.replace` that no longer matches changes nothing, and the test then
fails somewhere unrelated (ruff 0.17.5, November 2026: `setup.sh failed … os error 2`, because pre-commit was never
added). Edit through a helper that ignores versions and throws when it changed nothing, as `withPreCommit` in
`test/python-repo-standard.test.ts` does, and give the helper a pure-string test with other pins.

Proof: `bun test test/python-repo-standard.test.ts`.

## Instructions: one shared file

`instructions/AGENTS.md` is read on every machine, either linked as is or with a private section appended after it
(the title must stay its first line: `scripts/check-load.sh` asks each harness for it, and a machine's own section is
checked with `sh scripts/check-load.sh "<its heading>"`). Nothing here may describe one machine; when a shared rule
needs a machine's detail, it says "your machine's section" instead.

Proof: `sh scripts/check-load.sh` on the machine.
