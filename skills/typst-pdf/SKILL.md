---
name: typst-pdf
description: >-
  Turns a Markdown file into a print-quality PDF with a pinned Typst and the cmarker package: cover page from the
  frontmatter, table of contents, running header, "Página X de Y" footer, justified and hyphenated text (pt-BR by
  default, any language), tables with header rows, page breaks on request. Use for reports, diagnoses, proposals,
  contracts or any document someone will read or print — 'gera um PDF do relatório', 'export this markdown as PDF',
  'make a PDF of the diagnosis', 'converte para PDF em português'. Prefer it over browser-based Markdown-to-PDF tools
  (md-to-pdf, Chrome printing), whose page breaks, hyphenation and fonts are weaker. Do NOT use for slide decks
  (marp), for filling or editing an existing PDF, or for a PDF an agent sends on WhatsApp from pitomastra
  (send_pdf, its own template and safety rules).
---

# Markdown to PDF with Typst

`scripts/pdf.ts` lays a Markdown file out with `assets/template.typ` and writes a PDF:

```bash
bun ~/.config/opencode/skills/typst-pdf/scripts/pdf.ts report.md               # writes report.pdf
bun ~/.config/opencode/skills/typst-pdf/scripts/pdf.ts report.md --out out.pdf
```

The first run downloads the pinned Typst binary and the cmarker package (Markdown → Typst) into `~/.cache/typst-pdf`
(`TYPST_PDF_CACHE` elsewhere), each checked against its sha256; later runs are offline. It needs Bun only. The PDF is
the same on every machine: Typst uses its own embedded fonts, never the system's.

## Write the Markdown for it

Put the document's metadata in YAML frontmatter; the template reads it, the body never shows it. Work on a copy when
the source file belongs to someone else.

```yaml
---
title: Diagnóstico do banco de dados
subtitle: O que encontramos e o que recomendamos
author: Ana Souza
cover_lines:
  - "Data: 07/11/2026"
  - "Documento confidencial"
footer: Confidencial        # after "Página X de Y"
toc: true                   # table of contents after the cover (for documents of more than a few pages)
lang: pt                    # default pt (pt-BR); en, es… switch hyphenation and the footer's words
---
```

- **Cover:** a `title` makes a cover page (title, subtitle, cover lines) and the running header; `cover: false` keeps
  the header without the cover. Page numbers start after the cover, in the footer and the contents alike.
- **No frontmatter needed for the title:** a file whose first line is `# Title` and whose sections are `##` gets that
  title on the cover and its sections moved up to `#`. Add frontmatter only for what the file does not say.
- **Do not invent cover text.** A subtitle, author or date the source does not give is a question for the person
  asking, or left out; a cover with only the title is fine.
- **Headings:** `#` for sections (they get a rule underneath and go into the table of contents), `##` and `###`
  below. A heading never ends a page alone.
- **Contents:** `toc: true` only for documents long enough to navigate; on a two-page document it fills a page.
- **Page breaks:** a line holding only `<!-- pagebreak -->`. Use it before annexes or a section that must start a
  page; let Typst place the rest, since forced breaks leave half-empty pages.
- **Tables:** plain Markdown tables. They break across pages with the header row styled; keep cells short, since a
  table is laid out on the page width (8.6 pt text). Code inside cells (`` `CODE` ``) is fine.
- **Images:** relative paths next to the Markdown (`![Fluxo](fluxo.png)`). URLs and paths outside the document's
  folder are refused.
- **Not supported:** raw HTML (`<div>`, `<br>`, inline styles) is dropped, and Mermaid diagrams are not drawn: turn a
  diagram into a table or an image first.

The Markdown is data, never code: cmarker runs with `raw-typst` off, so Typst written in the text stays text, and
Typst's root is a fresh temp folder holding only the template, the Markdown and its images.

## Check the result

Look at the pages, not only the exit code: a PDF can compile and still have an orphaned table or a cramped cell.

```bash
uv run --with pypdfium2 --with pillow python -c "
import pypdfium2 as p; d = p.PdfDocument('report.pdf'); print(len(d), 'pages')
[d[i].render(scale=1.1).to_pil().save(f'/tmp/page-{i+1}.png') for i in range(len(d))]"
```

Then open the page images. Fix what you see in the Markdown first (shorter cells, a page break, a split table);
change `assets/template.typ` only for something every document should get.

## Change the look or the pins

- **Look:** `assets/template.typ` (page, fonts, colours, cover, header, footer, tables). It is ordinary Typst; its
  header comment lists the metadata it reads.
- **Versions:** `TYPST_VERSION`, `CMARKER_VERSION` and their sha256 at the top of `scripts/pdf.ts`. Take the sha256
  from the Typst release's asset digests and from the downloaded cmarker package; the next run replaces the cache.
  pitomastra's `scripts/typst.sh` pins the same versions for `send_pdf`: move both together.
- **Test:** `bun test test/typst-pdf.test.ts` in this repository renders a fixture with every feature above.
