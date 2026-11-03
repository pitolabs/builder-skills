# Capture-lessons examples

Read when candidate selection or the wording of a rule is uncertain.

## Signals that generate candidates

| Signal | What it looks like |
|---|---|
| Developer correction | The user redirected the agent or supplied a fact it could not infer |
| Blind search | 3+ materially different searches, or the answer sat somewhere non-obvious |
| Wrong direction shipped | A false assumption reached code, a test, a migration, or a PR |
| Plausible-but-wrong result | Empty/successful output that looked valid — wrong store, id, stage, or database |
| Mock/real mismatch | A mock or test accepted what the real DB, provider, or runtime rejects |
| Hidden prerequisite | Success needed an undocumented cwd, profile, generated artifact, or ordering |
| Identity trap | Two plausible names/ids/stages/tables meant different things |
| Repeat offence | The same misunderstanding twice in-session, or visible again in `git log` |
| Guidance proved false | A loaded rule told the agent to do X and X was wrong or harmful — a REPLACE/DELETE candidate, no friction needed beyond the contradiction itself |

## What belongs where

The proposal is the only thing the user reads. Keep it that way:

- **Numbered entry** — an edit you want applied. Nothing else gets a number.
- **`Considered, no change` line** — one clause per rejected candidate, after
  the question. It exists so over-capture is visible, not so it gets read.
- **Candidate fields from Step 1** (`Surface`, `Counterfactual`) — working
  notes. They shape the rule; they do not appear in the proposal.

## Rule wording — BAD / GOOD

Story, names and chronology belong in the evidence line; the rule keeps only
the transferable invariant, what fails, and where the truth lives.

Examples below use a generic web/data stack; substitute your repo's own paths
and identifiers.

```text
BAD   During PR #1324 we spent ages on wrong query results. Dana found the
      column was naive UTC but the session had another timezone. Agents should
      be careful with timezones.
GOOD  Compare instants only after normalizing both operands to UTC. Never
      compare a naive-UTC column against a session-dependent value such as
      `CURRENT_TIMESTAMP` — the mismatch returns wrong rows without raising.

BAD   Prod and staging are in eu-west-2, personal dev stages are in sa-east-1,
      PR stages are eu-west-2. Use the right region.
GOOD  Never hard-code a deploy stage's cloud region. The stage→region map in
      `<the module that owns it>` is the source of truth.

BAD   Docs-only PRs skip CI, so there is nothing to wait for.
      (CI behaviour is owned by the workflow files and changes without this
      line changing — it was already false when captured.)
GOOD  Follow root `AGENTS.md`'s merge rules; do not infer skipped checks from
      file extensions.
```

## Sizing a root edit

A lesson that fits root is two lines of invariant plus a pointer; the mechanism
goes to the skill that owns the procedure.

```text
TOO BIG   Eight lines explaining how staging deploys coalesce, what a
          "superseded" run means, how merge batching causes it, and what to
          check.
RIGHT     When verification depends on a deploy, confirm the running stage
          carries *your* commit — a merged PR or a green deploy is not evidence.
          <the skill that owns the deploy check> owns the check.
```

## A complete proposal

Two edits and three rejects, as the user sees it. Note the proportions: the
rejects cost three lines total, below the question.

````markdown
### 1. REPLACE — resolve the integration-test DB URL, never hardcode it
`<db-package>/AGENTS.md` § Integration tests · +2/−1
Because: every new integration test against this package — the wrong target
passes green against the CI tunnel, so the suite proves nothing.
Evidence: ses_…/msg_… — "connected to localhost:5432 and the assertions ran
against the CI tunnel to the shared cluster"
```diff
-- Use `DATABASE_URL` from the environment.
+- Resolve the URL with `getDatabaseUrl()`, even for a raw client —
+  `localhost:5432` is a live tunnel to the shared cluster in CI, not a local
+  container.
```

### 2. DELETE — "run `<cli> secret list` to check alerting config"
`<service>/AGENTS.md` § Alerting · +0/−3
Because: any agent checking alert config leaks every stage secret into its
transcript. The command prints plaintext values.
Evidence: the cited command's documented behaviour contradicts this rule
```diff
-To check whether alerting is configured, run `<cli> secret list` and look
-for `AlertWebhookUrl`. If it is missing, set it with `<cli> secret set` and
-redeploy.
```

**Apply which? (all / none / e.g. 1,3)**

**Considered, no change:** `npx <codegen>` — looked like a toolchain trap worth
pinning → gate 2, root `AGENTS.md` § Toolchain already forbids `npx` and was
loaded; the analytics store returned zero rows for a valid record — looked like
an identity trap → gate 2, root `AGENTS.md` § id mapping owns it; the service
image doubled in size unnoticed → passed the gates, but Step 3 names no future
task it changes — the fix is a size check, not a rule.
````
