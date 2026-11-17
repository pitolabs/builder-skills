// Builds the file each harness reads: instructions/AGENTS.md (every environment) followed by one environment's layer
// (instructions/<env>.md), written to instructions/<env>/AGENTS.md. `--check` writes nothing and exits 1 when a built
// file differs from its sources (test/instructions.test.ts runs the same check in CI).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DIR = join(import.meta.dir, "../instructions");
// scripts/check-load.sh asks each harness for this heading, so every layer must start with it.
export const LAYER_HEADING = /^## Environment: \S.*\n/;

export function environments(): string[] {
	return readdirSync(DIR, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "AGENTS.md")
		.map((e) => e.name.slice(0, -".md".length))
		.sort();
}

export function build(env: string): string {
	const shared = readFileSync(join(DIR, "AGENTS.md"), "utf8");
	const layer = readFileSync(join(DIR, `${env}.md`), "utf8");
	if (!LAYER_HEADING.test(layer)) throw new Error(`instructions/${env}.md must start with "## Environment: <name>"`);
	const [title, ...rest] = shared.trimEnd().split("\n");
	const notice = `<!-- Built by scripts/instructions.ts from instructions/AGENTS.md and instructions/${env}.md: edit those, then run it. -->`;
	return [title, notice, ...rest, "", layer.trimEnd(), ""].join("\n");
}

export function stale(): string[] {
	return environments().filter((env) => {
		try {
			return readFileSync(join(DIR, env, "AGENTS.md"), "utf8") !== build(env);
		} catch {
			return true;
		}
	});
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		const out = stale();
		for (const env of out) console.error(`instructions/${env}/AGENTS.md is stale: run bun scripts/instructions.ts`);
		process.exit(out.length ? 1 : 0);
	}
	for (const env of environments()) {
		mkdirSync(join(DIR, env), { recursive: true });
		writeFileSync(join(DIR, env, "AGENTS.md"), build(env));
		console.log(`instructions/${env}/AGENTS.md`);
	}
}
