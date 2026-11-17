// The harnesses read the built files (instructions/<env>/AGENTS.md), not the sources: a source edited without
// rebuilding never reaches an agent.
import { expect, test } from "bun:test";
import { environments, stale } from "../scripts/instructions";

test("the layers the README and PitoBox link to exist", () => {
	expect(environments()).toEqual(["macos", "pitobox"]);
});

test("built instructions match their sources (run bun scripts/instructions.ts)", () => {
	expect(stale()).toEqual([]);
});
