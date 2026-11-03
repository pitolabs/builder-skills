#!/usr/bin/env bun
// Audits a repository that is (or is about to be) public against the builder-skills standard for keeping secrets and
// personal data out of it. Prevention is what counts, since a push publishes: a pre-commit hook and a pre-push hook
// that scan with a pinned gitleaks, personal-data rules, an identity check and a private blocklist; GitHub secret
// scanning with push protection; and, as a backstop, a CI job scanning the whole history. Checks behaviour: the hooks
// must refuse generated leaks in a fresh copy, whatever hook manager runs them.
//
//   bun audit.ts <repo> [--ref <rev> | --working-tree] [--offline] [--no-behavior] [--json]
//
// The hook tests run on one snapshot (HEAD, --ref or --working-tree) in a temporary directory. The history scan reads
// the repository itself (every ref; read-only) with the private blocklist ($PRIVACY_BLOCKLIST, default
// ~/.config/privacy/blocklist.txt). --offline skips the GitHub settings (needs `gh` and a github.com origin otherwise).
// Exit 1 if any check fails, 2 on bad usage.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type Status = "pass" | "fail" | "warn" | "skip";
interface Check {
	id: string;
	status: Status;
	detail: string;
	fix?: string;
}

const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const ref = refAt >= 0 ? args[refAt + 1] : undefined;
const repo = args.find((a, i) => !a.startsWith("--") && !(refAt >= 0 && i === refAt + 1));
const workingTree = args.includes("--working-tree");
const offline = args.includes("--offline");
const behavior = !args.includes("--no-behavior");
const asJson = args.includes("--json");
if (!repo || (refAt >= 0 && !ref) || (ref && workingTree)) {
	console.error("usage: bun audit.ts <repo> [--ref <rev> | --working-tree] [--offline] [--no-behavior] [--json]");
	process.exit(2);
}

const ASSETS = join(import.meta.dir, "../assets");
const NOREPLY = "audit@users.noreply.github.com";
const checks: Check[] = [];
const add = (id: string, status: Status, detail: string, fix?: string) => checks.push({ id, status, detail, fix });

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
	const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
	return { ok: p.exitCode === 0, out: p.stdout.toString(), err: p.stderr.toString() };
}
const git = (cwd: string, ...a: string[]) => run(["git", ...a], cwd);
const rand = (alphabet: string, n: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join("");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const root = run(["git", "rev-parse", "--show-toplevel"], repo);
if (!root.ok) {
	console.error(`${repo} is not a git repository`);
	process.exit(2);
}
const source = root.out.trim();
const tmp = mkdtempSync(join(tmpdir(), "audit-public-"));
const top = join(tmp, "repo");
const audited = snapshot();
const tracked = new Set(git(top, "ls-files").out.split("\n").filter(Boolean));
const textOf = (f: string) => {
	try {
		return readFileSync(join(top, f), "utf8");
	} catch {
		return "";
	}
};

/** Copies what is audited into `top`, as a one-commit repository; returns what it is, for the report. */
function snapshot(): string {
	mkdirSync(top);
	let label: string;
	if (workingTree) {
		for (const f of git(source, "ls-files", "-co", "--exclude-standard").out.split("\n").filter(Boolean)) {
			if (!existsSync(join(source, f))) continue;
			mkdirSync(dirname(join(top, f)), { recursive: true });
			cpSync(join(source, f), join(top, f));
		}
		label = "working tree";
	} else {
		const rev = ref ?? "HEAD";
		const sha = git(source, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`);
		if (!sha.ok) {
			console.error(`${rev} is not a commit in ${source}`);
			rmSync(tmp, { recursive: true, force: true });
			process.exit(2);
		}
		const id = sha.out.trim();
		const x = run(["sh", "-c", `git -C "$0" archive "$1" | tar -x -C "$2"`, source, id, top], source);
		if (!x.ok) throw new Error(`git archive ${rev}: ${x.err}`);
		label = `${rev} (${id.slice(0, 7)})`;
	}
	git(top, "init", "-q", "-b", "main");
	for (const [k, v] of [
		["user.email", NOREPLY],
		["user.name", "audit"],
		["commit.gpgsign", "false"],
	])
		git(top, "config", k, v);
	git(top, "add", "-A");
	git(top, "commit", "-q", "--no-verify", "-m", "audited snapshot");
	return label;
}

// --- files --------------------------------------------------------------------------------------------------------
const scanner = "scripts/privacy-scan.sh";
add(
	"files.scanner",
	tracked.has(scanner) ? "pass" : "fail",
	tracked.has(scanner) ? `${scanner} present` : `no ${scanner}`,
	"copy assets/scripts/privacy-scan.sh and assets/scripts/gitleaks.sh",
);
add(
	"files.rules",
	tracked.has(".gitleaks.toml") ? "pass" : "fail",
	tracked.has(".gitleaks.toml") ? ".gitleaks.toml present" : "no .gitleaks.toml: gitleaks has no personal-data rules",
	"copy assets/.gitleaks.toml",
);

// --- CI backstop ----------------------------------------------------------------------------------------------------
const ciFiles = [...tracked].filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
const ci = ciFiles.map(textOf).join("\n");
const history = /privacy-scan\.sh\s+--history\b/.test(ci);
const depth = /fetch-depth:\s*0\b/.test(ci);
const secret = /secrets\.PRIVACY_BLOCKLIST\b/.test(ci);
if (history && depth && secret) add("ci.history-scan", "pass", "CI scans the whole history with the blocklist secret");
else
	add(
		"ci.history-scan",
		"fail",
		`CI ${!history ? "never runs privacy-scan.sh --history" : !depth ? "checks out without fetch-depth: 0 (only the last commit)" : "does not pass secrets.PRIVACY_BLOCKLIST"}`,
		"add the job in assets/ci-privacy.yml",
	);

// --- GitHub ---------------------------------------------------------------------------------------------------------
if (offline) add("github", "skip", "--offline: GitHub settings not checked");
else githubChecks();

function githubChecks() {
	const url = git(source, "remote", "get-url", "origin").out.trim();
	const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (!m) {
		add("github", "skip", `origin is not on github.com (${url || "no origin"})`);
		return;
	}
	const slug = `${m[1]}/${m[2]}`;
	const info = run(["gh", "api", `repos/${slug}`], source);
	if (!info.ok) {
		add("github", "fail", `gh api repos/${slug} failed: ${info.err.trim().split("\n")[0]}`, "gh auth login");
		return;
	}
	const r = JSON.parse(info.out);
	add("github.visibility", "pass", `${slug} is ${r.visibility}`);
	const sa = r.security_and_analysis ?? {};
	const on = (k: string) => sa[k]?.status === "enabled";
	const enable = `gh api -X PATCH repos/${slug} --input - <<< '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}'`;
	add(
		"github.secret-scanning",
		on("secret_scanning") ? "pass" : "fail",
		`secret scanning ${on("secret_scanning") ? "on" : "off"}`,
		enable,
	);
	add(
		"github.push-protection",
		on("secret_scanning_push_protection") ? "pass" : "fail",
		`push protection ${on("secret_scanning_push_protection") ? "on: GitHub refuses pushes carrying known token formats" : "off"}`,
		enable,
	);
	const secrets = run(["gh", "api", `repos/${slug}/actions/secrets`, "--jq", ".secrets[].name"], source);
	const has = secrets.ok && secrets.out.split("\n").includes("PRIVACY_BLOCKLIST");
	add(
		"github.blocklist-secret",
		has ? "pass" : "fail",
		has ? "the PRIVACY_BLOCKLIST secret exists" : "no PRIVACY_BLOCKLIST secret: the CI scan has no blocklist",
		`gh secret set PRIVACY_BLOCKLIST --repo ${slug} < ~/.config/privacy/blocklist.txt`,
	);
}

// --- history (the repository itself, read-only) ---------------------------------------------------------------------
historyScan();

function historyScan() {
	const env: Record<string, string> = {};
	if (!existsSync(join(source, ".gitleaks.toml"))) env.GITLEAKS_CONFIG = join(ASSETS, ".gitleaks.toml");
	// What is published: origin's branches as of the last fetch. Local-only commits are the pre-push hook's job, and
	// leftovers of a history rewrite (old local branches, backups, the reflog) are not public. With no origin yet,
	// every local ref: all of it would be published by the first push.
	const remote = git(source, "for-each-ref", "--count=1", "refs/remotes/origin").out.trim() !== "";
	const scope = remote ? "origin's branches (as of the last fetch)" : "every local ref (nothing pushed yet)";
	const scan = run(
		["sh", join(ASSETS, "scripts/privacy-scan.sh"), ...(remote ? ["--commits", "--remotes=origin"] : ["--history"])],
		source,
		env,
	);
	const lines = (scan.err + scan.out)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) =>
			/^(Finding|RuleID|File|Commit|privacy-scan: (blocklist|commits that)|[0-9a-f]{7,} (author|committer))/.test(l),
		);
	if (scan.ok)
		add("history.clean", "pass", `${scope}: every commit passes gitleaks, the identity check and the blocklist`);
	else
		add(
			"history.clean",
			"fail",
			`${scope} already carry findings:\n       ${lines.slice(0, 24).join("\n       ")}`,
			"rewrite the commits (git rebase -i / git filter-repo), force-push, and ask GitHub support to purge cached views; rotate any secret",
		);
}

// --- behaviour: hooks refuse generated leaks ------------------------------------------------------------------------
if (behavior) behaviourChecks();
else add("behavior", "skip", "--no-behavior: hooks not tested");
report();

function activateHooks(): string {
	if (tracked.has("scripts/setup.sh")) {
		const s = run(["sh", "scripts/setup.sh"], top);
		if (!s.ok) return `scripts/setup.sh failed: ${s.err.trim().split("\n").slice(-1)[0]}`;
	} else if (tracked.has("package.json")) {
		const s = run(["bun", "install"], top);
		if (!s.ok) return `bun install failed: ${s.err.trim().split("\n").slice(-1)[0]}`;
	} else if (existsSync(join(top, ".githooks"))) git(top, "config", "core.hooksPath", ".githooks");
	return "";
}

function behaviourChecks() {
	const problem = activateHooks();
	if (problem) {
		add("hooks.setup", "fail", problem);
		return;
	}
	const hooksDir = git(top, "config", "core.hooksPath").out.trim() || ".git/hooks";
	for (const h of ["pre-commit", "pre-push"]) {
		if (!existsSync(join(top, hooksDir, h)))
			add(
				`hooks.${h}`,
				"fail",
				`after setup there is no ${h} hook`,
				`assets/.githooks/${h} (core.hooksPath .githooks)`,
			);
	}

	// A private blocklist with one random entry, so a match can be told from the person's real list.
	const marker = `zq${rand("abcdefghijklmnopqrstuvwxyz", 14)}`;
	const list = join(tmp, "blocklist.txt");
	writeFileSync(list, `# audit\n${marker}\n`);
	const env = { PRIVACY_BLOCKLIST: list };
	const probes: [string, string][] = [
		["a GitHub token", `token = ghp_${rand(ALNUM, 36)}`],
		["a phone number", `owner = 55519${rand("0123456789", 8)}`],
		["an e-mail address", `contact = maria.${rand("abcdefghijklmnopqrstuvwxyz", 6)}@gmail.com`],
		["a blocklist entry", `hello ${marker.toUpperCase()} there`],
	];
	const write = (f: string, s: string) => writeFileSync(join(top, f), `${s}\n`);
	const leakedMarker = (s: string) => s.toLowerCase().includes(marker);

	// pre-commit: each probe staged alone must be refused.
	if (existsSync(join(top, hooksDir, "pre-commit"))) {
		const results: string[] = [];
		let bad = false;
		for (const [name, content] of probes) {
			write("audit-probe.txt", content);
			git(top, "add", "audit-probe.txt");
			const c = run(["git", "commit", "-q", "-m", "audit probe"], top, env);
			if (c.ok) {
				bad = true;
				results.push(`${name}: COMMITTED`);
				git(top, "reset", "-q", "--hard", "HEAD~1");
			} else {
				results.push(`${name}: refused`);
				if (leakedMarker(c.out + c.err)) {
					bad = true;
					results.push("THE OUTPUT SHOWED THE BLOCKLIST ENTRY");
				}
				git(top, "reset", "-q", "--hard", "HEAD");
			}
			rmSync(join(top, "audit-probe.txt"), { force: true });
		}
		add(
			"hooks.pre-commit",
			bad ? "fail" : "pass",
			results.join("; "),
			bad ? "put `sh scripts/privacy-scan.sh --staged` first in the pre-commit hook" : undefined,
		);
	}

	// pre-push: a bare remote with the snapshot (pushed without hooks), then commits made with --no-verify.
	if (existsSync(join(top, hooksDir, "pre-push"))) {
		const remote = join(tmp, "remote.git");
		git(tmp, "init", "-q", "--bare", remote);
		git(top, "remote", "add", "origin", remote);
		git(top, "push", "-q", "--no-verify", "origin", "main");
		const results: string[] = [];
		let bad = false;
		const published = () => git(top, "ls-remote", "origin").out;
		const base = git(top, "rev-parse", "HEAD").out.trim();
		const attempt = (name: string, refspec: string) => {
			const before = published();
			const p = run(["git", "push", "-q", "origin", refspec], top, env);
			if (p.ok || published() !== before) {
				bad = true;
				results.push(`${name}: PUSHED`);
				// Put the remote back as it was, so the next case starts from the same published state.
				git(top, "push", "-q", "--no-verify", "-f", "origin", `${base}:refs/heads/main`, ":refs/heads/audit-branch");
			} else results.push(`${name}: refused`);
			if (leakedMarker(p.out + p.err)) {
				bad = true;
				results.push("THE OUTPUT SHOWED THE BLOCKLIST ENTRY");
			}
		};
		const commit = (f: string, s: string, email = NOREPLY) => {
			write(f, s);
			git(top, "add", f);
			run(["git", "-c", `user.email=${email}`, "commit", "-q", "--no-verify", "-m", `audit ${f}`], top);
		};
		// (base: the snapshot as published, above)
		// A leak followed by a clean commit: a hook that only looks at the last commit lets it through.
		commit("audit-leak.txt", probes[0][1]);
		commit("audit-clean.txt", "nothing here");
		attempt("a token in an earlier commit than the last", "main");
		attempt("the same commits on a new branch", "HEAD:refs/heads/audit-branch");
		git(top, "reset", "-q", "--hard", base);
		commit("audit-list.txt", probes[3][1]);
		attempt("a blocklist entry", "main");
		git(top, "reset", "-q", "--hard", base);
		// Built at run time, like the other probes: a literal address here would be flagged by the scan itself.
		commit("audit-email.txt", "nothing here", ["someone", "gmail.com"].join("@"));
		attempt("a commit authored with a personal e-mail", "main");
		git(top, "reset", "-q", "--hard", base);
		// A blocklist entry that only a merge's conflict resolution introduces: `git log -p` shows no diff for a merge,
		// so a scan without --diff-merges never sees it. Built with plumbing (no checkout of another branch).
		write("audit-merge.txt", "side");
		git(top, "add", "audit-merge.txt");
		const side = git(top, "commit-tree", git(top, "write-tree").out.trim(), "-p", base, "-m", "audit side").out.trim();
		commit("audit-merge.txt", "main");
		write("audit-merge.txt", `resolved ${probes[3][1]}`);
		git(top, "add", "audit-merge.txt");
		const tree = git(top, "write-tree").out.trim();
		const merge = git(top, "commit-tree", tree, "-p", "HEAD", "-p", side, "-m", "audit merge").out.trim();
		git(top, "update-ref", "refs/heads/main", merge);
		attempt("a blocklist entry only in a merge's conflict resolution", "main");
		git(top, "reset", "-q", "--hard", base);
		add(
			"hooks.pre-push",
			bad ? "fail" : "pass",
			results.join("; "),
			bad
				? "use assets/.githooks/pre-push and assets/scripts/privacy-scan.sh: every commit the push carries, merges included"
				: undefined,
		);
	}
}

function report(): never {
	rmSync(tmp, { recursive: true, force: true });
	const failed = checks.filter((c) => c.status === "fail").length;
	if (asJson) console.log(JSON.stringify({ repo: source, audited, failed, checks }, null, 2));
	else {
		console.log(`public-repo-standard audit: ${source} at ${audited}`);
		for (const c of checks)
			console.log(
				`${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}${c.fix && c.status !== "pass" ? `\n     fix: ${c.fix}` : ""}`,
			);
		console.log(failed ? `\n${failed} check(s) failed` : "\nall required checks pass");
	}
	return process.exit(failed ? 1 : 0);
}
