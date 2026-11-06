# builder-skills

The Tito agent: its instructions and its skills, the same on a developer's machine and in Tito.
[`instructions/AGENTS.md`](instructions/AGENTS.md) is the agent's global instructions (how it works in any
repository, how it proposes options). The skills are folders with a `SKILL.md` in the open
[Agent Skills](https://agentskills.io/specification) format, so any harness that reads that format can load them.

| Skill | Use it when |
|---|---|
| [`base-repo-standard`](skills/base-repo-standard/SKILL.md) | every repository, any language, public or private: Renovate on the shared preset, Dependabot alerts, SHA-pinned actions and read-only permissions, mise-pinned gitleaks/actionlint/zizmor/shellcheck/osv-scanner as CI checks and a gitleaks pre-commit |
| [`javascript-repo-standard`](skills/javascript-repo-standard/SKILL.md) | creating, adopting or reviewing a JavaScript/TypeScript repository's tooling: Bun, a pinned Biome, a pre-commit hook that never commits unstaged edits, CI that refuses unformatted code, Turborepo in a workspace |
| [`python-repo-standard`](skills/python-repo-standard/SKILL.md) | the same for Python: uv, a pinned Ruff, the same hook guarantees, CI |
| [`public-repo-standard`](skills/public-repo-standard/SKILL.md) | a repository that is public or about to be: hooks that refuse secrets and personal data before anything is pushed, GitHub push protection, a CI history scan, CodeQL, a `SECURITY.md` with private vulnerability reporting |
| [`readme-standard`](skills/readme-standard/SKILL.md) | writing or rewriting a package's README: welcome first (banner, badges, pitch, features, a quick start that compiles), depth moved into `docs/`, neutral example names |
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
not installed, and exits 1 if one misses a skill or the instructions. `?` means the harness could not answer (e.g.
Claude Code not logged in). Run it after installing, renaming or adding a skill, or changing the
instructions' links.

## Install

```bash
git clone https://github.com/pitolabs/builder-skills.git ~/pitolabs/builder-skills
for s in ~/pitolabs/builder-skills/skills/*/; do
  ln -sfn "${s%/}" ~/.config/opencode/skills/"$(basename "$s")"
done
ln -sfn ~/pitolabs/builder-skills/instructions/AGENTS.md ~/.config/opencode/AGENTS.md   # OpenCode, OmO, omp
ln -sfn ~/pitolabs/builder-skills/instructions/AGENTS.md ~/.claude/CLAUDE.md            # Claude Code
sh ~/pitolabs/builder-skills/scripts/check-load.sh
```

`~/.config/opencode/skills` is the personal skill folder here; `~/.agents/skills` and
`~/.claude/skills` are links to it, so every harness above sees one copy. Without those links, link
each skill into each harness's folder. Move an existing `AGENTS.md` or `CLAUDE.md` aside before linking (anything
machine-specific in it has no place in the shared instructions). Remove an older copy of a skill before linking it.
The audits need [Bun](https://bun.com), [uv](https://docs.astral.sh/uv/) and [mise](https://mise.jdx.dev)
(`brew install mise`).

Update with `git -C ~/pitolabs/builder-skills pull`. Never edit the clone itself.

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
base checks (gitleaks, actionlint, zizmor, shellcheck, osv-scanner) and the privacy scan.

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
