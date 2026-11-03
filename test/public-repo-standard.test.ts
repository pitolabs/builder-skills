// public-repo-standard's audit against throwaway repositories built from its own assets: the assets as given must
// pass, and each realistic way of getting the protection wrong must fail the check that names it. Offline (no GitHub
// settings); needs the network once, for the pinned gitleaks download. Leaks are generated at run time, so this file
// carries none.
import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SKILL = join(import.meta.dir, "../skills/public-repo-standard");
const ASSETS = join(SKILL, "assets");
const TIMEOUT = 180_000;
const NOREPLY = "1+fixture@users.noreply.github.com";
// Built at run time: a literal personal-looking address in this file would be refused by the repository's own scan.
const PERSONAL = ["someone", "gmail.com"].join("@");

interface Result {
	failed: number;
	checks: { id: string; status: string; detail: string }[];
}

function sh(cmd: string[], cwd: string) {
	const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr}`);
	return p.stdout.toString();
}

function write(dir: string, file: string, text: string, mode?: number) {
	mkdirSync(dirname(join(dir, file)), { recursive: true });
	writeFileSync(join(dir, file), text);
	if (mode) chmodSync(join(dir, file), mode);
}

const ciWorkflow = () => `name: ci\non:\n  push:\njobs:\n${readFileSync(join(ASSETS, "ci-privacy.yml"), "utf8")}`;

/** A repository set up as the assets say, changed by `mutate`, committed (more commits from `history`); then audited. */
function audit(mutate: (dir: string) => void = () => {}, history: (dir: string) => void = () => {}): Result {
	const base = mkdtempSync(join(tmpdir(), "audit-public-fixture-"));
	const dir = join(base, "repo");
	try {
		for (const f of [
			"scripts/gitleaks.sh",
			"scripts/privacy-scan.sh",
			".gitleaks.toml",
			".githooks/pre-commit",
			".githooks/pre-push",
		]) {
			mkdirSync(dirname(join(dir, f)), { recursive: true });
			cpSync(join(ASSETS, f), join(dir, f));
		}
		write(dir, ".github/workflows/ci.yml", ciWorkflow());
		write(dir, "README.md", "# fixture\n");
		mutate(dir);
		sh(["git", "init", "-q", "-b", "main"], dir);
		sh(["git", "config", "user.email", NOREPLY], dir);
		sh(["git", "config", "user.name", "fixture"], dir);
		sh(["git", "add", "-A"], dir);
		sh(["git", "commit", "-q", "--no-verify", "-m", "fixture"], dir);
		history(dir);
		// Isolated lists: the history scan must not depend on the machine's real ones.
		writeFileSync(join(base, "blocklist.txt"), "");
		const p = Bun.spawnSync(["bun", join(SKILL, "scripts/audit.ts"), dir, "--offline", "--json"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PRIVACY_BLOCKLIST: join(base, "blocklist.txt"), PRIVACY_LOCAL_LIST: "/dev/null" },
		});
		if (p.exitCode !== 0 && p.exitCode !== 1) throw new Error(`audit exited ${p.exitCode}: ${p.stderr}`);
		return JSON.parse(p.stdout.toString());
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
}

const check = (r: Result, id: string) => r.checks.find((c) => c.id === id);
const failing = (r: Result) => r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`);

describe("public-repo-standard audit", () => {
	test(
		"the assets as given refuse every generated leak, at commit and at push, without printing the blocklist entry",
		() => {
			const r = audit();
			expect(failing(r)).toEqual([]);
			expect(check(r, "hooks.pre-commit")?.status).toBe("pass");
			expect(check(r, "hooks.pre-push")?.status).toBe("pass");
			expect(check(r, "history.clean")?.status).toBe("pass");
		},
		TIMEOUT,
	);

	test(
		"a pre-push hook that scans only the last commit lets an earlier leak through",
		() => {
			const hook = readFileSync(join(ASSETS, ".githooks/pre-push"), "utf8").replace(
				/sh "\$top\/scripts\/privacy-scan\.sh" --commits "\$revs"/,
				'sh "$top/scripts/privacy-scan.sh" --commits "$local_sha~1..$local_sha"',
			);
			const r = audit((dir) => write(dir, ".githooks/pre-push", hook, 0o755));
			expect(check(r, "hooks.pre-push")?.status).toBe("fail");
			expect(check(r, "hooks.pre-push")?.detail).toContain("a token in an earlier commit than the last: PUSHED");
		},
		TIMEOUT,
	);

	test(
		"a pre-commit hook without the scan commits secrets and personal data",
		() => {
			const r = audit((dir) => write(dir, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n", 0o755));
			expect(check(r, "hooks.pre-commit")?.status).toBe("fail");
			expect(check(r, "hooks.pre-commit")?.detail).toContain("a GitHub token: COMMITTED");
		},
		TIMEOUT,
	);

	test(
		"without the personal-data rules, gitleaks' defaults let a phone number and an e-mail address through",
		() => {
			const r = audit((dir) => rmSync(join(dir, ".gitleaks.toml")));
			expect(check(r, "files.rules")?.status).toBe("fail");
			const detail = check(r, "hooks.pre-commit")?.detail ?? "";
			expect(detail).toContain("a phone number: COMMITTED");
			expect(detail).toContain("an e-mail address: COMMITTED");
			expect(detail).toContain("a GitHub token: refused");
		},
		TIMEOUT,
	);

	test(
		"a commit already published with a personal e-mail fails the history check",
		() => {
			const r = audit(
				() => {},
				(dir) =>
					sh(["git", "-c", `user.email=${PERSONAL}`, "commit", "-q", "--no-verify", "--allow-empty", "-m", "x"], dir),
			);
			expect(check(r, "history.clean")?.status).toBe("fail");
			expect(check(r, "history.clean")?.detail).toContain(`author ${PERSONAL}`);
		},
		TIMEOUT,
	);

	test(
		"a CI scan that checks out only the last commit is no history scan",
		() => {
			const r = audit((dir) =>
				write(dir, ".github/workflows/ci.yml", ciWorkflow().replace(/\n\s+with:\n\s+fetch-depth: 0.*/, "")),
			);
			expect(check(r, "ci.history-scan")?.status).toBe("fail");
			expect(check(r, "ci.history-scan")?.detail).toContain("fetch-depth");
		},
		TIMEOUT,
	);
});
