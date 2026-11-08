// typst-pdf: the pinned Typst and cmarker render a Markdown document with every feature the skill documents, and the
// Markdown stays data. Downloads Typst once into node_modules/.cache/typst-pdf.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	ensureTypst,
	renderPdf,
	splitFrontmatter,
	type Typst,
	titleFromHeading,
} from "../skills/typst-pdf/scripts/pdf";

let typst: Typst;
beforeAll(async () => {
	typst = await ensureTypst(join(import.meta.dir, "..", "node_modules", ".cache", "typst-pdf"));
}, 180_000);

// A 1×1 PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64",
);

const DOC = `---
title: Diagnóstico de teste
subtitle: Acentuação, tabelas e quebras
cover_lines:
  - "Data: 07/11/2026"
footer: Confidencial
toc: true
---

# Sumário executivo

Parágrafo justificado com hifenização em português: inconstitucionalissimamente.

| Código | Descrição |
|---|---|
| \`GER_CODEMP\` | Empresa, texto de 3 caracteres |

![Logo](img/logo.png)

<!-- pagebreak -->

# Anexo

- item com \`código\`
`;

function folder(files: Record<string, string | Buffer>): string {
	const dir = mkdtempSync(join(tmpdir(), "typst-pdf-test-"));
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	return dir;
}

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("typst-pdf", () => {
	test("frontmatter is read and removed from the body", () => {
		const { meta, body } = splitFrontmatter(DOC);
		expect(meta.title).toBe("Diagnóstico de teste");
		expect(meta.cover_lines).toEqual(["Data: 07/11/2026"]);
		expect(body.startsWith("\n# Sumário executivo")).toBe(true);
	});

	test("a leading # Title without frontmatter becomes the title, and the ## sections move up", () => {
		const body = "# Proposta\n\nTexto.\n\n## Escopo\n\n```\n## not a heading\n```\n\n### Detalhe\n";
		expect(titleFromHeading({}, body)).toEqual({
			meta: { title: "Proposta" },
			body: "\nTexto.\n\n# Escopo\n\n```\n## not a heading\n```\n\n## Detalhe\n",
		});
		// Several level-1 headings: they are sections, nothing moves.
		const sections = "# Um\n\ntexto\n\n# Dois\n";
		expect(titleFromHeading({}, sections)).toEqual({ meta: {}, body: sections });
	});

	test("a document with cover, contents, table, image and a page break compiles to cover + contents + 2 pages", async () => {
		const dir = folder({ "doc.md": DOC, "img/logo.png": PNG });
		await renderPdf(join(dir, "doc.md"), join(dir, "doc.pdf"), typst);
		const pdf = readFileSync(join(dir, "doc.pdf"));
		expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
		expect(pages(pdf)).toBe(4);
	});

	test("Typst written in the Markdown is text, not code", async () => {
		const md = '<!--raw-typst #panic("raw typst ran") -->\n\n#panic("markup ran") and `#panic("code")`\n';
		const dir = folder({ "doc.md": md });
		await renderPdf(join(dir, "doc.md"), join(dir, "doc.pdf"), typst);
		expect(readFileSync(join(dir, "doc.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
	});

	test("an image outside the document's folder cannot be read", async () => {
		const dir = folder({ "doc.md": "![x](../../etc/hosts)\n" });
		await expect(renderPdf(join(dir, "doc.md"), join(dir, "doc.pdf"), typst)).rejects.toThrow();
	});

	test("an image that is a symlink to a file outside the document's folder is refused", async () => {
		const secret = folder({ "secret.png": PNG });
		const dir = folder({ "doc.md": "![x](img.png)\n" });
		symlinkSync(join(secret, "secret.png"), join(dir, "img.png"));
		await expect(renderPdf(join(dir, "doc.md"), join(dir, "doc.pdf"), typst)).rejects.toThrow(/outside the document/);
	});
});
