# Contract: Export — Three Formats, Three Mechanisms

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02

PLAN.md asks for CSV, Excel and PDF. They look like three variations of one feature and they are not:
each fails differently, and Arabic is what separates them.

| Format | Produced by                          | The thing that goes wrong           |
| ------ | ------------------------------------ | ----------------------------------- |
| CSV    | Server — Phase 2's `export.service.ts` | Encoding, and formula injection    |
| Excel  | Server — `exceljs`                    | Types, and RTL sheet direction      |
| PDF    | **The browser's print pipeline**      | Arabic glyph shaping                |

---

## CSV — Phase 2 already solved both problems

**Extend `backend/src/services/export.service.ts` rather than writing a second CSV writer.** It already
does the two things that go wrong, and its comments say why.

**The UTF-8 BOM.** Phase 2's constant carries this note:

> _"Excel guesses the encoding of a CSV without this, and Arabic customer names arrive as mojibake — in
> the one place they are most likely to be read by someone outside the team. It is not decoration."_

FR-048 is that sentence restated as a requirement, and the fix already exists.

**Formula injection.** Phase 2 prefixes any cell beginning `=`, `+`, `-` or `@` with a quote, because
spreadsheet software evaluates it otherwise. FR-049 is that fix restated. It matters more here than it
did in Phase 2: a report export contains customer-authored text — CSAT comments (FR-028) — so a value
beginning `=` is not hypothetical, and a comment that becomes a formula is both a broken cell and, with
some functions, a data-exfiltration vector in the recipient's spreadsheet.

**Paging.** Phase 2 fetches in pages of 100 so a large export is never held whole in memory, and
FR-052's "fail plainly rather than truncate" builds on that: the page loop counts, and refuses past the
declared ceiling **before** producing a partial file.

---

## Excel — `exceljs`, and the two things it adds

The one new dependency in the phase. It exists because a spreadsheet is what managers actually work in,
and a CSV renamed `.xlsx` is not one.

**Types, not strings.** Numbers written as numbers and dates as dates, so a recipient can sort and
total without re-typing a column. This is the whole reason to prefer it over CSV, and writing everything
as text would forfeit it.

**Sheet direction.** `exceljs` can set a worksheet's `views[0].rightToLeft`, and an Arabic export should
have it — column A on the right, as an Arabic reader expects. That is the only RTL concern in this
format: cell text is Unicode and the spreadsheet application shapes it.

**Formula injection applies here too.** The same guard as CSV. A `.xlsx` cell whose value begins `=` is
a formula by definition of the format, so the risk is if anything more direct than in CSV.

**No charts in the Excel export.** The figures go as data; the recipient charts them if they want.
Embedding a chart means reimplementing D7's form decisions in a second rendering engine, and the chart
would not match the screen.

---

## PDF — the browser, not a library

**Decision**: produced client-side by the browser's own print pipeline with a print stylesheet. No
server-side PDF library, no headless browser.

**Why, and it is the sharpest reasoning in the phase.** SC-021 requires a reader of Arabic to open each
export and find it legible. Arabic in a PDF needs three things:

1. an embedded font containing Arabic glyphs,
2. bidirectional reordering, so Arabic runs right-to-left and embedded Latin or digits do not,
3. **contextual glyph shaping** — Arabic letters take initial, medial, final or isolated forms depending
   on their neighbours.

A JavaScript PDF library gives you none of the three by default. Getting them right is a project;
getting them subtly wrong produces a document that looks like Arabic to somebody who does not read it,
which is exactly the failure SC-021 exists to catch and exactly the failure a reviewer who does not read
Arabic will approve.

The browser already does all three, correctly, for the screen the reader is looking at. Printing that
screen reuses a text engine that is already right rather than building a second one that must be made
right.

**What makes it work:**

- Charts are **inline SVG** (D7), so they print as vectors at print resolution. A canvas-based charting
  library would print as a bitmap or not at all — the second time D7 pays for itself.
- A print stylesheet hides navigation and filters, expands every collapsed table view, and forces
  page-break behaviour so a figure does not split across pages.
- The figure envelope's provenance — period, timezone, filters, computed-at, current-state disclosure —
  is `display: block` in print, so FR-047's "the file states which filters produced it" holds without a
  separate PDF template.

**The costs, stated rather than discovered:**

- The PDF is generated client-side, so it is not byte-identical across browsers. Acceptable: the
  requirement is that the figures match and Arabic is legible, not that the bytes match.
- It cannot be produced by a server-side job, so scheduled or emailed delivery is impossible this way.
  Also acceptable — both are explicitly out of scope.
- **It is not audited by the server**, because the server is not involved. This is the one genuine gap:
  FR-051 requires every export recorded, and a browser print cannot be. The resolution is that the
  client posts an audit-only notification when it initiates a print, and the contract states plainly
  that this is **best-effort** — a determined user could print without it. It is not a control, and
  presenting it as one would be worse than admitting the limit. Anyone who can see a report on screen
  can photograph it; the audit exists for accountability, not prevention.

**Alternatives considered.** A headless browser server-side (Playwright, Puppeteer): correct output and
a genuine audit trail, at the cost of a browser binary to install, patch and keep running in order to
produce a document the user's own browser already can. Recorded as the upgrade path if the audit gap
proves unacceptable — it buys exactly that one thing.

---

## Rules across all three formats

| Rule                                                            | Requirement |
| --------------------------------------------------------------- | ----------- |
| Figures match the screen exactly, under the same filters         | FR-047, SC-020 |
| The file states the filters, period and timezone that produced it | FR-003, FR-047 |
| Arabic is legible in the format's normal reader                   | FR-048, SC-021 |
| No value is interpretable as a formula                            | FR-049, SC-022 |
| Requires `reports:export` **and** the report's own authority      | FR-050, FR-054 |
| Contains nothing the user could not see on screen                 | FR-054       |
| Too large: refuse plainly, never truncate                         | FR-052, SC-024 |
| Recorded in the audit log                                         | FR-051, SC-023 — server formats guaranteed; PDF best-effort, above |
| Producing one does not degrade other users' work                  | FR-053, FR-044 |

**SC-021 stays a human check.** No automated test establishes that an Arabic PDF is legible — glyph
shaping failures produce valid-looking output. A reader of Arabic has to open all three files, and that
task belongs in the manual list rather than being quietly closed by a passing suite.
