---
name: typst-pdf
description: >-
  Turns a Markdown file into a print-quality PDF with a pinned Typst and the cmarker package: Inter type, cover page
  from the frontmatter, optional designed front pages (one-pager, KPI cards, flows, charts) in Typst, table of
  contents, running header, "Página X de Y" footer, tables with header rows, page breaks on request, pt-BR by
  default. Use for reports, diagnoses, proposals, one-pagers, contracts or any document someone will read or print —
  'gera um PDF do relatório', 'export this markdown as PDF', 'make a PDF of the diagnosis', 'faz um one-pager
  bonito'. Prefer it to printing Markdown from a browser, whose page breaks and fonts are weaker. Do NOT use for
  slide decks or for filling or editing an existing PDF. pitomastra's send_pdf tool uses the same template and fonts
  through its own pinned copy; change them here, then bump that pin.
---

# Markdown to PDF with Typst

`scripts/pdf.ts` lays a Markdown file out with `assets/template.typ` and writes a PDF:

```bash
bun ~/.config/opencode/skills/typst-pdf/scripts/pdf.ts report.md               # writes report.pdf
bun ~/.config/opencode/skills/typst-pdf/scripts/pdf.ts report.md --out out.pdf
```

The first run downloads the pinned Typst binary and the cmarker package (Markdown → Typst) into `~/.cache/typst-pdf`
(`TYPST_PDF_CACHE` elsewhere), each checked against its sha256; later runs are offline. It needs Bun only. The PDF is
the same on every machine: Typst uses Inter from `assets/fonts` (SIL Open Font License, `OFL.txt`) and its own
embedded fonts, never the system's.

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
- **Not supported in Markdown:** raw HTML (`<div>`, `<br>`, inline styles) is dropped, and Mermaid diagrams are not
  drawn: turn a diagram into a table, an image or a designed page.

The Markdown is data, never code: cmarker runs with `raw-typst` off, so Typst written in the text stays text, and
Typst's root is a fresh temp folder holding only the template, the Markdown, its images and the front pages.

## Designed front pages

Markdown gives text, lists and tables. For what someone reads first (a one-pager for a decision maker, an executive
summary, a dashboard of the findings) write those pages in Typst and name the file in the frontmatter:

```yaml
front: abertura.typ   # next to the Markdown; its pages come after the cover and before the body
```

The file is the author's own code (unlike the Markdown, it runs), so it must sit in the document's folder; symlinks
out of it are refused. It starts with `#import "kit.typ": *`, which gives the palette (`ink`, `coral`, `blue`,
`teal`, `amber`, `violet`, `tint(c, 10%)`), `sans` (Inter) and blocks: `kpi` (big number and label), `card`
(coloured top edge), `callout`, `pill`, `badge`, `flow` (steps with arrows), `bar`, `swatches`, `bubble` (a chat
message, for showing a WhatsApp flow), `fact` (a "Nos dados" / "A validar" line) and `band-background` (a dark title
band). Each page is a `#page(…)[…]` with its own margins and `set text(font: sans)`; see `assets/kit.typ`.

- **One idea per page, scannable in a minute:** a title that says the conclusion, 3 to 4 KPIs, one card per idea with
  a small visual (a flow, a chat, a bar), what the data supports and what is still to check.
- **Every number from the document**, with its caveat in small type (estimates, samples); illustrations (a made-up
  chat, an example colour) labelled as such.
- **Fit the page:** render, look at it, and cut words before shrinking type below ~7 pt.

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

- **Look:** `assets/template.typ` (page, fonts, colours, cover, header, footer, tables) and `assets/kit.typ` (the
  blocks of designed pages, same palette). Both are ordinary Typst; the template's header comment lists the metadata
  it reads.
- **Shared with pitomastra:** its WhatsApp `send_pdf` compiles this same template (cover and header off) with the
  Inter fonts, all downloaded by commit and sha256 in its `scripts/typst.sh` (not `kit.typ`: no front pages there).
  After changing the template or the fonts here and pushing, update `TEMPLATE_COMMIT` and the sha256 values there;
  until then its PDFs keep the old look.
- **Versions:** `TYPST_VERSION`, `CMARKER_VERSION` and their sha256 at the top of `scripts/pdf.ts`. Take the sha256
  from the Typst release's asset digests and from the downloaded cmarker package; the next run replaces the cache.
  pitomastra's `scripts/typst.sh` pins the same versions: move both together.
- **Test:** `bun test test/typst-pdf.test.ts` in this repository renders a fixture with every feature above.
