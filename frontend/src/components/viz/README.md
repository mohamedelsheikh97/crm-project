# `frontend/src/components/viz/`

Chart primitives. **Inline SVG, no charting library** (research D7).

These components are deliberately ignorant of which report they serve — the same bar chart draws
volume by category, agent volumes and AI usage. That ignorance is what stops a chart acquiring a
business rule.

## Why no library

The chart is HTML/SVG marks either way. A library adds an intermediary with its own opinions about the
three things this phase cannot compromise on:

- **Direction.** FR-062 requires RTL. Inline SVG has no opinion about `dir`; a library's axis renderer
  usually does, and overriding it is a fight.
- **Print.** PDF export is the browser's own print pipeline (contracts/export-contract.md). Inline SVG
  prints as vectors; a canvas-based library prints as a bitmap or not at all.
- **Colour.** The palette is validated and applied as CSS custom properties. A library ships its own
  defaults and its own cycling behaviour, and "categorical hues in fixed order, never cycled" is not
  something most of them offer.

## The forms, and which figure each serves

| Component             | Job                                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| `StatTile` / `KpiRow` | A handful of headline numbers — not a chart                                  |
| `LineChart`           | Trend over time                                                              |
| `BarChart`            | Compare magnitude. Horizontal by default: category and status names are long |
| `StackedBar`          | Part-to-whole                                                                |
| `DivergingStackedBar` | An ORDERED scale (CSAT 1–5), centred on neutral                              |
| `RatioMeter`          | A single ratio against a target                                              |
| `FigureFrame`         | The envelope: value, counts, provenance, table toggle                        |
| `FigureTable`         | The table view every chart has                                               |

## Rules

- **No dual-axis chart, ever.** Two measures of different scale go in two charts, or indexed to a
  common base. It is the single most common reporting mistake and it makes any apparent relationship an
  artefact of the scales chosen.
- **Categorical hues in fixed order, never cycled.** Four slots. A fifth series folds into "Other",
  facets, or becomes a table.
- **Past roughly seven classes, use a table.** More colours stop distinguishing anything.
- **Every chart has a table view.** One component doing four jobs: screen-reader access, the relief the
  palette's light-mode contrast WARN requires, the RTL fallback, and greyscale print.
- **Text wears text tokens, never the series colour.** A coloured mark beside a label carries identity;
  the label itself stays in ink.
- **Numbers and dates go through `vue-i18n`.** An axis label is the easiest place in a codebase to
  leave `String(n)`, and the result is Latin digits on an Arabic screen.
