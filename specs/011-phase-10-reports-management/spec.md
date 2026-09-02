# Feature Specification: Phase 10 — Reports & Management

**Feature Branch**: `011-phase-10-reports-management`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description (PLAN.md Phase 10 Specify prompt): "Implement reporting and management
dashboards: ticket volume/status reports, SLA performance, agent performance, CSAT reporting, a
configurable real-time KPI dashboard, and export to PDF/Excel/CSV."

**PLAN.md Reference**: Phase 10 — Reports & Management

**Depends on**: Phases 3–9 — and unusually, it depends on them having been **used**, not merely built.
Phase 3 (tickets, and `ticket_history` as the record of what changed when), Phase 4 (the agent
dashboard this is the management counterpart to), Phase 5 (channel of origin), Phase 6 (SLA targets,
breaches, and the business calendar that defines a working hour), Phase 7 (knowledge base readership),
Phase 8 (satisfaction scores — the only direct customer sentiment in the system), Phase 9 (AI usage
and cost)

## Overview

Every phase so far produced something a person could look at and judge. A permission either refused
them or did not. A ticket either reached the right agent or sat in a queue. A summary was useful or it
was not worth reading. When those features were wrong, somebody noticed.

**A wrong number looks exactly like a right one.** That is the whole of Phase 10, and it is a
different kind of risk from anything in the nine phases before it. A dashboard reporting 94% SLA
compliance when the true figure is 71% does not error, does not look broken, and does not prompt
anybody to check. It gets acted on: an agent is praised, a hire is not made, a customer's complaint is
dismissed as an outlier. The failure is silent, confident, and durable — and it is discovered, if at
all, months later by somebody reconciling two figures that should have matched.

Four consequences follow, and each one is new to this codebase.

**This is the first phase that reads across every other phase.** Nine phases built forty-eight tables
under a rule the constitution states plainly: business logic lives in services, and each service owns
its own concern. Reporting respects no such boundary — an SLA compliance figure needs `ticket_sla`,
`tickets`, `business_calendars` and `users` in one query, and an agent performance figure needs
`ticket_history` to know who did what and when. That coupling is unavoidable and it is dangerous: a
reporting query that reaches directly into another phase's tables becomes a second definition of that
phase's rules, and the two will drift. When they do, the report will be the one that is wrong, and
nothing will say so.

**Numbers about tickets become numbers about people.** Agent performance reporting is the first
feature in this system whose subject is a member of staff rather than a record. That changes what the
requirements have to cover: not only whether the figure is correct, but who may see it, whether the
person it describes may see it, and what happens when it is wrong about somebody. A tickets-resolved
count that omits reassigned work is not a rounding error to the agent it undercounts. This phase
therefore treats a performance report as a **statement about a colleague**, with the access rules and
the right of reply that implies.

**Time stops being a timestamp and becomes a question.** Every phase so far stored `created_at` and
compared it to `now`. A report asks "how many tickets last month", and that has no answer until
somebody says which timezone the month is in, whether a working hour means a business-calendar hour or
a wall-clock one, and what happens to a ticket that opened in one period and closed in the next. Phase
6 already made a business calendar with a timezone; a report that ignores it will produce SLA figures
that disagree with the SLA screen, and both will look authoritative.

**And exporting stops being one customer's data and becomes the operation's.** Phase 2 built
`customers:export`, permissioned and audited, for a list of customers. A report export is a different
proposition: SLA breach counts by agent, satisfaction scores by customer, volumes by channel — the
material an organisation would least like to leave the building unnoticed. The precedent is right and
the scale is not.

Phase 10 changes no existing behaviour. Every surface here is **read-only**: it computes, it displays,
it exports. It writes nothing to a ticket, a customer, or a message. If reporting is switched off or
fails entirely, every other phase behaves exactly as it did before.

## Clarifications

### Session 2026-09-02

**Q1 — Who may see an agent's performance figures?**

**Decision: supervisors and administrators only.** An agent has no access to agent performance
reporting, including their own figures.

This is the narrowest of the three options and it has one consequence worth naming rather than
discovering: **an agent cannot check a figure that is wrong about them.** FR-034 still requires every
agent figure to be traceable to the tickets it counted — but the person exercising that traceability
is now the supervisor, on the agent's behalf. That makes the right of reply *mediated* rather than
absent, and it makes FR-034 more important, not less: it is the only mechanism by which a disputed
figure can be settled at all. FR-031's requirement that the attribution rule be stated explicitly
carries the same weight for the same reason.

User Story 5 loses its agent-facing half as a result, and its scenarios are rewritten accordingly.

**Q2 — What does "real-time" mean for the dashboard?**

**Decision: automatic refresh on an interval** while the dashboard is open.

This is the option PLAN.md's phrasing most plausibly meant, and it is the one an operations room
actually wants. It also carries the highest running cost of the three realistic options, so the
requirements have to bound it: a refresh must not overlap a slow query (FR-045a), must stop when
nobody is looking (FR-045b), and must not make an auto-updating screen hostile to a screen reader
(FR-045c). SC-018 — no degradation of ticket, message or portal operations — moves from a formality to
the constraint this feature is measured against, because a repeated aggregate query per open dashboard
is a load the operational database has never carried.

**Q3 — Does a report reflect the past as it was, or as it is now?**

**Decision: as it is now.** Reports query current record state.

Simple, and honest only if the system says so. Recategorising a ticket today changes last month's
volume-by-category report, and a manager who quoted the old figure will find it has moved with nothing
to explain why. The mitigation is disclosure rather than machinery: FR-011a requires every report to
state that it reflects current state, so the behaviour is a documented property instead of a surprise.
Period snapshots were the alternative and were rejected for this phase — a stored snapshot that is
subtly wrong is undetectable afterwards, which is worse than a live figure that moves visibly.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — A Supervisor Answers "How Are We Doing?" Without Asking Anybody (Priority: P1)

A supervisor opens one screen at the start of the week and sees the numbers that tell them whether the
team is coping: how much came in, how much is still open, how much is late, how customers rated what
was finished. They can narrow any of it by date, category, channel or agent without exporting anything
or asking for a query to be written.

**Why this priority**: This is the first half of PLAN.md's Definition of done — "a manager can open one
dashboard and see accurate, real-time KPIs". It also delivers value entirely alone: shipped with
nothing else in this phase, a supervisor who currently has no operational view has one.

**Independent Test**: With a known set of tickets, open the dashboard and confirm every figure matches
a count done by hand against the same data, and that each filter narrows the figures consistently.

**Acceptance Scenarios**:

1. **Given** tickets across several statuses, categories and channels, **When** a supervisor opens the
   management dashboard, **Then** they see total volume, open volume, and breakdowns by status,
   category and channel.
2. **Given** the dashboard is showing a period, **When** the supervisor changes the date range,
   **Then** every figure on the screen updates to that range and none is left showing the old one.
3. **Given** a filter is applied, **When** the supervisor reads two figures that should agree — a total
   and the sum of its breakdown — **Then** they agree.
4. **Given** no tickets match the filters, **When** the dashboard renders, **Then** it says so rather
   than showing zeroes that look like a system fault.
5. **Given** a supervisor without authority to see other agents' work, **When** they open the
   dashboard, **Then** they see only what they are entitled to, and the figures are consistent with
   that scope rather than silently mixing scopes.
6. **Given** an Arabic interface, **When** the dashboard renders, **Then** numbers, dates and charts
   read correctly right-to-left.

---

### User Story 2 — Somebody Can Prove Whether the SLA Was Met (Priority: P1)

A supervisor needs to know how often the team answered and resolved within the promised time, broken
down by policy, priority and period — and needs the figure to agree with what the SLA screen says
about individual tickets, because somebody will check.

**Why this priority**: SLA performance is the report most likely to be quoted to a customer or used in
a commitment, so it is the one where being wrong is most expensive. It is P1 with User Story 1 because
a volume dashboard without SLA context tells a supervisor how busy they are but not whether they are
succeeding.

**Independent Test**: Construct tickets with known response and resolution times against a known
policy, some breaching and some not, and confirm the reported compliance rate matches the hand count
and the per-ticket SLA state.

**Acceptance Scenarios**:

1. **Given** tickets with SLA targets, some met and some breached, **When** a supervisor opens the SLA
   report, **Then** response and resolution compliance are reported separately, because they are
   separate promises.
2. **Given** a ticket whose SLA clock was paused, **When** it appears in the report, **Then** the
   elapsed time excludes the paused period, consistently with how Phase 6 computed its target.
3. **Given** a ticket with no SLA policy attached, **When** the report is computed, **Then** it is
   excluded from compliance rates rather than counted as compliant.
4. **Given** a reported compliance figure, **When** a supervisor drills into it, **Then** they can
   reach the individual tickets it was computed from.
5. **Given** the business calendar defines working hours, **When** elapsed time is reported, **Then**
   it uses the same definition of a working hour the SLA targets were set with.

---

### User Story 3 — A Report Leaves the System in a Form Somebody Else Can Open (Priority: P1)

A supervisor exports what is on screen and sends it to a manager who does not use the system: a
spreadsheet to work with, or a document to read.

**Why this priority**: The second half of PLAN.md's Definition of done — "and export any report". It is
P1 because a report that cannot leave the screen does not reach the people the phase exists to serve;
management reporting is consumed in meetings and in mailboxes.

**Independent Test**: Export the same report in each supported format and confirm the figures match the
screen exactly, that Arabic text is intact, and that the export is recorded.

**Acceptance Scenarios**:

1. **Given** a report on screen with filters applied, **When** the supervisor exports it, **Then** the
   exported figures match the screen, including the filters, and the file states which filters produced
   it.
2. **Given** an export containing Arabic text, **When** it is opened in common spreadsheet software,
   **Then** the Arabic is legible rather than mojibake.
3. **Given** an export is produced, **When** an administrator reviews the audit log, **Then** the
   export is recorded, attributable to the person who took it, with what was exported.
4. **Given** a user without authority to export, **When** they attempt it, **Then** they are refused
   server-side.
5. **Given** a report covering a very large period, **When** it is exported, **Then** it completes or
   states plainly that the period is too large — it does not fail silently or produce a truncated file
   that looks complete.

---

### User Story 4 — Customers' Own Verdict, Aggregated (Priority: P2)

A supervisor sees how customers rated resolved tickets, over time and by agent, category and channel.

**Why this priority**: Real value and the only direct customer sentiment the system holds — but Phase 8
already shows individual scores on the ticket, so the aggregate is an addition rather than a first
sight of the data. P2 because a small sample makes an aggregate misleading, and the requirements have
to handle that (FR-036) before the report is worth reading.

**Independent Test**: With a known set of satisfaction scores, confirm the reported averages and
distributions match a hand calculation, and that a period with too few responses says so.

**Acceptance Scenarios**:

1. **Given** resolved tickets with satisfaction scores, **When** a supervisor opens the CSAT report,
   **Then** they see the score distribution and the response rate, not only an average.
2. **Given** a period with very few responses, **When** the figure is displayed, **Then** the sample
   size is shown alongside it and a misleadingly precise average is not presented as reliable.
3. **Given** tickets that were resolved but never rated, **When** the response rate is computed,
   **Then** they are counted in the denominator.
4. **Given** a customer's free-text comment, **When** it appears in a report, **Then** it is
   attributable to the ticket it came from so somebody can act on it.

---

### User Story 5 — An Agent's Work Is Counted Fairly (Priority: P2)

A supervisor sees what each agent handled: volumes, resolution times, SLA outcomes, satisfaction. The
figures account for the messy reality of support work — reassignment, escalation, tickets that pass
through several hands.

**Why this priority**: Genuinely useful for staffing and coaching, and the most consequential report
for the individuals it describes. P2 rather than P1 because it is the one that most needs the other
reports to be trusted first: an agent performance figure derived from an SLA calculation nobody has
validated is worse than no figure.

**A supervisory surface only** (Clarifications Q1). The agents it describes cannot see it, which puts
the whole weight of fairness on two things: the attribution rule being stated (FR-031), and every
figure being traceable to the tickets it counted (FR-034) so a supervisor can settle a dispute on an
agent's behalf.

**Independent Test**: With tickets deliberately reassigned between agents, confirm the reported
attribution matches a stated, documented rule rather than whichever agent happens to hold the ticket
now — and confirm an agent account cannot reach the report by any route.

**Acceptance Scenarios**:

1. **Given** tickets assigned to several agents, **When** a supervisor opens the agent performance
   report, **Then** each agent's volumes and outcomes are shown for the selected period.
2. **Given** a ticket reassigned from one agent to another, **When** it is attributed, **Then** the
   attribution follows a rule the report states, and the same ticket is not counted in full for both.
3. **Given** an agent who was inactive for part of the period, **When** their figures are shown,
   **Then** the period they were actually working is evident, so a low count is not read as poor
   performance.
4. **Given** an agent account, **When** it attempts to reach the agent performance report — directly,
   by export, or as a dashboard component — **Then** it is refused server-side, including for the
   agent's own figures.
5. **Given** an agent disputes a figure about them, **When** their supervisor investigates, **Then**
   the supervisor can reach the tickets the figure counted in one step, because the agent cannot check
   it themselves.
6. **Given** a supervisor who may view operational reports but not agent figures, **When** they open
   the reports area, **Then** the agent report is absent rather than present-and-refusing.

---

### User Story 6 — The Dashboard Shows What This Manager Cares About (Priority: P3)

A manager arranges the dashboard to show the figures relevant to them, and it stays that way.

**Why this priority**: PLAN.md asks for "configurable KPI widgets", and configurability is real value
for people with different responsibilities. P3 because a fixed dashboard showing the right figures
delivers most of the benefit, and configurability without trustworthy figures underneath is
rearranging furniture.

**Independent Test**: Change the dashboard's arrangement, sign out and back in, and confirm the
arrangement persisted and belongs to that user rather than to everyone.

**Acceptance Scenarios**:

1. **Given** the dashboard, **When** a manager chooses which figures to show and how they are arranged,
   **Then** the choice persists for their next visit.
2. **Given** one manager's arrangement, **When** another manager signs in, **Then** they see their own,
   not the first manager's.
3. **Given** a configured dashboard, **When** a figure the manager selected is one they lose the
   authority to see, **Then** it disappears rather than erroring or showing an empty panel.
4. **Given** a manager has configured nothing, **When** they first open the dashboard, **Then** it
   shows a sensible default rather than an empty screen.

---

### Edge Cases

- **A ticket that opened in one reporting period and closed in another.** Which period counts it, for
  volume and for resolution time, must be a stated rule rather than an accident of the query.
- **A ticket reassigned three times.** Whose resolution is it? Whose SLA breach?
- **A ticket merged into another** (Phase 3). Counting both double-counts the work; counting neither
  loses it.
- **An agent who has been deactivated** but whose historical work is in the period.
- **A customer record that was merged** (Phase 2), so tickets that were two customers' are now one's.
- **A ticket whose category was changed** after the period it is being reported in.
- **A period that crosses a daylight-saving boundary**, or a calendar exception (Phase 6).
- **A ticket with no SLA policy**, no assignee, or no category — the null cases that make a percentage
  either wrong or undefined.
- **The same figure computed two ways** — a total and the sum of its parts — disagreeing because one
  excluded nulls and the other did not.
- **A satisfaction average over two responses**, presented to two decimal places.
- **An export of a year of data**, large enough to exhaust memory or time out.
- **An export opened in spreadsheet software that interprets a leading `+` as a formula**, or guesses
  the wrong encoding for Arabic.
- **A report requested for a period before the system held any data**, or before a phase that produced
  the data existed.
- **Two users reading the same dashboard seconds apart** and seeing different numbers because work is
  arriving — and disagreeing about which was right.
- **A figure that was correct when the dashboard loaded** and is stale by the time it is acted on.

## Requirements _(mandatory)_

### Functional Requirements

#### Correctness, and being able to show it

- **FR-001**: Every reported figure MUST be traceable to the individual records it was computed from,
  and a reader MUST be able to reach those records from the figure.
- **FR-002**: Two figures on the same surface that logically must agree — a total and the sum of its
  breakdown — MUST agree, and the system MUST NOT present a breakdown that silently excludes records
  the total includes.
- **FR-003**: Every report MUST state the filters, period and timezone that produced it, on screen and
  in any export.
- **FR-004**: Where records are excluded from a calculation — no SLA policy, no assignee, no category —
  the report MUST state that they were excluded and how many, rather than omitting them silently.
- **FR-005**: A percentage MUST be accompanied by the counts it derives from, so a reader can tell 2
  out of 3 from 6,700 out of 10,000.
- **FR-006**: The system MUST NOT present a figure with more precision than its sample supports.
- **FR-007**: Reporting MUST derive SLA outcomes, working-hour elapsed time, and ticket state from the
  **same definitions** the originating phases use, and MUST NOT restate those rules independently.
- **FR-008**: A reported figure MUST NOT disagree with the equivalent figure shown on the record's own
  screen; where the two are computed by different paths, the report MUST be reconcilable to the record.

#### Period, timezone and the shape of time

- **FR-009**: Every report MUST be filterable by date range, and the range MUST be interpreted in a
  single, stated timezone.
- **FR-010**: Where a report measures elapsed time against a promise, it MUST use the business calendar
  and working-hour definition that promise was made under (Phase 6), not wall-clock time.
- **FR-011**: A report MUST reflect record state **as it is now**, not as it was during the reported
  period (Clarifications Q3). Where a ticket's category, assignee or customer has changed since, the
  current value is what the report counts.
- **FR-011a**: Every report MUST state that it reflects current record state, so that a figure moving
  between two runs is a documented property rather than an apparent fault. This is the whole of the
  mitigation for Q3 and MUST NOT be treated as a cosmetic footnote.
- **FR-011b**: Consequently, an edge case with a definite answer: a ticket recategorised after the
  period it falls in MUST be counted under its CURRENT category, and a ticket reassigned after the
  period MUST be attributed by FR-031's rule applied to current state.
- **FR-012**: A ticket that opened in one period and closed in another MUST be counted according to a
  rule the report states, and the same rule MUST be applied consistently across every report.
- **FR-013**: The system MUST handle a period crossing a daylight-saving change or a calendar exception
  without double-counting or losing a day.
- **FR-014**: A report for a period in which the system held no data MUST say so, and MUST NOT present
  zero as a result.

#### Ticket volume and status reporting

- **FR-015**: The system MUST report ticket volume and current status distribution, filterable by date
  range, category, channel, priority and agent (PLAN.md scope).
- **FR-016**: Volume reporting MUST distinguish tickets **received** in a period from tickets **open**
  at the end of it, because they answer different questions and are commonly confused.
- **FR-017**: A merged ticket (Phase 3) MUST be counted once across the merge, not twice and not zero
  times, and the report MUST state which side of the merge it counted.
- **FR-018**: Reporting MUST reflect the channel a ticket arrived through (Phase 5), including the
  portal and assistant-originated tickets (Phases 8 and 9).
- **FR-019**: Where a customer record was merged (Phase 2), tickets MUST remain attributed to the
  surviving customer without losing history.

#### SLA performance reporting

- **FR-020**: The system MUST report response and resolution compliance **separately**, because they
  are separate promises with separate targets.
- **FR-021**: Compliance MUST be reported per policy and per priority, and MUST be filterable by period,
  category, channel and agent.
- **FR-022**: A paused SLA clock MUST be excluded from elapsed time, consistently with how the target
  was computed.
- **FR-023**: Tickets with no SLA policy MUST be excluded from compliance rates and their count
  reported separately (FR-004).
- **FR-024**: The report MUST distinguish a breach from an at-risk state and from a target that has not
  yet fallen due.
- **FR-025**: Reported breach counts MUST reconcile to the per-ticket SLA state the ticket screen shows.

#### CSAT reporting

- **FR-026**: The system MUST report satisfaction score distribution, average, and **response rate**,
  filterable by period, agent, category and channel.
- **FR-027**: The response rate MUST count every ticket that could have been rated in its denominator,
  not only those that were.
- **FR-028**: Free-text comments MUST be reportable and MUST remain attributable to the ticket they
  came from, so a supervisor can act on one.
- **FR-029**: Where the sample is too small to support an average, the system MUST show the sample size
  and MUST NOT present the average as reliable (FR-006).

#### Agent performance reporting

- **FR-030**: Agent performance reporting MUST be visible only to supervisors and administrators
  (Clarifications Q1). An agent MUST NOT be able to reach agent performance figures, including their
  own, through any surface, export or aggregation.
- **FR-030a**: The permission granting it MUST be distinct from the permission to view the other
  reports in this phase, so that operational reporting can be granted without handing over figures
  about colleagues.
- **FR-030b**: Because the subject of the report cannot see it, the system MUST NOT present an agent
  performance figure anywhere an agent can reach — including on the ticket screen, in a notification,
  or as a component a manager might add to a shared surface.
- **FR-031**: Agent attribution for a reassigned ticket MUST follow a rule the report states explicitly,
  and MUST NOT count one ticket in full for two agents.
- **FR-032**: The report MUST make evident the period an agent was actually active, so a low count
  during leave or after joining is not read as performance.
- **FR-033**: A deactivated agent's historical work MUST remain reportable for periods they worked in.
- **FR-034**: Every agent figure MUST be traceable to the tickets it counted (FR-001) — in one step
  from the figure, and without needing a query written.
  **This requirement carries more weight after Clarifications Q1, not less.** The agent the figure
  describes cannot see it, so they cannot check it themselves; the supervisor must be able to do that
  on their behalf. Traceability is the only mechanism by which a disputed figure can be settled at
  all, and without it FR-030's access decision leaves an agent with no recourse.
- **FR-035**: The system MUST NOT report on an individual's activity beyond what the underlying phases
  already record — this phase adds no new monitoring of staff.
- **FR-036**: Where a figure describes fewer records than a stated minimum, the report MUST show the
  count rather than a rate, so no individual is characterised by a handful of tickets.

#### The management dashboard

- **FR-037**: The system MUST provide a single dashboard surface presenting the phase's key figures
  together, distinct from Phase 4's per-agent working dashboard.
- **FR-038**: The dashboard MUST be filterable by period, and the filter MUST apply consistently to
  every figure on it (FR-002).
- **FR-039**: Every figure MUST be reachable through to the records behind it (FR-001).
- **FR-040**: A manager MUST be able to choose which figures appear and how they are arranged, and the
  choice MUST persist for that user and belong only to them.
- **FR-041**: The dashboard MUST show a usable default arrangement before any configuration is made.
- **FR-042**: A configured figure the viewer is no longer entitled to see MUST disappear rather than
  error or render empty.
- **FR-043**: The dashboard MUST state when its figures were computed, so a reader knows how fresh they
  are. With automatic refresh (FR-045) this is the timestamp of the last SUCCESSFUL refresh, not of the
  last attempt — a stale figure beside a current-looking clock is worse than no clock.
- **FR-044**: Loading the dashboard MUST NOT degrade the performance of ticket, message or portal
  operations for other users (SC-018).
- **FR-045**: The dashboard MUST refresh its figures automatically on an interval while it is open
  (Clarifications Q2). The interval MUST be configurable rather than fixed in code, because the right
  value depends on how the dashboard is used — a wall display and a manager's browser tab want
  different numbers.
- **FR-045a**: A refresh MUST NOT overlap the previous one. If a refresh is still running when the
  next is due, the next MUST be skipped rather than queued — otherwise a slow query under load
  produces a growing backlog of identical queries, which is how a busy period turns a reporting
  feature into an outage.
- **FR-045b**: Refreshing MUST stop when nobody is looking — the dashboard is not visible, the tab is
  in the background, or the session has gone idle. A dashboard left open overnight on an unattended
  screen MUST NOT keep querying until morning.
- **FR-045c**: Automatic updates MUST NOT make the surface hostile to a screen reader. A figure
  changing on an interval MUST NOT be announced as though it were new information the reader must act
  on; the reader MUST be able to establish the current values deliberately rather than having them
  read out repeatedly.
- **FR-045d**: A failed refresh MUST leave the last successful figures on screen, clearly marked as of
  their own timestamp (FR-043), rather than blanking the dashboard or showing zeroes.

#### Export

- **FR-046**: A permitted user MUST be able to export any report to CSV, Excel and PDF (PLAN.md scope).
- **FR-047**: An export MUST contain the same figures as the screen it was taken from, under the same
  filters, and MUST state those filters in the file.
- **FR-048**: Arabic text in an export MUST be legible in common spreadsheet and document software,
  including correct encoding and right-to-left rendering where the format supports it.
- **FR-049**: An export MUST NOT allow spreadsheet software to interpret a data value as a formula.
- **FR-050**: Exporting MUST require a permission distinct from viewing a report, and MUST be enforced
  server-side.
- **FR-051**: Every export MUST be recorded in the audit log, attributable to the person who took it,
  identifying what was exported and under which filters.
- **FR-052**: An export too large to produce MUST fail with a plain statement rather than truncating,
  timing out silently, or producing a file that appears complete.
- **FR-053**: Producing an export MUST NOT block or degrade other users' work (FR-044).
- **FR-054**: An export MUST NOT contain data the requesting user could not see on screen.

#### Reporting on the AI capability (Phase 9)

- **FR-055**: The system MUST report AI usage volume, outcomes and cost by feature and period, from the
  invocation records Phase 9 keeps.
- **FR-056**: The system MUST report the category-proposal acceptance rate, which is the measure Phase 9
  left to be established from real traffic.
- **FR-057**: AI reporting MUST NOT report on prompt or completion content, because none is retained —
  and the report MUST say so rather than appearing to have lost it.
- **FR-058**: The system MUST report assistant deflection — questions resolved without a ticket — from
  the records Phase 9 keeps.

#### Authority, audit and bilingual behaviour

- **FR-059**: Viewing reports MUST require a permission distinct from everyday ticket work, enforced
  server-side on every endpoint.
- **FR-060**: Report data MUST be scoped to what the viewer is entitled to see, and the scoping MUST be
  applied in the query rather than by filtering results after the fact.
- **FR-061**: A report MUST NOT become a route to data the viewer could not reach directly, including
  by aggregation over a group small enough to identify an individual record.
- **FR-062**: Every report surface MUST work in Arabic and English, in both RTL and LTR layouts, under
  Constitution Principle I — including numbers, dates and any chart axis or legend.
- **FR-063**: All interface text introduced by this phase MUST be externalised into the existing locale
  files, with no hardcoded strings.
- **FR-064**: Reporting MUST be read-only. No report, dashboard or export may write to a ticket,
  customer, message or any other operational record.
- **FR-065**: The system MUST record report configuration changes where they are shared, and MUST NOT
  require an audit entry for a user rearranging their own dashboard.

### PLAN.md Traceability

PLAN.md **Scope** bullets for Phase 10 map as follows:

| PLAN.md scope bullet                                      | Requirements                | Verified by                        |
| --------------------------------------------------------- | --------------------------- | ---------------------------------- |
| Ticket volume/status reports (filterable)                 | FR-015–FR-019               | User Story 1, SC-001–SC-004        |
| SLA performance reports                                   | FR-020–FR-025               | User Story 2, SC-005–SC-008        |
| Agent performance reports                                 | FR-030–FR-036 (incl. FR-030a–b) | User Story 5, SC-012–SC-014a   |
| CSAT reports                                              | FR-026–FR-029               | User Story 4, SC-009–SC-011        |
| Real-time management dashboard with configurable KPI widgets | FR-037–FR-045d        | User Story 1, User Story 6, SC-015–SC-019, SC-018a–b |
| Export to PDF/Excel/CSV                                   | FR-046–FR-054               | User Story 3, SC-020–SC-024        |
| _(enabling, not a scope bullet)_                          | FR-001–FR-014 (incl. FR-011a–b), FR-055–FR-065 | SC-025–SC-030, SC-026a |

PLAN.md **Definition of done** — _"A manager can open one dashboard and see accurate, real-time KPIs,
and export any report"_ — maps as follows:

| Definition of done clause     | Verified by                                        |
| ----------------------------- | -------------------------------------------------- |
| "open one dashboard"          | FR-037–FR-041, User Story 1, SC-015                |
| "accurate"                    | FR-001–FR-008, SC-001, SC-025, SC-026              |
| "real-time"                   | FR-043, FR-045–FR-045d, SC-017, SC-018a–b — Clarifications Q2 settled this as interval refresh, which is what makes it testable |
| "and export any report"       | FR-046–FR-054, User Story 3, SC-020–SC-024         |

**Carried forward from earlier phases.** Phase 2 built the export precedent this phase generalises —
permissioned, audited, UTF-8 BOM for Arabic, and a guard against spreadsheet formula injection
(FR-048, FR-049 restate those as requirements rather than reinventing them). Phase 4 built the agent's
own dashboard and split `dashboard:view` from `dashboard:view_any` for exactly the question FR-030 now
asks at management scale. Phase 6 produced the SLA records and the business calendar that FR-010 and
FR-022 depend on, and its `ticket_sla` table already distinguishes satisfied, breached and paused —
this phase must not restate that logic (FR-007). Phase 8's `ticket_satisfaction` is the sole source for
CSAT and made one rating per ticket structural, which is what makes FR-027's response rate computable.
Phase 9 deliberately kept AI records metadata-only, which is why FR-057 exists.

**Carried into later phases.** Phase 11's integrations will want to push these figures outward, and
FR-003's requirement that a report state its own filters and timezone is what makes a figure meaningful
once it leaves this system. Phase 12's department-aware RBAC will narrow FR-060's scoping, and every
reporting query is a place that must gain a predicate then — the same warning Phase 9 recorded for its
similar-ticket query.

### Key Entities

- **Report Definition**: A named, filterable question the system can answer — its dimensions, its
  measures, and the records it draws on. Not a stored result.
- **Report Result**: The figures for one report under one set of filters at one moment, carrying the
  filters, period, timezone and computation time that produced it (FR-003, FR-043). Its provenance is
  part of it, not metadata about it.
- **Dashboard Arrangement**: Which figures one user has chosen to see and how they are laid out.
  Belongs to that user, persists between visits, and is not shared (FR-040).
- **Export Record**: That a named person took a named report, under stated filters, at a stated time.
  The audit answer to "how did this leave the building" (FR-051).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a fixed data set, every figure on every report matches a hand-computed count, with
  zero discrepancies.
- **SC-002**: Every total on every surface equals the sum of its own breakdown, verified across all
  filter combinations exercised by tests.
- **SC-003**: Applying any filter changes every figure on the surface consistently; zero figures remain
  showing a previous filter's result.
- **SC-004**: A supervisor can answer "how many tickets did we receive last week, and how many are
  still open" within 30 seconds of opening the dashboard, without exporting anything.
- **SC-005**: Reported SLA compliance matches the per-ticket SLA state for 100% of tickets in the
  period, with zero reconciliation differences.
- **SC-006**: Response and resolution compliance are reported as separate figures on every SLA surface.
- **SC-007**: Elapsed-time figures computed against a business calendar match the targets Phase 6 set
  for the same tickets, to the minute.
- **SC-008**: Tickets excluded from a compliance rate are counted and reported; zero silent exclusions.
- **SC-009**: Every satisfaction figure is presented with its sample size.
- **SC-010**: The CSAT response rate denominator equals the count of tickets that could have been
  rated, verified by hand against a known set.
- **SC-011**: Zero satisfaction averages are shown to a precision the sample does not support.
- **SC-012**: For tickets reassigned between agents, attribution matches the report's stated rule in
  100% of cases, and no ticket is counted in full for two agents.
- **SC-013**: Every agent figure can be traced to the tickets it counted, in one step from the figure.
- **SC-014**: Zero agent figures are presented as a rate over fewer records than the stated minimum.
- **SC-014a**: Zero routes exist by which an agent account can obtain an agent performance figure —
  verified by enumerating every reporting endpoint, export and dashboard component against an agent
  session, including for the agent's own figures.
- **SC-015**: A manager sees the phase's key figures on one screen without navigating between reports.
- **SC-016**: A user's dashboard arrangement persists across sessions and is visible to no other user.
- **SC-017**: Every dashboard states when its figures were last successfully computed, and the stated
  time is never newer than the figures beside it.
- **SC-018**: Opening or refreshing the dashboard does not increase ticket view, message send, or portal
  page response times beyond their Phase 9 values — measured with the maximum supported number of
  dashboards open and auto-refreshing simultaneously, not with one.
- **SC-018a**: Concurrent refreshes never accumulate: with a deliberately slowed query, the number of
  in-flight refresh requests per dashboard never exceeds one.
- **SC-018b**: A dashboard left open and unattended stops querying, verified by observing zero
  reporting queries after the idle threshold.
- **SC-019**: A figure the viewer has lost authority to see disappears from their dashboard within one
  page load, with zero errors rendered.
- **SC-020**: Exported figures match the on-screen figures exactly, in all three formats.
- **SC-021**: Arabic text in every export format is legible when opened in common software, verified by
  a reader of Arabic.
- **SC-022**: Zero exported values are interpreted as formulas by spreadsheet software.
- **SC-023**: 100% of exports are recorded and attributable to the person who took one.
- **SC-024**: An export that cannot be produced reports that plainly; zero truncated files are produced
  that appear complete.
- **SC-025**: Zero reports restate a rule owned by another phase — verified by review that SLA state,
  working hours and ticket lifecycle are read from their owning services.
- **SC-026**: Running the same report twice over unchanged data returns identical figures.
- **SC-026a**: Running the same report after a ticket's category or assignee has changed returns
  figures reflecting the change, and every report surface states that it reflects current state — so
  the movement is explained rather than mysterious (Clarifications Q3, FR-011a).
- **SC-027**: Zero report responses contain data the requesting user could not obtain directly.
- **SC-028**: No report, dashboard or export writes to any operational record, verified by test.
- **SC-029**: Every report surface renders correctly in Arabic RTL and English LTR and passes WCAG 2.1
  AA checks in both, including charts.
- **SC-030**: With reporting unavailable, the complete Phase 0–9 test suite passes unchanged.

## Assumptions

- **Reporting is read-only.** Nothing in this phase writes to an operational record. The only writes
  are a user's own dashboard arrangement and the audit entry for an export.
- **The reports are the six PLAN.md names.** Volume/status, SLA, agent, CSAT, the KPI dashboard, and
  export. No custom report builder, no ad-hoc query interface, and no scheduled delivery — those are
  larger features and none appears in the Phase 10 scope.
- **Figures come from the records the earlier phases already keep.** This phase adds no new
  instrumentation, no event stream, and no tracking of staff activity beyond what Phases 3–9 record
  (FR-035).
- **One timezone, from the active business calendar.** Phase 6 already holds a timezone on the business
  calendar; reports use it rather than introducing a per-user timezone preference, which would mean two
  users reading the same report and seeing different period boundaries.
- **Charts are a presentation of figures, not a separate capability.** Where a figure is easier to read
  as a chart it is shown as one, and the underlying numbers remain available — a chart nobody can read
  the values off is not a report.
- **Correctness is established by hand-computed fixtures**, not by comparing one query to another. SC-001
  requires a known data set with known answers; two queries that agree can both be wrong.
- **English and Arabic only**, matching every prior phase. RTL in PDF is the hardest part of FR-048 and
  is a known risk rather than an assumption that it will work.
- **Historical data is what the system happens to hold.** A report cannot show what was never recorded,
  and periods before a phase existed will be thin — FR-014 makes that visible rather than presenting it
  as zero activity.
- **Reports read current state, and say so** (Clarifications Q3). No period is frozen, no snapshot is
  stored, and a figure can therefore move between two runs. FR-011a's disclosure is the whole of the
  mitigation, which means it is a requirement rather than a nicety.
- **The dashboard's refresh interval is configuration, not a constant.** The right value depends on
  whether it is a wall display or a browser tab, and nobody knows it before the feature is in use.
- **Agent performance is a supervisory report** (Clarifications Q1). The agents it describes have no
  access to it, so the fairness of the attribution rule and the traceability of every figure are doing
  work that transparency would otherwise have done.

## Out of Scope

- **A custom report builder or ad-hoc query interface.** PLAN.md names six reports; a builder is a
  different product.
- **Scheduled or emailed report delivery.** Not in the Phase 10 scope; Phase 11's integrations are the
  natural home if it is wanted.
- **Forecasting, trend prediction, or anomaly detection.** This phase reports what happened.
- **Period snapshots and point-in-time reconstruction.** Clarifications Q3 chose current state. A
  later phase that needs last month's figures to be immutable would add snapshots deliberately, on the
  evidence that somebody actually relies on them.
- **Live push of dashboard figures.** Clarifications Q2 chose interval refresh. Push is the natural
  next step if the interval proves too coarse, and FR-045's configurable interval is what will show
  whether it does.
- **Self-service performance figures for agents.** Clarifications Q1 made agent reporting supervisory.
  Giving an agent their own figures is a coherent later decision — and would need FR-034's traceability
  to already be good, which is why that requirement is written to a higher standard than access alone
  demands.
- **A data warehouse, OLAP cubes, or a separate reporting database.** If the operational database
  cannot serve these reports at the volumes required, that is a finding for the plan to record — not an
  architecture to adopt speculatively.
- **Per-user timezone preferences.** See Assumptions.
- **Cross-organisation or per-department reporting.** Phase 12 makes RBAC department-aware; until then
  there are no departments to report across.
- **Reporting on prompt or completion content** (FR-057) — Phase 9 retains none.
- **New tracking of staff activity** (FR-035). Reporting on what is already recorded is in scope;
  recording more in order to report on it is not.
