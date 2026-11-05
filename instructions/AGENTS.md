# Tito agent: instructions

These are the agent's global instructions, the same on a developer's machine and in Tito. They live in
[`instructions/AGENTS.md`](https://github.com/pitolabs/builder-skills/blob/main/instructions/AGENTS.md) of
builder-skills and reach each harness as a link (the README says how): change them there, in a worktree, never through
a link.

## Skills

Skills live in `~/.config/opencode/skills/<skill-name>/SKILL.md` (YAML frontmatter `name`, `description` saying when
to use it), loaded by OpenCode, OmO, omp and Claude Code. Some are symlinks into `~/pitolabs/builder-skills` (public:
[pitolabs/builder-skills](https://github.com/pitolabs/builder-skills)); change those there, in a worktree, never
through the link.

## Git repositories: always your own worktree

Several agents work in parallel, in any repository. A shared checkout mixes their uncommitted edits: one agent's
commit or deploy then carries another's half-done work, and cleaning up one agent's changes destroys another's.
So in any git repository, before changing a file:

```bash
git fetch origin
git worktree add ../<repo>-<task> -b <task> origin/<default-branch>   # e.g. origin/main
cd ../<repo>-<task>   # then the repo's own setup (bun install, sh scripts/setup.sh, …)
```

- Edit, test, commit and deploy only from that worktree. Rebase on `origin/<default-branch>` before you deploy or
  push, so you ship the latest default branch plus your change and nothing else.
- Never edit, stash, check out, reset or clean files in a checkout you did not create (the main one included):
  what looks like leftovers may be another agent's work in progress. Read-only commands there (status, diff, log)
  are fine.
- When done: push (`git push origin <task>:<default-branch>`, or open a PR), then
  `git worktree remove ../<repo>-<task>` and delete the branch.
- Read-only investigation (reading code, logs, running nothing that writes) needs no worktree.
- A repository's own AGENTS.md may add setup steps (e.g. which install turns on its hooks); it does not lift this rule.

## Repository standard

Every JavaScript/TypeScript and Python repository follows one standard, so any of them can be picked up the same way:
`javascript-repo-standard` (Bun, a pinned Biome, Turborepo in a workspace) and `python-repo-standard` (uv, a pinned
Ruff), both from builder-skills. When you create or adopt a repository, or change its package manager, formatter,
pre-commit hook or CI, use the matching skill and run its audit; it must pass before you push. Do not bring in another
package manager or formatter. A repository that is public, or about to be, also follows `public-repo-standard`.

## Obsidian vaults synced by LiveSync

On a Mac, Obsidian's LiveSync syncs only when the Obsidian window gets focus. A file changed or deleted in the vault
by a shell or another editor stays local until then, and changes from other devices or servers arrive only then too.
After editing a vault outside Obsidian, bring Obsidian to the front (`open -a Obsidian`), then check that the other
copy changed. Don't write the other copy by hand as well: LiveSync has no version check, so two writers of one file
can lose an edit.

## Proposing solutions

When offering fixes, options or a plan:

- Label each option with a letter (A, B, C, …), so it can be referred to ("go with B"). Keep the same letter wherever
  the option appears: the table, the recommendation, later messages. Even a single option, or options in separate
  tables, get letters (the next table goes on with the next letter, never starting again at A).
- For each option, give a confidence level (%) that it solves the problem, and say what that
  number rests on: tested here, read in code or docs, or inferred.
- End with one recommendation, by its letter, its confidence, and what would raise it.
- Don't present an option below ~90% as settled when more research could raise it. Keep
  researching first.
- On a long-running task you may stop to check in before reaching that bar. If you do, say so,
  name the research that would raise confidence, and recommend continuing it rather than
  deciding now.

Example:

| Option | Confidence | Based on |
|---|---|---|
| A: raise timeout to 1800 s | 95% | reproduced and fixed locally |
| B: switch Claude to `/v1/messages` | 85% | tested on small context only |

Recommendation: B, then A as a fallback (85%). Testing B on a ~300k-token session would raise this
to ~95%; I suggest doing that before rollout.
