// The layout scripts/pdf.ts compiles: A4 in Inter (assets/fonts; Libertinus Serif where Inter is absent), a cover
// from the frontmatter, optional designed front pages, the title and "Página X de Y" (or "Page X of Y") in a thin
// header and footer, ragged-right text in the document's language, sections opened by a short colour bar, tables
// with a dark header row and light rules, quotes as callouts. Edit this file to change the look of every PDF
// the skill makes; kit.typ holds the building blocks of designed pages (same palette).
//
// meta.json (written by the caller from the Markdown's frontmatter): title, subtitle, author, cover_lines, cover,
// header, footer, toc, lang, region, front (then front.typ is in the root), and parts (the Markdown split at each
// <!-- pagebreak --> line).
//
// Shared: pitomastra's send_pdf compiles this same file, pinned by commit and sha256 in its scripts/typst.sh, with
// cover and header off. Keep it free of anything that reads files other than meta.json, the parts and front.typ.
#import "@preview/cmarker:VERSION"

#let meta = json("meta.json")
#let get(key, default: none) = meta.at(key, default: default)
#let lang = get("lang", default: "pt")
#let region = get("region", default: if lang == "pt" { "br" } else { none })
#let ink = rgb("#172036")
#let accent = rgb("#2e6fac")
#let warm = rgb("#e4572e")
#let muted = rgb("#5b6478")
#let rule = rgb("#d9dee8")
#let surface = rgb("#f3f5f9")
#let title = get("title")
#let author = get("author", default: ())
#let has-cover = title != none and get("cover", default: true)
#let footer-note = get("footer")

#set document(title: title, author: if type(author) == str { (author,) } else { author })
#set text(
  lang: lang,
  region: region,
  font: ("Inter", "Libertinus Serif"),
  size: 9.6pt,
  fill: ink,
  hyphenate: false,
)
#set par(justify: false, leading: 0.66em, spacing: 1.05em)
#set page(
  paper: "a4",
  margin: (x: 20mm, top: 24mm, bottom: 22mm),
  header: context if title != none and get("header", default: true) and counter(page).get().first() > 0 {
    set text(7.4pt, fill: muted)
    grid(
      columns: (1fr, auto),
      align: (left, right),
      title, if footer-note != none { text(weight: "semibold", fill: warm, upper(footer-note)) },
    )
    v(-4pt)
    line(length: 100%, stroke: 0.4pt + rule)
  },
  footer: context {
    set text(7.4pt, fill: muted)
    let n = [
      #if lang == "pt" [Página] else [Page]
      #text(weight: "semibold", fill: ink, counter(page).display())
      #if lang == "pt" [de] else [of]
      #counter(page).final().first()
    ]
    if get("header", default: true) and title != none { align(right, n) } else {
      align(center)[#n#if footer-note != none [ · #footer-note]]
    }
  },
)
#show raw: set text(font: "DejaVu Sans Mono", size: 0.9em)
#show raw.where(block: false): box.with(fill: surface, inset: (x: 2pt), outset: (y: 2pt), radius: 2pt)
#show raw.where(block: true): block.with(fill: surface, inset: 9pt, radius: 4pt, width: 100%)
// Typst's bold adds 300 to the weight (Inter Regular 400 -> Black 700+); 200 gives SemiBold, which reads better.
#set strong(delta: 200)
#show heading: set text(fill: ink)
#show heading: set par(justify: false)
#show heading: set block(above: 1.6em, below: 0.8em, sticky: true)
#show heading.where(level: 1): it => block(above: 2.1em, below: 1em, sticky: true)[
  #block(width: 22pt, height: 3.5pt, radius: 2pt, fill: warm)
  #v(-2pt)
  #text(17pt, weight: "bold", tracking: -0.01em, it.body)
]
#show heading.where(level: 2): set text(12pt, weight: "bold", fill: accent)
#show heading.where(level: 3): set text(10pt, weight: "semibold")
#show link: set text(fill: accent)
#set list(marker: text(fill: warm, weight: "bold")[•], indent: 2pt, body-indent: 6pt)
#set enum(numbering: n => text(fill: warm, weight: "bold")[#n.], indent: 2pt, body-indent: 6pt)
#show quote.where(block: true): it => block(
  width: 100%,
  fill: rgb("#eef3f9"),
  radius: (right: 5pt),
  stroke: (left: 3pt + accent),
  inset: (x: 12pt, y: 9pt),
  it.body,
)
#set table(
  stroke: (_, y) => (bottom: 0.5pt + rule, top: if y == 0 { none } else { 0pt }),
  inset: (x: 6pt, y: 5pt),
  fill: (_, y) => if y == 0 { ink } else if calc.even(y) { surface },
)
#show table: set text(size: 8.3pt)
#show table: set par(justify: false, leading: 0.55em)
#show table.cell.where(y: 0): set text(fill: white, weight: "semibold")
// Code in a header cell: plain white monospace, without the grey box (it would read as a black patch).
#show table.cell.where(y: 0): it => {
  show raw: r => text(font: "DejaVu Sans Mono", size: 0.9em, fill: white, r.text)
  it
}

#if has-cover {
  page(header: none, footer: none, margin: 0pt)[
    #block(width: 100%, height: 58%, fill: ink, inset: (x: 22mm, bottom: 18mm))[
      #set par(justify: false)
      #set text(hyphenate: false, fill: white)
      #v(1fr)
      #block(width: 34pt, height: 4pt, radius: 2pt, fill: warm)
      #v(6pt)
      #block(width: 92%, text(27pt, weight: "bold", tracking: -0.015em, title))
      #if get("subtitle") != none {
        v(8pt)
        block(width: 85%, text(12pt, fill: rgb("#c9d1e3"), get("subtitle")))
      }
    ]
    #block(inset: (x: 22mm, top: 14mm))[
      #set text(10pt, fill: muted)
      #for line in get("cover_lines", default: ()) [
        #line \
      ]
    ]
  ]
  counter(page).update(1)
}

#if get("front") != none {
  include "front.typ"
}

#if get("toc", default: false) {
  show outline.entry.where(level: 1): set text(weight: "semibold")
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
