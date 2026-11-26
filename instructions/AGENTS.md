# Tito agent: instructions

These are the agent's global instructions, the same on a developer's machine, in a remote development container and
in Tito: what holds in every environment. They live in `instructions/AGENTS.md` of
[builder-skills](https://github.com/pitolabs/builder-skills), which is public. A machine may add a section of its own
after them (where things are, what that machine has and lacks, how these instructions reach it), kept in a private
repository; when it does, that section is the last one here and says where it comes from. Change these shared
instructions in a worktree of builder-skills, never in the file a harness reads.

## Skills

Skills live in `~/.config/opencode/skills/<skill-name>/SKILL.md` (YAML frontmatter `name`, `description` saying when
to use it), loaded by OpenCode, OmO, omp and Claude Code. Those from builder-skills are symlinks into its clone (where
it is: your machine's section, if any); change them in a worktree of builder-skills, never through the link.

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
- Read-only investigation (reading code, logs, running nothing that writes) needs no worktree. But a checkout you
  only read may be behind `origin`, and so is the `AGENTS.md` loaded from it: `git fetch origin` and read from
  `origin/<default-branch>` (`git show origin/main:<file>`, `git log origin/main`) before answering from it, and
  never say something is not in a repository before checking there.
- A repository's own AGENTS.md may add setup steps (e.g. which install turns on its hooks); it does not lift this rule.

## Repository standard

Every repository follows `base-repo-standard` (Renovate on the shared `pitolabs/renovate-config` preset, Dependabot
alerts, SHA-pinned actions with read-only permissions, the `base` CI job running the mise-pinned gitleaks, jactionlint,
zizmor, shellcheck and osv-scanner, and a gitleaks pre-commit), plus the standard for each language its projects use,
wherever they sit (a project only in a subdirectory gets a root Bun workspace or a root `pyproject.toml`):
`javascript-repo-standard` (Bun, a pinned Biome, Turborepo in a workspace) or `python-repo-standard` (uv, a pinned
Ruff), all from builder-skills. When you create or adopt a repository, or change its package manager, formatter,
pre-commit hook, CI, tool pins or Renovate config, use the matching skills and run their audits; they must pass before
you push. Do not bring in another package manager, formatter, tool manager or dependency bot. Renovate's `:automerge`
preset is part of the standard (every update but majors and re-pushed actions or release assets merges on green CI)
and requires CI that runs the repository's tests on pull requests. A repository that is public, or about to be, also
follows `public-repo-standard`. The org requires two-factor authentication for everyone.

Actions minutes in private repositories are paid (GitHub Free includes $12 a month for the whole org), so CI there
runs only when it has to. Renovate acts only on Monday and Tuesday (UTC), with the updates that merge themselves in
one PR per repository: on other days it leaves its PRs alone, so do not wait for one to merge (its rebase checkbox
acts at once); `default.json` and `automerge.json` in `pitolabs/renovate-config` decide this. Every workflow of a
private repository that runs on `pull_request` has a workflow-level `concurrency:` that cancels the run a newer push
supersedes (the block is in base-repo-standard, step 4); a new workflow gets it too. Proof:
`bun ~/.config/opencode/skills/base-repo-standard/scripts/audit.ts <repo> --working-tree` (check `ci.concurrency`).

When you write a script (a tool, a helper an image runs, anything beyond a few lines of shell), write it in TypeScript
run by Bun, not Python. Exception: inside an image that already ships Node, use that Node when it runs the script
(test it with that image's `node`: older versions and non-erasable syntax fail), so the image gets no second runtime.

## Names in English

Everything a program reads is named in English: URL paths and API endpoints, query and body fields, file and folder
names, package names, environment variables, database tables and columns, storage keys, identifiers and code comments.
What a person reads (interface text, prompts, messages, generated documents) is in the product's language.
A new name is English from the start. An existing name in another language is renamed when the change that touches it
can also migrate what depends on it (stored data, links people hold); until then it stays whole: never translate half
of a path.

## A mechanism change carries its AGENTS.md

When a change adds or alters something later work must keep in sync — a test that gates merges, a deploy flow, a CI
job, a fixture or mock other code must extend, a convention — the nearest `AGENTS.md` covering it is part of the
deliverable, in the same commit or PR: what exists and where, the rule a later change must obey ("a new agent needs a
scenario in …"), and the command that proves it. A plan lists this as a step with the text to add; it is not
documentation cleanup for afterwards. Do not restate what code or CI already says; name the file that decides. An
`AGENTS.md` that still describes the old flow is a rule the next agent executes.

## Public repositories: nothing personal, nothing internal

Some repositories are public, builder-skills among them, and so are these instructions (`gh repo view <owner>/<repo>
--json visibility` says which). A push there publishes at once, on any branch, and a later fix leaves it in the
history. The privacy hooks of `public-repo-standard` refuse known secret formats and the exact strings on the personal
blocklist; they do not see what a person did or how our systems are built. That judgement is yours:

- **Nothing about a person:** names, contacts, what someone bought, searched for, said, earns or suffers from, where
  they live or work, whose session something happened in. A lesson from a session goes in as the rule and a neutral
  example ("a session sat 36 minutes on …"), never as the story (who, what they were doing, the date).
- **Nothing internal:** host names and addresses, where secrets and keys are kept, the names and interfaces of private
  tools and services, how servers and containers are locked down, backup schedules. They belong in the `AGENTS.md` of
  the private repository that owns them.
- Examples use neutral names (`example.com`, `<dev>`, `my-app`).
- Before committing to a public repository, read the staged diff once against this list, as you would for a secret.
  Something already pushed: remove it in a new commit and tell the developer; rewriting public history is their call.

## Scripts that call tools: every `await` must settle

A harness that runs code you write with tools inside it (OpenCode's `execute` script, an eval cell) waits for every
`await` in it, and the turn shows "running" until the script ends: one promise that never settles holds the session
until someone stops it, and nothing reports an error (seen: a session sat 36 minutes on `await new Promise(r=>r)`,
written before its tool calls, which never ran).

- Every `await` is a tool call or a promise that settles by itself. Never a placeholder, a `new Promise` whose
  executor never calls `resolve`/`reject`, or a wait for an event nothing will send. To pause, use a bounded timer:
  `await new Promise((r) => setTimeout(r, ms))`.
- A wait the tool itself does not bound gets its own timeout: `Promise.race` with a `setTimeout` that rejects.
- Before you send a script, read it once for an `await` that does not belong there.
- A script running longer than its tool calls should: look at what it waits on (the server's processes or logs, the
  script's code) before you blame the server or wait more.

## Websites that block automation: CloakBrowser

A site that refuses an automated browser, or sits behind bot protection (a challenge page, a CAPTCHA wall, an empty
page or an "access denied" where a person gets content), is opened in
[CloakBrowser](https://github.com/CloakHQ/CloakBrowser): a Chromium with source-level fingerprint patches, driven over
CDP like any Chromium. Use its latest release (the free license always downloads the newest build). Every launch
needs a license key; a free key allows one session at a time, so stop the browser when the task is done to release it.
How to start it and where its key is: your machine's section. Static pages and APIs do not need it: read them directly.

## Obsidian vaults synced by LiveSync

A vault has several copies (phone, Mac, server volumes) that LiveSync keeps in step through CouchDB. LiveSync has no
version check, so two writers of one file can lose an edit: write a change on one copy only, never the same change by
hand on another, and after editing check that the other copy received it. When your copy syncs, and where it is:
your machine's section.

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
