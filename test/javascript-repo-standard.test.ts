// javascript-repo-standard's audit against throwaway repositories built from its own assets: the standard setup must pass,
// other correct hook managers (Husky + lint-staged, Lefthook) must pass the behaviour tests, and each way of getting
// it wrong must fail the check that names it. Needs the network (bun install).
import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SKILL = join(import.meta.dir, "../skills/javascript-repo-standard");
const ASSETS = join(SKILL, "assets");
const TIMEOUT = 180_000;

interface Result {
	failed: number;
	checks: { id: string; status: string; detail: string }[];
}

interface Pkg {
	scripts: Record<string, string>;
	devDependencies: Record<string, string>;
	[field: string]: unknown;
}

type Mutate = (dir: string, pkg: Pkg) => void;

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

/** A repository set up exactly as the assets say, changed by `mutate`, installed and committed; then audited. */
function audit(mutate: Mutate = () => {}): Result {
	const dir = mkdtempSync(join(tmpdir(), "audit-js-fixture-"));
	try {
		for (const f of ["biome.json", "bunfig.toml", "scripts/biome.sh", ".githooks/pre-commit"]) {
			mkdirSync(dirname(join(dir, f)), { recursive: true });
			cpSync(join(ASSETS, f), join(dir, f));
		}
		write(dir, ".github/workflows/ci.yml", readFileSync(join(ASSETS, "ci.yml"), "utf8"));
		write(dir, ".gitignore", "node_modules/\n");
		write(dir, "src/index.ts", "export const answer = 42;\n");
		const pkg = JSON.parse(readFileSync(join(ASSETS, "package.json"), "utf8"));
		mutate(dir, pkg);
		write(dir, "package.json", `${JSON.stringify(pkg, null, "\t")}\n`);
		sh(["git", "init", "-q"], dir);
		sh(["bun", "install"], dir);
		sh(["git", "add", "-A"], dir);
		sh(
			["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--no-verify", "-m", "fixture"],
			dir,
		);
		const p = Bun.spawnSync(["bun", join(SKILL, "scripts/audit.ts"), dir, "--json"], {
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

describe("javascript-repo-standard audit", () => {
	test(
		"the assets as given pass every required check, hook behaviour included",
		() => {
			const r = audit();
			expect(failing(r)).toEqual([]);
			expect(status(r, "hook.cases")).toBe("pass");
			expect(status(r, "biome.pinned-only")).toBe("pass");
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
					'#!/bin/sh\nset -eu\nsh "$(git rev-parse --show-toplevel)/scripts/biome.sh" check --write --staged --files-ignore-unknown=true --no-errors-on-unmatched\ngit update-index --again\n',
					0o755,
				),
			);
			expect(status(r, "hook.cases")).toBe("fail");
			expect(r.checks.find((c) => c.id === "hook.cases")?.detail).toContain("COMMITTED THE UNSTAGED EDIT");
		},
		TIMEOUT,
	);

	test(
		"scripts calling a bare biome run whatever Biome is on PATH",
		() => {
			const r = audit((_, pkg) => {
				pkg.scripts.format = "biome check --write .";
				pkg.scripts["format:check"] = "biome ci .";
			});
			expect(status(r, "biome.pinned-only")).toBe("fail");
		},
		TIMEOUT,
	);

	test(
		"a hook running Biome through npx is a download runner; a comment naming npx is not",
		() => {
			const hook = readFileSync(join(ASSETS, ".githooks/pre-commit"), "utf8");
			const viaNpx = audit((dir) =>
				write(dir, ".githooks/pre-commit", hook.replace(/^sh .*biome\.sh"/m, "npx @biomejs/biome"), 0o755),
			);
			expect(status(viaNpx, "biome.no-download")).toBe("fail");
			const comment = audit((dir) =>
				write(dir, ".githooks/pre-commit", hook.replace("set -eu", "# never npx biome here\nset -eu"), 0o755),
			);
			expect(status(comment, "biome.no-download")).toBeUndefined();
		},
		TIMEOUT,
	);

	test(
		"npm as the package manager fails the Bun checks",
		() => {
			const r = audit((dir, pkg) => {
				pkg.packageManager = "npm@11.6.2";
				const ci = readFileSync(join(ASSETS, "ci.yml"), "utf8").replace("bun install --frozen-lockfile", "npm ci");
				write(dir, ".github/workflows/ci.yml", ci);
			});
			expect(status(r, "pm.declared")).toBe("fail");
			expect(status(r, "ci.frozen-install")).toBe("fail");
		},
		TIMEOUT,
	);

	test(
		"a CI that only formats (--write) does not refuse unformatted code",
		() => {
			const r = audit((dir) => {
				const ci = readFileSync(join(ASSETS, "ci.yml"), "utf8").replace(
					/- run: bun run format:check.*\n/,
					"- run: bun run format\n",
				);
				write(dir, ".github/workflows/ci.yml", ci);
			});
			expect(status(r, "ci.format-check")).toBe("fail");
		},
		TIMEOUT,
	);

	test(
		"a workspace needs Turborepo; with turbo, turbo.json and .turbo ignored it passes",
		() => {
			const addPackage: Mutate = (dir, pkg) => {
				pkg.workspaces = ["packages/*"];
				write(dir, "packages/lib/package.json", '{ "name": "lib", "private": true, "version": "0.0.0" }\n');
				write(dir, "packages/lib/index.ts", "export const lib = 1;\n");
			};
			const bare = audit(addPackage);
			expect(status(bare, "turbo.dependency")).toBe("fail");
			expect(status(bare, "turbo.config")).toBe("fail");
			const withTurbo = audit((dir, pkg) => {
				addPackage(dir, pkg);
				pkg.devDependencies.turbo = "2.11.10";
				pkg.scripts.typecheck = "turbo run typecheck";
				pkg.scripts.test = "turbo run test";
				cpSync(join(ASSETS, "turbo.json"), join(dir, "turbo.json"));
				write(dir, ".gitignore", "node_modules/\n.turbo\n");
			});
			expect(failing(withTurbo)).toEqual([]);
		},
		TIMEOUT,
	);

	test(
		"Husky + lint-staged, another correct hook setup, passes the behaviour tests",
		() => {
			const r = audit((dir, pkg) => {
				rmSync(join(dir, ".githooks"), { recursive: true });
				pkg.scripts.prepare = "husky";
				pkg.devDependencies.husky = "9.1.7";
				pkg.devDependencies["lint-staged"] = "17.6.0";
				pkg["lint-staged"] = { "*.{ts,js,json}": "sh scripts/biome.sh check --write --no-errors-on-unmatched" };
				write(dir, ".husky/pre-commit", "bun x --no-install lint-staged\n", 0o755);
			});
			expect(failing(r)).toEqual([]);
			expect(status(r, "hook.cases")).toBe("pass");
		},
		TIMEOUT,
	);

	test(
		"Lefthook with stage_fixed, another correct hook setup, passes the behaviour tests",
		() => {
			const r = audit((dir, pkg) => {
				rmSync(join(dir, ".githooks"), { recursive: true });
				pkg.scripts.prepare = "lefthook install";
				pkg.devDependencies.lefthook = "2.2.2";
				write(
					dir,
					"lefthook.yml",
					'pre-commit:\n  commands:\n    biome:\n      glob: "*.{ts,js,json}"\n      run: sh scripts/biome.sh check --write --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}\n      stage_fixed: true\n',
				);
			});
			expect(failing(r)).toEqual([]);
			expect(status(r, "hook.cases")).toBe("pass");
		},
		TIMEOUT,
	);
});
