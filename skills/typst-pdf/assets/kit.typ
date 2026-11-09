// Building blocks for designed pages (`--front <file.typ>` in scripts/pdf.ts): a front page imports them with
// `#import "kit.typ": *` and lays out cards, figures and flows that Markdown cannot. Same palette and fonts as
// template.typ; the Markdown body never sees this file.

#let ink = rgb("#172036")
#let muted = rgb("#5b6478")
#let line-color = rgb("#d9dee8")
#let surface = rgb("#f3f5f9")
#let coral = rgb("#e4572e")
#let blue = rgb("#2e6fac")
#let teal = rgb("#17907f")
#let amber = rgb("#e8a33d")
#let violet = rgb("#6c4ab6")
#let green = rgb("#2f9e5b")
#let red = rgb("#c8372d")
#let sans = ("Inter", "Libertinus Serif")

// A tint of a colour on white: tint(blue, 12%) is a pale blue background.
#let tint(c, amount) = color.mix((c, amount), (white, 100% - amount))

// Small capitals label above a title or a block.
#let eyebrow(body, fill: coral) = text(7.2pt, weight: "bold", tracking: 0.12em, fill: fill, upper(body))

// A pill: short status or category.
#let pill(body, fill: blue, solid: false) = box(
  fill: if solid { fill } else { tint(fill, 13%) },
  radius: 20pt,
  inset: (x: 6pt, y: 2.6pt),
  text(7pt, weight: "semibold", fill: if solid { white } else { fill.darken(15%) }, body),
)

// A round badge holding a number or a short mark.
#let badge(body, fill: coral, size: 20pt) = box(
  width: size,
  height: size,
  radius: size / 2,
  fill: fill,
  align(center + horizon, text(size * 0.48, weight: "bold", fill: white, body)),
)

// A big number with its label: kpi("735 mil", [pedidos e orçamentos]).
#let kpi(value, label, fill: blue, note: none) = block(
  width: 100%,
  inset: (x: 9pt, y: 8pt),
  radius: 6pt,
  fill: tint(fill, 9%),
  stroke: (left: 3pt + fill),
)[
  #text(17pt, weight: "black", fill: fill.darken(10%), value)
  #v(-6pt)
  #text(7.8pt, fill: ink, label)
  #if note != none { linebreak(); text(6.6pt, fill: muted, note) }
]

// A card with a coloured top edge.
#let card(body, fill: blue, inset: 10pt, height: auto) = block(
  width: 100%,
  height: height,
  inset: inset,
  radius: 7pt,
  fill: white,
  stroke: (paint: line-color, thickness: 0.7pt),
  breakable: false,
)[
  #place(top + left, dx: -inset, dy: -inset, block(width: 100% + 2 * inset, height: 3.5pt, radius: (top: 7pt), fill: fill))
  #body
]

// A box with a soft background and a left rule, for a principle or a quote.
#let callout(body, fill: coral) = block(
  width: 100%,
  inset: (x: 12pt, y: 9pt),
  radius: (right: 6pt),
  fill: tint(fill, 9%),
  stroke: (left: 3.5pt + fill),
  body,
)

// A labelled line: "Nos dados" / "A validar" under a card.
#let fact(label, body, fill: teal, mark: "✓") = grid(
  columns: (auto, 1fr),
  column-gutter: 6pt,
  align: (left + top, left + top),
  box(fill: tint(fill, 14%), radius: 3pt, inset: (x: 4pt, y: 2pt), text(
    6.8pt,
    weight: "bold",
    fill: fill.darken(20%),
  )[#mark #upper(label)]),
  text(8pt, fill: ink, body),
)

// Steps joined by arrows: flow(([Orçamento], [Pedido], [Venda]), fill: blue).
#let flow(steps, fill: blue, arrow: "→", width: auto) = {
  let cells = ()
  for (i, s) in steps.enumerate() {
    if i > 0 { cells.push(align(center + horizon, text(11pt, weight: "bold", fill: tint(fill, 60%), arrow))) }
    cells.push(box(
      width: 100%,
      fill: tint(fill, 12%),
      radius: 5pt,
      inset: (x: 6pt, y: 6pt),
      align(center + horizon, text(8pt, weight: "semibold", fill: fill.darken(25%), s)),
    ))
  }
  grid(
    columns: steps.enumerate().map(((i, _)) => if i == 0 { 1fr } else { (auto, 1fr) }).flatten(),
    column-gutter: 4pt,
    align: horizon,
    ..cells,
  )
}

// A horizontal bar: share of a total, with the rest in grey.
#let bar(share, fill: blue, height: 6pt) = block(width: 100%, height: height, radius: height / 2, fill: line-color, clip: true)[
  #block(width: share, height: height, fill: fill)
]

// A row of paint swatches, edge to edge.
#let swatches(colors, height: 5pt) = grid(
  columns: colors.len(),
  ..colors.map(c => block(width: 100%, height: height, fill: c)),
)

// A chat bubble; `me: true` for the person, false for the assistant.
#let bubble(body, me: false) = align(if me { right } else { left }, box(
  width: 88%,
  fill: if me { rgb("#dcf5d0") } else { white },
  stroke: if me { none } else { 0.6pt + line-color },
  radius: if me { (top-left: 8pt, top-right: 8pt, bottom-left: 8pt, bottom-right: 2pt) } else {
    (top-left: 8pt, top-right: 8pt, bottom-left: 2pt, bottom-right: 8pt)
  },
  inset: (x: 7pt, y: 5pt),
  text(7.4pt, fill: ink, body),
))

// A designed page's title band across the top edge; use with page(background: band-background(…)).
#let band-background(height, fill: ink, stripe: ()) = place(top + left, block(width: 100%, height: height, fill: fill)[
  #if stripe.len() > 0 { place(bottom + left, swatches(stripe, height: 4pt)) }
])
