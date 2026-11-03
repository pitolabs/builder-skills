// audit-python-project against throwaway repositories built from its own assets: the standard setup must pass, the
// pre-commit framework (another correct hook manager) must pass the behaviour tests, and each way of getting it wrong
// must fail the check that names it. Needs uv and the network (uv lock, uv sync).
import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SKILL = join(import.meta.dir, "../skills/audit-python-project");
const ASSETS = join(SKILL, "assets");
const TIMEOUT = 180_000;

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

const asset = (f: string) => readFileSync(join(ASSETS, f), "utf8");

/** A repository set up exactly as the assets say, changed by `mutate`, locked and committed; then audited. */
function audit(mutate: (dir: string) => void = () => {}): Result {
	const dir = mkdtempSync(join(tmpdir(), "audit-py-fixture-"));
	try {
		for (const f of [
			"pyproject.toml",
			".python-version",
			"scripts/ruff.sh",
			"scripts/setup.sh",
			".githooks/pre-commit",
		]) {
			mkdirSync(dirname(join(dir, f)), { recursive: true });
			cpSync(join(ASSETS, f), join(dir, f));
		}
		write(dir, ".github/workflows/ci.yml", asset("ci.yml"));
		write(dir, ".gitignore", ".venv/\n__pycache__/\n");
		write(dir, "src/app.py", 'ANSWER = {"value": 42}\n');
		mutate(dir);
		sh(["git", "init", "-q"], dir);
		sh(["uv", "lock", "--quiet"], dir);
		sh(["git", "add", "-A"], dir);
		sh(
			["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--no-verify", "-m", "fixture"],
			dir,
		);
		const p = Bun.spawnSync(["uv", "run", "--quiet", join(SKILL, "scripts/audit.py"), dir, "--json"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (p.exitCode !== 0 && p.exitCode !== 1) throw new Error(`audit exited ${p.exitCode}: ${p.stderr}`);
		return JSON.parse(p.stdout.toString());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const status = (r: Result, id: string) => r.checks.find((c) => c.id === id)?.status;
const failing = (r: Result) => r.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`);

describe("audit-python-project", () => {
	test(
		"the assets as given pass every required check, hook behaviour included",
		() => {
			const r = audit();
			expect(failing(r)).toEqual([]);
			expect(status(r, "hook.cases")).toBe("pass");
		},
		TIMEOUT,
	);

	test(
		"a hook that formats and re-stages without the staged/unstaged guard commits unstaged edits",
		() => {
			const r = audit((dir) =>
				write(
					dir,
					".githooks/pre-commit",
					'#!/bin/sh\nset -eu\nstaged=$(git diff --cached --name-only --diff-filter=ACMR -- "*.py")\n[ -n "$staged" ] || exit 0\nsh scripts/ruff.sh format -- $staged\ngit update-index --again\n',
					0o755,
				),
			);
			expect(status(r, "hook.cases")).toBe("fail");
			expect(r.checks.find((c) => c.id === "hook.cases")?.detail).toContain("COMMITTED THE UNSTAGED EDIT");
		},
		TIMEOUT,
	);

	test(
		"a hook calling a bare ruff runs whatever Ruff is on PATH",
		() => {
			const hook = asset(".githooks/pre-commit");
			const r = audit((dir) => write(dir, ".githooks/pre-commit", hook.replaceAll('sh "$ruff"', "ruff"), 0o755));
			expect(status(r, "hook.cases")).toBe("fail");
			expect(r.checks.find((c) => c.id === "hook.cases")?.detail).toContain("RAN A RUFF FROM PATH");
		},
		TIMEOUT,
	);

	test(
		"CI running Ruff through uvx is a download runner; a comment naming uvx is not",
		() => {
			const viaUvx = audit((dir) =>
				write(
					dir,
					".github/workflows/ci.yml",
					asset("ci.yml").replace("sh scripts/ruff.sh check .", "uvx ruff check ."),
				),
			);
			expect(status(viaUvx, "ruff.no-download")).toBe("fail");
			const comment = audit((dir) =>
				write(dir, ".github/workflows/ci.yml", `# never uvx ruff here\n${asset("ci.yml")}`),
			);
			expect(status(comment, "ruff.no-download")).toBeUndefined();
		},
		TIMEOUT,
	);

	test(
		"CI that installs with pip, or only fixes, does not hold the standard",
		() => {
			const r = audit((dir) =>
				write(
					dir,
					".github/workflows/ci.yml",
					asset("ci.yml")
						.replace("uv sync --frozen", "pip install -r requirements.txt")
						.replace("format --check .", "format .")
						.replace("ruff.sh check .", "ruff.sh check --fix ."),
				),
			);
			expect(status(r, "ci.frozen-install")).toBe("fail");
			expect(status(r, "ci.format-check")).toBe("fail");
			expect(status(r, "ci.lint")).toBe("fail");
		},
		TIMEOUT,
	);

	test(
		"a requirements file is fine only as an export of uv.lock",
		() => {
			const exported = audit((dir) => {
				sh(["uv", "lock", "--quiet"], dir);
				write(dir, "requirements.txt", sh(["uv", "export", "--frozen", "--no-dev"], dir));
			});
			expect(status(exported, "pm.requirements")).toBeUndefined();
			const hand = audit((dir) => write(dir, "requirements.txt", "httpx==0.28.1\n"));
			expect(status(hand, "pm.requirements")).toBe("fail");
		},
		TIMEOUT,
	);

	test(
		"the pre-commit framework never commits unstaged edits, but refuses unformatted files instead of formatting them",
		() => {
			const r = audit((dir) => {
				rmSync(join(dir, ".githooks"), { recursive: true });
				write(
					dir,
					"pyproject.toml",
					asset("pyproject.toml").replace(
						'dev = ["pytest==9.2.0", "ruff==0.17.3"]',
						'dev = ["pre-commit==4.7.0", "pytest==9.2.0", "ruff==0.17.3"]',
					),
				);
				write(
					dir,
					"scripts/setup.sh",
					"#!/bin/sh\nset -eu\nuv sync --frozen\nuv run --frozen pre-commit install\n",
					0o755,
				);
				write(
					dir,
					".pre-commit-config.yaml",
					"repos:\n  - repo: local\n    hooks:\n      - id: ruff-format\n        name: ruff format\n        entry: sh scripts/ruff.sh format\n        language: system\n        types: [python]\n",
				);
			});
			expect(failing(r)).toEqual([]);
			// It rewrites the file and fails the commit, leaving a re-add to the person: safe, one step more.
			const cases = r.checks.find((c) => c.id === "hook.cases");
			expect(cases?.status).toBe("warn");
			expect(cases?.detail).toContain("refuses an unformatted file");
			expect(cases?.detail).not.toContain("COMMITTED");
		},
		TIMEOUT,
	);
});
