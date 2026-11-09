#!/usr/bin/env bun
// Markdown -> PDF with a pinned Typst and the cmarker package, laid out by ../assets/template.typ.
//
//   bun pdf.ts <file.md> [--out <file.pdf>]
//
// The first run downloads Typst and cmarker into ~/.cache/typst-pdf (TYPST_PDF_CACHE elsewhere), each checked against
// its sha256; later runs are offline. The Markdown is data, never code: cmarker runs with raw-typst off, Typst's root
// is a fresh temp folder holding only the template, the Markdown parts, the local images the Markdown names and the
// optional designed front pages (`front:` in the frontmatter, the author's own Typst, with ../assets/kit.typ), and
// only the fonts in ../assets/fonts and Typst's embedded ones are used (the same PDF on every machine).
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const TYPST_VERSION = "0.15.1";
export const CMARKER_VERSION = "0.1.8";
const CMARKER_SHA256 = "157cc40db2716f12c7eabb95df1f60714a4d95ebfb1c6087cf4aec224e49392a";
// Release assets of Typst TYPST_VERSION and their sha256 (the GitHub release's digests).
const BUILDS: Record<string, { target: string; sha256: string }> = {
	"darwin-arm64": {
		target: "aarch64-apple-darwin",
		sha256: "48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a",
	},
	"linux-arm64": {
		target: "aarch64-unknown-linux-musl",
		sha256: "5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee",
	},
	"linux-x64": {
		target: "x86_64-unknown-linux-musl",
		sha256: "a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c",
	},
};
const ASSETS = join(import.meta.dir, "..", "assets");
const TEMPLATE = join(ASSETS, "template.typ");
const KIT = join(ASSETS, "kit.typ");
const FONTS = join(ASSETS, "fonts");
const COMPILE_TIMEOUT_MS = 120_000;
// A line holding only this comment starts a new page.
const PAGEBREAK = /^[ \t]*<!--\s*pagebreak\s*-->[ \t]*$/m;
const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export interface Typst {
	bin: string;
	packages: string;
}

async function download(url: string, file: string, expected: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`typst-pdf: ${url} answered ${res.status}`);
	writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
	const got = createHash("sha256").update(readFileSync(file)).digest("hex");
	if (got !== expected) throw new Error(`typst-pdf: ${url} has sha256 ${got}, expected ${expected}`);
}

function run(cmd: string[], timeout?: number): void {
	const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout });
	if (p.exitCode !== 0) {
		const why = p.signalCode ? `killed (${p.signalCode})` : p.stderr.toString().trim();
		throw new Error(`${cmd[0]} failed: ${why}`);
	}
}

/** The pinned Typst and cmarker, downloaded on first use. */
export async function ensureTypst(
	cache = process.env.TYPST_PDF_CACHE || join(homedir(), ".cache", "typst-pdf"),
): Promise<Typst> {
	const build = BUILDS[`${process.platform}-${process.arch}`];
	if (!build) throw new Error(`typst-pdf: no pinned Typst build for ${process.platform}-${process.arch}`);
	const bin = join(cache, "bin", "typst");
	const packages = join(cache, "packages");
	const stamp = join(cache, ".installed");
	const want = `typst ${TYPST_VERSION} ${build.target}, cmarker ${CMARKER_VERSION}`;
	if (existsSync(stamp) && readFileSync(stamp, "utf8") === want && existsSync(bin)) return { bin, packages };

	const tmp = mkdtempSync(join(tmpdir(), "typst-pdf-dl-"));
	try {
		const tarXz = join(tmp, "typst.tar.xz");
		const tarGz = join(tmp, "cmarker.tar.gz");
		await download(
			`https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${build.target}.tar.xz`,
			tarXz,
			build.sha256,
		);
		await download(`https://packages.typst.org/preview/cmarker-${CMARKER_VERSION}.tar.gz`, tarGz, CMARKER_SHA256);
		rmSync(cache, { recursive: true, force: true });
		const cmarkerDir = join(packages, "preview", "cmarker", CMARKER_VERSION);
		mkdirSync(join(cache, "bin"), { recursive: true });
		mkdirSync(cmarkerDir, { recursive: true });
		run(["tar", "-xJf", tarXz, "-C", tmp]);
		copyFileSync(join(tmp, `typst-${build.target}`, "typst"), bin);
		run(["chmod", "0755", bin]);
		run(["tar", "-xzf", tarGz, "-C", cmarkerDir]);
		writeFileSync(stamp, want);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return { bin, packages };
}

export interface Meta {
	title?: string;
	subtitle?: string;
	author?: string | string[];
	/** Lines under the title on the cover (date, who prepared it, confidentiality). */
	cover_lines?: string[];
	/** false: no cover page even with a title. */
	cover?: boolean;
	/** Text after the page number in the footer, e.g. "Confidencial". */
	footer?: string;
	/** true: a table of contents after the cover. */
	toc?: boolean;
	/** ISO 639-1; "pt" (the default) hyphenates as pt-BR and writes "Página X de Y". */
	lang?: string;
	region?: string;
	/** A Typst file next to the Markdown: designed pages placed before the body (it may `#import "kit.typ": *`). */
	front?: string;
}

/** YAML frontmatter and the body after it. */
export function splitFrontmatter(markdown: string): { meta: Meta; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
	if (!m) return { meta: {}, body: markdown };
	const parsed = Bun.YAML.parse(m[1] ?? "");
	const meta = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Meta) : {};
	return { meta, body: markdown.slice(m[0].length) };
}

/**
 * A document without a frontmatter title whose only level-1 heading is its first line (`# Title`, sections in `##`):
 * that heading becomes the title (cover and running header) and every other heading moves up one level, so sections
 * are `#` as the template expects. Lines inside code fences are left alone.
 */
export function titleFromHeading(meta: Meta, body: string): { meta: Meta; body: string } {
	if (meta.title) return { meta, body };
	const lines = body.split("\n");
	let fence = false;
	const level1: number[] = [];
	lines.forEach((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		else if (!fence && /^# \S/.test(line)) level1.push(i);
	});
	const first = lines.findIndex((l) => l.trim() !== "");
	if (level1.length !== 1 || level1[0] !== first) return { meta, body };
	const title = (lines[first] as string).slice(2).trim();
	fence = false;
	const rest = lines.slice(first + 1).map((line) => {
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		return !fence && /^#{2,6} \S/.test(line) ? line.slice(1) : line;
	});
	return { meta: { ...meta, title }, body: rest.join("\n") };
}

/** Local image paths the Markdown names (no URLs, no paths that leave the document's folder). */
function localImages(body: string): string[] {
	const out = new Set<string>();
	for (const [, raw] of body.matchAll(IMAGE)) {
		const path = decodeURI(raw ?? "");
		if (/^[a-z]+:/i.test(path) || isAbsolute(path)) continue;
		const clean = normalize(path);
		if (clean.startsWith("..")) continue;
		out.add(clean);
	}
	return [...out];
}

/**
 * The real path of a file the document names, which must sit inside the document's folder once symlinks are resolved
 * (an image or front page that points elsewhere is refused, so a crafted link cannot pull another file into the PDF).
 */
function insideFolder(source: string, rel: string, what: string): string {
	const folder = realpathSync(dirname(source));
	const from = resolve(dirname(source), rel);
	if (!existsSync(from)) throw new Error(`typst-pdf: ${what} not found: ${rel}`);
	const real = realpathSync(from);
	if (!real.startsWith(folder + sep)) throw new Error(`typst-pdf: ${what} outside the document's folder: ${rel}`);
	return real;
}

/** Renders the Markdown file to a PDF; throws with Typst's diagnostics when it does not compile. */
export async function renderPdf(input: string, output: string, typst?: Typst): Promise<void> {
	const t = typst ?? (await ensureTypst());
	const source = resolve(input);
	const split = splitFrontmatter(readFileSync(source, "utf8"));
	const { meta, body } = titleFromHeading(split.meta, split.body);
	const parts = body.split(PAGEBREAK);
	const root = mkdtempSync(join(tmpdir(), "typst-pdf-"));
	try {
		const names = parts.map((_, i) => `part-${i}.md`);
		parts.forEach((part, i) => {
			writeFileSync(join(root, names[i] as string), part);
		});
		for (const img of localImages(body)) {
			const real = insideFolder(source, img, "image");
			mkdirSync(dirname(join(root, img)), { recursive: true });
			copyFileSync(real, join(root, img));
		}
		if (meta.front !== undefined) {
			if (typeof meta.front !== "string" || !meta.front.endsWith(".typ"))
				throw new Error("typst-pdf: front must name a .typ file next to the Markdown");
			copyFileSync(insideFolder(source, meta.front, "front"), join(root, "front.typ"));
			copyFileSync(KIT, join(root, "kit.typ"));
		}
		const front = meta.front === undefined ? {} : { front: "front.typ" };
		writeFileSync(
			join(root, "meta.json"),
			JSON.stringify({ ...meta, ...front, parts: names, cmarker: CMARKER_VERSION }),
		);
		writeFileSync(
			join(root, "main.typ"),
			readFileSync(TEMPLATE, "utf8").replace("@preview/cmarker:VERSION", `@preview/cmarker:${CMARKER_VERSION}`),
		);
		const out = join(root, "out.pdf");
		const compile = [
			t.bin,
			"compile",
			"--root",
			root,
			"--package-path",
			t.packages,
			"--ignore-system-fonts",
			"--font-path",
			FONTS,
		];
		run([...compile, join(root, "main.typ"), out], COMPILE_TIMEOUT_MS);
		mkdirSync(dirname(resolve(output)), { recursive: true });
		copyFileSync(out, resolve(output));
	} catch (e) {
		throw new Error(String((e as Error).message).replaceAll(`${root}/`, ""));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const outAt = args.indexOf("--out");
	const out = outAt >= 0 ? args[outAt + 1] : undefined;
	const input = args.find((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));
	if (!input || (outAt >= 0 && !out)) {
		console.error("usage: bun pdf.ts <file.md> [--out <file.pdf>]");
		process.exit(2);
	}
	const output = out ?? `${input.replace(/\.(md|markdown)$/i, "")}.pdf`;
	try {
		await renderPdf(input, output);
		console.log(output);
	} catch (e) {
		console.error((e as Error).message);
		process.exit(1);
	}
}
