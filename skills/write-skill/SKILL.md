---
name: write-skill
description: >-
  Use when authoring, reviewing or fixing an agent skill (SKILL.md) — 'create a skill
  for X', 'turn this into a skill', 'why isn't my skill triggering', 'review this
  SKILL.md', 'improve this skill's trigger or structure'. Covers the
  description-as-trigger mechanism, progressive disclosure across SKILL.md and
  references/, the draft→test→iterate loop, frontmatter that every loader accepts, and
  where skills live so OmO, OpenCode and Claude Code all see them. Adapted from
  Anthropic's upstream skill-creator, minus its Python scripts, browser eval-viewer and
  .skill packaging. Do NOT use to decide where an observed lesson belongs — AGENTS.md,
  an existing skill, a new skill, or nowhere — or to write an AGENTS.md rule (that is
  capture-lessons); nor for OpenCode's own config such as agents, MCP servers or
  permissions (the built-in opencode skill).
---

# Write a skill

A skill is **instructions an agent loads on demand**. That framing decides everything else:
the description is a trigger rather than a summary, the body is a recurring token cost, and
detail belongs in files that load only when needed.

Upstream reference: [Anthropic's `skill-creator`](https://github.com/anthropics/skills/tree/main/skills/skill-creator)
and the [authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
Read them when this skill does not cover your case — but skip their Python scripts, browser
eval-viewer, `claude -p` optimizer and `.skill` packaging: OmO, OpenCode and Claude Code
all load a skill straight from its folder, so there is nothing to build or package.

## First: should this be a skill at all?

| Shape | Home |
|---|---|
| "When X, always Y" — a rule, one or two lines | `AGENTS.md` (nearest one that covers the paths) |
| A multi-step procedure with decisions in it | a skill |
| A trap plus the procedure for avoiding it | `AGENTS.md` gets the one-line warning; skill gets the procedure |
| Behaviour an existing skill already triggers on | extend that skill |
| OpenCode's own config — agents, MCP, permissions | the built-in `opencode` skill |

A single command or invariant is never a skill. `capture-lessons` owns the full routing
decision and its evidence bar; use it when the question is "where does this lesson go".

## Where the skill lives

Pick the scope first; it decides the path.

| Scope | Path | Who sees it |
|---|---|---|
| Shared, public: how we build applications and repositories | `skills/<name>/` in [`pitolabs/builder-skills`](https://github.com/pitolabs/builder-skills) (git repo; change it in a worktree, push, then `git pull` in the clone) | every machine that cloned it and linked the skill into the personal folder below; nothing private (hosts, people, keys) |
| Personal / all projects | `~/.config/opencode/skills/<name>/` (local folder, not a git repo) | OmO via `~/.agents/skills`, Claude Code via `~/.claude/skills`, OpenCode directly — both are symlinks to this folder, so write it once here |
| One project | that repo's existing skill folder — `.agents/skills/` in new repos, `.opencode/skills/` where the repo already uses it | tools that read that folder; a committed `.claude/skills` symlink to it covers Claude Code |

Follow the layout a repo already has rather than adding a second skill folder. A builder-skills skill reaches the
tools as a symlink `~/.config/opencode/skills/<name>` → the clone's `skills/<name>` (its README says how).
`~/.config/opencode/skills-local/` is **not** read by any tool — a skill put there never fires.

## The three levels

Everything follows from what loads when:

1. **`name` + `description`** — always in every prompt, for every session. This is the
   trigger, and the only part that is always paid for.
2. **SKILL.md body** — loads when the skill fires. Keep under 500 lines.
3. **`references/*.md`** — loads only when the body points the agent at it. Effectively
   unlimited.

The practical consequence: **detail is cheap in `references/`, expensive in the body, and
very expensive in the description.**

## The description is the trigger

It is the primary mechanism deciding whether your skill ever fires, and the most common
reason a good skill goes unused. It must carry:

- **What** the skill does.
- **When** to use it — concrete phrases a person would actually type, not abstractions.
- **When NOT to** — the negative triggers. Name the adjacent skills it should defer to.

Write in **third person**; it is injected into the system prompt, where "I can help you…"
reads wrong. Be slightly pushy: agents under-trigger skills far more often than they
over-trigger them. Stay under **1024 characters** — the Agent Skills limit.

```yaml
description: >-
  Use when turning a Markdown file into a styled PDF — 'export this as PDF', 'make a
  PDF of the README'. Covers the md-to-pdf CLI, stylesheet and page options. Do NOT use
  for slide decks (marp) or for filling in an existing PDF form.
```

All "when to use" information lives **here**, not in a body section — the body only loads
*after* the trigger decision has already been made, so a "When to use this skill" heading in
the body is dead weight.

### Frontmatter that every loader accepts

OmO parses frontmatter as strict YAML and **silently drops a skill it cannot parse** —
OpenCode and Claude Code may still load it, so the breakage only shows in one tool. The
usual cause is an unquoted description containing `: ` (e.g. `Trigger phrases: ...`).
Use a folded block (`description: >-`, as above) or a quoted string, and check the skill
appears in all three tools after writing it (see [Test the load](#test-the-load)).

## Structure

```text
<skills-dir>/<skill-name>/
├── SKILL.md          # required; frontmatter + body
└── references/       # optional; loaded on demand
    └── <topic>.md
```

- Folder name is kebab-case and **must match** the `name` field.
- **References stay one level deep.** Every reference links directly from SKILL.md — an
  agent previewing a nested chain may read only part of it.
- **Reference files over 100 lines open with a table of contents**, so a partial read still
  shows the full scope.
- No `README.md` inside a skill folder.

## Writing the body

- **Imperative voice.** "Validate the scope before writing", not "the scope should be
  validated".
- **Explain why.** A rule with a reason survives the edge case the rule did not anticipate;
  a bare MUST does not. If you are writing ALWAYS or NEVER in caps, try reframing as the
  consequence instead — reserve the absolutes for the two or three places where the failure
  is genuinely unrecoverable.
- **Say what breaks.** "returns zero rows silently" is what makes a rule stick.
- **Concrete over abstract.** Real commands, real paths, real payloads.
- **No duplication between SKILL.md and references/.** Information lives in exactly one
  place. Procedural guidance in the body; detail, schemas and worked examples in references.
- **Checklists earn their place in complex workflows** — the upstream guidance explicitly
  recommends one the agent can copy and tick off. Do not add one to a three-step skill.
- **Cite, don't copy.** Never inline a version, a region map, a cron table, a file
  inventory, or a count of what exists today — name the file or give the command that
  regenerates the answer. A skill that restates the project's `AGENTS.md` will drift out of
  sync with it.

## Draft → test → iterate

A skill that has never been run is untested design:

1. **Draft** the skill from a real task you just did, not an imagined one.
2. **Write 2–3 realistic test prompts** — what someone would genuinely type, with the mess
   included: file paths, half-remembered names, lowercase, a bit of backstory. Show them to
   the requester before running: "do these look right?"
3. **Run each prompt in a subagent**, via `task(..., load_skills=["<skill-name>"])`. In the
   same batch, run the same prompt with `load_skills=[]` as a baseline — if the two outputs
   match, the skill is not adding anything. Skills a subagent does not load stay out of its
   context, which is what makes the comparison meaningful. **In a worktree, `load_skills`
   and the `skill` tool resolve to the main checkout's copy, not your draft** — the output's
   `Base directory:` line shows which. Test a draft with `load_skills=[]`, telling the
   subagent to Read the worktree's `SKILL.md` path, follow it, and not call `skill` —
   otherwise both copies land in its context. The baseline stays `load_skills=[]` with no
   read.
4. **Read the transcripts, not just the outputs.** Where did it stall, re-derive something
   the skill should have supplied, or ignore a section? If every run independently wrote the
   same helper, that helper belongs in the skill.
5. **Revise and repeat** until the feedback stops changing.

### Test the trigger separately

Triggering fails independently of content. Check both directions:

- **Should fire:** several phrasings of the same intent, including ones that never name the
  skill or its nouns.
- **Should NOT fire:** the near-misses. Adjacent work that shares vocabulary — for `marp`,
  that is "make a PDF of this markdown" and "review my slide notes". Obvious negatives
  ("write a fibonacci function") test nothing.

If it under-triggers, the fix is almost always the description, not the body.

### Test the load

A skill that one tool fails to load never fires there, and nothing warns you. After
writing or renaming one, confirm each tool lists it:

```bash
opencode reload && opencode api GET /api/skill | jq -r '.data[].id'        # OpenCode
claude -p x --output-format stream-json --verbose \
  | jq -c 'select(.subtype=="init") | .skills'                            # Claude Code
omo -p --no-tools 'List every <name> in your <available_skills>.'          # OmO
```

## Reviewing an existing skill

Run this against the file before shipping or when a skill is not pulling its weight.

**Trigger**
- [ ] Description states what it does *and* when, in third person, under 1024 chars
- [ ] Concrete trigger phrases someone would actually type
- [ ] Negative triggers name the adjacent skills
- [ ] Tested on near-miss prompts that must NOT fire it

**Structure**
- [ ] Folder name matches `name`; kebab-case
- [ ] Frontmatter parses as strict YAML; skill listed by every tool that should load it
- [ ] SKILL.md under 500 lines
- [ ] References one level deep, each linked from SKILL.md with a note on when to read it
- [ ] Reference files over 100 lines have a table of contents
- [ ] No `README.md` in the skill folder

**Content**
- [ ] Imperative voice
- [ ] Explains why, not only what
- [ ] Nothing duplicated between SKILL.md and references/
- [ ] No restated `AGENTS.md` content, versions, crons, inventories or counts
- [ ] No "when to use this skill" section in the body (it belongs in the description)
- [ ] Examples are concrete
- [ ] Every internal link and anchor resolves

**Evidence**
- [ ] Run on at least two realistic prompts
- [ ] Compared against a no-skill baseline
- [ ] Transcripts read, not just final outputs

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
|---|---|---|
| Description that summarises instead of triggering | Never fires; the body is irrelevant | State what *and* when, with real phrases |
| Unquoted `: ` in the description | One loader drops the skill silently | `description: >-` or quote it |
| "When to use this skill" section in the body | Loads only after the trigger decision | Move it into the description |
| Everything in one long SKILL.md | Pays full token cost on every trigger | Push detail into `references/` |
| Restating `AGENTS.md` | Two copies drift; the skill wins by proximity and is wrong | Link it |
| A count or inventory ("the two importers") | Stale the moment a third arrives | Give the `ls` that answers it |
| Documenting one existing implementation | Teaches a sample, not the space | Teach the forms; use implementations as illustrations |
| Absolutes everywhere | The one real constraint is lost among nine fake ones | Reserve them; explain the rest |
| Shipping untested | Untested design, not a skill | Two prompts and a baseline, minimum |
