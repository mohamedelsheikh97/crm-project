# Implementation Plan: Phase 10 — Reports & Management

**Branch**: `011-phase-10-reports-management` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-phase-10-reports-management/spec.md`

**PLAN.md Reference**: Phase 10 — Reports & Management

**Builds on**: Phase 9 — AI Features, merged to `main` at `8e00afc`

## Summary

Six report surfaces over forty-eight existing tables, and the phase's whole difficulty is that a wrong
number cannot be seen to be wrong. The plan is therefore organised around removing opportunities to be
wrong rather than around building screens.

**Phase 6 already answered the hardest question, in writing.** `ticket-sla.model.ts` annotates
`response_breached_at` as _"The recorded outcome Phase 10 reporting must read, not recompute."_ That is
exactly right and it settles FR-007, FR-022, FR-025 and SC-005 together: SLA compliance is a `COUNT`
over stored outcome columns, so the reported figure and the ticket screen's figure are **the same
columns** rather than two calculations that have to agree. Reconciliation stops being a test and
becomes a property.

**The one measurable finding, and it is a real one: `tickets` has no index on `created_at`.** Every
report in this phase filters by date range. Nine phases never needed that index because nothing before
now asked "how many last month". Adding it — and its siblings on the other reported tables — is D1,
and it is the difference between a report and a table scan.

**Working-hour arithmetic cannot go in a SQL aggregate**, and knowing that early avoids designing a
query that cannot exist. `lib/business-hours.ts` exports `workingTimeBetween(from, to, calendar)`; it
is JavaScript, it walks a calendar with exceptions, and there is no SQL equivalent. D3 is the
consequence: **compliance rates are SQL over recorded outcomes; average elapsed working time is not
offered as an aggregate at all.** That is a scope reduction taken deliberately rather than a query
that quietly reports wall-clock hours while looking like working hours.

**No charting library** (D7). The dataviz method treats a chart as HTML/SVG marks rather than a
library's output, and here that choice pays three times over: inline SVG has no opinion about `dir`
(FR-062), the browser's own print pipeline renders it for PDF (D6), and there is no third-party
rendering to fight over Arabic. The categorical palette has been **validated at plan stage rather than
at implementation** — both modes pass, with one WARN whose required relief the spec already mandates.

Three decisions worth flagging up front:

**The reporting query layer never restates another phase's rules** (D2). SLA state comes from
`ticket_sla`'s recorded columns, status classification from `sla/clock.ts`, working time from
`lib/business-hours.ts`, the taxonomy from `tickets/taxonomy.ts`. SC-025 is verified by review of
imports, and the plan names the modules so the review has a checklist rather than a judgement.

**Attribution for a reassigned ticket is the current assignee, and that is uncomfortable** (D4).
Clarifications Q3 committed to current state, so this follows from it — but it means an agent who
resolved fifty tickets and handed them on shows zero. It is stated in the report, and it is Open
Question 1 for operations, because it is the decision most likely to be wrong about a person who
cannot see it (Clarifications Q1).

**PDF is produced by the browser, not by a server-side library** (D6). Arabic in PDF is the hardest
requirement in the phase (FR-048, SC-021), every JavaScript PDF library would need font embedding plus
bidi and shaping, and the browser already does all three correctly for the screen the reader is looking
at.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js 22+, Vue 3.5 (`<script setup>`)

**Primary Dependencies**: Express, Sequelize, MySQL 8.4, Pinia, vue-i18n, Tailwind. **New:** `exceljs`
for the Excel format only. **No charting library, no PDF library, no reporting engine** (D6, D7).

**Storage**: MySQL, unchanged. 1 new table (`dashboard_arrangements`), 0 new columns on existing
tables, **7 new indexes** on existing tables (D1) — the only schema change the reports themselves
require.

**Testing**: Vitest. Correctness is established by **hand-computed fixtures** (D9): a known data set
with answers worked out by hand, never by comparing one query to another.

**Target Platform**: Linux server; reports rendered in the browser, PDF produced by it.

**Project Type**: Web application (existing `backend/` + `frontend/` workspaces).

**Performance Goals**: Every report query served from an index (D1). Dashboard refresh must not degrade
Phase 9's response times with the maximum supported number of dashboards open and refreshing (SC-018).

**Constraints**: Read-only — no report, dashboard or export writes to an operational record (FR-064,
SC-028). No rule owned by another phase is restated (FR-007, SC-025). Agent figures unreachable by
agents (FR-030, SC-014a).

**Scale/Scope**: 4 reports + 1 dashboard + 3 export formats, 1 new table, 7 indexes, 3 permission keys,
~6 backend services, ~10 frontend components, 0 changes to existing behaviour.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle                              | Status                | Note                                                                                                              |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| I. Bilingual-First & RTL               | PASS with obligations | FR-062–FR-063. Charts are the new hazard: axes, legends and number formatting all have direction. D7 and D8.        |
| II. Security by Default                | PASS with obligations | Three new keys, query-level scoping (FR-060), and the aggregation-inference rule (FR-061). D11.                     |
| III. Layered Architecture              | PASS with tension     | Reporting reads across every phase. D2 is how it stays inside the rule; SC-025 is how that is checked.              |
| IV. Accessibility                      | PASS with obligations | An auto-refreshing dashboard and charts are both WCAG hazards this project has not met before. D8.                  |
| V. Phase-Gated Delivery                | PASS                  | `/speckit-specify` → `/speckit-plan` (here) → `/speckit-tasks` → `/speckit-implement`.                              |
| **Technology Standards (fixed stack)** | **PASS — no amendment required** | See below.                                                                                       |

**No constitution amendment is needed, unlike Phase 9.** The Technology Standards table fixes
framework, build, language, styling, state, runtime, ORM, database, auth, i18n and AI processing.
Nothing here changes any of them: reporting reads the existing MySQL through the existing Sequelize
layer and renders in the existing Vue and Tailwind. `exceljs` is a library in the same category as the
IMAP and SMS clients Phase 5 added without amendment, and Phase 9 recorded the distinction explicitly —
_"the provider choice needs the amendment; the npm package does not."_

**The gate that would have applied, and does not.** If the plan had concluded that the operational
database cannot serve these aggregates and a warehouse or a second datastore were required, that IS a
Technology Standards deviation and would need an amendment. D1 establishes it is not required: the
figures are countable from indexed columns, and the missing indexes are the actual problem. The spec's
Out of Scope refused to adopt a warehouse speculatively and that refusal survives contact with the
schema.

### Post-design re-evaluation

Re-checked after Phase 1. No new violations. Three notes:

- **Principle III held, but only because D2 exists.** Reporting is genuinely cross-cutting and the
  honest description is that the reporting services sit at the same layer as any other service and
  **call** the rule-owning modules rather than reimplementing them. The temptation this design refuses
  is a `reports/` layer with its own SQL for SLA state — which would compile, pass tests written against
  itself, and disagree with Phase 6 within a release.
- **Principle IV got harder than any previous phase and the plan accounts for it.** An interval-refreshing
  region and a chart are both things this codebase has never had to make accessible. D8 specifies
  `aria-live` off on figures with a deliberate refresh control, and a table view for every chart — which
  the dataviz method already required for the contrast WARN, so one mechanism discharges two obligations.
- **Principle I revealed something charts make worse.** Number and date formatting is locale-dependent
  and a chart axis is the easiest place to leave it hardcoded. D8 routes every axis label and legend
  through `vue-i18n`'s formatters rather than `toString()`.

## Project Structure

### Documentation (this feature)

```text
specs/011-phase-10-reports-management/
├── plan.md              # This file
├── research.md          # Phase 0 output — 12 decisions
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── reports-api.md       # Report and dashboard endpoints
│   ├── figure-contract.md   # What a reported figure must carry to be trustworthy
│   └── export-contract.md   # The three formats and what each guarantees
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # NOT created by /speckit-plan
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── reporting/                       # NEW — query building, not business rules
│   │   ├── period.ts                    # Date range → timezone-resolved bounds (D5)
│   │   ├── filters.ts                   # The one filter shape every report accepts
│   │   ├── figure.ts                    # Figure + provenance envelope (D10)
│   │   ├── suppression.ts               # The small-sample floor, declared once (D12)
│   │   └── sources.ts                   # THE ONLY place that names another phase's tables
│   ├── services/
│   │   ├── report-volume.service.ts
│   │   ├── report-sla.service.ts         # Reads recorded outcomes (D3)
│   │   ├── report-csat.service.ts
│   │   ├── report-agent.service.ts       # Supervisory only (D11)
│   │   ├── report-ai.service.ts          # Phase 9 usage, counts only
│   │   ├── dashboard-arrangement.service.ts
│   │   └── report-export.service.ts      # Extends Phase 2's export.service.ts (D6)
│   ├── controllers/reports/
│   ├── routes/reports/index.ts
│   ├── models/dashboard-arrangement.model.ts
│   └── db/migrations/                   # 1 table + 7 indexes
└── tests/
    ├── reporting/                       # hand-computed fixtures (D9)
    ├── reports/                         # per-report correctness + scoping
    └── exports/                         # format, encoding, injection, audit

frontend/
├── src/
│   ├── components/viz/                  # Inline SVG marks — no library (D7)
│   │   ├── StatTile.vue                 # value + delta + optional sparkline
│   │   ├── KpiRow.vue
│   │   ├── BarChart.vue                 # horizontal by default (long category names)
│   │   ├── LineChart.vue                # with crosshair + tooltip
│   │   ├── StackedBar.vue               # part-to-whole
│   │   ├── DivergingStackedBar.vue      # CSAT 1–5 (D7)
│   │   ├── Meter.vue                    # a ratio against a target
│   │   ├── FigureFrame.vue              # title, provenance, table toggle (D10)
│   │   └── FigureTable.vue              # the table view every chart has (D8)
│   ├── components/reports/
│   │   ├── PeriodFilter.vue
│   │   └── ExportMenu.vue
│   ├── views/reports/
│   │   ├── ManagementDashboardView.vue
│   │   ├── VolumeReportView.vue
│   │   ├── SlaReportView.vue
│   │   ├── CsatReportView.vue
│   │   └── AgentReportView.vue
│   ├── composables/useAutoRefresh.ts    # D8 — skip-if-inflight, stop-if-hidden
│   ├── services/reports.service.ts
│   └── stores/reports.store.ts
└── tests/reports/
```

**Structure Decision**: The existing two-workspace layout is unchanged. Two new directories, each for a
stated reason.

`backend/src/reporting/` holds **query construction and presentation of figures, never business
rules** — the same role `src/portal/` and `src/ai/` play for their phases. `sources.ts` is the one file
permitted to name another phase's tables, so the coupling FR-007 warns about has exactly one address
and a reviewer can read it in full.

`frontend/src/components/viz/` holds chart primitives rather than report-specific components, because
the same bar chart serves volume, agent and AI reporting. Keeping them ignorant of which report they
serve is what stops a chart acquiring a business rule.

## Complexity Tracking

| Violation                                                | Why Needed                                                                                                         | Simpler Alternative Rejected Because                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **7 new indexes on tables this phase does not own**       | `tickets` has no `created_at` index and every report filters by date. Without them, each report is a full scan.     | Reporting off a replica or a warehouse: a Technology Standards deviation requiring an amendment, adopted to avoid adding an index. Absurd trade. |
| **`frontend/src/components/viz/` — 9 new components**     | Inline SVG marks with no library (D7). RTL, print and Arabic all work because nothing third-party intervenes.        | A charting library: one dependency instead of nine files, but it owns `dir`, its own fonts, its own colors, and its own print behaviour.          |
| **Hand-computed test fixtures instead of query-vs-query** | SC-001 requires figures to match a count done by hand. Two queries that agree can both be wrong.                    | Comparing the report to a second query: cheaper to write, and proves only that two things share a bug.                                          |

### Non-violations worth recording

- **`exceljs` is a dependency, not a stack deviation.** Same category as Phase 5's IMAP and SMS clients
  and Phase 9's `@anthropic-ai/sdk`.
- **No new datastore, no replica, no materialised views, no cache.** D1 establishes the figures are
  countable from indexed columns. A cache would also reintroduce staleness that Clarifications Q3
  deliberately rejected.
- **`dashboard_arrangements` is one table for one purpose** — a user's own layout. It is not a
  general-purpose preferences table, because this phase needs one preference and speculative generality
  is forbidden by the constitution's Compliance Review.
- **No report-definition table.** The six reports are code, not data. A report builder is explicitly out
  of scope, and storing definitions would be the first half of building one.

## Phase closeout

The phase is done when:

1. All `/speckit-tasks` tasks are complete.
2. Every figure matches a hand-computed fixture (SC-001) — the criterion the phase exists to satisfy.
3. Reported SLA compliance reconciles to the per-ticket SLA state for every ticket in the period
   (SC-005), which D3 makes structural rather than coincidental.
4. Every new surface works in Arabic (RTL) and English (LTR), including chart axes, legends and number
   formatting.
5. WCAG 2.1 AA on all new screens in both languages, **including the auto-refreshing dashboard and
   every chart** — the two things this project has not had to make accessible before.
6. No agent account can reach an agent performance figure by any route (SC-014a).
7. Server-side permission checks verified for all three new keys, not just UI hiding.
8. PLAN.md's Definition of done demonstrated: one dashboard, accurate, refreshing, and every report
   exported.

## Outstanding from earlier phases

- **Phase 9's manual passes are still open** (its T122–T134), including the Arabic assistant gate and
  the grounding floor. Phase 10 reports on AI usage (FR-055–FR-058) and will show counts for features
  that may still be switched off — FR-014's "say so rather than showing zero" covers that case.
- **Phase 2's virus scanning**, deferred through Phases 8 and 9. Untouched here: this phase accepts no
  uploads.
- **Phase 9's `pending` status wording** (its research open question 1) surfaces again: status
  distribution reporting will display the same six statuses, so whatever word is chosen appears in one
  more place.
- **Phase 12 will narrow FR-060's scoping.** Every reporting query is a place that must gain a
  department predicate then, and `reporting/sources.ts` is deliberately the single file where that
  change lands.
