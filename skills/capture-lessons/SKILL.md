---
name: capture-lessons
description: >-
  Use ONLY when the user explicitly asks to harvest lessons from the current or a prior session, or to decide where an observed lesson belongs — `AGENTS.md`, an existing skill, a new skill, an ADR, or nowhere. Trigger phrases include "capture lessons", "lessons learned", "what did we learn", "add this to AGENTS.md", "document this for future agents", "should this lesson be a skill", "/capture-lessons". Written for an agent-heavy team: it distills the moments where an agent searched blind, took a wrong direction, or needed a developer correction into rules that stop the next agent paying the same cost, and retires guidance the session proved false. NEVER fires on its own at task completion or on "we're done". NOT for authoring or reviewing a skill already chosen as the destination, NOT for writing text the user already dictated (just edit the file), NOT for planning (ulw-plan), NOT for acting on PR review feedback, NOT for diagnosing a live failure (debugging).
---

# Capture Lessons

## Why this exists

Every line in an `AGENTS.md` is paid for by **every future prompt** in its
scope; root `AGENTS.md` is the most expensive text in the repo. A lesson is not
"true and interesting" — it must be worth renting that space. The counterweight:
an agent that greps blind for twenty minutes, or ships a wrong solution because
a trap was undocumented, costs far more than the note that prevents it. And a
line that is *false* is worse than no line: an agent executes it, it does not
merely read it.

**Zero persisted lessons is a successful run.** Default verdict is **no change**.
Never persist more than **3** per run; report the rest as no-change.

## Step 0: Learn this repo's guidance surfaces

Before mining, find where guidance actually lives here — placement decisions in
Steps 2 and 4 depend on it, and guessing produces misplaced rules:

```bash
git ls-files -co --exclude-standard '**/AGENTS.md' '**/CLAUDE.md'
ls -d docs/decisions docs/adr .opencode/skills .claude/skills skills 2>/dev/null
```

Record three things: the `AGENTS.md` hierarchy (root plus nested), the
decision-record directory if one exists, and the skills directory. Where this
skill later names `docs/decisions/` or `.opencode/skills/`, substitute what you
found. **A surface this repo does not have is not a destination** — never create
an ADR directory or a skills tree just to file one lesson.

## Step 1: Mine the evidence

Default input is the current conversation. For a prior session, take the id
from the user; `include_todos` exposes the plan-vs-actual gap:

```text
session_list(limit: 10)
session_read(session_id: "ses_...", include_todos: true)
```

**Follow the work into child sessions.** Friction often happens inside a
`task()` subagent or a background run whose transcript is a separate session.
Follow every `ses_...` id the source conversation references; use
`session_search` when an id is missing. `session_read` shows messages but not
tool inputs or results — when the friction is in what a command returned, load
`coding-agent-sessions` to read the raw transcript. Record an unreadable or
unfinished run as an evidence gap, not as "nothing happened". Cite the source session and
message (or the PR thread), never only a parent's summary of it. Several
reports of one incident count **once**. A bot reviewer's finding is a
candidate, not a fact — verify it against the code and its disposition on the
thread before it can become a rule.

Record four fields per candidate. **If any field needs speculation to fill, it
is not a candidate.**

```text
Evidence:       session/message or PR-thread locator + a redacted quote — no secrets, tokens, or customer data
Lesson:         the generalized rule it implies
Surface:        which files/tasks meet this trap
Counterfactual: the exact action a forewarned agent would have taken instead
```

Candidates come from developer corrections, blind searches, wrong directions
that reached an artifact, plausible-but-wrong results, mock/real mismatches,
hidden prerequisites, identity traps, and repeat offences. Drop before
gating: typos; transient outages or expired credentials; ticket-specific data;
a workaround for a bug this change fixes; errors whose own message gave the
remedy; generic language, tooling or cloud advice with no repo-specific twist;
inventories owned by code or config; narration; an agent's unaccepted opinion.
If candidate selection or wording is uncertain, read
[references/examples.md](references/examples.md).

Typical honest yield is **0–3 candidates**.

## Step 2: Gates

All must pass. Name the failed gate for every candidate a gate stops.

1. **Evidence.** A concrete transcript event proves the friction. Not "this
   could have gone wrong".
2. **Novelty and truth.** Search with synonyms across every guidance surface
   found in Step 0:
   ```bash
   rg -n "<concept|command|identifier>" \
     $(git ls-files -co --exclude-standard '**/AGENTS.md') \
     <decision-records-dir> <skills-dir>
   ```
   (`-co` includes an `AGENTS.md` created but not yet staged. Drop the trailing
   paths this repo does not have.)
   Then read the hits' current source of truth. Classify the result:
   - **NO CHANGE** — already clear, current, and loaded in the failing session.
     That is agent noncompliance, not a documentation defect; do not add
     emphasis, repetition, or a second section.
   - **REPLACE** — present but stale, ambiguous, or misplaced.
   - **DELETE** — present and now false, with no true replacement needed.
   - **ADD** — absent.
   For REPLACE and DELETE, a **verified contradiction with the current source
   is sufficient evidence** — no session friction is required. Limit
   maintenance to the candidate's topic; propose a wider audit as separate work.
3. **Enforceability.** Could a type, schema constraint, validation, test, or a
   better error make this mistake impossible? If this change implements it →
   no change. If it is separate work → propose a tracked issue and keep any
   temporary warning **in that issue**, never in ambient guidance.
4. **Half-life.** Reject anything likely false or useless within ~3 months — a
   pending fix, an in-flight migration, current incident state. If a temporary
   incident revealed a **permanent invariant**, the invariant is the candidate.

## Step 3: Retention test

After the gates, propose an edit only if you can name a **future task** where
the note changes a non-obvious action and prevents material rework, repeated
friction, or serious harm. Name the recurrence evidence (ordinary workflow
surface, structural trap, seen twice, several packages expose it) or the rare
high-impact exception. Do not infer recurrence from several agents repeating
one incident. If the benefit is uncertain, no change.

Higher bars for costlier shapes: a **new skill** needs a reusable procedure
with decisions or verification in it, on a recurring surface; an **ADR** needs
a developer decision between live alternatives; **root `AGENTS.md`** needs
Step 4's veto.

Then compress: keep the **transferable rule**, discard the story.

## Step 4: Placement

**Shape decides the destination.**

- "When X, always Y" / "don't assume X; Y owns it" → **`AGENTS.md`**.
- "To do X: steps A, B, C, with branches and verification" → **a skill**.
- "We chose X over Y because…" → an **ADR** in this repo's decision-records
  directory, plus a one-line rule in `AGENTS.md` citing it. No such directory
  and no appetite to start one → keep the one-line rule and drop the ADR.
- Both a trap and a procedure → `AGENTS.md` gets the one-line warning and the
  skill trigger; the skill owns the commands. Never duplicate the procedure.

**Which `AGENTS.md`:** the **deepest file whose directory covers every path the
lesson touches.** Walk up from the affected code, stop at the first one. Never
place higher "so more agents see it" — that is the cost this skill prevents.

- Spans sibling packages → the nearest common ancestor that *has* an
  `AGENTS.md`; if that is root, prefer **two short nested notes**, or one skill
  plus a one-line trigger in each.
- No `AGENTS.md` in the right directory → create the smallest-scoped file that
  covers it. Do not broaden placement to avoid creating a file.
- **Single-package repo with only a root `AGENTS.md`:** there is no deeper file
  to prefer, so the root veto below is the whole test. A flat repo is not a
  licence to file everything at root.

**Root veto — all must hold:** it binds ≥3 distinct top-level areas or nearly
every task; an agent can violate it *before* knowing which package or skill
applies; it is a structural invariant or stable policy; not enforceable in
code; not ownable by a nested file or skill. Replace or compress related text
where possible and **justify any net root growth in the proposal**.
Naming a specific package, provider, or framework disqualifies it unless it is
purely a routing trigger.

**New skill only if** no existing skill's trigger covers the intent — otherwise
extend that skill. A single command or invariant is never a skill.

## Step 5: Draft and verify the edit

Match the surrounding file: imperative, terse, no preamble.

- **`AGENTS.md` rules: ≤10 lines per addition, target ≤3 at root**, one rule
  per bullet. Longer means it is a skill or an ADR. Skill procedures are sized
  by the procedure, not by this cap.
- Template: `When <stable condition>, <required action>. Do not <plausible
  wrong action>; <source of truth or reason>.`
- **Cite the source of truth, don't copy it.** Name the deciding
  function/constant or the command that regenerates the answer — never inline a
  list, version, region map, CI behaviour, or rename-prone path.
- **Supersede, don't append.** Replace weaker or staler nearby text; never leave
  two rules on one topic.
- Say **what fails**, not just what to do — "returns zero rows silently" is what
  makes a rule stick.
- No PR numbers, dates, names, chronology or customer data in the rule. Reject
  vague rules ("be careful with dates" is not a rule), and don't widen past
  the evidence with "always"/"never". Worked BAD/GOOD pairs:
  [references/examples.md](references/examples.md).

Before proposing, verify each draft:

- **Truth.** Read the current source (Read/Grep) for every claim; run a
  command example only when it is safe and authorised. Never promote what an
  agent merely *believed* into policy; disclose anything left unverified.
- **Dedupe** against the target, every `AGENTS.md` from it up to root, and any
  descendants that restate the topic — a parent edit can contradict a child.
- **Placement proof:** name the deepest covering file, and why no deeper one works.
- **Budget:** `+N/−M` lines for the edit; for root, also the section's size
  after the edit (keep root sections short — ~15 lines unless the repo's own
  convention says otherwise).

## Step 6: Propose, then wait

**Touch no file before approval.** Number only the edits you are proposing —
a number means "you can approve this". Everything you considered and rejected
goes in one line *after* the question, so it stays auditable without competing
for the decision:

````markdown
### 1. <ADD | REPLACE | DELETE> — <the rule, in one line>
`<path>` § <section> · +N/−M lines <(root: section now K lines)>
Because: <the future task it changes, and what fails without it>
Evidence: <session/message or PR thread + redacted quote>
```diff
-<old text>
+<new text; ADD is only + lines, DELETE only - lines>
```

**Apply which? (all / none / e.g. 1,3)**

**Considered, no change:** <lesson> — <what made it look worth capturing> →
<the gate it failed, or the Step 3 criterion it missed>; <next…>
````

One clause per rejected candidate, never a block. When existing guidance
already covers it, name that owner by path so the user can check the call.
If nothing qualifies, say **"Nothing to propose"** and show that line alone —
a run with no edits is the expected outcome, not a failure to report.

For a new skill, show the proposed `name` and `description` above its diff — a
bigger commitment than a doc line.

Then wait for the reply. Approval binds to *these* diffs: if a target file or
a proposed edit changes before application, re-present and ask again. A
todo-continuation or a subagent turn is not approval.

## Step 7: Apply and hand off

Apply only the approved items, at most **3** — if the selection names more,
ask the user to narrow it before touching anything. Then show
`git diff` plus `git diff --no-index /dev/null <new-file>` for any created
file. Re-run the Step 2 search for each applied item: ADD/REPLACE must now
resolve to the updated owner; DELETE must return no hit for the removed
guidance and no surviving duplicate. List what the user declined separately
from what you rejected — a re-run on the same session may legitimately
re-propose something the user declined, never something that was applied.

Stop there unless publication was requested. For publication, follow this
repo's own branch, issue-link and merge rules — root `AGENTS.md` owns them
where it exists. Do not infer skipped CI checks from file extensions. If a
lesson exposed follow-up **code** work, open a tracked issue for the code.
