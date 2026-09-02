# Phase 0 Research: Phase 10 — Reports & Management

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

Twelve decisions. Three were settled by reading the existing schema rather than by choosing, and those
are the ones that matter most — a reporting phase is defined by what the data will actually let it
count.

The phase's hazard is stated in the spec and bears repeating here because every decision below is
shaped by it: **a wrong number looks exactly like a right one.** It does not error and nobody checks
it. So the design goal is not "compute the figures" but "remove the places a figure could be wrong",
and the two best techniques for that turn out to be the same one twice — read a recorded outcome
instead of recomputing it (D3), and name another phase's tables in exactly one file (D2).

---

## D1 — Index the operational database. No warehouse, no replica, no cache.

**Decision.** Add seven indexes to existing tables and report directly from MySQL:

| Table                   | Index                              | Serves                              |
| ----------------------- | ---------------------------------- | ----------------------------------- |
| `tickets`               | `(created_at)`                     | Every volume report's date filter   |
| `tickets`               | `(created_at, category)`           | Volume by category                  |
| `tickets`               | `(created_at, source)`             | Volume by channel                   |
| `tickets`               | `(assignee_user_id, created_at)`   | Agent volumes over a period         |
| `ticket_sla`            | `(response_breached_at)`           | Response compliance counts          |
| `ticket_sla`            | `(resolution_breached_at)`         | Resolution compliance counts        |
| `ticket_satisfaction`   | `(submitted_at)`                   | CSAT over a period                  |

**Rationale.** This started as a question about whether the operational database could serve these
aggregates at all — the spec's Out of Scope deliberately refused to adopt a warehouse speculatively and
left the finding to the plan. Reading the migrations answered it, and the answer was not the one the
question implied.

**`tickets` HAS NO INDEX ON `created_at`.** The nine existing indexes are
`customer_id`, `assignee_user_id`, `status`, `priority`, `(status, priority)`,
`merged_into_ticket_id`, `due_at`, `source` and `requesting_contact_id` — every one of them serves
finding or filtering a working set, because that is all any previous phase needed. Nothing before now
asked "how many arrived last month", so nothing indexed the column that answers it.

That reframes the whole performance question. The reports are counts and sums over columns that are
already stored; what they lacked was a way to reach a date range without a scan. Adding an index is
cheap, reversible, and owned by this phase. Adopting a second datastore to avoid adding an index would
be a Technology Standards deviation requiring a constitution amendment — taken to avoid a migration.

`ticket_satisfaction` has only `(ticket_id)`, which is Phase 8's uniqueness constraint rather than a
reporting index. `ticket_sla`'s existing indexes are `(resolution_target_at, paused_at)` and
`(response_target_at, paused_at)` — built for Phase 6's due-date sweep, not for counting outcomes.

**Alternatives considered.** A read replica: real infrastructure, and the reports are not heavy enough
to need one until measurement says so. Materialised views or a summary table refreshed on a schedule:
reintroduces exactly the staleness Clarifications Q3 rejected, and a stale summary is the "wrong number
that looks right" failure in its purest form. A cache: same objection.

**What would change this.** If a report at real volume still cannot be served from these indexes, that
is a finding worth a replica and worth the amendment. It is measurable, and D9's fixtures are where the
measurement belongs — not a guess made now.

---

## D2 — One file names another phase's tables

**Decision.** `backend/src/reporting/sources.ts` is the only module permitted to reference a table
owned by another phase. Every report service composes its query from the accessors that file exposes,
and no report service writes a raw table name.

**Rationale.** FR-007 and SC-025 forbid reporting from restating another phase's rules, and the reason
is specific: a reporting query that computes SLA state itself becomes a second definition of Phase 6's
rules. Both definitions compile. Both pass their own tests. They agree on the day they are written and
they drift on the first change to either — and when they disagree, the report is the wrong one and
nothing says so.

Concentrating the coupling in one file does not remove it; nothing can, because reporting is genuinely
cross-cutting. What it does is make the coupling **reviewable**. SC-025 asks for verification "by
review that SLA state, working hours and ticket lifecycle are read from their owning services", and
that review is a one-file read rather than a search across six services.

This is the property `routes/public/index.ts` and `portal/endpoints.ts` already provide for their own
concerns, and both files say so in their own comments. It is the same technique applied to a different
axis.

**The rule-owning modules reporting must call rather than reimplement:**

| Concern                        | Owner                                    |
| ------------------------------ | ---------------------------------------- |
| Ticket statuses, transitions   | `tickets/lifecycle.ts`                   |
| Categories, priorities         | `tickets/taxonomy.ts`                    |
| Which statuses pause an SLA    | `sla/clock.ts`                           |
| Working-hour arithmetic        | `lib/business-hours.ts`                  |
| Recorded SLA outcome           | `ticket_sla` columns, unmodified (D3)    |
| Customer-facing ticket state   | `portal/customer-status.ts`              |

---

## D3 — SLA compliance is a count over RECORDED outcomes, not a recomputation

**Decision.** Compliance rates are `COUNT`s over `ticket_sla.response_breached_at`,
`response_satisfied_at`, `resolution_breached_at` and `resolution_satisfied_at`. Reporting does not
recompute whether a target was met, and **does not offer average elapsed working time as an
aggregate at all**.

**Rationale.** Phase 6 anticipated this phase and left a note. `ticket-sla.model.ts` annotates those
columns:

> _"The recorded outcome Phase 10 reporting must read, not recompute."_

Taking that at its word settles four requirements at once. FR-007 (do not restate), FR-022 (exclude
paused time — already excluded when the outcome was recorded), FR-025 (reconcile to the ticket screen)
and SC-005 (zero reconciliation differences) all hold because the report and the ticket screen read
**the same columns**. Reconciliation is not a test that might fail; it is a property of there being
one number.

**The half that cannot be done, and is therefore not offered.** `lib/business-hours.ts` exports
`workingTimeBetween(from, to, calendar)`, and it is JavaScript: it walks a calendar with working days,
day-start and day-end minutes, a timezone, and per-date exceptions. There is no SQL equivalent, and
there is no honest way to aggregate it in a query. The options were:

1. Compute it per ticket in application code — correct, and O(tickets in period) calendar walks per
   report. Fine for a week, not for a year.
2. Approximate with wall-clock elapsed time — **rejected outright.** It would produce a figure labelled
   "average response time" that disagrees with every SLA target in the system, and it would look
   entirely plausible. This is the phase's central hazard in one line of SQL.
3. Do not offer the figure.

Option 3, for now. Compliance **rate** is the figure the requirements actually ask for (FR-020, FR-021),
and it is available exactly. Average elapsed time is a natural next request and Open Question 2 records
it, so it is a deliberate omission rather than an oversight.

---

## D4 — Attribution follows the CURRENT assignee, and the report says so

**Decision.** A ticket's outcomes are attributed to `tickets.assignee_user_id` — the current assignee.
The attribution rule is displayed on the agent report, not buried in documentation.

**Rationale.** Clarifications Q3 committed the phase to current record state, and this follows from it:
reading "who was assigned when the status became resolved" means reconstructing history from
`ticket_history` per ticket, which is both the thing Q3 rejected and a per-row history walk in a report.

**The cost is real and it is not hidden.** An agent who resolved fifty tickets and handed them to a
colleague shows zero for those fifty. That is a figure that is wrong about a person — and under
Clarifications Q1 that person cannot see it to object. Three things follow, and they are why FR-031 and
FR-034 are written the way they are: the rule is stated on the report so a supervisor reading it knows
what it means; every figure is traceable to the tickets it counted so a dispute can be settled; and this
is **Open Question 1**, because it is a fairness decision rather than a technical one and operations
should make it rather than inherit it from a schema convenience.

**Alternatives considered.** Assignee at resolution, from `ticket_history`: fairer, and it contradicts
Q3 while adding a per-ticket history read. Credit split across everyone who held the ticket: no
percentage sums to anything meaningful and no agent recognises their own number. Count for every
toucher: FR-031 explicitly forbids one ticket counting in full for two agents.

---

## D5 — One timezone, from the active business calendar, resolved once per request

**Decision.** `reporting/period.ts` converts a requested date range into absolute UTC bounds using the
timezone on the **active business calendar**, and every report receives resolved bounds rather than a
date string.

**Rationale.** The spec's Assumptions fixed one timezone rather than a per-user preference, and the
reason is that two managers reading the same report must not see different period boundaries. Phase 6
already stores `time_zone` on `business_calendars` and `lib/business-hours.ts` already exports
`zonedPartsOf` and `instantFromZoned` — so this is reuse, not new arithmetic, and D2 applies.

Resolving once per request rather than per query is what makes FR-002 achievable: a total and its
breakdown computed against two independently-resolved boundaries can differ by a day's worth of
tickets, which is precisely the "two figures that must agree, disagreeing" failure FR-002 exists to
prevent.

FR-013's daylight-saving and calendar-exception cases are `lib/business-hours.ts`'s existing problem,
already solved there, and D2 forbids solving them again here.

---

## D6 — Three export formats, three different mechanisms, and PDF is the browser's job

**Decision.**

| Format | Mechanism                                                             |
| ------ | --------------------------------------------------------------------- |
| CSV    | Extend Phase 2's `export.service.ts` — already correct (see below)    |
| Excel  | `exceljs`, server-side                                                |
| PDF    | **The browser's own print pipeline**, client-side, with a print stylesheet |

**Rationale, CSV.** Phase 2 already solved the two things that go wrong, and its comments say why. It
writes a UTF-8 BOM because _"Excel guesses the encoding of a CSV without this, and Arabic customer
names arrive as mojibake — in the one place they are most likely to be read by someone outside the
team"_, and it prefixes any cell starting `=`, `+`, `-` or `@` with a quote because spreadsheet
software treats it as a formula. FR-048 and FR-049 are restatements of exactly those two fixes.
Reimplementing them would be the D2 mistake in a different place.

**Rationale, PDF — the phase's biggest risk, and the reason for an unusual answer.** SC-021 requires a
reader of Arabic to open each export and find it legible. Arabic in PDF needs three things a JavaScript
PDF library does not have by default: an embedded font with Arabic glyphs, bidirectional text ordering,
and **contextual glyph shaping** (Arabic letters change form by position). Getting all three right in a
server-side library is a project, and getting them subtly wrong produces a PDF that looks like Arabic
to someone who does not read it.

The browser already does all three, correctly, for the screen the reader is looking at. Printing that
screen through a print stylesheet reuses a text engine that is already right instead of building a
second one that has to be made right.

**The costs, stated.** The PDF is generated client-side, so it is not byte-identical across browsers,
and it cannot be produced by a server-side job or scheduled — which is fine, because scheduled delivery
is out of scope. Charts print because they are inline SVG (D7), which is the second time that decision
pays.

**Alternatives considered.** A headless browser server-side (Playwright/Puppeteer): correct output, and
a very heavy dependency plus a browser to keep patched, to produce a document the user's own browser can
already make. A server-side PDF library: the shaping problem above.

---

## D7 — Charts are inline SVG. No charting library.

**Decision.** Nine chart primitives in `frontend/src/components/viz/`, each plain Vue rendering inline
SVG. No charting dependency.

**The form for each figure**, chosen by what the reader has to do with it rather than by what looks
impressive:

| Figure                              | Form                                        | Why                                                              |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Headline totals (received, open, late) | **KPI row of stat tiles**                | Handful of headline numbers. A grouped bar chart of four numbers is a chart pretending to be needed. |
| Volume over time                    | **line**                                    | Trend over time                                                  |
| Status distribution                 | **stacked bar**, horizontal                 | Part-to-whole, and status names are long — worse vertically       |
| Volume by category / channel        | **bar**, horizontal, sequential one-hue     | Compare magnitude. Categorical hues would imply the categories are identities being told apart, which is not the job. |
| SLA compliance vs target            | **meter**                                   | A single ratio against a limit. NOT a two-slice pie.              |
| Compliance over time                | **line**                                    | Trend                                                            |
| CSAT 1–5 distribution               | **diverging stacked bar, centred on neutral** | An ORDERED scale, not four independent categories — the same form a Likert scale takes. This is the one that would have been got wrong by instinct. |
| Agent comparison                    | **horizontal bar**, sequential — or a **table** past ~7 agents | Magnitudes being compared. Past seven, more colours stop distinguishing anything and a table is the honest form. |

**Rationale for no library.** The chart is HTML/SVG marks either way; a library adds an intermediary
that has its own opinions about the three things this phase cannot compromise on:

- **Direction.** FR-062 requires RTL. Inline SVG has no opinion about `dir`; a library's axis renderer
  usually does, and overriding it is a fight.
- **Print.** D6 makes the browser produce the PDF. Inline SVG prints natively; a canvas-based library
  prints as a bitmap or not at all.
- **Colour.** The palette is validated (below) and applied as CSS custom properties. A library ships its
  own defaults and its own cycling behaviour, and "categorical hues in fixed order, never cycled" is
  not something most of them offer.

**The palette was validated at plan stage, not left to implementation.** Four categorical slots — blue
`#2a78d6`, orange `#eb6834`, aqua `#1baf7a`, yellow `#eda100` — against the light surface, and their
dark-mode steps against the dark surface:

```
light: ALL CHECKS PASS  · worst adjacent CVD ΔE 9.1 (protan) · normal-vision ΔE 22.9
       WARN contrast vs surface: #1baf7a 2.74, #eda100 2.11 — relief required
dark:  ALL CHECKS PASS  · worst adjacent CVD ΔE 8.4 (protan) · all four ≥ 3:1 contrast
```

The light-mode WARN obligates visible labels or a table view — and **the spec already requires the
relief**: FR-001's traceability and FR-005's "counts alongside percentages" mean every figure has its
numbers available, and D8 gives every chart a table view. One mechanism discharges the accessibility
obligation, the colour-contrast relief, and FR-001 together.

Four slots is deliberate: it is the count at which direct labels become mandatory rather than optional,
and beyond it a fifth hue buys less than a table does.

**No dual-axis chart anywhere.** Volume and compliance-rate on one chart with two y-scales is the
single most common reporting mistake and it makes any relationship between the two lines an artefact of
the scales chosen. Two charts, or index both to a common base.

---

## D8 — Auto-refresh and charts are the two new accessibility problems

**Decision.** `composables/useAutoRefresh.ts` implements the refresh contract, and every chart ships a
table view.

**The refresh contract** (FR-045a–d):

- **Skip, never queue.** If a refresh is in flight when the next is due, the next is skipped. Queuing
  turns a slow query under load into a growing backlog of identical queries — a reporting feature
  becoming an outage during exactly the busy period somebody opened the dashboard to watch.
- **Stop when unobserved.** `document.visibilityState`, plus an idle threshold. A dashboard left open on
  an unattended screen must not query until morning.
- **Keep the last good figures on failure**, with their own timestamp. FR-043 is the last SUCCESSFUL
  refresh, not the last attempt — a stale number beside a current-looking clock is worse than no clock.

**The accessibility half, which is new to this project.** An interval-updating region is hostile to a
screen reader if it announces: a manager's dashboard would read numbers aloud every minute, unprompted,
interrupting whatever the reader was doing. So figures are **not** in an `aria-live` region. The reader
gets a deliberate "refresh now" control and an explicit statement of when the figures are from, which
is the same information without the interruption.

Every chart has a **table view** toggle. It is the accessibility answer for a screen reader, the relief
the colour contrast WARN requires (D7), the RTL answer where a chart's layout is ambiguous, and it is
what the reader gets in a greyscale print. Four obligations, one component.

**Number and date formatting goes through `vue-i18n`.** Chart axis labels are the easiest place in a
codebase to leave `String(n)`, and the result is Latin digits and ISO dates on an Arabic screen — a
Principle I violation that no test catches and no reviewer who does not read Arabic notices.

---

## D9 — Correctness is established by hand-computed fixtures, never query-versus-query

**Decision.** `backend/tests/reporting/` holds a fixture data set with answers computed by hand and
written into the test as literals. Every report is asserted against those literals.

**Rationale.** SC-001 requires every figure to match a hand-computed count with zero discrepancies, and
the spec's Assumptions section explicitly forbids the tempting alternative: **two queries that agree
can both be wrong.** A test that compares the report's SQL to a second, simpler SQL proves the two
share assumptions — about null handling, about boundary inclusiveness, about whether a merged ticket
counts — and those assumptions are precisely where the bug will be.

Writing the answers by hand forces someone to decide what the right answer IS for the awkward cases the
spec's Edge Cases list: the ticket that opened in one period and closed in another, the merged ticket,
the ticket with no assignee, the period boundary at a daylight-saving change. A fixture is where those
decisions become concrete, and disagreement with the implementation then means one of them is wrong
rather than that both drifted together.

The fixture is also where D1's performance claim gets measured, because it is the one place with a
known data volume.

---

## D10 — A figure carries its own provenance, as one type

**Decision.** `reporting/figure.ts` declares an envelope every reported figure is returned in:

```
Figure {
  value, count, total          // FR-005 — never a bare percentage
  excluded: { reason, count }[] // FR-004 — stated, never silent
  suppressed: boolean           // FR-006, FR-036 — sample too small to characterise
  period, timeZone, filters     // FR-003
  computedAt                    // FR-043
  reflectsCurrentState: true    // FR-011a — Clarifications Q3's disclosure
}
```

**Rationale.** These are six separate requirements about honesty, and every one of them is the kind a
surface forgets individually. A percentage rendered without its counts, an exclusion nobody mentioned,
a filter set the export did not record — each is a small omission that makes a figure untrustworthy in
a way the reader cannot detect.

Making it **one type** means a report cannot return a figure without them: the fields are not optional,
so a service that has not decided what to put in `excluded` has to decide. It also gives
`FigureFrame.vue` one shape to render, so the provenance appears on every surface without each surface
remembering to show it, and gives the export one shape to serialise (FR-047).

`reflectsCurrentState` being a literal `true` rather than a computed value is deliberate. It documents
Clarifications Q3 in the payload, and if a later phase adds period snapshots it becomes the flag that
distinguishes them — rather than a change to what every existing figure means.

---

## D11 — Three permission keys, and the agent report is unreachable rather than refused

**Decision.**

| Key                    | Grants                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `reports:view`         | Volume, SLA, CSAT, AI reports and the management dashboard    |
| `reports:view_agents`  | Agent performance reporting. Supervisors and administrators only (Clarifications Q1) |
| `reports:export`       | Taking any report out of the system                           |

**Rationale.** `reports:view_agents` is separate because Clarifications Q1 made agent figures
supervisory: operational reporting must be grantable without handing over figures about colleagues, and
one key would make those the same grant. `reports:export` is separate because FR-050 requires it and
because Phase 2 established the principle — export is the action that takes data out of the system, and
Phase 2's `customers:export` is separate from `customers:view` for the same reason.

**Unreachable, not present-and-refusing** (FR-030b, User Story 5 scenario 6). The agent report is
absent from navigation for anyone without the key, and no agent figure appears on any other surface —
not the ticket screen, not a notification, not as a dashboard component a manager could add to
something an agent sees. A refused-but-visible report tells an agent that figures about them exist and
that they may not see them, which is worse than either alternative.

**FR-061's aggregation rule is the subtle one.** A report must not become a route to data the viewer
could not reach directly, including by aggregating over a group small enough to identify one record.
D12 is the mechanism.

---

## D12 — One suppression floor, declared once

**Decision.** `reporting/suppression.ts` declares a single minimum record count. Below it, a report
shows the count and withholds the rate.

**Rationale.** Three requirements want this and would otherwise implement it three times with three
different numbers: FR-006 (no precision the sample does not support), FR-029 (CSAT averages over tiny
samples), FR-036 (no individual characterised by a handful of tickets), and FR-061 (no identification
by aggregation).

They are the same rule with different motivations, and one declaration is what makes SC-011 and SC-014
testable by iteration rather than by naming each surface. It is also the kind of value that gets tuned
once someone looks at real data, so it belongs in one place — the lesson Phase 9 recorded twice, for its
grounding floor and its classification confidence threshold.

**The number itself is Open Question 3.** Too high and small teams see nothing; too low and one bad
week characterises an agent. It cannot be chosen well before real data.

---

## Open questions

1. **Should attribution follow the current assignee, or the assignee at resolution?** D4 chose current,
   because Clarifications Q3 committed to current state. It means an agent who resolved fifty tickets
   and handed them on shows zero — a figure that is wrong about a person who, under Clarifications Q1,
   cannot see it. This wants an operations decision rather than a schema convenience, and it is the one
   question here whose wrong answer affects somebody's appraisal.
2. **Should average elapsed working time be offered at all?** D3 omits it because it cannot be
   aggregated in SQL and the wall-clock approximation would be plausibly wrong. Compliance rate is what
   the requirements ask for. If managers ask for average response time — and they will — the honest
   options are a bounded period computed in application code, or a stored elapsed-working-ms column
   written when the outcome is recorded, which is a Phase 6 change.
3. **What is the suppression floor?** (D12.) A number that cannot be chosen well before seeing real
   distributions, and whose wrong value is invisible: too high looks like missing data, too low looks
   like insight.
4. **Does the dashboard refresh interval want a default per surface?** A wall display and a browser tab
   want different values, and FR-045 makes it configurable without saying what the default is.
