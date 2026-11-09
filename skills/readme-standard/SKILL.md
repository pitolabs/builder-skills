---
name: readme-standard
description: >-
  Use when writing or rewriting the README of a library, package or public repository - 'write a README for this
  package', 'make the README friendlier', 'the README is too long/complex', 'add a banner and badges', 'split the
  README into docs'. Covers the welcome-first shape (banner, badges, a pitch in two sentences, a feature list, a quick
  start that compiles), moving depth into docs/ next to the code, an SVG hero image, neutral example names, and the
  checks before pushing. Do NOT use for a project's internal AGENTS.md or contributor rules alone (that is
  CONTRIBUTING.md, covered here only as a link target), for slide decks or for a skill's own SKILL.md (write-skill).
---

# README standard

A README has two readers: someone deciding in thirty seconds whether this is for them, and someone who already
decided and needs the detail. One file cannot serve both: the first leaves when the second's content starts. So the
README is for the first reader, and the detail lives in `docs/` next to the code, linked from a table.

## Shape

In this order; each part short. Markdown headings with one emoji each, like the popular repositories readers already
know (`# 👋 Welcome`, `## ✨ What you get`, `## 🚀 Quick start`).

1. **Banner**: an SVG in `docs/hero.svg`, centered, with the name, one line of pitch and the pipeline or shape of the
   thing drawn in boxes and arrows. See [the banner](#the-banner).
2. **Badges**, centered under it: npm/PyPI version, CI status, license. Three; more is noise. Not published yet or no
   CI: leave those out (a hand-made "version 0.1.0" badge says nothing a reader can click); the licence one stays.
3. **Welcome**: `# 👋 Welcome to <name>`, then one paragraph that says what it does **for the reader** in plain words,
   with one concrete example question the thing answers ("*when does the accountant's contract end?*"). Name the
   framework it targets and whether a framework-neutral part exists.
4. **What you get**: 5-8 bullets, each `emoji **bold claim**: one line of specifics` (the key format, the tool names,
   the providers). Specifics are what make a claim believable; keep adjectives out.
5. **Why it is light** (one short paragraph or 3-4 bullets): the qualities a reader weighs before adopting, each tied
   to a number or a fact: *lightweight* (how many dependencies, how many files, no native build), *low cost* (one
   model call per document, no vector database to run, a single file on disk), *private* (what never leaves the
   machine, what the errors never carry), *simple to run* (one process, no services). A quality without its evidence
   is marketing; with it, it is a reason. Skip any that is not true.
6. **Quick start**: the install line (both package managers when the project is Bun-first: `bun add x  # or: npm
   install x`; not on a registry yet: say so in one line and how to use it from a workspace instead), then one code
   block of about 20 lines that goes from import to a working object. It must compile against the real types: see
   [checks](#checks-before-pushing). One or two sentences after it for what the snippet leaves to the host, pointing
   at the guide.
7. **Learn more**: a two-column table, emoji + link on the left, what the page answers on the right: guide,
   reference, design notes, contributing.
8. **Anything the reader must know before adopting**: language of prompts and tool descriptions, a platform limit, a
   licence quirk. One short section each, only when true.
9. **Who made it and why**: two sentences, the licence, an invitation.

Nothing else. No API tables, no environment-variable lists, no architecture essays, no changelog: those go to
`docs/`.

## The docs/ split

Move depth out by *reader question*, not by code module:

| File | Answers |
|---|---|
| `docs/guide.md` | "How do I wire it in?" Step by step, every knob, the host's responsibilities. The pipeline diagram (text) lives here. |
| `docs/reference.md` | "What exactly does X accept and do?" Entry points, config tables, env vars, storage layout, policies (IAM, data flow), rebuild. |
| `docs/design.md` | "Why is it built like this, and what is planned?" The alternatives considered, with a comparison table; what is reused; roadmap. |
| `CONTRIBUTING.md` | Setup, hooks, formatting, tests, releasing. |

Each page opens with one sentence saying what it covers and links the sibling pages. Keep a page under ~150 lines;
split by question again when it grows. Delete, do not duplicate: a fact lives in one page and the README links it.

## The banner

A hand-written SVG, not a bitmap: it diffs, it scales, it needs no design tool, and the linter checks it.

- `viewBox="0 0 960 300"`; rounded dark gradient background; the name at 34px bold, the pitch at 17px, a short
  accent-gradient rule under them.
- The shape of the thing as 4-5 rounded boxes with an emoji, a bold label and a grey sub-label, joined by arrows with
  a marker; one grey caption line at the bottom.
- `role="img"`, `aria-labelledby`, and a `<title>`: Biome's `a11y/noSvgWithoutTitle` rule fails `format:check`
  without it, and the title is the alt text for readers who cannot see the image.
- Fonts from the system stack (`ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial`); emoji render from the
  reader's fonts.
- Every word in it in the README's language. The banner is copied into blog posts and npm pages without the
  surrounding text, so a word from the product's home locale ("sim" for yes) reads as a bug there.

Render it before committing (`read docs/hero.svg:img`, or open it in a browser) and look at it as a stranger:
the labels must make sense with no README around them.

## Neutral examples

A package extracted from an application carries that application's names in its examples, comments and tests
(`docsConfig("KINE")`, `where: "WhatsApp do KineBot"`, `const villa = …`). A reader does not know those products
and reads them as required values. Before publishing, grep the README, `docs/`, the source comments and the tests for
every internal product, person and place name, and replace each with a role name (`clerk`, `bucket-a`,
`"WhatsApp da empresa"`). Strings the code requires in another language stay in that language, with a note saying
so; the prose around them is in the README's language.

## Checks before pushing

- **The quick start compiles.** Extract the snippet, rewrite the package import to the local entry point, drop it in
  the test folder and run the project's typecheck; delete it after. A README that fails on line 3 loses the reader
  for good. A package without its own `typecheck` script (a workspace member, a folder of sources): run `tsc` with
  the nearest `tsconfig.json` and `node_modules` (`bun x tsc --noEmit -p <root>/tsconfig.json`), or a throwaway
  tsconfig that includes the snippet and `src/`; delete that too.
  ```bash
  awk '/^```ts$/{f=1;next}/^```$/{f=0}f' README.md | sed 's#"<package>/mastra"#"../src/mastra/index.ts"#' > test/readme-snippet.ts
  bun run typecheck; rm test/readme-snippet.ts
  ```
- **Every link resolves**: `grep -oE '\]\((docs/[a-z.]+|CONTRIBUTING.md|LICENSE)' README.md docs/*.md`, then
  `test -e` each.
- **The formatter and linter pass** (`format:check`): the SVG is a source file to them.
- **Look at the rendered page** on GitHub after pushing (`read https://github.com/<owner>/<repo>`): the banner's
  width, the badge row, the table.
- **No product, person or place names** from the originating application (the grep above).

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
|---|---|---|
| The README is the reference | The first reader leaves at the env-var table | README welcomes; `docs/reference.md` lists |
| A diagram as a code block in the README | Reads as code, not as shape | SVG banner at the top; the text diagram in the guide |
| Example named after the product it came from | Reads as a required value | Role names (`clerk`), neutral buckets |
| Quick start that was never run | Breaks on the first copy-paste | Typecheck the extracted snippet |
| A bitmap hero from a design tool | Cannot diff, drifts from the text | Hand-written SVG with a `<title>` |
| Eight badges | None is read | Version, CI, licence |
| "Comprehensive", "powerful", "blazing" | Adjectives are not evidence | The specific: the key format, the tool names, the provider list |
