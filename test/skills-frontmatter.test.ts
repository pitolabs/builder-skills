// Every skill must load in any Agent Skills client: the frontmatter rules of https://agentskills.io/specification.
// A skill that breaks them may load in one harness and be silently skipped by another.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS = join(import.meta.dir, "../skills");
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("skill frontmatter (Agent Skills specification)", () => {
	for (const dir of readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
		test(dir.name, () => {
			const text = readFileSync(join(SKILLS, dir.name, "SKILL.md"), "utf8");
			const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
			expect(m).not.toBeNull();
			const fm = Bun.YAML.parse(m?.[1] ?? "") as Record<string, unknown>;
			expect(fm.name).toBe(dir.name);
			expect(String(fm.name)).toMatch(NAME);
			expect(String(fm.name).length).toBeLessThanOrEqual(64);
			expect(typeof fm.description).toBe("string");
			const description = String(fm.description);
			expect(description.trim().length).toBeGreaterThan(0);
			expect(description.length).toBeLessThanOrEqual(1024);
			if (fm.compatibility !== undefined) expect(String(fm.compatibility).length).toBeLessThanOrEqual(500);
		});
	}
});
