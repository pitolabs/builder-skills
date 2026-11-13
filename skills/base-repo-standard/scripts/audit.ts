#!/usr/bin/env bun
// Audits any repository, whatever its language and visibility, against the builder-skills base standard: Renovate on
// the shared pitolabs/renovate-config preset plus its automerge preset (CI must run the tests on pull requests), Dependabot
// alerts, workflows with read-only permissions and SHA-pinned actions, the mise-pinned check tools (gitleaks,
// jactionlint, zizmor, shellcheck, osv-scanner) with a committed mise.lock and a CI job that runs them, a gitleaks
// pre-commit hook, and baselines that expire. Checks behaviour too: the `mise run check:*` tasks must pass on a fresh
// copy, and the hook must commit a clean change and refuse a generated token.
//
//   bun audit.ts <repo> [--ref <rev> | --working-tree] [--offline] [--private] [--no-behavior] [--json]
//
// Files and behaviour are read from one snapshot (HEAD, --ref or --working-tree) in a temporary directory; the secrets
// scan reads the repository's own history (read-only): origin's branches and the audited commit, what CI's base job
// sees. --offline skips the GitHub settings (needs `gh` and a github.com origin otherwise). A private repository (read
// from GitHub, or --private) pays for Actions minutes, so its pull-request workflows must cancel superseded runs. The
// behaviour checks need `mise` (brew install mise). Exit 1 if any check fails, 2 on bad usage.
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
type Table = Record<string, unknown>;
interface Step {
	uses?: string;
	run?: string;
	with?: Table;
}

const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const ref = refAt >= 0 ? args[refAt + 1] : undefined;
const repo = args.find((a, i) => !a.startsWith("--") && !(refAt >= 0 && i === refAt + 1));
const workingTree = args.includes("--working-tree");
const offline = args.includes("--offline");
const assumePrivate = args.includes("--private");
const behavior = !args.includes("--no-behavior");
const asJson = args.includes("--json");
if (!repo || (refAt >= 0 && !ref) || (ref && workingTree)) {
	console.error(
		"usage: bun audit.ts <repo> [--ref <rev> | --working-tree] [--offline] [--private] [--no-behavior] [--json]",
	);
	process.exit(2);
}

const PRESET = "local>pitolabs/renovate-config";
const TOOLS = [
	"aqua:gitleaks/gitleaks",
	"aqua:jdx/jactionlint",
	"aqua:zizmorcore/zizmor",
	"aqua:google/osv-scanner",
	"aqua:koalaman/shellcheck",
];
const TASKS = ["check:secrets", "check:workflows", "check:shell", "check:vulns"];
const PLATFORMS = ["linux-x64", "macos-arm64"];
const LOCK = `mise lock --platform ${PLATFORMS.join(",")}`;
const SHA = /^[0-9a-f]{40}$/;
// A test runner in a run step, or in the args of a docker:// step: what makes automerge safe (a green PR means the
// tests passed). A Renovate preset repository's test is the config validator.
const TEST_STEP =
	/\b(?:(?:bun|npm|pnpm) (?:run )?test|turbo (?:run )?test|pytest|go test|cargo test|renovate-config-validator)\b|\btest\/[\w.-]+\.sh\b/;
const MAX_BASELINE_DAYS = 90;
const NOREPLY = "audit@users.noreply.github.com";
const checks: Check[] = [];
const add = (id: string, status: Status, detail: string, fix?: string) => checks.push({ id, status, detail, fix });

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
	const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
	return { ok: p.exitCode === 0, out: p.stdout.toString(), err: p.stderr.toString() };
}
const git = (cwd: string, ...a: string[]) => run(["git", ...a], cwd);
const tail = (s: string, n = 12) => s.trim().split("\n").slice(-n).join("\n       ");
const rand = (alphabet: string, n: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join("");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const root = run(["git", "rev-parse", "--show-toplevel"], repo);
if (!root.ok) {
	console.error(`${repo} is not a git repository`);
	process.exit(2);
}
const source = root.out.trim();
const tmp = mkdtempSync(join(tmpdir(), "audit-base-"));
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
/** The parsed file, or undefined when it is not tracked or does not parse. */
function parsed(f: string, parse: (text: string) => unknown): Table | undefined {
	if (!tracked.has(f)) return undefined;
	try {
		const v = parse(textOf(f));
		return v && typeof v === "object" ? (v as Table) : undefined;
	} catch {
		return undefined;
	}
}
const table = (v: unknown): Table => (v && typeof v === "object" && !Array.isArray(v) ? (v as Table) : {});

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

// --- mise: pinned tools, their checks, their checksums ---------------------------------------------------------------
const miseToml = parsed("mise.toml", Bun.TOML.parse);
const tools = table(miseToml?.tools);
const versionOf = (v: unknown) => String(typeof v === "object" && v !== null ? (v as Table).version : v);
const pinned = (t: string) => /^\d+\.\d+\.\d+$/.test(versionOf(tools[t]));
if (!miseToml)
	add(
		"mise.config",
		"fail",
		tracked.has("mise.toml") ? "mise.toml does not parse" : "no mise.toml: the check tools are not pinned",
		"copy assets/mise.toml",
	);
else {
	const missing = TOOLS.filter((t) => !(t in tools));
	const unpinned = TOOLS.filter((t) => t in tools && !pinned(t));
	if (missing.length + unpinned.length === 0) add("mise.config", "pass", "mise.toml pins the five check tools");
	else
		add(
			"mise.config",
			"fail",
			[
				missing.length ? `missing ${missing.join(", ")}` : "",
				unpinned.length ? `not an exact x.y.z version: ${unpinned.join(", ")}` : "",
			]
				.filter(Boolean)
				.join("; "),
			"copy the [tools] of assets/mise.toml",
		);
	const tasks = table(miseToml.tasks);
	const missingTasks = TASKS.filter((t) => !(t in tasks));
	add(
		"mise.tasks",
		missingTasks.length ? "fail" : "pass",
		missingTasks.length ? `mise.toml has no task ${missingTasks.join(", ")}` : `mise.toml defines ${TASKS.join(", ")}`,
		"copy the [tasks] of assets/mise.toml",
	);
}

const lock = parsed("mise.lock", Bun.TOML.parse);
if (!lock)
	add(
		"mise.lock",
		"fail",
		tracked.has("mise.lock")
			? "mise.lock does not parse"
			: "no mise.lock: downloads are not checked against a checksum",
		LOCK,
	);
else {
	const lockTools = table(lock.tools);
	const problems: string[] = [];
	for (const t of TOOLS.filter(pinned)) {
		const want = versionOf(tools[t]);
		const entries = Array.isArray(lockTools[t]) ? (lockTools[t] as Table[]) : [];
		const entry = entries.find((e) => String(e.version) === want);
		if (!entry) {
			problems.push(`${t} ${want} not locked`);
			continue;
		}
		const unsummed = PLATFORMS.filter((p) => !String(table(entry[`platforms.${p}`]).checksum).startsWith("sha256:"));
		if (unsummed.length) problems.push(`${t} has no sha256 for ${unsummed.join(", ")}`);
	}
	add(
		"mise.lock",
		problems.length ? "fail" : "pass",
		problems.length
			? `mise.lock is stale (CI's mise install --locked fails): ${problems.join("; ")}`
			: `mise.lock has a sha256 per tool for ${PLATFORMS.join(" and ")}`,
		LOCK,
	);
}

// --- Renovate -------------------------------------------------------------------------------------------------------
const renovateFile = ["renovate.json", ".github/renovate.json"].find((f) => tracked.has(f));
const renovate = renovateFile ? parsed(renovateFile, JSON.parse) : undefined;
const extendsList = Array.isArray(renovate?.extends) ? (renovate.extends as unknown[]).map(String) : [];
if (!renovateFile) add("renovate.config", "fail", "no renovate.json", "copy assets/renovate.json");
else if (!renovate) add("renovate.config", "fail", `${renovateFile} does not parse`, "copy assets/renovate.json");
else if (!extendsList.includes(PRESET))
	add("renovate.config", "fail", `${renovateFile} does not extend ${PRESET}`, `add "${PRESET}" to "extends"`);
else add("renovate.config", "pass", `${renovateFile} extends ${PRESET}`);

// --- workflows ------------------------------------------------------------------------------------------------------
const workflowFiles = [...tracked].filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).sort();
const workflows = workflowFiles.map((file) => ({ file, doc: parsed(file, Bun.YAML.parse) }));
const jobsOf = (doc: Table | undefined) =>
	Object.entries(table(doc?.jobs)).map(([name, job]) => ({
		name,
		steps: (Array.isArray(table(job).steps) ? (table(job).steps as unknown[]) : []).map((s) => table(s) as Step),
	}));
const triggers = (doc: Table | undefined): string[] => {
	const on = doc?.on;
	return typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : Object.keys(table(on));
};

const AUTOMERGE = `${PRESET}:automerge`;
const automergePresets = extendsList.filter((e) => e === AUTOMERGE || e === `${AUTOMERGE}-minor`);
const tested = workflows.find(
	({ doc }) =>
		triggers(doc).includes("pull_request") &&
		jobsOf(doc).some((j) => j.steps.some((s) => TEST_STEP.test(`${s.run ?? ""} ${s.with?.args ?? ""}`))),
);
if (!renovate)
	add("renovate.automerge", "fail", "no parsable renovate.json, so no automerge", "copy assets/renovate.json");
else if (!extendsList.includes(AUTOMERGE))
	add(
		"renovate.automerge",
		"fail",
		`${renovateFile} does not extend ${AUTOMERGE}`,
		`make CI run the repository's tests on pull_request, then add "${AUTOMERGE}" to "extends"`,
	);
else if (tested) add("renovate.automerge", "pass", `${automergePresets.join(", ")}; ${tested.file} runs tests on PRs`);
else
	add(
		"renovate.automerge",
		"fail",
		`automerge needs tests on pull requests: no workflow with a pull_request trigger runs a test step (${automergePresets.join(", ")})`,
		"run the repository's tests in CI on pull_request",
	);

if (!workflowFiles.length)
	add(
		"ci.workflow",
		"fail",
		"no .github/workflows/*.yml",
		"add .github/workflows/ci.yml with the job in assets/ci-base.yml",
	);
else {
	add("ci.workflow", "pass", workflowFiles.join(", "));

	const loose: string[] = [];
	for (const { file, doc } of workflows) {
		if (!doc) {
			loose.push(`${file} (does not parse)`);
			continue;
		}
		const p = doc.permissions;
		if (p === undefined) loose.push(`${file} (no top-level permissions)`);
		else if (typeof p === "string" ? p !== "read-all" : Object.values(table(p)).some((v) => v === "write"))
			loose.push(`${file} (top-level ${typeof p === "string" ? p : "write"})`);
	}
	add(
		"ci.permissions",
		loose.length ? "fail" : "pass",
		loose.length
			? `the workflow token may write: ${loose.join(", ")}`
			: "every workflow's token is read-only at the top level",
		"top-level `permissions:\\n  contents: read`; grant writes per job",
	);

	const unpinned: string[] = [];
	for (const file of workflowFiles)
		for (const [i, line] of textOf(file).split("\n").entries()) {
			const u = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/.exec(line)?.[1];
			if (!u || u.startsWith("./")) continue;
			const ok = u.startsWith("docker://")
				? /@sha256:[0-9a-f]{64}$/.test(u)
				: SHA.test(u.slice(u.lastIndexOf("@") + 1)) && u.includes("@");
			if (!ok) unpinned.push(`${file}:${i + 1} ${u}`);
		}
	add(
		"ci.pinned-actions",
		unpinned.length ? "fail" : "pass",
		unpinned.length
			? `not pinned to a commit SHA (a tag can be re-pushed): ${unpinned.join(", ")}`
			: "every uses: is a commit SHA",
		"uses: owner/action@<40-hex sha> # vX.Y.Z (gh api repos/<owner>/<action>/commits/<tag> --jq .sha); docker://image@sha256:<digest>",
	);

	const baseMissing = (steps: Step[]) => {
		const missing: string[] = [];
		const uses = steps.map((s) => String(s.uses ?? ""));
		const runs = steps.map((s) => String(s.run ?? ""));
		if (!uses.some((u) => /^jdx\/mise-action@[0-9a-f]{40}$/.test(u))) missing.push("a SHA-pinned jdx/mise-action step");
		const all = runs.some((r) => /\bmise run check(?![\w:-])/.test(r));
		for (const t of TASKS)
			if (!all && !runs.some((r) => new RegExp(`\\bmise run ${t}(?![\\w:-])`).test(r))) missing.push(`mise run ${t}`);
		if (!steps.some((s) => /^actions\/checkout@/.test(String(s.uses ?? "")) && String(s.with?.["fetch-depth"]) === "0"))
			missing.push("a checkout with fetch-depth: 0");
		return missing;
	};
	const candidates = workflows
		.flatMap(({ file, doc }) =>
			jobsOf(doc).map((j) => ({ where: `${file} job ${j.name}`, missing: baseMissing(j.steps) })),
		)
		.sort((a, b) => a.missing.length - b.missing.length);
	const best = candidates[0];
	if (best && !best.missing.length) add("ci.base-job", "pass", `${best.where} runs the base checks`);
	else
		add(
			"ci.base-job",
			"fail",
			best ? `closest is ${best.where}, missing ${best.missing.join(", ")}` : "no job in any workflow",
			"paste the job in assets/ci-base.yml",
		);
}

// --- baselines: accepted findings must expire -----------------------------------------------------------------------
const osvFiles = [...tracked].filter((f) => f === "osv-scanner.toml" || f.endsWith("/osv-scanner.toml"));
if (!osvFiles.length) add("baseline.osv", "skip", "no osv-scanner.toml: nothing ignored");
else {
	const limit = Date.now() + MAX_BASELINE_DAYS * 86_400_000;
	const offenders: string[] = [];
	for (const f of osvFiles) {
		const doc = parsed(f, Bun.TOML.parse);
		if (!doc) {
			offenders.push(`${f} does not parse`);
			continue;
		}
		const entries = [
			...(Array.isArray(doc.IgnoredVulns) ? (doc.IgnoredVulns as Table[]) : []).map((e) => ({
				e,
				what: String(e.id),
				until: e.ignoreUntil,
				key: "ignoreUntil",
			})),
			...(Array.isArray(doc.PackageOverrides) ? (doc.PackageOverrides as Table[]) : []).map((e) => ({
				e,
				what: String(e.name ?? "package override"),
				until: e.effectiveUntil,
				key: "effectiveUntil",
			})),
		];
		for (const { e, what, until, key } of entries) {
			// TOML dates parse to a Date or a Temporal value depending on the Bun version; both print ISO first.
			const day = Date.parse((until instanceof Date ? until.toISOString() : String(until ?? "")).slice(0, 10));
			if (until === undefined) offenders.push(`${f} ${what}: no ${key}`);
			else if (Number.isNaN(day)) offenders.push(`${f} ${what}: ${key} is not a date`);
			else if (day > limit) offenders.push(`${f} ${what}: ${key} more than ${MAX_BASELINE_DAYS} days ahead`);
			if (!String(e.reason ?? "").trim()) offenders.push(`${f} ${what}: no reason`);
		}
	}
	add(
		"baseline.osv",
		offenders.length ? "fail" : "pass",
		offenders.length
			? offenders.join("; ")
			: `every ignore in ${osvFiles.join(", ")} expires within ${MAX_BASELINE_DAYS} days and says why`,
		`give each entry ignoreUntil/effectiveUntil at most ${MAX_BASELINE_DAYS} days ahead and a reason`,
	);
}

const zizmorFile = [".github/zizmor.yml", "zizmor.yml"].find((f) => tracked.has(f));
const zizmorIgnores = Object.entries(table(parsed(zizmorFile ?? "", Bun.YAML.parse)?.rules)).flatMap(([rule, cfg]) =>
	(Array.isArray(table(cfg).ignore) ? (table(cfg).ignore as unknown[]) : []).map((x) => `${rule}: ${x}`),
);
if (zizmorIgnores.length)
	add(
		"baseline.zizmor",
		"warn",
		`${zizmorFile} ignores (zizmor has no expiry; review them): ${zizmorIgnores.join(", ")}`,
	);
else add("baseline.zizmor", "pass", "no zizmor ignores");

// --- GitHub ---------------------------------------------------------------------------------------------------------
let isPrivate = assumePrivate;
if (offline) add("github", "skip", "--offline: GitHub settings not checked");
else githubChecks();
if (isPrivate) concurrencyCheck();

// Actions minutes are paid in a private repository: a newer push to a pull request (Renovate bringing its PR up to
// date, an agent's next commit) must cancel the run it supersedes. Pushes to the default branch keep a group each.
function concurrencyCheck() {
	const missing = workflows
		.filter(({ doc }) => triggers(doc).includes("pull_request"))
		.filter(({ doc }) => {
			const c = table(doc?.concurrency);
			const cancel = c["cancel-in-progress"];
			return !(c.group && (cancel === true || (typeof cancel === "string" && cancel.includes("${{"))));
		})
		.map(({ file }) => file);
	add(
		"ci.concurrency",
		missing.length ? "fail" : "pass",
		missing.length
			? `private repository: a newer push to a pull request does not cancel the older run in ${missing.join(", ")}`
			: "private repository: every pull_request workflow cancels the run a newer push supersedes",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, printed as is
		"workflow-level `concurrency:` with `group: ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}` and `cancel-in-progress: true`",
	);
}

function githubChecks() {
	const url = git(source, "remote", "get-url", "origin").out.trim();
	const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (!m) {
		add("github", "skip", `origin is not on github.com (${url || "no origin"})`);
		return;
	}
	const [owner, slug] = [m[1], `${m[1]}/${m[2]}`];
	if (run(["gh", "api", `repos/${slug}`, "--jq", ".private"], source).out.trim() === "true") isPrivate = true;
	const alerts = run(["gh", "api", `repos/${slug}/vulnerability-alerts`], source);
	if (alerts.ok)
		add("github.dependabot-alerts", "pass", "Dependabot alerts on (Renovate's vulnerabilityAlerts reads them)");
	else
		add(
			"github.dependabot-alerts",
			"fail",
			/\b404\b|Not Found/.test(alerts.err)
				? "Dependabot alerts off: Renovate gets no vulnerability alerts"
				: `gh api failed: ${alerts.err.trim().split("\n")[0]}`,
			`gh api -X PUT repos/${slug}/vulnerability-alerts`,
		);

	const dash = run(
		[
			"gh",
			"issue",
			"list",
			"-R",
			slug,
			"--state",
			"open",
			"--search",
			"Dependency Dashboard in:title",
			"--json",
			"author,title",
		],
		source,
	);
	const issues: { author?: { login?: string }; title?: string }[] = dash.ok ? JSON.parse(dash.out || "[]") : [];
	const active = issues.find((i) => i.author?.login === "app/renovate");
	if (active) add("renovate.active", "pass", `Renovate runs here ("${active.title}" is open)`);
	else
		add(
			"renovate.active",
			"fail",
			dash.ok ? "no Dependency Dashboard issue by Renovate" : `gh issue list failed: ${dash.err.trim().split("\n")[0]}`,
			`first Renovate run pending (≤ ~4 h); if it never appears: developer.mend.io → ${slug} → Settings → Dependencies → Silent mode off, Automated PRs on → Actions → run`,
		);

	const org = run(["gh", "api", `orgs/${owner}`, "--jq", ".two_factor_requirement_enabled"], source);
	const twoFa = org.out.trim();
	if (!org.ok || twoFa === "null" || twoFa === "")
		add("org.2fa", "skip", `${owner} is not an organization, or its 2FA setting is visible to owners only`);
	else if (twoFa === "true") add("org.2fa", "pass", `${owner} requires two-factor authentication`);
	else
		add(
			"org.2fa",
			"fail",
			`${owner} does not require two-factor authentication`,
			`github.com/organizations/${owner}/settings/security → Require two-factor authentication for everyone (confirm \`gh api user --jq .two_factor_authentication\` is true first)`,
		);
}

// --- behaviour: the checks run, the hook refuses a token ------------------------------------------------------------
if (behavior) behaviourChecks();
else add("behavior", "skip", "--no-behavior: checks and hook not run");
report();

function behaviourChecks() {
	const ids = ["run.secrets", "run.workflows", "run.shell", "run.vulns", "hook.secrets"];
	if (!run(["sh", "-c", "command -v mise"], top).ok) {
		for (const id of ids) add(id, "fail", "mise is not installed", "install mise (brew install mise)");
		return;
	}
	const install = run(["mise", "install"], top);
	if (!install.ok) {
		for (const id of ids) add(id, "fail", `mise install failed:\n       ${tail(install.err + install.out)}`);
		return;
	}

	// Secrets: the repository's own history, as CI sees it (origin's branches and the audited commit), read-only.
	const rev = ref ?? "HEAD";
	const remote = git(source, "for-each-ref", "--count=1", "refs/remotes/origin").out.trim() !== "";
	const logOpts = remote ? `--remotes=origin ${rev}` : rev;
	const secrets = run(
		[
			"mise",
			"exec",
			"--",
			"gitleaks",
			"git",
			"--redact",
			"--no-banner",
			"--log-level",
			"warn",
			"--exit-code",
			"1",
			`--log-opts=${logOpts}`,
			source,
		],
		top,
	);
	add(
		"run.secrets",
		secrets.ok ? "pass" : "fail",
		secrets.ok
			? `gitleaks: no secret in ${remote ? "origin's branches or " : ""}${rev}'s history`
			: `gitleaks found secrets in the history:\n       ${tail(secrets.err + secrets.out, 24)}`,
		"rotate the secret first; then rewrite the commits, or add the finding's fingerprint to .gitleaksignore",
	);

	for (const name of ["workflows", "shell", "vulns"]) {
		// zizmor's online audits need a token and give different answers over time; CI's base job runs them.
		const r = run(["mise", "run", `check:${name}`], top, { ZIZMOR_OFFLINE: "true" });
		add(
			`run.${name}`,
			r.ok ? "pass" : "fail",
			r.ok ? `mise run check:${name} passes` : `mise run check:${name} fails:\n       ${tail(r.err + r.out, 24)}`,
			name === "vulns"
				? "update the dependency (or let Renovate's lockFileMaintenance do it); else a dated ignore in osv-scanner.toml"
				: `fix what mise run check:${name} reports`,
		);
	}

	hookCheck();
}

function hookCheck() {
	if (tracked.has("scripts/setup.sh")) {
		const s = run(["sh", "scripts/setup.sh"], top);
		if (!s.ok) return add("hook.secrets", "fail", `scripts/setup.sh failed:\n       ${tail(s.err + s.out)}`);
	} else if (tracked.has("package.json")) {
		const s = run(["bun", "install"], top);
		if (!s.ok) return add("hook.secrets", "fail", `bun install failed:\n       ${tail(s.err + s.out)}`);
	} else if (existsSync(join(top, ".githooks"))) git(top, "config", "core.hooksPath", ".githooks");
	const hooksDir = git(top, "config", "core.hooksPath").out.trim() || ".git/hooks";
	if (!existsSync(join(top, hooksDir, "pre-commit")))
		return add(
			"hook.secrets",
			"fail",
			"after setup there is no pre-commit hook",
			"copy assets/.githooks/pre-commit and assets/scripts/setup.sh",
		);
	// No private lists for a public-repo-standard hook: what is tested is the token, not a missing blocklist.
	const env = { PRIVACY_BLOCKLIST: "none", PRIVACY_LOCAL_LIST: "/dev/null" };
	const commit = (file: string, text: string) => {
		writeFileSync(join(top, file), `${text}\n`);
		git(top, "add", file);
		return run(["git", "commit", "-q", "-m", `audit ${file}`], top, env);
	};
	const clean = commit("audit-clean.txt", "nothing here");
	if (!clean.ok)
		return add(
			"hook.secrets",
			"fail",
			`the hook refuses a clean commit, so it proves nothing:\n       ${tail(clean.err + clean.out)}`,
		);
	const probe = commit("audit-probe.txt", `token = ghp_${rand(ALNUM, 36)}`);
	add(
		"hook.secrets",
		probe.ok ? "fail" : "pass",
		probe.ok ? "a GitHub token: COMMITTED" : "a clean change: committed; a GitHub token: refused",
		probe.ok ? "put the gitleaks lines of assets/.githooks/pre-commit first in the pre-commit hook" : undefined,
	);
}

function report(): never {
	rmSync(tmp, { recursive: true, force: true });
	const failed = checks.filter((c) => c.status === "fail").length;
	if (asJson) console.log(JSON.stringify({ repo: source, audited, failed, checks }, null, 2));
	else {
		console.log(`base-repo-standard audit: ${source} at ${audited}`);
		for (const c of checks)
			console.log(
				`${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}${c.fix && c.status !== "pass" ? `\n     fix: ${c.fix}` : ""}`,
			);
		console.log(failed ? `\n${failed} check(s) failed` : "\nall required checks pass");
	}
	return process.exit(failed ? 1 : 0);
}
