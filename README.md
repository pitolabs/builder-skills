# builder-skills

Agent skills for building applications and repositories the same way every time. They load in
OpenCode, oh-my-openagent (OmO) and Claude Code.

| Skill | Use it when |
|---|---|
| [`javascript-repo-standard`](skills/javascript-repo-standard/SKILL.md) | creating, adopting or reviewing a JavaScript/TypeScript repository: Bun, a pinned Biome, a pre-commit hook that never commits unstaged edits, CI that refuses unformatted code, Turborepo in a workspace |
| [`python-repo-standard`](skills/python-repo-standard/SKILL.md) | the same for Python: uv, a pinned Ruff, the same hook guarantees, CI |
| [`capture-lessons`](skills/capture-lessons/SKILL.md) | harvesting lessons from a session and deciding where each belongs (AGENTS.md, a skill, an ADR, nowhere) |
| [`write-skill`](skills/write-skill/SKILL.md) | writing, reviewing or fixing a skill |

The two audits run a script (`scripts/audit.ts`, `scripts/audit.py`) that checks behaviour in a
fresh copy of the repository, not file names: any hook manager or layout passes if it does the
right thing. Their `assets/` are tested starting points for what fails.

## Install

```bash
git clone https://github.com/pitolabs/builder-skills.git ~/pitolabs/builder-skills
for s in ~/pitolabs/builder-skills/skills/*/; do
  ln -sfn "${s%/}" ~/.config/opencode/skills/"$(basename "$s")"
done
```

`~/.config/opencode/skills` is the personal skill folder; OmO (`~/.agents/skills`) and Claude
Code (`~/.claude/skills`) link to it. Remove an older copy of a skill there before linking it.
The audits need [Bun](https://bun.com) and [uv](https://docs.astral.sh/uv/).

Update with `git -C ~/pitolabs/builder-skills pull`. Never edit the clone itself.

## Change a skill

In a worktree from the latest main, so the clone the tools read stays clean:

```bash
git -C ~/pitolabs/builder-skills fetch origin
git -C ~/pitolabs/builder-skills worktree add ../builder-skills-<task> -b <task> origin/main
cd ../builder-skills-<task> && sh scripts/setup.sh   # bun install, uv sync, turns on the hook
bun test test/                                          # builds fixture repositories, runs both audits
```

This repository follows its own two standards (both audits pass on it). Then push the branch
and open a pull request, or push to `main`; CI runs formatting, lint, typecheck and the tests.

## License

Apache License 2.0 ([LICENSE](LICENSE)). `write-skill` is adapted from Anthropic's
[skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator), Apache 2.0.
