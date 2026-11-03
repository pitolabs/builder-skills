#!/usr/bin/env bun
// Audits a JavaScript/TypeScript repository against the builder-skills standard: Bun as the package manager, Biome
// as the formatter (pinned, run only from node_modules), a pre-commit hook that formats staged files and never
// commits unstaged edits, CI that refuses unformatted code, and Turborepo in a monorepo. Checks behaviour, not file
// names: any hook manager or script layout passes if it does the right thing in a fresh copy.
//
//   bun audit.ts <repo> [--ref <rev>] [--working-tree] [--no-behavior] [--json]
//
// Every check reads one snapshot of the repository, in a temporary directory: the committed HEAD by default (what
// everyone else gets), another commit with --ref (e.g. origin/main), or with --working-tree the files on disk
// (tracked and untracked, not ignored), for checking a fix before committing it. The repository itself is never
// touched. Exit 1 if any check fails, 2 on bad usage.
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
const behavior = !args.includes("--no-behavior");
const asJson = args.includes("--json");
if (!repo || (refAt >= 0 && !ref) || (ref && workingTree)) {
	console.error("usage: bun audit.ts <repo> [--ref <rev> | --working-tree] [--no-behavior] [--json]");
	process.exit(2);
}

const checks: Check[] = [];
const add = (id: string, status: Status, detail: string, fix?: string) => checks.push({ id, status, detail, fix });

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
	const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
	return { ok: p.exitCode === 0, code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
const git = (cwd: string, ...a: string[]) => run(["git", ...a], cwd);
const readJson = (path: string): Record<string, unknown> | undefined => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const EXACT = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const TOOLING = ["@biomejs/biome", "turbo", "typescript", "lefthook", "husky", "lint-staged"];

const root = run(["git", "rev-parse", "--show-toplevel"], repo);
if (!root.ok) {
	console.error(`${repo} is not a git repository`);
	process.exit(2);
}
const source = root.out.trim();
const tmp = mkdtempSync(join(tmpdir(), "audit-js-"));
const top = join(tmp, "repo");
const audited = snapshot();
const tracked = new Set(git(top, "ls-files").out.split("\n").filter(Boolean));

/** Copies what is audited into `top`, as a one-commit repository; returns what it is, for the report. */
function snapshot(): string {
	mkdirSync(top);
	let label: string;
	if (workingTree) {
		for (const f of git(source, "ls-files", "-co", "--exclude-standard").out.split("\n").filter(Boolean)) {
			if (!existsSync(join(source, f))) continue; // deleted on disk, not yet staged
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
	git(top, "init", "-q");
	for (const [k, v] of [
		["user.email", "audit@example.com"],
		["user.name", "audit"],
		["commit.gpgsign", "false"],
	])
		git(top, "config", k, v);
	git(top, "add", "-A");
	git(top, "commit", "-q", "--no-verify", "-m", "audited snapshot");
	return label;
}
const pkgPath = join(top, "package.json");
const pkg = readJson(pkgPath);
if (!pkg) {
	add(
		"js.package-json",
		"fail",
		"no package.json at the repository root: not a JavaScript project (or not at its root)",
	);
	report();
}
const scripts: Record<string, string> = isObject(pkg?.scripts) ? (pkg.scripts as Record<string, string>) : {};
const devDeps: Record<string, string> = isObject(pkg?.devDependencies)
	? (pkg.devDependencies as Record<string, string>)
	: {};
const deps: Record<string, string> = isObject(pkg?.dependencies) ? (pkg.dependencies as Record<string, string>) : {};

// --- package manager: Bun ---------------------------------------------------------------------------------------
const otherLocks = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"].filter((f) =>
	tracked.has(f),
);
if (tracked.has("bun.lock")) add("pm.lockfile", "pass", "bun.lock is committed");
else if (tracked.has("bun.lockb"))
	add(
		"pm.lockfile",
		"warn",
		"bun.lockb (binary, legacy) is committed",
		"bun install --save-text-lockfile, commit bun.lock, remove bun.lockb",
	);
else add("pm.lockfile", "fail", "no committed bun.lock", "bun install, then commit bun.lock");
if (otherLocks.length)
	add(
		"pm.single",
		"fail",
		`other package managers' lockfiles are committed: ${otherLocks.join(", ")}`,
		"Bun is the package manager: git rm them after bun install",
	);
const declared =
	typeof pkg?.packageManager === "string"
		? pkg.packageManager
		: isObject(pkg?.devEngines) && isObject(pkg.devEngines.packageManager)
			? `${pkg.devEngines.packageManager.name}@${pkg.devEngines.packageManager.version}`
			: undefined;
if (declared?.startsWith("bun@")) add("pm.declared", "pass", `package.json declares ${declared}`);
else
	add(
		"pm.declared",
		"fail",
		declared ? `package.json declares ${declared}, not Bun` : "package.json declares no package manager",
		'add "packageManager": "bun@<bun --version>" (CI setup-bun and Turborepo read it)',
	);

// --- exact versions -------------------------------------------------------------------------------------------------
const loose = (m: Record<string, string>) =>
	Object.entries(m).filter(([, v]) => !EXACT.test(v) && !v.startsWith("workspace:"));
const looseTooling = [...loose(devDeps), ...loose(deps)].filter(([n]) => TOOLING.includes(n));
const looseOther = [...loose(devDeps), ...loose(deps)].filter(([n]) => !TOOLING.includes(n));
if (looseTooling.length)
	add(
		"deps.tooling-exact",
		"fail",
		`tooling without an exact version: ${looseTooling.map(([n, v]) => `${n}@${v}`).join(", ")}`,
		"pin exact versions (bunfig.toml [install] exact = true, then bun add -d <pkg>@<version>)",
	);
else add("deps.tooling-exact", "pass", "tooling versions are exact");
if (looseOther.length)
	add(
		"deps.exact",
		"warn",
		`${looseOther.length} dependencies with ranges (e.g. ${looseOther
			.slice(0, 3)
			.map(([n, v]) => `${n}@${v}`)
			.join(", ")})`,
		"exact versions everywhere: bunfig.toml [install] exact = true",
	);

// --- Biome ----------------------------------------------------------------------------------------------------------
const biomeVersion = devDeps["@biomejs/biome"];
if (biomeVersion) add("biome.dependency", "pass", `@biomejs/biome ${biomeVersion} in devDependencies`);
else add("biome.dependency", "fail", "@biomejs/biome is not a devDependency", "bun add -d -E @biomejs/biome");
const biomeConfigFile = ["biome.json", "biome.jsonc"].find((f) => existsSync(join(top, f)));
if (!biomeConfigFile) add("biome.config", "fail", "no biome.json or biome.jsonc", "copy assets/biome.json");
else {
	const cfgText = readFileSync(join(top, biomeConfigFile), "utf8");
	const formatterOff = /"formatter"\s*:\s*\{[^}]*"enabled"\s*:\s*false/.test(cfgText);
	// `biome migrate` (2.6) turns "recommended": true into "preset": "none", which enables no rule at all.
	const linterOff =
		/"linter"\s*:\s*\{[^}]*"enabled"\s*:\s*false/.test(cfgText) ||
		/"linter"\s*:\s*\{[\s\S]*?"rules"\s*:\s*\{[^}]*"preset"\s*:\s*"none"/.test(cfgText);
	add(
		"biome.config",
		formatterOff ? "fail" : "pass",
		formatterOff ? `${biomeConfigFile} disables the formatter` : `${biomeConfigFile} present, formatter on`,
	);
	if (linterOff)
		add(
			"biome.linter",
			"warn",
			`${biomeConfigFile} turns the linter off, or leaves it with no rules (preset "none")`,
			'"linter": { "enabled": true } (the default preset is "recommended"), then fix or suppress what it reports',
		);
}
const otherFormatters = ["prettier", "eslint"].filter((n) => devDeps[n] || deps[n]);
if (otherFormatters.length)
	add(
		"biome.single",
		"warn",
		`also depends on ${otherFormatters.join(", ")}`,
		"Biome formats and lints: remove them once Biome covers the same files",
	);

// Places that invoke tools: scripts, hook files, CI. A download runner there runs whatever npm has under that name.
const hookFiles = [".githooks", ".husky"].flatMap((d) =>
	existsSync(join(top, d)) ? readdirSync(join(top, d)).map((f) => join(d, f)) : [],
);
const ciFiles = existsSync(join(top, ".github/workflows"))
	? readdirSync(join(top, ".github/workflows"))
			.filter((f) => /\.ya?ml$/.test(f))
			.map((f) => join(".github/workflows", f))
	: [];
const textOf = (f: string) => {
	try {
		return readFileSync(join(top, f), "utf8");
	} catch {
		return "";
	}
};
// Shell and YAML comments mention tools without running them.
const code = (t: string) =>
	t
		.split("\n")
		.filter((l) => !l.trimStart().startsWith("#"))
		.join("\n");
const invocations = [
	...Object.entries(scripts).map(([n, s]) => [`package.json scripts.${n}`, s] as const),
	...[...hookFiles, "lefthook.yml", ".lefthook.yml", ".lintstagedrc", ".lintstagedrc.json", ...ciFiles]
		.filter((f) => existsSync(join(top, f)))
		.map((f) => [f, code(textOf(f))] as const),
];
const downloaders = invocations.filter(([, t]) =>
	/\b(npx|bunx|bun x|pnpm dlx|yarn dlx|npm exec)\b[^\n]*\b(biome|@biomejs)/.test(t),
);
if (downloaders.length)
	add(
		"biome.no-download",
		"fail",
		`runs Biome through a download runner in ${downloaders.map(([w]) => w).join(", ")}`,
		"call the pinned Biome through scripts/biome.sh (assets/scripts/biome.sh)",
	);

// --- monorepo: Turborepo --------------------------------------------------------------------------------------------
const workspaces = Array.isArray(pkg?.workspaces)
	? pkg.workspaces
	: isObject(pkg?.workspaces)
		? pkg.workspaces.packages
		: undefined;
if (Array.isArray(workspaces) && workspaces.length) {
	const turbo = devDeps.turbo;
	add(
		"turbo.dependency",
		turbo && EXACT.test(turbo) ? "pass" : "fail",
		turbo ? `turbo ${turbo}` : "a workspace without turbo",
		"bun add -d -E turbo",
	);
	add(
		"turbo.config",
		existsSync(join(top, "turbo.json")) ? "pass" : "fail",
		existsSync(join(top, "turbo.json")) ? "turbo.json present" : "no turbo.json",
		"copy assets/turbo.json and list the workspace's tasks",
	);
	const rootScripts = Object.entries(scripts).filter(([n]) => ["build", "test", "typecheck", "lint"].includes(n));
	const notTurbo = rootScripts.filter(([, s]) => !/\bturbo\b/.test(s));
	if (notTurbo.length)
		add(
			"turbo.scripts",
			"warn",
			`root scripts not run through turbo: ${notTurbo.map(([n]) => n).join(", ")}`,
			'root "build": "turbo run build", etc.',
		);
	add(
		"turbo.gitignore",
		/^\.turbo\/?$/m.test(textOf(".gitignore")) ? "pass" : "fail",
		".turbo in .gitignore",
		"add .turbo to .gitignore",
	);
} else add("turbo", "skip", "single package (no workspaces): Turborepo not required");

if (!/^\/?node_modules\/?$/m.test(textOf(".gitignore")))
	add("gitignore.node_modules", "fail", "node_modules is not in .gitignore", "add node_modules to .gitignore");

// --- CI -------------------------------------------------------------------------------------------------------------
const ciText = ciFiles.map((f) => code(textOf(f))).join("\n");
if (!ciFiles.length) add("ci.workflow", "fail", "no .github/workflows/*.yml", "copy assets/ci.yml");
else {
	const otherInstall = /\b(npm (ci|install|i)|pnpm (install|i)|yarn install)(?!\S)/.exec(ciText);
	if (otherInstall)
		add(
			"ci.frozen-install",
			"fail",
			`CI installs with ${otherInstall[0]}`,
			"bun install --frozen-lockfile, everywhere CI installs",
		);
	else
		add(
			"ci.frozen-install",
			/\bbun (install --frozen-lockfile|ci)\b/.test(ciText) ? "pass" : "fail",
			"CI installs with bun install --frozen-lockfile (or bun ci)",
			"a run step: bun install --frozen-lockfile",
		);
	// A CI step counts if it runs a check-only Biome command, directly or through a package.json script.
	const expand = (line: string) => {
		const m = /\b(?:bun|npm|pnpm|yarn) (?:run )?([\w:.-]+)/.exec(line);
		return m && scripts[m[1]] ? `${line} ${scripts[m[1]]}` : line;
	};
	const steps = ciText.split("\n").map(expand);
	const checkOnly = steps.some(
		(s) =>
			/\bbiome\.sh\s+ci\b|\bbiome\s+ci\b/.test(s) ||
			(/\bbiome(\.sh)?\s+(check|format|lint)\b/.test(s) && !/--write|--fix/.test(s)),
	);
	add(
		"ci.format-check",
		checkOnly ? "pass" : "fail",
		checkOnly ? "CI runs a check-only Biome command" : "CI never runs a check-only Biome command (biome ci)",
		'a "format:check": "sh scripts/biome.sh ci ." script and a CI step running it',
	);
	if (!steps.some((s) => /\btsc\b|typecheck/.test(s)))
		add("ci.typecheck", "warn", "CI runs no typecheck", "bun run typecheck (tsc --noEmit)");
	if (!steps.some((s) => /\bbun test\b|vitest|jest/.test(s))) add("ci.tests", "warn", "CI runs no tests", "bun test");
}

// --- behaviour in a fresh copy ----------------------------------------------------------------------------------------
if (behavior) behaviourChecks();
else add("behavior", "skip", "--no-behavior: hook and runner behaviour not tested");
report();

function behaviourChecks() {
	const dir = top;
	// A fake `biome` first on PATH: if anything runs it, the repo would run whatever Biome a machine happens to have.
	const fakeBin = join(tmp, "fake-bin");
	const marker = join(tmp, "fake-biome-ran");
	mkdirSync(fakeBin);
	writeFileSync(join(fakeBin, "biome"), `#!/bin/sh\necho "$@" >> "${marker}"\nexit 0\n`);
	chmodSync(join(fakeBin, "biome"), 0o755);
	const env = { PATH: `${fakeBin}:${process.env.PATH}` };

	// Without node_modules, a script that formats must fail, never fall back to a global Biome.
	const formatScripts = Object.entries(scripts)
		.filter(([, s]) => /\bbiome\b/.test(s))
		.map(([n]) => n);
	for (const n of formatScripts) run(["bun", "run", n], dir, env);
	if (existsSync(marker)) {
		add(
			"biome.pinned-only",
			"fail",
			`without node_modules, bun run ${formatScripts.join("/")} ran a biome found on PATH`,
			"invoke Biome through scripts/biome.sh, which runs node_modules/@biomejs/biome at the pinned version or fails",
		);
		rmSync(marker);
	} else if (formatScripts.length)
		add(
			"biome.pinned-only",
			"pass",
			`without node_modules, ${formatScripts.map((n) => `bun run ${n}`).join(", ")} never ran a Biome from PATH`,
		);

	// With no bun.lock (already a failure above), a plain install still lets the hook be tested.
	const frozen = tracked.has("bun.lock") || tracked.has("bun.lockb");
	const install = run(["bun", "install", ...(frozen ? ["--frozen-lockfile"] : [])], dir, env);
	if (!install.ok) {
		add(
			"behavior.install",
			"fail",
			`bun install${frozen ? " --frozen-lockfile" : ""} failed: ${install.err.trim().split("\n").slice(-1)[0]}`,
			"bun install and commit the updated bun.lock",
		);
		return;
	}
	if (frozen) add("behavior.install", "pass", "bun install --frozen-lockfile works in a fresh copy");

	const hooksPath = git(dir, "config", "core.hooksPath").out.trim();
	const hook = hooksPath ? join(dir, hooksPath, "pre-commit") : join(dir, ".git/hooks/pre-commit");
	if (!existsSync(hook)) {
		add(
			"hook.active",
			"fail",
			"after bun install there is no pre-commit hook",
			'a "prepare" script that turns it on (e.g. git config core.hooksPath .githooks), or a hook manager installed on install',
		);
		return;
	}
	add(
		"hook.active",
		"pass",
		`bun install turns on a pre-commit hook (${hooksPath ? `core.hooksPath ${hooksPath}` : ".git/hooks/pre-commit"})`,
	);
	hookCases(dir, env, marker);
}

function hookCases(dir: string, env: Record<string, string>, marker: string) {
	const biomeBin = join(dir, "node_modules/@biomejs/biome/bin/biome");
	const ugly = "export const probe = {   value: 1   };\n";
	const formatAs = (path: string) => {
		const p = Bun.spawnSync(["bun", biomeBin, "format", `--stdin-file-path=${path}`], {
			cwd: dir,
			stdin: Buffer.from(ugly),
			stdout: "pipe",
			stderr: "pipe",
		});
		return p.exitCode === 0 ? p.stdout.toString() : "";
	};
	// A probe path the project's Biome formats: next to an existing source file, else at the root or in src/.
	const existing = git(dir, "ls-files", "*.ts", "*.tsx", "*.js", "*.mjs").out.split("\n").filter(Boolean);
	const candidates = [...new Set([...existing.map((f) => dirname(f)), ".", "src"])].map((d) =>
		d === "." ? "" : `${d}/`,
	);
	const probeDir = candidates.find((d) => {
		const out = formatAs(`${d}audit-probe.ts`);
		return out.length > 0 && out !== ugly;
	});
	if (probeDir === undefined) {
		add("hook.cases", "warn", "the project's Biome formats none of the probe paths; hook behaviour not tested");
		return;
	}
	const expected = formatAs(`${probeDir}audit-probe.ts`);
	const write = (f: string, s: string) => {
		mkdirSync(dirname(join(dir, f)), { recursive: true });
		writeFileSync(join(dir, f), s);
	};
	const commit = () => run(["git", "commit", "-q", "-m", "audit probe"], dir, env);
	const head = (f: string) => git(dir, "show", `HEAD:${f}`).out;
	const reset = () => {
		git(dir, "reset", "-q", "--hard", "HEAD");
		git(dir, "clean", "-qfd", "--", probeDir || ".");
	};
	const unstagedLine = "// UNSTAGED EDIT\n";
	const results: string[] = [];
	let bad = false;

	// 1. A staged, unformatted new file: the commit must end up formatted (or be refused).
	const f1 = `${probeDir}audit-probe-a.ts`;
	write(f1, ugly);
	git(dir, "add", f1);
	const c1 = commit();
	if (c1.ok && head(f1) === expected) results.push("formats a staged file");
	else if (c1.ok) {
		bad = true;
		results.push("COMMITTED AN UNFORMATTED FILE");
	} else results.push("refuses an unformatted file (does not format it: warn)");
	reset();

	// 2-4. Staged then edited again (new file, modified file, renamed file): the unstaged edit must never be committed.
	const cases: [string, () => string][] = [
		[
			"AM (new file edited after staging)",
			() => {
				const f = `${probeDir}audit-probe-b.ts`;
				write(f, ugly);
				git(dir, "add", f);
				write(f, ugly + unstagedLine);
				return f;
			},
		],
		[
			"MM (modified file edited after staging)",
			() => {
				const f = `${probeDir}audit-probe-c.ts`;
				write(f, expected);
				git(dir, "add", f);
				run(["git", "commit", "-q", "--no-verify", "-m", "base"], dir);
				write(f, ugly);
				git(dir, "add", f);
				write(f, ugly + unstagedLine);
				return f;
			},
		],
		[
			"RM (renamed file edited after staging)",
			() => {
				const f = `${probeDir}audit-probe-d.ts`;
				write(f, expected);
				git(dir, "add", f);
				run(["git", "commit", "-q", "--no-verify", "-m", "base"], dir);
				const g = `${probeDir}audit-probe-e.ts`;
				git(dir, "mv", f, g);
				write(g, ugly + unstagedLine);
				return g;
			},
		],
	];
	for (const [name, setup] of cases) {
		const f = setup();
		const c = commit();
		if (c.ok && head(f).includes("UNSTAGED")) {
			bad = true;
			results.push(`${name}: COMMITTED THE UNSTAGED EDIT`);
		} else results.push(`${name}: ${c.ok ? "committed only the staged content" : "refused"}`);
		reset();
	}

	// 5. A staged file plus an unrelated unstaged edit elsewhere: should commit, without that edit.
	const f5 = `${probeDir}audit-probe-f.ts`;
	const g5 = `${probeDir}audit-probe-g.ts`;
	write(g5, expected);
	git(dir, "add", g5);
	run(["git", "commit", "-q", "--no-verify", "-m", "base"], dir);
	write(f5, ugly);
	git(dir, "add", f5);
	write(g5, expected + unstagedLine);
	const c5 = commit();
	if (c5.ok && head(g5).includes("UNSTAGED")) {
		bad = true;
		results.push("unrelated unstaged file: COMMITTED IT");
	} else
		results.push(`unrelated unstaged file: ${c5.ok ? "left out of the commit" : "commit refused (too strict: warn)"}`);
	reset();

	if (existsSync(marker)) {
		bad = true;
		results.push("THE HOOK RAN A BIOME FROM PATH");
	}
	const warnOnly = !bad && results.some((r) => r.includes("warn"));
	add(
		"hook.cases",
		bad ? "fail" : warnOnly ? "warn" : "pass",
		results.join("; "),
		bad
			? "use a hook that refuses any staged path with unstaged edits before formatting (assets/.githooks/pre-commit)"
			: undefined,
	);
}

function report(): never {
	rmSync(tmp, { recursive: true, force: true });
	const failed = checks.filter((c) => c.status === "fail").length;
	if (asJson) console.log(JSON.stringify({ repo: source, audited, failed, checks }, null, 2));
	else {
		console.log(`audit-javascript-project: ${source} at ${audited}`);
		for (const c of checks)
			console.log(
				`${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}${c.fix && c.status !== "pass" ? `\n     fix: ${c.fix}` : ""}`,
			);
		console.log(failed ? `\n${failed} check(s) failed` : "\nall required checks pass");
	}
	return process.exit(failed ? 1 : 0);
}
