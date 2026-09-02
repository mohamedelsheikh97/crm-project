# Tasks: Phase 10 — Reports & Management

**Input**: Design documents from `/specs/011-phase-10-reports-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included, and they carry more weight here than in any previous phase. SC-001 can only be
established by hand-computed fixtures — a wrong number does not error, and two queries that agree can
both be wrong. SC-002, SC-014a, SC-022, SC-026a, SC-028 and SC-030 each name a test as the means of
verification.

**Organization**: Grouped by user story. US1, US2 and US3 are P1; US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Exact file paths are given in every task

## Path Conventions

Web application, existing two-workspace layout: `backend/src/`, `backend/tests/`, `frontend/src/`,
`frontend/tests/`.

**No governance gate this phase.** Unlike Phase 9, nothing here deviates from the fixed technology
stack — see plan.md Constitution Check. Implementation starts at T001.

---

## Phase 1: Setup

**Purpose**: The one dependency, the seven indexes, and the directories

- [X] T001 Add `exceljs` to `backend/package.json` dependencies and install — the only new dependency in the phase (plan.md Complexity Tracking)
- [X] T002 Create migration `backend/src/db/migrations/*-add-reporting-indexes.cjs` adding the seven indexes from data-model.md, with a comment recording that `tickets` had no `created_at` index before this phase and that every report filters by date (research D1)
- [X] T003 [P] Create migration `backend/src/db/migrations/*-create-dashboard-arrangements.cjs` per data-model.md, with `UNIQUE(user_id)` and CASCADE on user delete
- [X] T004 [P] Create `backend/src/models/dashboard-arrangement.model.ts` and register it in `backend/src/models/index.ts`
- [X] T005 [P] Create the `backend/src/reporting/` and `frontend/src/components/viz/` directories with a README in each stating what belongs there and what does not — query construction and chart primitives, never business rules (plan.md Structure Decision)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The figure envelope, the single source of table names, and the fixture that makes
correctness checkable

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### The honesty machinery

- [X] T006 [P] Create `backend/src/reporting/figure.ts` declaring the `Figure<T>` envelope from contracts/figure-contract.md — every field REQUIRED, so a service that has not decided what belongs in `excluded` must decide (research D10)
- [X] T007 [P] Create `backend/src/reporting/period.ts` resolving a requested date range into absolute UTC bounds using the active business calendar's timezone, reusing `lib/business-hours.ts`'s `zonedPartsOf` and `instantFromZoned` rather than doing new arithmetic (research D5)
- [X] T008 [P] Create `backend/src/reporting/filters.ts` declaring the one filter shape every report accepts, validating `category`, `channel` and `priority` against `tickets/taxonomy.ts` rather than accepting free strings (contracts/reports-api.md)
- [X] T009 [P] Create `backend/src/reporting/suppression.ts` declaring the small-sample floor ONCE — the same number for CSAT averages, agent rates and aggregation-based identification, because they are one rule with three motivations (research D12)
- [X] T010 Create `backend/src/reporting/sources.ts` — **the only module permitted to name a table owned by another phase**. Expose accessors for tickets, ticket_sla, ticket_satisfaction, users, ai_invocations and ai_category_proposals, and state in the file header that concentrating the coupling here is what makes SC-025 reviewable in one read (research D2)

### The fixture — the phase's correctness mechanism

- [X] T011 Create `backend/tests/reporting/fixture.ts` building a data set that deliberately contains: tickets spanning three months, a merged pair, tickets with no assignee, tickets with no SLA policy, a ticket opened in one month and closed in the next, a period boundary at a daylight-saving change, and satisfaction scores on a subset
- [X] T012 Write `backend/tests/reporting/fixture-answers.ts` holding the expected figures for that data set **computed by hand and written as literals** — never derived from a second query, because two queries that agree share the assumptions where the bug is (research D9, SC-001)
- [X] T013 [P] Write `backend/tests/reporting/period.test.ts` asserting that a requested range resolves identically for every report in one request, and that a daylight-saving boundary neither double-counts nor loses a day (FR-013, D5)
- [X] T014 [P] Write `backend/tests/reporting/figure.test.ts` asserting the envelope identity `sum(bucket counts) + sum(excluded counts) == total` — the check that catches a total counting nulls beside a breakdown with no null bucket (FR-002, SC-002)
- [X] T015 [P] Write `backend/tests/reporting/suppression.test.ts` asserting that below the floor a rate is withheld and a count is shown, iterating the surfaces rather than naming them (SC-011, SC-014)

### Authority, audit, read-only

- [X] T016 Add `define('reports', 'view')`, `define('reports', 'view_agents')` and `define('reports', 'export')` to `backend/src/auth/permissions.ts`, with a comment explaining why agent figures are a separate key (Clarifications Q1) and why export is separate from viewing (Phase 2's precedent) — research D11
- [X] T017 [P] Create seeder `backend/src/db/seeders/*-reporting-permissions.cjs` granting `reports:view` and `reports:export` to supervisor and admin, and `reports:view_agents` to supervisor and admin only; register it in the `ROLE_PERMISSIONS_SEEDER` list in `backend/tests/helpers/database.ts`
- [X] T018 [P] Write `backend/tests/reports/read-only.test.ts` asserting that no reporting endpoint writes to any operational table — snapshot row counts and a checksum of `tickets`, `ticket_sla` and `ticket_satisfaction` across a full pass over every report (FR-064, SC-028)

### Chart primitives that every story uses

- [X] T019 [P] Add the validated palette to `frontend/src/assets/` as CSS custom properties — four categorical slots plus the status colours, light and dark, exactly the values validated in research D7; include the validator output as a comment so a later change can be re-checked
- [X] T020 [P] Create `frontend/src/components/viz/FigureFrame.vue` rendering the envelope: value with counts beside it, period, timezone, filters, last-successful-computation time, translated exclusions, the current-state disclosure, and the table-view toggle (contracts/figure-contract.md § Rendering contract)
- [X] T021 [P] Create `frontend/src/components/viz/FigureTable.vue` — the table view every chart has. One component discharging four obligations: screen-reader access, the palette's contrast relief, the RTL fallback, and greyscale print (research D8)
- [X] T022 [P] Create `frontend/src/components/viz/StatTile.vue` (value + delta + optional sparkline) and `KpiRow.vue` — the form for a handful of headline numbers, which is not a chart (research D7)
- [X] T023 [P] Create `frontend/src/services/reports.service.ts` and `frontend/src/stores/reports.store.ts` following the existing service and store patterns
- [X] T024 [P] Add the base `reports.*` locale keys to `frontend/src/locales/en.json` and `ar.json`, including every exclusion reason key so an Arabic reader gets an Arabic explanation (FR-063)

**Checkpoint**: A figure cannot be returned without its provenance, the coupling has one address, and
there is a data set with known answers to check against.

---

## Phase 3: User Story 1 — The Management Dashboard and Volume Report (Priority: P1) 🎯 MVP

**Goal**: A supervisor opens one screen and sees whether the team is coping.

**Independent Test**: With the fixture loaded, open the dashboard and confirm every figure matches the
hand-computed literals, and that each filter narrows every figure consistently.

### Tests for User Story 1

- [X] T025 [P] [US1] Write `backend/tests/reports/volume.test.ts` asserting every volume figure against `fixture-answers.ts` — received, open-at-end, and each breakdown (SC-001)
- [X] T026 [P] [US1] Write `backend/tests/reports/volume-consistency.test.ts` asserting that received ≠ open-at-end for the fixture, so FR-016's distinction is actually exercised rather than passing by coincidence
- [X] T027 [P] [US1] Write `backend/tests/reports/merged-tickets.test.ts` asserting a merged pair is counted once, on the surviving side, and that the figure states which side (FR-017)
- [X] T028 [P] [US1] Write `backend/tests/reports/empty-period.test.ts` asserting a period before the system held data reports that it is empty rather than returning zero (FR-014)

### Implementation for User Story 1

- [X] T029 [US1] Implement `backend/src/services/report-volume.service.ts` composing queries through `reporting/sources.ts`, classifying status via `sla/clock.ts`, and returning `Figure` envelopes (research D2)
- [X] T030 [US1] Create `backend/src/controllers/reports/volume.controller.ts` implementing `GET /api/reports/volume` per contracts/reports-api.md
- [X] T031 [US1] Implement `backend/src/services/report-ai.service.ts` for the Phase 9 usage figures, returning `contentRetained: false` so a reader learns content was never kept rather than concluding the log is broken (FR-057)
- [X] T032 [US1] Create `backend/src/controllers/reports/dashboard.controller.ts` implementing `GET /api/reports/dashboard` — **one request returning every figure**, so all of them resolve against one period (FR-002, contracts/reports-api.md)
- [X] T033 [US1] Create `backend/src/routes/reports/index.ts` applying `authenticate` and `requirePasswordChange` once for the group, mounted on the `/reports` **prefix** — never with a bare `router.use`, which is the Phase 9 mistake recorded in `routes/ai/index.ts`
- [X] T034 [US1] Register the reports router in `backend/src/routes/index.ts` and add its paths to the enumerated staff route list in `backend/tests/portal/realm.test.ts` so a portal token is proven to be refused
- [X] T035 [P] [US1] Create `frontend/src/components/viz/LineChart.vue` with crosshair and tooltip — inline SVG, no library (research D7)
- [X] T036 [P] [US1] Create `frontend/src/components/viz/BarChart.vue`, horizontal by default because category and status names are long, sequential single-hue because the job is comparing magnitude rather than telling identities apart (research D7)
- [X] T037 [P] [US1] Create `frontend/src/components/viz/StackedBar.vue` for status part-to-whole, with the 2px surface gap between segments the mark spec requires
- [X] T038 [P] [US1] Create `frontend/src/components/reports/PeriodFilter.vue` — one filter row above the figures, applying to every figure on the surface (FR-038)
- [X] T039 [US1] Create `frontend/src/composables/useAutoRefresh.ts` implementing the refresh contract: **skip never queue** when a refresh is in flight, stop on `document.visibilityState` hidden or idle, and keep the last good figures with their own timestamp on failure (FR-045a–d, research D8)
- [X] T040 [US1] Create `frontend/src/views/reports/ManagementDashboardView.vue` composing the KPI row and charts, using `useAutoRefresh`, with figures deliberately NOT in an `aria-live` region and a explicit refresh control instead (research D8)
- [X] T041 [P] [US1] Create `frontend/src/views/reports/VolumeReportView.vue`
- [X] T042 [US1] Add the dashboard and volume routes to `frontend/src/router/index.ts` behind `reports:view`
- [X] T043 [P] [US1] Add `reports.volume.*` and `reports.dashboard.*` locale keys to both locale files
- [X] T044 [P] [US1] Write `frontend/tests/reports/auto-refresh.test.ts` asserting that a second refresh is skipped while one is in flight, and that refreshing stops when the document is hidden (FR-045a–b, SC-018a–b)

**Checkpoint**: US1 is fully functional and demonstrable — the first half of PLAN.md's Definition of
done, and the figures are checkable against hand-computed answers.

---

## Phase 4: User Story 2 — SLA Performance (Priority: P1)

**Goal**: Somebody can prove whether the SLA was met, and the figure agrees with the ticket screen.

**Independent Test**: Construct tickets with known outcomes against a known policy and confirm the
reported compliance matches both the hand count and the per-ticket SLA state.

### Tests for User Story 2

- [X] T045 [P] [US2] Write `backend/tests/reports/sla-reconciliation.test.ts` asserting reported breach counts equal the per-ticket SLA state for every ticket in the period, with zero differences (SC-005) — this passes by construction because both read the same columns, and the test exists to catch anyone who starts recomputing
- [X] T046 [P] [US2] Write `backend/tests/reports/sla-separate-promises.test.ts` asserting response and resolution compliance are never combined into one figure (FR-020, SC-006)
- [X] T047 [P] [US2] Write `backend/tests/reports/sla-exclusions.test.ts` asserting tickets with no policy are reported in `excluded` with a count and absent from the denominator (FR-023, SC-008)
- [X] T048 [P] [US2] Write `backend/tests/reports/sla-no-recompute.test.ts` asserting the SLA report never calls `lib/business-hours.ts` — the guard against a wall-clock approximation appearing as "average response time" (research D3, FR-007)

### Implementation for User Story 2

- [X] T049 [US2] Implement `backend/src/services/report-sla.service.ts` counting over `ticket_sla`'s recorded outcome columns, per policy and per priority, and **offering no average elapsed time** — the omission is deliberate and documented (research D3, Open Question 2)
- [X] T050 [US2] Create `backend/src/controllers/reports/sla.controller.ts` implementing `GET /api/reports/sla` and mount it in `backend/src/routes/reports/index.ts`
- [X] T051 [P] [US2] Create `frontend/src/components/viz/Meter.vue` — a single ratio against a target, on a same-hue track. **Not** a two-slice pie (research D7)
- [X] T052 [US2] Create `frontend/src/views/reports/SlaReportView.vue` with drill-through from any compliance figure to the tickets it counted (FR-001, User Story 2 scenario 4)
- [X] T053 [US2] Add the SLA report route to `frontend/src/router/index.ts` behind `reports:view`
- [X] T054 [P] [US2] Add `reports.sla.*` locale keys to both locale files

**Checkpoint**: SLA compliance is reportable and reconciles to the tickets by construction.

---

## Phase 5: User Story 3 — Export (Priority: P1)

**Goal**: A report leaves the system in a form somebody else can open.

**Independent Test**: Export the same report in each format, confirm figures match the screen, Arabic
is intact, and the export is recorded.

**Depends on US1** — there must be a report to export. This is the one genuine cross-story dependency
in the phase and it is recorded rather than glossed.

### Tests for User Story 3

- [X] T055 [P] [US3] Write `backend/tests/exports/figures-match.test.ts` asserting exported figures equal the endpoint's figures under the same filters, for CSV and Excel (FR-047, SC-020)
- [X] T056 [P] [US3] Write `backend/tests/exports/injection.test.ts` asserting a CSAT comment beginning `=`, `+`, `-` or `@` is neutralised in both CSV and Excel — customer-authored text makes this real rather than hypothetical (FR-049, SC-022)
- [X] T057 [P] [US3] Write `backend/tests/exports/encoding.test.ts` asserting the CSV carries a UTF-8 BOM and Arabic round-trips intact (FR-048)
- [X] T058 [P] [US3] Write `backend/tests/exports/authority.test.ts` asserting export requires `reports:export` **and** the report's own authority — so `reports:export` cannot become a route to the agent report (contracts/reports-api.md)
- [X] T059 [P] [US3] Write `backend/tests/exports/audit.test.ts` asserting every server-side export writes `data.exported` with the report name and filters, attributable to the taker (FR-051, SC-023)
- [X] T060 [P] [US3] Write `backend/tests/exports/too-large.test.ts` asserting an over-ceiling period refuses plainly and produces **no** file — a truncated file that looks complete is the worst outcome (FR-052, SC-024)

### Implementation for User Story 3

- [X] T061 [US3] Extend `backend/src/services/export.service.ts` with a report-agnostic CSV writer, reusing its existing UTF-8 BOM and formula guard rather than writing a second implementation (contracts/export-contract.md)
- [X] T062 [US3] Implement Excel output in `backend/src/services/report-export.service.ts` using `exceljs` — numbers as numbers and dates as dates, `views[0].rightToLeft` for Arabic exports, and the same formula guard as CSV
- [X] T063 [US3] Implement the filter and provenance header written into every export file, from the `Figure` envelope (FR-003, FR-047)
- [X] T064 [US3] Enforce the row ceiling in the paging loop in `backend/src/services/report-export.service.ts` **before** producing a partial file (FR-052)
- [X] T065 [US3] Create `backend/src/controllers/reports/export.controller.ts` implementing `POST /api/reports/{report}/export` and mount it with both authority checks
- [X] T066 [P] [US3] Create `frontend/src/print.css` (or the print block in the existing stylesheet): hide navigation and filters, expand every collapsed table view, force page-break behaviour so no figure splits, and make the provenance block visible (contracts/export-contract.md § PDF)
- [X] T067 [P] [US3] Create `frontend/src/components/reports/ExportMenu.vue` offering CSV, Excel and PDF — PDF invoking the browser's print pipeline rather than a server call
- [X] T068 [US3] Post a best-effort audit notification when a PDF print is initiated, and state in the code comment that this is **not a control** — a browser print cannot be prevented, and presenting it as enforcement would be worse than admitting the limit (contracts/export-contract.md)
- [X] T069 [P] [US3] Add `reports.export.*` locale keys to both locale files

**Checkpoint**: PLAN.md's Definition of done is complete — one dashboard, refreshing, and every report
exportable.

---

## Phase 6: User Story 4 — CSAT Reporting (Priority: P2)

**Goal**: Customers' own verdict, aggregated honestly.

**Independent Test**: With known scores, confirm the distribution and response rate match a hand
calculation and that a small sample says so.

### Tests for User Story 4

- [X] T070 [P] [US4] Write `backend/tests/reports/csat.test.ts` asserting distribution and average against `fixture-answers.ts` (SC-001)
- [X] T071 [P] [US4] Write `backend/tests/reports/csat-response-rate.test.ts` asserting the denominator counts every ticket that could have been rated, including those never rated (FR-027, SC-010)
- [X] T072 [P] [US4] Write `backend/tests/reports/csat-small-sample.test.ts` asserting an average over fewer responses than the floor is suppressed and the count shown instead (FR-029, SC-009, SC-011)

### Implementation for User Story 4

- [X] T073 [US4] Implement `backend/src/services/report-csat.service.ts` reading `ticket_satisfaction` through `reporting/sources.ts`, returning distribution, average, response rate and comments carrying `ticketReference` rather than an internal id (FR-028)
- [X] T074 [US4] Create `backend/src/controllers/reports/csat.controller.ts` implementing `GET /api/reports/csat` and mount it
- [X] T075 [P] [US4] Create `frontend/src/components/viz/DivergingStackedBar.vue` centred on the neutral score — **CSAT 1–5 is an ordered scale, not four independent categories**, so it takes the same form a Likert scale does (research D7). A column chart here would be the instinctive choice and the wrong one
- [X] T076 [US4] Create `frontend/src/views/reports/CsatReportView.vue`, showing sample size beside every average (FR-029)
- [X] T077 [US4] Add the CSAT route to `frontend/src/router/index.ts` behind `reports:view`
- [X] T078 [P] [US4] Add `reports.csat.*` locale keys to both locale files

**Checkpoint**: CSAT is reportable, and no average is presented more precisely than its sample supports.

---

## Phase 7: User Story 5 — Agent Performance (Priority: P2)

**Goal**: An agent's work is counted by a stated rule, visible only to supervisors.

**Independent Test**: With tickets deliberately reassigned, confirm attribution matches the stated rule
— and confirm an agent account cannot reach the report by any route.

### Tests for User Story 5

- [X] T079 [P] [US5] Write `backend/tests/reports/agent-unreachable.test.ts` enumerating every reporting endpoint, the export route and every dashboard figure key against an **agent** session, asserting none yields an agent performance figure — including with `?agentId=<self>` (FR-030, FR-030b, SC-014a)
- [X] T080 [P] [US5] Write `backend/tests/reports/agent-attribution.test.ts` asserting a reassigned ticket counts for the current assignee and for exactly one agent, never two (FR-031, SC-012)
- [X] T081 [P] [US5] Write `backend/tests/reports/agent-traceability.test.ts` asserting every agent figure reaches the tickets it counted in one step — the mechanism by which a disputed figure is settled, since the agent cannot check it themselves (FR-034, SC-013)
- [X] T082 [P] [US5] Write `backend/tests/reports/agent-suppression.test.ts` asserting no rate is shown over fewer records than the floor, so no individual is characterised by a handful of tickets (FR-036, SC-014)

### Implementation for User Story 5

- [X] T083 [US5] Implement `backend/src/services/report-agent.service.ts` attributing outcomes to `tickets.assignee_user_id`, including deactivated agents for periods they worked in, and exposing each agent's active period (FR-032, FR-033, research D4)
- [X] T084 [US5] Return `attributionRule` as a **field in the response**, describing D4's current-assignee rule — FR-031 requires it stated, and putting it in the payload means no client can render the figures without it
- [X] T085 [US5] Create `backend/src/controllers/reports/agent.controller.ts` implementing `GET /api/reports/agents` gated on `reports:view_agents`, returning **404** rather than 403 so the report is absent rather than present-and-withheld (FR-030b, research D11)
- [X] T086 [US5] Create `frontend/src/views/reports/AgentReportView.vue` — a **table past roughly seven agents**, because more colours stop distinguishing anything and a table is the honest form (research D7); horizontal sequential bars below that
- [X] T087 [US5] Display the attribution rule prominently in `frontend/src/views/reports/AgentReportView.vue`, not in a tooltip — a supervisor reading the figures needs to know what they mean, and the agent they describe cannot ask
- [X] T088 [US5] Add the agent route to `frontend/src/router/index.ts` behind `reports:view_agents`, and omit it from navigation for anyone without the key
- [X] T089 [P] [US5] Add `reports.agent.*` locale keys to both locale files, including the attribution-rule wording

**Checkpoint**: Agent performance is reportable to supervisors, by a stated rule, and unreachable by
the agents it describes.

---

## Phase 8: User Story 6 — Configurable Dashboard (Priority: P3)

**Goal**: The dashboard shows what this manager cares about, and stays that way.

**Independent Test**: Rearrange, sign out and back in, confirm it persisted and belongs only to that
user.

### Tests for User Story 6

- [X] T090 [P] [US6] Write `backend/tests/reports/arrangement.test.ts` asserting an arrangement persists, belongs to one user, and that another user sees their own (FR-040, SC-016)
- [X] T091 [P] [US6] Write `backend/tests/reports/arrangement-validation.test.ts` asserting an unknown figure key is **refused** rather than stored and later ignored — a layout that accumulates dead keys looks broken to its owner (data-model.md)
- [X] T092 [P] [US6] Write `backend/tests/reports/arrangement-authority.test.ts` asserting a figure the viewer has lost authority for is absent from the dashboard response rather than erroring (FR-042, SC-019)

### Implementation for User Story 6

- [X] T093 [US6] Implement `backend/src/services/dashboard-arrangement.service.ts` reading and writing one row per user, validating every key against the declared figure catalog
- [X] T094 [US6] Add the arrangement routes to `backend/src/controllers/reports/dashboard.controller.ts` — own arrangement only, with no id parameter that could become a route to another user's
- [X] T095 [US6] Filter the dashboard response by the viewer's authority in `backend/src/controllers/reports/dashboard.controller.ts` so an unentitled figure is absent rather than refused (FR-042)
- [X] T096 [US6] Add arrangement controls to `frontend/src/views/reports/ManagementDashboardView.vue`, with a sensible default before any configuration is made (FR-041)
- [X] T097 [P] [US6] Add `reports.arrangement.*` locale keys to both locale files

**Checkpoint**: All six stories complete and independently verifiable.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T098 [P] Assert both locale files hold identical `reports.*` key sets in `frontend/tests/locales.test.ts`, following the Phase 9 pattern
- [X] T099 [P] Write `backend/tests/reports/scoping.test.ts` asserting every report applies its scoping **in the query** rather than by filtering results, and that no response contains a record the caller could not obtain directly (FR-060, FR-061, SC-027)
- [X] T100 [P] Write `backend/tests/reports/current-state.test.ts` asserting that recategorising a ticket changes the report and that every figure carries `reflectsCurrentState` — so the movement is explained rather than mysterious (Clarifications Q3, FR-011a, SC-026a)
- [X] T101 [P] Write `backend/tests/reports/no-rule-restatement.test.ts` reading the import graph of every report service and asserting each reaches another phase's tables only through `reporting/sources.ts` (FR-007, SC-025) — the static-read technique that caught a real defect in Phase 9
- [X] T102 [P] Update `README.md` with the reporting section: the three permission keys, the one timezone, that reports reflect current state, and that PDF is produced by the browser
- [X] T103 Confirm no chart component contains a business rule or names a table — chart primitives are ignorant of which report they serve (plan.md Structure Decision)
- [X] T104 Confirm no dual-axis chart exists anywhere in `frontend/src/components/viz/` (research D7)

### Manual passes (cannot be automated — do not close silently)

- [ ] T105 [P] Confirm every report and the dashboard render correctly in Arabic RTL and English LTR, checking specifically what charts get wrong: axis labels, legend position, bar direction, and numbers and dates formatted through `vue-i18n` rather than `String(n)` (Principle I, SC-029)
- [ ] T106 [P] WCAG 2.1 AA pass over every report and the dashboard in both languages — **including the auto-refreshing region and every chart**, the two things this project has not had to make accessible before (Principle IV, SC-029)
- [ ] T107 [P] Screen-reader pass: leave the dashboard open through two refresh intervals and confirm it does **not** read the numbers aloud unprompted (research D8)
- [ ] T108 [P] Greyscale pass: every series distinguishable without colour, via direct labels or the table view
- [ ] T109 **Have a reader of Arabic open all three export formats** and judge legibility. PDF glyph shaping is the risk, and a failure produces output that looks like Arabic to somebody who does not read it (SC-021)
- [ ] T110 Run `quickstart.md` end to end, including Scenario 1's hand-addition of breakdown buckets — the check that catches a total counting nulls beside a breakdown with no null bucket
- [ ] T111 **Measure a report at realistic volume against the new indexes** (research D1). If it still cannot be served, that is the finding that would justify a replica and the constitution amendment that comes with it. Until measured, D1's claim is a claim
- [ ] T112 Answer Open Question 1 with operations: attribution by current assignee, or by assignee at resolution? The one question here whose wrong answer affects somebody's appraisal, about a figure they cannot see
- [ ] T113 Answer Open Question 2: should average elapsed working time be offered at all? Managers will ask. The honest options are a bounded period computed in application code, or a stored `elapsed_working_ms` written when the outcome is recorded — which is a Phase 6 change
- [ ] T114 Tune Open Question 3, the suppression floor, against real distributions. Too high looks like missing data; too low looks like insight
- [ ] T115 Choose Open Question 4, the default refresh interval, per surface — a wall display and a browser tab want different values

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Setup — **blocks all user stories**.
- **Phases 3–8 (User Stories)**: All depend on Phase 2.
- **Phase 9 (Polish)**: Depends on the stories being complete.

### User Story Dependencies

| Story | Priority | Depends on | Notes |
| ----- | -------- | ---------- | ----- |
| US1 Dashboard + volume | P1 | Phase 2 | The MVP. Creates the reports router every later story mounts into. |
| US2 SLA        | P1 | Phase 2 | Independent. Reads recorded outcomes, so it needs nothing from US1 but the router. |
| US3 Export     | P1 | Phase 2 **+ US1** | **The one real cross-story dependency**: there must be a report to export. |
| US4 CSAT       | P2 | Phase 2 | Independent. |
| US5 Agent      | P2 | Phase 2 | Independent, and the only story with its own permission key. |
| US6 Arrangement | P3 | Phase 2 **+ US1** | Arranges the dashboard US1 builds. |

### Within Each Story

Tests → services → controllers → routes → chart primitives → views → locales.

### Parallel Opportunities

- **Phase 1**: T003–T005 in parallel.
- **Phase 2**: T006–T009 in parallel; T013–T015 in parallel; T019–T024 largely in parallel. T010 and
  T011–T012 are sequential in themselves (`sources.ts` before the fixture uses it).
- **Phase 3+**: every story's tests are `[P]`; chart primitives within a story are `[P]`.
- **Across stories**: once Phase 2 lands, US1, US2, US4 and US5 can proceed simultaneously. US3 and US6
  wait on US1.

---

## Parallel Example: User Story 2

```bash
# All four US2 tests together:
Task: "backend/tests/reports/sla-reconciliation.test.ts"
Task: "backend/tests/reports/sla-separate-promises.test.ts"
Task: "backend/tests/reports/sla-exclusions.test.ts"
Task: "backend/tests/reports/sla-no-recompute.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 — Setup, including the seven indexes. Do these first: without them every report is a table
   scan, and a slow report during development invites the wrong conclusion about the architecture.
2. Phase 2 — Foundational. **The largest investment in the phase and the one that makes the rest
   trustworthy**: the figure envelope means a figure cannot ship without its provenance, `sources.ts`
   means the coupling has one reviewable address, and the hand-computed fixture means correctness is
   checkable at all.
3. Phase 3 — US1.
4. **STOP and VALIDATE**: a supervisor sees accurate figures on one refreshing dashboard, checked
   against hand-computed answers. Half of PLAN.md's Definition of done.

### Incremental Delivery

1. Setup + Foundational → nothing can return a figure without provenance.
2. + US1 → the dashboard. **MVP.**
3. + US2 → SLA compliance, reconciling to the tickets by construction.
4. + US3 → export. **Definition of done complete.**
5. + US4, US5, US6 → in any order; US6 after US1.

### Sequencing Note

**US2 is worth doing second even though US3 completes the Definition of done.** SLA compliance is the
figure most likely to be quoted to a customer, and D3 makes it reconcile by construction — establishing
that early builds the confidence the rest of the phase trades on. Exporting a figure nobody has
validated is the wrong order.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- **Correctness is established against hand-computed literals, never against a second query.** Two
  queries that agree share the assumptions where the bug is (research D9)
- Run the backend suite alone — it shares one `crm_support_test` schema with `fileParallelism: false`,
  and a concurrent or killed run leaves open transactions that produce 401/403 failures across
  unrelated files
- Commit after each task or logical group
- T111 is the task that could change the architecture: it converts D1's performance claim into a
  measurement
- T112 is the task whose wrong answer affects a person who cannot see the figure
