---
name: public-repo-standard
description: >-
  Use ONLY for the extra protections of a repository that is public or about to be made
  public: 'make this repo public', 'check this public repo for leaks', 'protect it from
  pushing personal data', 'set up gitleaks/push protection', 'did we publish a token or a phone
  number', 'my commits show my e-mail', 'add a security policy', 'turn on CodeQL'. Runs an audit
  script that tests the protections in a fresh copy (pre-commit and pre-push hooks scanning with
  the mise-pinned gitleaks, personal-data rules, a noreply identity check and a private
  blocklist; GitHub secret scanning and push protection; a CI history scan as backstop; CodeQL
  default setup; SECURITY.md with private vulnerability reporting) and scans the whole published
  history; fixes what fails in a worktree. NOT for what every repository gets, public or not
  (base-repo-standard), and NOT for rotating a leaked credential (do that first, at the
  provider).
---

# Public repo standard

A push to a public repository publishes every commit it carries, on any branch, and a pull request
does too. CI runs after that, so it can only report a leak, not stop it. What keeps data private
is what runs **before** the push:

| Layer | When | Catches | Role |
|---|---|---|---|
| `pre-commit` hook: `scripts/privacy-scan.sh --staged` | `git commit` | the staged changes | catches it early |
| `pre-push` hook: the same scan over **every** outgoing commit | `git push`, before anything leaves | everything about to be published, commits made with `--no-verify` included | **the barrier** |
| GitHub secret scanning + push protection | on GitHub, before it accepts the push | known token formats only | server-side barrier for tokens |
| CI job: `privacy-scan.sh --history` | after the push | anything a machine without the hooks pushed; new rules on old history | backstop |
| CodeQL default setup (free on public repositories) | every push | injection and dataflow bugs in TS/Python and in workflows | backstop |
| `SECURITY.md` + private vulnerability reporting | always | gives reporters a private channel (OSPS Baseline VM-02/VM-03) | contact |

`privacy-scan.sh` runs three checks, and nothing it prints shows a list entry: gitleaks redacts the secrets it finds,
and every line of output (file names, gitleaks' `File:` and `Fingerprint:` lines, e-mail addresses) has list entries
replaced by `***`, since a file may be named after a person and an author e-mail may be an entry:

1. **gitleaks**, pinned in `mise.toml` (from base-repo-standard; mise checks the download against `mise.lock`), with
   its secret rules plus `.gitleaks.toml`'s personal-data rules: Brazilian phone numbers, e-mail
   addresses (not example domains or GitHub noreply), IPv4 outside loopback and documentation ranges,
   and `/Users/<name>/` or `/home/<name>/` paths.
2. **Identities**: every author and committer e-mail must be a GitHub noreply address
   (`<id>+<login>@users.noreply.github.com`). Gitleaks reads file contents, not commit headers, so it
   cannot catch an e-mail published there.
3. **Private lists**, kept outside every repository and matched as exact text:
   `~/.config/privacy/blocklist.txt` (personal data: family names, phone numbers, group ids,
   e-mail addresses; uploaded as the `PRIVACY_BLOCKLIST` CI secret) and
   `~/.config/privacy/local-only.txt` (exact secret values; never uploaded anywhere, CI included).
   Matches are reported as "blocklist entry 7", never as the text.

## Run the audit

```bash
audit=~/.config/opencode/skills/public-repo-standard/scripts/audit.ts
bun "$audit" <repo>                      # HEAD's hooks + GitHub settings + the whole published history
bun "$audit" <repo> --working-tree       # your uncommitted fix
```

It needs `bun`, `git`, `mise`, `gh` (logged in; `--offline` skips the GitHub checks) and the network on
first use (the gitleaks download). The hook tests run on a snapshot in a temporary directory: they
activate the hooks the way a clone does (`scripts/setup.sh`, else `bun install`, else
`core.hooksPath .githooks`), then commit generated leaks (a GitHub token, a phone number, an e-mail
address, a random blocklist entry) and push them to a throwaway bare remote: one in an earlier
commit than the last, the same commits on a new branch, a commit authored with a personal e-mail,
the entry in a file name and as an author e-mail, and a blocklist entry that only a merge's conflict
resolution introduces (each also staged alone at commit time). Every case must be
refused, and the output must not show the blocklist entry. The history scan reads the repository
itself, read-only, with your real lists: origin's branches as of the last fetch (what is public),
or every local ref when nothing has been pushed yet.

## Fix what fails

1. Work in a worktree from the latest main (the global rule).
2. Copy from `assets/`: `scripts/privacy-scan.sh`, `.gitleaks.toml`, `.githooks/pre-push`, `SECURITY.md`, and
   `mise.toml` + `mise.lock` from base-repo-standard (they pin gitleaks); put `sh "$(git rev-parse --show-toplevel)/scripts/privacy-scan.sh" --staged`
   **first** in the existing pre-commit hook (or copy `assets/.githooks/pre-commit` if there is none);
   add the job in `assets/ci-privacy.yml`. With Husky or Lefthook, call the same two scripts from
   their pre-commit and pre-push.
3. GitHub: `gh api -X PATCH repos/<owner>/<repo> --input -` with
   `{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}`,
   `gh secret set PRIVACY_BLOCKLIST --repo <owner>/<repo> < ~/.config/privacy/blocklist.txt`,
   `gh api -X PUT repos/<owner>/<repo>/private-vulnerability-reporting` (the channel `SECURITY.md` names), and
   `gh api -X PATCH repos/<owner>/<repo>/code-scanning/default-setup --input - <<< '{"state":"configured"}'` (CodeQL).
4. Identity: `git config user.email <id>+<login>@users.noreply.github.com` in the repository
   (`gh api user --jq .id`), so new commits pass.
5. Audit again with `--working-tree`, commit, push (the new pre-push hook runs), audit once more.

**If the history already carries something**, the fix cannot be a new commit: the old one stays
public. Rotate any secret at its provider first. Then rewrite the commits (`git filter-repo`, or
`git rebase -i` for a few recent ones), force-push every affected branch, and ask GitHub Support to
remove cached views of the old commits. Forks and clones made in between keep the data. That is
why the hooks matter more than the backstop.

## Traps seen in practice

- Gitleaks never looks at author or committer e-mails; a personal e-mail in every commit header
  passes gitleaks and is published anyway. The identity check exists for this.
- A blocklist entry that is the owner's own public name (the author name on every commit) refuses
  every push. Keep the owner's public identity out of the list.
- Commits GitHub makes for you (the test merge of a pull request, a merge, squash or rebase done on GitHub, a web
  edit) record you with your GitHub e-mail setting, not your git config: with "Keep my email addresses private" off
  (github.com/settings/emails), a rebase merge keeps the noreply author but records your primary e-mail as committer,
  and `gh pr merge --author-email` refuses the noreply address. Turn the setting on before merging on GitHub, or
  merge locally: push the pull request's tested head to `main` (`git push origin origin/<branch>:main`, a
  fast-forward); GitHub records the pull request as merged, also under a ruleset that requires pull requests and
  checks, and the commits keep your git identity. The CI job checks out a pull request's own commits, not its test
  merge. Renovate's merges carry its bot identity, committed by `GitHub <noreply@github.com>`.
- A pre-push hook that scans only the last commit (`git show`, `HEAD~1..HEAD`) lets a leak through
  when a clean commit sits on top of it, and a new branch has no remote sha to diff against. The
  asset scans `<remote sha>..<local sha>`, or `<local sha> --not --remotes` for a new branch.
- `git log -p` shows no diff for a merge commit, so a token or a name typed while resolving a
  conflict reaches no scanner that reads `git log -p` (gitleaks' `git` mode included). The asset
  adds `--diff-merges=first-parent` to both its gitleaks and its blocklist scans.
- A scanner that names the file or the e-mail it refused prints the entry whenever the entry *is*
  the file name or the e-mail (`exam-<name>.pdf`), and a public repository's CI log is public. The
  asset masks every line it prints, gitleaks' report included.
- Binary files (PDFs, images) are not scanned: gitleaks and the blocklist read text. A scanned
  document or a photo with location metadata needs a human look before it is committed.
- Do not put production tokens in the CI secret: a compromised workflow could read every secret
  the repository has. Exact secret values go in `local-only.txt`, which never leaves the machine.
