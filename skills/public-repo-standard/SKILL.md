---
name: public-repo-standard
description: >-
  Use ONLY for keeping secrets and personal data out of a repository that is public or about to
  be made public: 'make this repo public', 'check this public repo for leaks', 'protect it from
  pushing personal data', 'set up gitleaks/push protection', 'did we publish a token or a phone
  number', 'my commits show my e-mail'. Runs an audit script that tests the protections in a
  fresh copy (pre-commit and pre-push hooks scanning with a pinned gitleaks, personal-data rules,
  a noreply identity check and a private blocklist; GitHub secret scanning and push protection;
  a CI history scan as backstop) and scans the whole published history; fixes what fails in a
  worktree. NOT for private repositories that stay private, and NOT for rotating a leaked
  credential (do that first, at the provider).
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

`privacy-scan.sh` runs three checks, and none of them prints what it matched:

1. **gitleaks**, pinned (`scripts/gitleaks.sh` downloads the release once and checks its sha256), with
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

It needs `bun`, `git`, `gh` (logged in; `--offline` skips the GitHub checks) and the network on
first use (the gitleaks download). The hook tests run on a snapshot in a temporary directory: they
activate the hooks the way a clone does (`scripts/setup.sh`, else `bun install`, else
`core.hooksPath .githooks`), then commit generated leaks (a GitHub token, a phone number, an e-mail
address, a random blocklist entry) and push them to a throwaway bare remote: one in an earlier
commit than the last, the same commits on a new branch, a commit authored with a personal e-mail,
and a blocklist entry that only a merge's conflict resolution introduces. Every case must be
refused, and the output must not show the blocklist entry. The history scan reads the repository
itself, read-only, with your real lists: origin's branches as of the last fetch (what is public),
or every local ref when nothing has been pushed yet.

## Fix what fails

1. Work in a worktree from the latest main (the global rule).
2. Copy from `assets/`: `scripts/gitleaks.sh`, `scripts/privacy-scan.sh`, `.gitleaks.toml`,
   `.githooks/pre-push`; put `sh "$(git rev-parse --show-toplevel)/scripts/privacy-scan.sh" --staged`
   **first** in the existing pre-commit hook (or copy `assets/.githooks/pre-commit` if there is none);
   add the job in `assets/ci-privacy.yml`. With Husky or Lefthook, call the same two scripts from
   their pre-commit and pre-push.
3. GitHub: `gh api -X PATCH repos/<owner>/<repo> --input -` with
   `{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}`,
   and `gh secret set PRIVACY_BLOCKLIST --repo <owner>/<repo> < ~/.config/privacy/blocklist.txt`.
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
- A pre-push hook that scans only the last commit (`git show`, `HEAD~1..HEAD`) lets a leak through
  when a clean commit sits on top of it, and a new branch has no remote sha to diff against. The
  asset scans `<remote sha>..<local sha>`, or `<local sha> --not --remotes` for a new branch.
- `git log -p` shows no diff for a merge commit, so a token or a name typed while resolving a
  conflict reaches no scanner that reads `git log -p` (gitleaks' `git` mode included). The asset
  adds `--diff-merges=first-parent` to both its gitleaks and its blocklist scans.
- Binary files (PDFs, images) are not scanned: gitleaks and the blocklist read text. A scanned
  document or a photo with location metadata needs a human look before it is committed.
- Do not put production tokens in the CI secret: a compromised workflow could read every secret
  the repository has. Exact secret values go in `local-only.txt`, which never leaves the machine.
