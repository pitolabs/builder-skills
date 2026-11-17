# builder-skills

The Tito agent: its instructions and its skills, the same on a developer's machine and in Tito.
[`instructions/`](instructions/) is the agent's global instructions (how it works in any repository, how it proposes
options): `AGENTS.md` holds what holds everywhere, `macos.md` and `pitobox.md` what holds only on a developer's Mac or
only in a PitoBox (Pito Labs' remote developer container), and `bun scripts/instructions.ts` joins them into
`instructions/macos/AGENTS.md` and `instructions/pitobox/AGENTS.md`, the files the harnesses read. The skills are
folders with a `SKILL.md` in the open [Agent Skills](https://agentskills.io/specification) format, so any harness that
reads that format can load them.

| Skill | Use it when |
|---|---|
| [`base-repo-standard`](skills/base-repo-standard/SKILL.md) | every repository, any language, public or private: Renovate on the shared preset, Dependabot alerts, SHA-pinned actions and read-only permissions, mise-pinned gitleaks/jactionlint/zizmor/shellcheck/osv-scanner as CI checks and a gitleaks pre-commit |
| [`javascript-repo-standard`](skills/javascript-repo-standard/SKILL.md) | creating, adopting or reviewing a JavaScript/TypeScript repository's tooling: Bun, a pinned Biome, a pre-commit hook that never commits unstaged edits, CI that refuses unformatted code, Turborepo in a workspace |
| [`python-repo-standard`](skills/python-repo-standard/SKILL.md) | the same for Python: uv, a pinned Ruff, the same hook guarantees, CI |
| [`public-repo-standard`](skills/public-repo-standard/SKILL.md) | a repository that is public or about to be: hooks that refuse secrets and personal data before anything is pushed, GitHub push protection, a CI history scan, CodeQL, a `SECURITY.md` with private vulnerability reporting |
| [`readme-standard`](skills/readme-standard/SKILL.md) | writing or rewriting a package's README: welcome first (banner, badges, pitch, features, a quick start that compiles), depth moved into `docs/`, neutral example names |
| [`typst-pdf`](skills/typst-pdf/SKILL.md) | turning a Markdown report, proposal or contract into a print-quality PDF with a pinned Typst: cover, contents, header, "Página X de Y", hyphenated pt-BR text, tables |
| [`capture-lessons`](skills/capture-lessons/SKILL.md) | harvesting lessons from a session and deciding where each belongs (AGENTS.md, a skill, an ADR, nowhere) |
| [`write-skill`](skills/write-skill/SKILL.md) | writing, reviewing or fixing a skill |

The four standards run an audit script (`scripts/audit.ts`, `scripts/audit.py`) that checks
behaviour in a fresh copy of the repository, not file names: any hook manager or layout passes if
it does the right thing. Their `assets/` are tested starting points for what fails.

## Works in

| Harness | Reads skills from | Reads the instructions from | Checked by `scripts/check-load.sh` with |
|---|---|---|---|
| [OpenCode](https://opencode.ai) | `~/.config/opencode/skills/` | `~/.config/opencode/AGENTS.md` | `opencode api GET /api/skill`; `opencode run`, asked for the instructions' title |
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | `~/.claude/skills/` | `~/.claude/CLAUDE.md` | the `init` event of `claude -p --output-format stream-json`; `claude -p` (needs a login) |
| [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO) | `~/.agents/skills/` | `~/.config/opencode/AGENTS.md` | `omo -p`, asked for its skill list and the title |
| [omp](https://github.com/can1357/oh-my-pi) | `~/.claude/skills/`, `~/.agents/skills/`, `~/.config/opencode/skills/` (its discovery providers) | `~/.config/opencode/AGENTS.md` (its OpenCode provider) | `omp -p`, asked for its skill list and the title |
| any other Agent Skills client | its own skills folder | its own global instructions file | link them there; CI checks every `SKILL.md` against the format's rules |

```text
$ sh scripts/check-load.sh
skill                       opencode  claude    omo       omp
base-repo-standard          yes       yes       yes       yes
capture-lessons             yes       yes       yes       yes
javascript-repo-standard    yes       yes       yes       yes
public-repo-standard        yes       yes       yes       yes
python-repo-standard        yes       yes       yes       yes
write-skill                 yes       yes       yes       yes
(instructions)              yes       yes       yes       yes
(- : not installed here; ? : could not ask, e.g. not logged in)
```

It asks each installed harness in a fresh process (a running session keeps what it read at start), skips the ones
not installed, and exits 1 if one misses a skill, the instructions or the environment layer (`macos` on macOS,
`pitobox` in a box; name it as the first argument elsewhere). `?` means the harness could not answer (e.g. Claude Code
not logged in). Run it after installing, renaming or adding a skill, or changing the instructions' links.

## Install

```bash
git clone https://github.com/pitolabs/builder-skills.git ~/pitolabs/builder-skills
for s in ~/pitolabs/builder-skills/skills/*/; do
  ln -sfn "${s%/}" ~/.config/opencode/skills/"$(basename "$s")"
done
ln -sfn ~/pitolabs/builder-skills/instructions/macos/AGENTS.md ~/.config/opencode/AGENTS.md   # OpenCode, OmO, omp
ln -sfn ~/pitolabs/builder-skills/instructions/macos/AGENTS.md ~/.claude/CLAUDE.md            # Claude Code
sh ~/pitolabs/builder-skills/scripts/check-load.sh
```

`~/.config/opencode/skills` is the personal skill folder here; `~/.agents/skills` and
`~/.claude/skills` are links to it, so every harness above sees one copy. Without those links, link
each skill into each harness's folder. Move an existing `AGENTS.md` or `CLAUDE.md` aside before linking (what is
specific to one machine goes in that environment's layer). Remove an older copy of a skill before linking it.
The audits need [Bun](https://bun.com), [uv](https://docs.astral.sh/uv/) and [mise](https://mise.jdx.dev)
(`brew install mise`).

Update with `git -C ~/pitolabs/builder-skills pull --ff-only`. Never edit the clone itself.

A PitoBox installs itself: its entrypoint keeps a clone in `~/.local/share/pitobox/builder-skills` at the latest
`main` and links `instructions/pitobox/AGENTS.md` and the skills (`box/sync-builder-skills.sh` in pitobox).

## Change the instructions

Edit `instructions/AGENTS.md` (every environment) or one layer (`instructions/<env>.md`, which starts with
`## Environment: <name>`), never a built file, then `bun scripts/instructions.ts`; `bun test test/` fails while a built
file is stale. A new environment is a new layer, a link to `instructions/<env>/AGENTS.md` on its machines, and its
name in `test/instructions.test.ts`.

## Change a skill

In a worktree from the latest main, so the clone the tools read stays clean:

```bash
git -C ~/pitolabs/builder-skills fetch origin
git -C ~/pitolabs/builder-skills worktree add ../builder-skills-<task> -b <task> origin/main
cd ../builder-skills-<task> && sh scripts/setup.sh   # bun install, uv sync, mise install, turns on the hooks
bun test test/                                          # fixture repositories, all four audits
```

This repository follows its own four standards (all four audits pass on it). Then push the branch
and open a pull request, or push to `main`; CI runs formatting, lint, typecheck, the tests, the
base checks (gitleaks, jactionlint, zizmor, shellcheck, osv-scanner) and the privacy scan.

## Keeping personal data out

This repository is public, so nothing personal may reach it, and a push publishes whatever it
carries, on any branch. The protections are the ones in `public-repo-standard`:

- **before the push, on your machine:** the pre-commit hook scans the staged changes and the
  pre-push hook scans every outgoing commit (`scripts/privacy-scan.sh`): the mise-pinned gitleaks with
  secret and personal-data rules, a check that every author and committer e-mail is a GitHub
  noreply address, and your private lists in `~/.config/privacy/` (`blocklist.txt`: names, phone
  numbers, e-mail addresses; `local-only.txt`: exact secret values). The lists live outside the
  repository and their entries are never printed. Without `blocklist.txt` the hooks refuse to run;
  an empty file is fine.
- **on GitHub, before it accepts the push:** secret scanning with push protection (known token
  formats).
- **after the push, as a backstop:** the `privacy` CI job scans the whole history with the
  blocklist from the `PRIVACY_BLOCKLIST` secret. It reports a leak; by then the commit is public.

Set your commit e-mail to your noreply address in this repository before committing:
`git config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"`.

## License

Apache License 2.0 ([LICENSE](LICENSE)). `write-skill` is adapted from Anthropic's
[skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator), Apache 2.0.
