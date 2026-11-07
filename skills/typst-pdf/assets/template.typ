// The layout scripts/pdf.ts compiles: A4, a cover from the frontmatter, the title in the header, "Página X de Y"
// (or "Page X of Y") in the footer, justified text hyphenated for the document's language, tables with a dark header
// row and zebra rows. Edit this file to change the look of every PDF the skill makes.
//
// meta.json (written by pdf.ts from the Markdown's frontmatter): title, subtitle, author, cover_lines, cover, footer,
// toc, lang, region, and parts (the Markdown split at each <!-- pagebreak --> line).
#import "@preview/cmarker:VERSION"

#let meta = json("meta.json")
#let get(key, default: none) = meta.at(key, default: default)
#let lang = get("lang", default: "pt")
#let region = get("region", default: if lang == "pt" { "br" } else { none })
#let ink = rgb("#1a1a2e")
#let accent = rgb("#0f3460")
#let title = get("title")
#let author = get("author", default: ())
#let has-cover = title != none and get("cover", default: true)

#set document(title: title, author: if type(author) == str { (author,) } else { author })
#set text(lang: lang, region: region, font: "Libertinus Serif", size: 10.5pt, hyphenate: true)
#set par(justify: true, leading: 0.62em, spacing: 0.95em)
#set page(
  paper: "a4",
  margin: (x: 22mm, top: 24mm, bottom: 22mm),
  header: context if title != none and counter(page).get().first() > 0 {
    align(right, text(8pt, fill: luma(130), title))
  },
  footer: context align(center, text(8pt, fill: luma(130))[
    #if lang == "pt" [Página] else [Page]
    #counter(page).display()
    #if lang == "pt" [de] else [of]
    #counter(page).final().first()
    #if get("footer") != none [ · #get("footer")]
  ]),
)

#show raw: set text(font: "DejaVu Sans Mono", size: 0.82em)
#show raw.where(block: false): box.with(fill: luma(238), inset: (x: 1.5pt), outset: (y: 2pt), radius: 1.5pt)
#show raw.where(block: true): block.with(fill: luma(244), inset: 8pt, radius: 3pt, width: 100%)
#show heading: set text(fill: ink)
#show heading: set block(above: 1.5em, below: 0.8em, sticky: true)
#show heading.where(level: 1): it => block(
  width: 100%,
  stroke: (bottom: 1.2pt + ink),
  inset: (bottom: 4pt),
  text(16pt, it),
)
#show heading.where(level: 2): set text(13pt)
#show heading.where(level: 3): set text(11pt, fill: accent)
#show link: set text(fill: accent)
#show quote.where(block: true): it => block(
  width: 100%,
  fill: rgb("#f4f6fa"),
  stroke: (left: 3pt + accent),
  inset: (x: 12pt, y: 9pt),
  it.body,
)
#set table(
  stroke: 0.5pt + luma(195),
  inset: (x: 5pt, y: 4pt),
  fill: (_, y) => if y == 0 { ink } else if calc.even(y) { luma(246) },
)
#show table: set text(size: 8.6pt)
#show table: set par(justify: false)
#show table.cell.where(y: 0): set text(fill: white, weight: "bold")
// Code in a header cell: plain white monospace, without the grey box (it would read as a black patch).
#show table.cell.where(y: 0): it => {
  show raw: r => text(font: "DejaVu Sans Mono", size: 0.82em, fill: white, r.text)
  it
}

#if has-cover {
  page(header: none, footer: none)[
    #v(1fr)
    #align(center)[
      #set par(justify: false)
      #set text(hyphenate: false)
      #block(width: 85%, text(24pt, weight: "bold", fill: ink, title))
      #if get("subtitle") != none {
        v(10pt)
        block(width: 80%, text(12pt, get("subtitle")))
      }
      #v(22pt)
      #for line in get("cover_lines", default: ()) [
        #text(10.5pt, line) \
      ]
    ]
    #v(1.6fr)
  ]
  counter(page).update(1)
}

#if get("toc", default: false) {
  outline(title: if lang == "pt" [Sumário] else [Contents], depth: 2)
  pagebreak()
}

#for (i, part) in meta.parts.enumerate() {
  if i > 0 { pagebreak() }
  cmarker.render(
    read(part),
    raw-typst: false,
    scope: (image: (path, alt: none) => image(path, alt: alt)),
  )
}
