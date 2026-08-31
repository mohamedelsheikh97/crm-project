---
description: 'Task list for Phase 6 — SLA & Automation'
---

# Tasks: Phase 6 — SLA & Automation

**Input**: Design documents from `/specs/007-phase-6-sla-automation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested, and Principle II makes the authorization matrix non-optional. This phase has a second reason
earlier phases did not: **everything it does happens when nobody is watching.** A breach fires at
02:00, a rule cascades in a tenth of a second, a target is computed from a calendar that changes
twice a year. None of it can be verified by using the application, so the suite is not a check on the
work — it is the only place the behaviour is observable. SC-004 and SC-011 say so explicitly.

**Organization**: Grouped by user story. Stories run **US1 → US6 → US2 → US3 → US5 → US4 → US7**,
which is priority order with one deliberate deviation:

- **US6 (the clock pauses) is pulled ahead of US2 and US3**, though it is P2 and they are P1, because
  it is the same service and the same arithmetic as US1. Building the breach sweep (US2) against a
  clock that cannot pause means writing its predicate twice — once as a no-op and once for real — and
  writing escalation tests that all have to be revisited once pausing exists. The clock is finished in
  one pass, then swept.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Directories, configuration, and locale skeletons. **No new dependencies** — the working-
time arithmetic is written here rather than imported (research D2), which is the one thing to confirm
before starting rather than discover halfway through.

- [X] T001 Create the module directories `backend/src/sla/`, `backend/src/automation/`, `backend/src/controllers/sla/`, `backend/src/controllers/assignment/`, `backend/src/controllers/automation/`, `backend/src/controllers/alerts/`, `backend/src/routes/sla/`, `backend/src/routes/assignment/`, `backend/src/routes/automation/`, `backend/src/routes/alerts/`, `backend/tests/sla/`, `backend/tests/escalation/`, `backend/tests/assignment/`, `backend/tests/automation/`, `backend/tests/alerts/`, `frontend/src/components/sla/`, `frontend/src/components/automation/`, `frontend/tests/sla/`, `frontend/tests/automation/`
- [X] T002 [P] Add `SLA_WARNING_LEAD_MINUTES` (default 60), `AUTOMATION_MAX_DEPTH` (default 3), and `ALERT_MAX_PER_RECIPIENT_PER_HOUR` (default 20) to the zod schema in `backend/src/config/env.ts` and to `.env.example`, per research D15
- [X] T003 [P] Add the `sla.*`, `assignment.*`, `automation.*`, and `alerts.*` namespace skeletons plus `permission.module.sla`, `permission.module.assignment`, and `permission.module.automation` to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, so later tasks add keys to an existing branch rather than creating it twice in two files

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissions, models, declarations, and the one type change every automated act
depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Three tasks in particular:

- **T023 (`Actor.id` widening)** blocks every automation action. Attempting a story before it lands
  produces a rule engine that writes models directly — the second enforcement path research D8 exists
  to prevent, and the hardest thing in this phase to unpick later.
- **T021 (the lifecycle edge)** blocks US2. Without it a breached `new` ticket cannot escalate, which
  is the phase's Definition of done failing for its most important case (research D11).
- **T019 (the test-helper permission grant)** — a forgotten grant makes every new test fail with a 403
  that looks nothing like its cause, exactly as happened in Phases 2, 3, 4 and 5.

### Schema

- [X] T004 [P] Migration `backend/src/db/migrations/20260831000001-alter-tickets-add-due-source.cjs` adding `due_source ENUM('policy','manual') NOT NULL DEFAULT 'manual'`; the default backfills every existing row to `'manual'`, which is FR-024c — comment it as such, because it looks like an arbitrary default and is not
- [X] T005 [P] Migration `backend/src/db/migrations/20260831000002-alter-users-add-alert-phone.cjs` adding `alert_phone VARCHAR(32) NULL`, commented as an alert destination and not a profile field (research D13)
- [X] T006 [P] Migration `backend/src/db/migrations/20260831000003-create-sla-policies.cjs` per data-model.md, with indexes `(is_active, specificity)` and `(priority, category)`, and **no** unique constraint on `(priority, category)`
- [X] T007 [P] Migration `backend/src/db/migrations/20260831000004-create-business-calendars.cjs` per data-model.md, storing hours as minutes from local midnight and days as a 7-bit mask
- [X] T008 [P] Migration `backend/src/db/migrations/20260831000005-create-calendar-exceptions.cjs` with unique `(calendar_id, exception_date)`
- [X] T009 [P] Migration `backend/src/db/migrations/20260831000006-create-ticket-sla.cjs` with `ticket_id` as the primary key, and indexes `(resolution_target_at, paused_at)` and `(response_target_at, paused_at)` — the two the sweep uses
- [X] T010 [P] Migration `backend/src/db/migrations/20260831000007-create-assignment-settings.cjs` per data-model.md, with `strategy` defaulting to `'off'`
- [X] T011 [P] Migration `backend/src/db/migrations/20260831000008-create-user-competencies.cjs` with composite primary key `(user_id, category)` and an index on `(category)`
- [X] T012 [P] Migration `backend/src/db/migrations/20260831000009-create-automation-rules.cjs` with `is_enabled` defaulting to **false** and an index on `(is_enabled, trigger_key, run_order)`
- [X] T013 [P] Migration `backend/src/db/migrations/20260831000010-create-automation-runs.cjs` with `rule_id ON DELETE SET NULL` and a denormalised `rule_name` — FR-070: the record outlives the rule
- [X] T014 [P] Migration `backend/src/db/migrations/20260831000011-create-alert-subscriptions.cjs` with unique `(event_key, recipient_kind, role_id)`
- [X] T015 [P] Migration `backend/src/db/migrations/20260831000012-create-alert-deliveries.cjs` with the four-value `outcome` enum, commented with why `skipped` and `failed` are different facts (FR-076)

### Permissions

- [X] T016 Add `sla:manage`, `assignment:manage`, `automation:manage`, and `automation:view` to `backend/src/auth/permissions.ts`, with the two deliberate merges recorded in comments as data-model.md states them: `sla:manage` covers the calendar, `assignment:manage` covers competencies. Note in the same comment why there is no `sla:view` key
- [X] T017 Seeder `backend/src/db/seeders/20260831000001-sla-permissions.cjs` granting the four keys to Administrator and `automation:view` additionally to Supervisor; **no grant to Agent** (FR-051)
- [X] T018 Add the four probes to `PROBES` in `backend/tests/authorization.matrix.test.ts` — the generated matrix fails until every catalog key has one, which is the mechanism that stops a module shipping unverified
- [X] T019 Extend the test-helper role/permission seeding in `backend/tests/helpers/` so a test user built with the new permissions actually holds them; without this every Phase 6 test fails with a 403 whose cause is invisible

### Models

- [X] T020 [P] Create the ten new Sequelize models in `backend/src/models/`: `sla-policy.model.ts`, `business-calendar.model.ts`, `calendar-exception.model.ts`, `ticket-sla.model.ts`, `assignment-setting.model.ts`, `user-competency.model.ts`, `automation-rule.model.ts`, `automation-run.model.ts`, `alert-subscription.model.ts`, `alert-delivery.model.ts`, and register their associations in `backend/src/models/index.ts`
- [X] T021 [P] Add `due_source` to `backend/src/models/ticket.model.ts` and `alert_phone` to `backend/src/models/user.model.ts`, each with the comment explaining what it is *not* (a machine value; a profile field)

### Declarations

- [X] T022 Add the `new → escalated` edge to `TRANSITIONS` in `backend/src/tickets/lifecycle.ts` with a comment citing research D11, and update the generated transition test's expected edge count in `backend/tests/` from 13 to 14
- [X] T023 Widen `Actor` in `backend/src/services/ticket.service.ts` to `{ id: number | null; email: string | null; fullName: string; roleId: number | null }`, add an exported `isSystemActor(actor)` helper, and make every branch reading `actor.id` in `ticket.service.ts`, `ticket-lifecycle.service.ts`, `ticket-due.service.ts`, and `message.service.ts` explicit about the system case — permission-conditional branches (`tickets:manage_any`, close-ownership) treat a system actor as permitted, per research D8. Controllers are unaffected: a request always has a real actor
- [X] T024 [P] Create `backend/src/sla/clock.ts` declaring `PAUSED_STATUSES = ['pending']` and `RESOLVED_STATUSES = ['resolved','closed']`, with an exhaustiveness test in `backend/tests/sla/clock-declaration.test.ts` that fails if a status exists in `TICKET_STATUSES` and is classified by neither (FR-023, research D7)
- [X] T025 [P] Create `backend/src/sla/precedence.ts` declaring the specificity order — priority+category (3), priority (2), category (1), catch-all (0) — and the `updated_at DESC` tie-break, as the single source both the matcher and the policies screen read (FR-013)
- [X] T026 [P] Create `backend/src/automation/catalog.ts` declaring the eight triggers, eight condition fields with their permitted operators and value enumerations, and seven actions with their parameter shapes, exactly as `contracts/automation-engine.md` lists them, plus the i18n key per entry
- [X] T027 [P] Create `backend/src/automation/events.ts` declaring the event payload shape for each trigger
- [X] T028 [P] Add `SLA_AT_RISK`, `SLA_BREACHED`, and `ASSIGNMENT_FAILED` to `NOTIFICATION_TYPES` in `backend/src/models/notification.model.ts` — no new columns, all three reference a ticket
- [X] T029 [P] Add the five SLA events to `TICKET_EVENTS` in `backend/src/services/ticket-history.service.ts` (`SLA_TARGET_SET`, `SLA_TARGET_CHANGED`, `SLA_BREACHED`, `SLA_CLOCK_PAUSED`, `SLA_CLOCK_RESUMED`), with a comment stating that automated escalations and assignments reuse the existing `ESCALATED` and `ASSIGNED` events with `SYSTEM_ACTOR` rather than forking the timeline
- [X] T030 [P] Add the SLA, calendar, assignment, competency, and automation-rule actions to `AUDIT_ACTIONS` in `backend/src/services/audit.service.ts`, and record in the comment why rule *runs* are not audited individually

### Seeded configuration

- [X] T031 [P] Seeder `backend/src/db/seeders/20260831000002-default-calendar.cjs`: one active calendar, Sun–Thu, 09:00–17:00, `Africa/Cairo`, no exceptions (Clarifications Q1; a holiday list is organisation-specific and must not be guessed)
- [X] T032 [P] Seeder `backend/src/db/seeders/20260831000003-default-sla-policies.cjs`: four active policies, one per priority, with bilingual names — urgent 60/240, high 240/480, normal 480/1440, low 480/2400 working minutes (spec FR-009)
- [X] T033 [P] Seeder `backend/src/db/seeders/20260831000004-default-alert-subscriptions.cjs` per data-model.md, and one `assignment_settings` row with `strategy = 'off'` — a fresh installation must not start redistributing tickets before an administrator chooses to

**Checkpoint**: Schema, permissions, declarations, and the widened actor are in place. `npm test --workspace backend` passes with the matrix green. Nothing new works yet; nothing existing is broken.

---

## Phase 3: User Story 1 — A Ticket Knows When It Is Due Without Anyone Typing a Date (Priority: P1) 🎯 MVP

**Goal**: Configurable policies produce first-response and resolution targets on every matching
ticket, in working time, and the resolution target drives Phase 4's existing due date.

**Independent Test**: Configure a policy, raise a matching ticket, confirm both targets appear and
that Phase 4's due-date column, sort, overdue indicator, and approaching-due warning all work
unchanged with their existing tests untouched.

### Tests for User Story 1

- [X] T034 [P] [US1] Table-driven test of `addWorkingTime` and `workingTimeBetween` in `backend/tests/sla/business-hours.test.ts`: inside and outside working hours, across a weekend, across a calendar exception, and **across the Africa/Cairo DST transition in both directions** — the single highest-risk piece of logic in the phase (research D2)
- [X] T035 [P] [US1] Test enumerating (delivered inside `backend/tests/sla/target-computation.test.ts`) all four specificity levels plus a same-specificity tie, asserting exactly one policy is chosen and the choice is stable across runs (FR-013)
- [X] T036 [P] [US1] Test `backend/tests/sla/target-computation.test.ts`: a matching ticket gets both targets at creation; a ticket matching no policy gets **no `ticket_sla` row at all** and is never reported as at risk or breached (FR-010, FR-014)
- [X] T037 [P] [US1] Test `backend/tests/sla/recompute.test.ts`: changing priority or category recomputes both targets from the original `started_at`, records previous and new values in the ticket history, and neither forgives nor double-charges elapsed time (FR-017)
- [X] T038 [P] [US1] Test `backend/tests/sla/due-date-integration.test.ts`: the resolution target populates `tickets.due_at` with `due_source = 'policy'`; a manual set flips it to `'manual'` and no later evaluation touches it; clearing the override restores the computed value (FR-024, FR-024a, FR-024d)
- [X] T039 [P] [US1] Test `backend/tests/sla/policy-crud.test.ts`: validation refusals (`resolutionMinutes < responseMinutes`, non-positive durations, unknown priority or category), deactivation without deletion, and the absence of a delete route (FR-008, FR-019)
- [X] T040 [P] [US1] Test `backend/tests/sla/calendar-crud.test.ts`: an unknown IANA zone is refused at the API, an empty working week is refused, `dayEnd <= dayStart` is refused, and editing the calendar does not move existing targets (FR-026, FR-029, contracts/sla-api.md)
- [X] T041 [P] [US1] Frontend test `frontend/tests/sla/state-rendering.test.ts`: all four SLA states render with an icon and text and remain distinguishable with colour stripped; a ticket with `sla: null` renders no SLA annotation at all (FR-085, contracts/sla-automation-ui.md)

### Implementation for User Story 1

- [X] T042 [US1] Create `backend/src/lib/business-hours.ts`: `addWorkingTime(from, ms, calendar)` and `workingTimeBetween(from, to, calendar)`, pure, using `Intl.DateTimeFormat.formatToParts` for instant→zoned conversion and a two-pass guess-and-correct for zoned→instant, with the day walk bounded at 400 iterations so a malformed calendar throws instead of hanging a sweep (research D2)
- [X] T043 [US1] Create `backend/src/services/sla-policy.service.ts`: CRUD, activation, deactivation, `specificity` derived on write (never accepted from the client), and `matchFor(ticket)` reading `sla/precedence.ts`
- [X] T044 [US1] Create `backend/src/services/calendar.service.ts`: read and update the active calendar, manage exceptions, and validate the time zone by round-tripping it through `Intl.DateTimeFormat` so an unknown zone can never throw inside a sweep
- [X] T045 [US1] Create `backend/src/services/sla-target.service.ts` with `attachTargets(ticket, transaction)` and `recompute(ticket, transaction)`, writing absolute times to `ticket_sla` (FR-029) and mirroring the resolution target into `tickets.due_at` only while `due_source = 'policy'`
- [X] T046 [US1] Call `attachTargets` from `ticket.service.create` and from `intake.service.accept` in `backend/src/services/`, inside the existing transaction, so a ticket arriving by email acquires its targets exactly as a typed one does
- [X] T047 [US1] Call `recompute` from `ticket.service.update` when priority or category changes, recording `SLA_TARGET_CHANGED` in the ticket history with previous and new target values (FR-017)
- [X] T048 [US1] Update `backend/src/services/ticket-due.service.ts` so `setDueDate` sets `due_source = 'manual'` and clearing an override restores the computed target, replacing the Phase 4 comment about being "the seam Phase 6 replaces" with what actually happened (research D6)
- [X] T049 [P] [US1] Create `backend/src/controllers/sla/policies.controller.ts` and `backend/src/routes/sla/policies.routes.ts` per contracts/sla-api.md, guarded by `sla:manage`, with the list ordered as matched
- [X] T050 [P] [US1] Create `backend/src/controllers/sla/calendar.controller.ts` and `backend/src/routes/sla/calendar.routes.ts`, converting `workingDays` between the wire array and the stored bitmask at the boundary
- [X] T051 [US1] Mount the SLA routers in `backend/src/routes/index.ts` and add the `sla` field to the ticket summary and detail shapes in `backend/src/services/ticket.service.ts`, computing `state` and `remainingMinutes` server-side against `lib/clock.ts` (FR-011) and returning `null` — not an object of nulls — for a ticket with no policy
- [X] T052 [P] [US1] Create `frontend/src/services/sla.service.ts` for the policy and calendar endpoints
- [X] T053 [P] [US1] Create `frontend/src/components/sla/SlaState.vue` and `frontend/src/components/sla/DueSourceBadge.vue` per contracts/sla-automation-ui.md — icon plus text, colour never the sole carrier, and both due-date sources labelled rather than only the override
- [X] T054 [P] [US1] Create `frontend/src/components/sla/SlaCountdown.vue` rendering durations through `vue-i18n` pluralisation with `Intl.NumberFormat` numerals and bidirectional isolation for numbers inside translated prose — no string concatenation anywhere (FR-084)
- [X] T055 [P] [US1] Create `frontend/src/views/admin/SlaPoliciesView.vue` with the duration input as a number plus a unit selector, and the standing line explaining that list order is precedence order
- [X] T056 [P] [US1] Create `frontend/src/views/admin/BusinessCalendarView.vue` with the Sunday-first day checkboxes, time inputs, zone selector over `Intl.supportedValuesOf('timeZone')`, exceptions list, and the `sla.calendar.noRetroactiveChange` reassurance line
- [X] T057 [US1] Add both admin routes under `/admin` in `frontend/src/router/index.ts` with the `sla:manage` guard, add the SLA panel to `frontend/src/views/tickets/TicketDetailView.vue`, add the `SlaState` column to the queue and ticket list, and add every new key to both locale files

**Checkpoint**: Targets are computed and visible. Phase 4's queue, sort, indicator, and warning still pass their own tests untouched (SC-014).

---

## Phase 4: User Story 6 — The Clock Stops While We Are Waiting on the Customer (Priority: P2)

**Goal**: The SLA clock pauses on Pending and resumes correctly, however many times it happens.

**Independent Test**: Pause a ticket, advance well past its target, resume it, and confirm it is not
breached and its target moved by the paused duration — repeated three times without compounding.

**Why here**: same service and same arithmetic as US1. Sweeping an incomplete clock (US2) would mean
writing the pause exclusion twice and revisiting every escalation test.

### Tests for User Story 6

- [X] T058 [P] [US6] Test `backend/tests/sla/pause-resume.test.ts`: pausing captures the remainder, resuming sets `target = now + remaining`, and three pause/resume cycles exclude the paused time **exactly once** with no compounding (FR-021, FR-022)
- [X] T059 [P] [US6] Test `backend/tests/sla/reopen.test.ts`: reopening a resolved ticket arms a fresh resolution target under the currently matching policy, is not instantly breached, and records both the original outcome and the new target in the history (FR-030)
- [X] T060 [P] [US6] Test `backend/tests/sla/first-response.test.ts`: the first outbound customer-visible message satisfies the response target; an internal note does not; and later correspondence never re-arms it (FR-015, FR-016)
- [X] T061 [P] [US6] Frontend test `frontend/tests/sla/paused-countdown.test.ts`: a paused ticket shows the captured remainder with a pause affordance and does not decrement

### Implementation for User Story 6

- [X] T062 [US6] Add `pause(ticketSla, now)` and `resume(ticketSla, now)` to `backend/src/services/sla-target.service.ts` per research D3 — capture `*_remaining_ms` at pause, rewrite the target at resume, accumulate `total_paused_ms` for display only and never use it in arithmetic
- [X] T063 [US6] Call pause and resume from `backend/src/services/ticket-lifecycle.service.ts` on transitions into and out of `PAUSED_STATUSES`, reading the classification from `sla/clock.ts` and never from a second list, recording `SLA_CLOCK_PAUSED` / `SLA_CLOCK_RESUMED` in the ticket history
- [X] T064 [US6] Set `resolution_satisfied_at` on transition into `RESOLVED_STATUSES`, and arm a fresh target on reopen, in `backend/src/services/ticket-lifecycle.service.ts` (FR-030)
- [X] T065 [US6] Set `response_satisfied_at` from `backend/src/services/message.service.ts` on the first outbound customer-visible message — write-once, never cleared, so FR-016 holds by construction rather than by a guard
- [X] T066 [US6] Add `isPaused` to the ticket API `sla` shape and render the paused state in `frontend/src/components/sla/SlaCountdown.vue`, with keys in both locale files

**Checkpoint**: The clock is complete and correct. It is not yet swept.

---

## Phase 5: User Story 2 — A Breach Escalates and Reaches the Right People With Nobody Watching (Priority: P1)

**Goal**: PLAN.md's Definition of done. A passed target escalates the ticket and notifies the right
people, exactly once, with no human action.

**Independent Test**: With a controlled clock, advance past a target and confirm the escalation, the
notifications, the history entry, and the audit record each appear exactly once — and that sweeping
again produces nothing.

### Tests for User Story 2

- [X] T067 [P] [US2] Test `backend/tests/escalation/breach.test.ts`: a passed resolution target escalates the ticket, sets its reason, notifies the assignee and the supervisory recipients, and writes history attributed to the system and audit with a null actor (FR-036, FR-039, FR-040, FR-041)
- [X] T068 [P] [US2] Test `backend/tests/escalation/idempotency.test.ts`: sweeping ten times over one breached ticket produces exactly one escalation, one history entry, and one notification per recipient; a manual de-escalation does not re-arm it; a reopen does (FR-034, FR-042, SC-004)
- [X] T069 [P] [US2] Test `backend/tests/escalation/downtime.test.ts`: a target that expired while nothing was running is detected on the next pass, with no "since last run" bookkeeping anywhere in the path (FR-035)
- [X] T070 [P] [US2] Test `backend/tests/escalation/new-status.test.ts`: a ticket still in `new` that breaches **is** escalated, exercising the edge added in T022 — the case that fails silently without research D11
- [X] T071 [P] [US2] Test `backend/tests/escalation/exclusions.test.ts`: merged, closed, paused, and already-satisfied tickets are never escalated and never reported as breached (FR-031, FR-032)
- [X] T072 [P] [US2] Test `backend/tests/escalation/warning.test.ts`: an approaching target warns without escalating, and a target that breaches before it was ever warned produces the escalation only — never both in one pass (FR-037)
- [X] T073 [P] [US2] Test `backend/tests/escalation/unassigned.test.ts`: a breached ticket with no assignee still escalates and still reaches the supervisory recipients, and a recipient who is both assignee and supervisor receives one notification, not two (FR-041, SC-005)

### Implementation for User Story 2

- [X] T074 [US2] Create `backend/src/services/sla-escalation.service.ts` with `detectAndAct(now)`: the value-comparison predicate from data-model.md written as a Sequelize `literal` for the column-to-column comparison — the mistake `ticket-due.service.ts` already documents and the one that would make the sweep silently never fire
- [X] T075 [US2] Escalate through `ticket-lifecycle.service.transition` with a system actor rather than by writing the model, so the lifecycle governs automation exactly as it governs a person (research D8); where the edge is genuinely undeclared, record the refusal and its reason instead of forcing it (FR-038)
- [X] T076 [US2] Set the marker (`resolution_escalated_for = resolution_target_at`) **in the same transaction as the escalation**, following the Phase 4 sweep pattern: the act and the thing that stops it repeating commit together or neither does
- [X] T077 [US2] Create `backend/src/services/alert.service.ts` with `dispatch(eventKey, context)` — resolve recipients from `alert_subscriptions` (assignee plus role members), deduplicate, and create the in-application notification for each; **in-app only in this story**, transports arrive in US5
- [X] T078 [US2] Write one `alert_deliveries` row per recipient per transport with its outcome, so "nobody was told" is already distinguishable from "we tried" before any real transport exists (FR-076)
- [X] T079 [US2] Add `sweepSlaTargets(now)` to `runScheduledSweeps` in `backend/src/lib/scheduler.ts` alongside the two Phase 4 sweeps, ordered satisfy-checks → warnings → breaches, exported for direct call with a controlled clock so no test ever waits on a timer
- [X] T080 [P] [US2] Add the `sla.at_risk`, `sla.breached`, and `assignment.failed` notification renderings to `frontend/src/components/` and both locale files, composed from keys and parameters rather than sentences

**Checkpoint**: 🏁 **PLAN.md's Definition of done is met.** A ticket that breaches its SLA escalates and notifies the right people without manual intervention. This is the first genuinely deployable increment.

---

## Phase 6: User Story 3 — An Arriving Ticket Finds an Owner by Itself (Priority: P1)

**Goal**: Unassigned work routes itself to an eligible agent under a configured strategy, without a
supervisor acting and without ever exceeding what a supervisor could have done by hand.

**Independent Test**: Enable round-robin, raise six unassigned tickets, confirm they distribute
evenly with the ordinary assignment notification and a history entry attributed to the automation.

### Tests for User Story 3

- [X] T081 [P] [US3] Test `backend/tests/assignment/round-robin.test.ts`: six tickets across three eligible agents distribute two each, and the cursor survives a reassignment and a merge (FR-046, SC-006)
- [X] T082 [P] [US3] Test `backend/tests/assignment/least-loaded.test.ts`: the agent with fewest open assigned tickets wins, with a documented deterministic tie-break producing identical results on identical state
- [X] T083 [P] [US3] Test `backend/tests/assignment/competency.test.ts`: a competent agent wins for their category; with no competent agent the ticket **still reaches an owner** through the load-based fallback (FR-044b, SC-018)
- [X] T084 [P] [US3] Test `backend/tests/assignment/eligibility.test.ts`: deactivated, locked, and `tickets:view`-lacking users are never selected, matching the guard `ticket.service.assign` already applies (FR-045, SC-007)
- [X] T085 [P] [US3] Test `backend/tests/assignment/ceiling.test.ts`: an agent at `max_open_per_agent` is not selected, and when every agent is at their ceiling the ticket stays unassigned with the attempt and reason recorded and the supervisory recipients alerted (FR-047, FR-048)
- [X] T086 [P] [US3] Test `backend/tests/assignment/human-wins.test.ts`: a ticket assigned by a person is never reassigned by a strategy (FR-049, SC-007)
- [X] T087 [P] [US3] Test `backend/tests/assignment/concurrency.test.ts`: two concurrent assignment attempts on one ticket leave exactly one assignee (FR-053)
- [X] T088 [P] [US3] Test `backend/tests/assignment/authority.test.ts`: an agent holding `assignment:manage` but not `tickets:assign` is refused server-side — configuring assignment is self-assignment by a longer route (FR-051)

### Implementation for User Story 3

- [X] T089 [US3] Create `backend/src/services/assignment.service.ts` with `eligibleAgents()` reusing the exact three conditions from `ticket.service.assign` (active, not locked, role holds `tickets:view`) and the three strategies from research D12
- [X] T090 [US3] Implement `autoAssign(ticketId)` executing through `ticket.service.assign` with a system actor, so FR-050's "same downstream effects" is inherited rather than reimplemented, and guard the write with a conditional update on `assignee_user_id IS NULL` (FR-053)
- [X] T091 [US3] Advance `round_robin_cursor_user_id` on `assignment_settings` in the same transaction as the assignment, stored rather than derived (research D12)
- [X] T092 [US3] Call `autoAssign` after ticket creation in `ticket.service.create` and `intake.service.accept`, after commit, and dispatch `assignment.failed` through `alert.service` where no eligible agent exists (FR-048)
- [X] T093 [P] [US3] Create `backend/src/controllers/assignment/assignment.controller.ts` and `backend/src/routes/assignment/` per contracts/sla-api.md, gating on `assignment:manage` **and** `tickets:assign` in the service, and returning `eligibleAgentCount` so zero eligible agents is visible while choosing
- [X] T094 [P] [US3] Implement competency read and replace-whole-set endpoints, validating categories against `TICKET_CATEGORIES`, with the change audited (FR-044a, FR-044d)
- [X] T095 [P] [US3] Create `frontend/src/services/assignment.service.ts` and `frontend/src/views/admin/AssignmentView.vue`: four strategy radios each with a sentence of consequence, an optional ceiling with an explicit "no limit" state, the live eligible-agent count, the competency matrix, and the `assignment.humanAssignmentWins` header note
- [X] T096 [US3] Add the route and guard in `frontend/src/router/index.ts` and every key to both locale files

**Checkpoint**: Work routes itself. No automatic assignment can do something a supervisor could not.

---

## Phase 7: User Story 5 — The Alert Reaches Someone Who Is Not Looking at the Screen (Priority: P2)

**Goal**: Escalations and failures also travel by email and SMS, configurably, without any transport
being able to prevent the underlying act.

**Independent Test**: Trigger one alerting event; the in-app notification always arrives, email and
SMS are attempted only where enabled and addressable, and breaking a transport changes nothing else.

### Tests for User Story 5

- [X] T097 [P] [US5] Test `backend/tests/alerts/transport-independence.test.ts`: with email and SMS both unconfigured and failing, the escalation and the in-application notification still happen and the failures are recorded (FR-073, FR-075, SC-009)
- [X] T098 [P] [US5] Test `backend/tests/alerts/skipped-vs-failed.test.ts`: a recipient with no `alert_phone` is recorded `skipped`, a refusing gateway is recorded `failed`, and the two are never conflated (FR-076, FR-077)
- [X] T099 [P] [US5] Test `backend/tests/alerts/ceiling.test.ts`: alerts beyond `ALERT_MAX_PER_RECIPIENT_PER_HOUR` for one recipient are recorded `suppressed`, never silently discarded (FR-078, SC-010)
- [X] T100 [P] [US5] Test `backend/tests/alerts/language.test.ts`: an alert body is composed in the **recipient's** language from locale content, with no hardcoded sentence in either language, and discloses nothing the recipient could not see by opening the record (FR-080, FR-081)
- [X] T101 [P] [US5] Test `backend/tests/alerts/customer-recipient.test.ts`: an alert to a customer honours Phase 5's opt-out and automated-mail rules exactly as an agent's reply does (FR-074)
- [X] T102 [P] [US5] Test `backend/tests/alerts/subscriptions.test.ts`: `inApp: false` is rejected with `alerts.error.inAppNotOptional`, and the `GET` response reports `unreachableForSms` per subscription

### Implementation for User Story 5

- [X] T103 [US5] Extend `backend/src/services/alert.service.ts` to fan out to email and SMS through Phase 5's adapters (`adapterFor(channel).send`) **without writing a `messages` row** — alerts to users are not correspondence (research D13)
- [X] T104 [US5] Compose alert bodies per recipient from locale content at delivery time, resolving the recipient's language, and normalise `users.alert_phone` on write through `backend/src/lib/phone.ts`
- [X] T105 [US5] Apply the per-recipient ceiling using `backend/src/lib/rate-limit.ts` keyed `alert:{userId}`, recording suppressed attempts in `alert_deliveries` (research D15)
- [X] T106 [P] [US5] Create `backend/src/controllers/alerts/subscriptions.controller.ts` and `backend/src/routes/alerts/` per contracts/sla-api.md, guarded by `sla:manage`, replacing the whole set in one transaction
- [X] T107 [P] [US5] Add the alert-subscription matrix to `frontend/src/views/admin/BusinessCalendarView.vue`'s settings area or a sibling view, with the in-app column shown **disabled rather than hidden** — a control that appears adjustable but is not is worse than one shown as fixed
- [X] T108 [P] [US5] Add `alertPhone` to the user form in `frontend/src/views/admin/UserFormView.vue`, labelled as an alert destination rather than a contact number, with keys in both locale files

**Checkpoint**: Alerts reach people away from the screen, and nothing about them can break an escalation.

---

## Phase 8: User Story 4 — A Supervisor Automates a Routine Without Writing Code (Priority: P2)

**Goal**: A trigger-condition-action rule builder whose authority is bounded by a closed catalog and
whose execution cannot loop, cannot exceed a person's authority, and cannot fail its trigger.

**Independent Test**: Build a rule with a trigger, a condition, and an action; it fires on a matching
ticket, does not fire on a non-matching one, can be disabled, and reports what it did.

### Tests for User Story 4

- [X] T109 [P] [US4] Generated test `backend/tests/automation/catalog.test.ts` iterating **every** catalog entry and asserting the validator accepts a well-formed rule using it — so an entry added without validator support fails here, in the manner of Phase 1's permission matrix
- [X] T110 [P] [US4] Test `backend/tests/automation/validation.test.ts` covering every rejection in contracts/automation-engine.md, including a condition field unavailable for its trigger and an empty action list
- [X] T111 [P] [US4] Test `backend/tests/automation/ordering.test.ts`: two rules matching one event apply in `run_order`, asserted by a final state only one order could produce (FR-060)
- [X] T112 [P] [US4] Test `backend/tests/automation/cycles.test.ts`: a self-triggering rule and a mutually triggering pair both terminate at the depth bound with `suppressed` runs recorded, and the process stays responsive (FR-062, FR-063, FR-064, SC-011)
- [X] T113 [P] [US4] Test `backend/tests/automation/failure-isolation.test.ts`: a failing action does not abort its siblings (FR-065), and a failing rule does not fail its trigger — asserted by the triggering request still returning `200` (FR-071)
- [X] T114 [P] [US4] Test `backend/tests/automation/bounded-authority.test.ts`: a rule assigning to a deactivated user fails, and one transitioning along an undeclared edge fails — each with a recorded reason and neither by a bypass (FR-058, research D8)
- [X] T115 [P] [US4] Test `backend/tests/automation/enabled-state.test.ts`: a disabled rule has no effect and re-enabling does not act retroactively; rules are created disabled (FR-061)
- [X] T116 [P] [US4] Test `backend/tests/automation/dry-run.test.ts`: the dry run writes nothing, and its described actions match what the executor would do because both read the same catalog entry (FR-066)
- [X] T117 [P] [US4] Frontend test `frontend/tests/automation/builder.test.ts`: full keyboard operation — add, edit, remove, and reorder rules and rows with no pointer; focus lands sensibly after every add and remove; changing a condition's field resets its operator and value and announces it

### Implementation for User Story 4

- [X] T118 [US4] Create `backend/src/services/automation.service.ts` with `emit(event, transaction)` registering an `afterCommit` callback — never a Sequelize model hook, per research D10, and never evaluating synchronously inside the transaction
- [X] T119 [US4] Implement the condition evaluator as a **pure** function with no writes, separated from the action executor, which is what makes the dry run trustworthy rather than a simulation with side effects
- [X] T120 [US4] Implement the action executor, every action calling the service a person's request would call (`ticket.service`, `ticket-lifecycle.service`, `assignment.service`, `alert.service`, `message.service`) with a system actor, per the table in contracts/automation-engine.md
- [X] T121 [US4] Implement `ExecutionContext` with `depth` and the `seen` set keyed `"ruleId:ticketId"` per originating event, and wrap the whole `afterCommit` body so nothing can propagate to the caller (FR-071)
- [X] T122 [US4] Write one `automation_runs` row per rule evaluation with outcome `acted`, `no_match`, `suppressed`, or `failed`, `actions_applied` naming per-action results, and `detail` as an i18n key with parameters — never a sentence and never a stack trace
- [X] T123 [US4] Add `automation.emit` calls to `ticket.service` (created, priority changed, assigned, unassigned), `ticket-lifecycle.service` (status changed), `intake.service` (message received), and `sla-escalation.service` (at risk, breached), each after its mutation and inside its transaction
- [X] T124 [US4] Implement rule validation against `automation/catalog.ts` at write time in `backend/src/services/automation.service.ts`, so a stored rule can never name something the catalog does not contain (research D9)
- [X] T125 [P] [US4] Create `backend/src/controllers/automation/rules.controller.ts` and `backend/src/routes/automation/` per contracts/automation-engine.md — catalog, CRUD, enable, disable, reorder, dry-run, delete — with rules always created disabled
- [X] T126 [P] [US4] Create `frontend/src/services/automation.service.ts` and `frontend/src/components/automation/RuleBuilder.vue`, `ConditionRow.vue`, `ActionRow.vue`, `DryRunResults.vue` per contracts/sla-automation-ui.md: labelled fieldsets per row, dependent selects that reset on field change, focus management on add and remove, and **move up / move down buttons rather than drag alone**
- [X] T127 [P] [US4] Create `frontend/src/views/admin/AutomationRulesView.vue` with the list, the enabled toggle, keyboard reordering, the `automation.builder.allConditionsMustHold` line, and dry-run before enable as a separate deliberate step
- [X] T128 [US4] Add the route and guard in `frontend/src/router/index.ts` and every key to both locale files

**Checkpoint**: A supervisor can automate a routine, and nothing they build can loop, exceed their authority, or break the thing that triggered it.

---

## Phase 9: User Story 7 — A Supervisor Can See What Automation Did, and Why (Priority: P3)

**Goal**: Every automated act is retrievable with its reason, including the ones where nothing
happened.

**Independent Test**: Fire rules that act, do not match, are suppressed, and fail; confirm each
outcome is retrievable with its reason and that the record survives the rule's deletion.

### Tests for User Story 7

- [X] T129 [P] [US7] Test `backend/tests/automation/runs-api.test.ts`: all four outcomes are retrievable and distinguishable, filters work, and a deleted rule leaves its runs intact with `ruleName` still populated (FR-067, FR-070)
- [X] T130 [P] [US7] Test `backend/tests/automation/runs-permission.test.ts`: a user without `automation:view` is refused server-side, not merely shown nothing
- [X] T131 [P] [US7] Test `backend/tests/automation/ticket-history.test.ts`: every automated act also appears in the ticket's own history attributed to the automation rather than to a person (FR-068, SC-012)

### Implementation for User Story 7

- [X] T132 [P] [US7] Create `backend/src/controllers/automation/runs.controller.ts` and its route per contracts/sla-api.md, guarded by `automation:view`, paged newest first with `ruleId`, `ticketId`, `outcome`, `from`, and `to` filters
- [X] T133 [P] [US7] Create `frontend/src/views/admin/AutomationRunsView.vue` rendering outcomes with icon and text rather than colour alone, showing `no_match` rows as visibly not errors, and rendering `detail` from its i18n key and parameters
- [X] T134 [US7] Add the route and guard in `frontend/src/router/index.ts` and the keys to both locale files

**Checkpoint**: All seven user stories are independently functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T135 [P] Run `frontend/tests/locales.test.ts` and resolve every key present in one locale file and absent from the other — the mechanism that keeps Principle I true without inspection
- [ ] T136 [P] Greyscale pass: screenshot the queue and the ticket header with colour stripped and confirm all four SLA states and all four run outcomes remain identifiable by icon and text (FR-085, SC-015)
- [ ] T137 [P] Arabic RTL pass by eye: countdowns, overdue phrases, and every number embedded in translated prose. "left 3 hours working" is the failure to look for — this phase's new i18n hazard
- [ ] T138 [P] Keyboard and screen-reader pass over the rule builder and the reorder controls, per the obligations in contracts/sla-automation-ui.md — happy-dom reaches the attributes and no further
- [ ] T139 Run the six quickstart scenarios end to end against a running application, including the manual cycle test in Scenario 5
- [ ] T140 Connect one real email transport and confirm an alert arrives (quickstart, "manual passes") — the one thing in this phase that cannot be proved in CI
- [ ] T141 Confirm the default calendar against the organisation's actual working week with whoever owns the SLA commitments; Sun–Thu 09:00–17:00 Africa/Cairo is a stated assumption, not a discovered fact
- [X] T142 Update `.env.example` and the repository README with the three new knobs and the seeded defaults
- [X] T143 Propose the constitution amendment (written to `specs/007-phase-6-sla-automation/constitution-amendment.md`; awaiting approval, NOT applied) striking the Open Item _"SLA response/resolution time targets (needed before Phase 6)"_ as resolved by Clarifications Q1, following the governance procedure in `.specify/memory/constitution.md` — **not** by editing the file directly
- [X] T144 Fill the "Changed during implementation" table in `specs/007-phase-6-sla-automation/plan.md` with what the code actually forced, following the Phase 5 precedent

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US1 (Phase 3)**: depends on Foundational. Blocks every other story — they are all statements about
  a target.
- **US6 (Phase 4)**: depends on US1.
- **US2 (Phase 5)**: depends on US1 and US6 (sweeping a complete clock), and on T022 for the lifecycle
  edge.
- **US3 (Phase 6)**: depends on Foundational and on US2's `alert.service` for FR-048.
- **US5 (Phase 7)**: depends on US2's `alert.service`.
- **US4 (Phase 8)**: depends on US1 (SLA triggers and conditions), US3 (`apply_assignment_strategy`),
  and US2 (`notify_users`). It is last among the P2 work for that reason.
- **US7 (Phase 9)**: depends on US4 writing the rows it reads.
- **Polish (Phase 10)**: depends on everything.

### Within Each User Story

- Tests first, and confirmed failing, before the implementation that satisfies them.
- Declarations → models → services → controllers/routes → frontend.
- Backend before the frontend that calls it.

### Parallel Opportunities

- **Phase 2 migrations T004–T015** are twelve independent files — the largest parallel block in the
  phase.
- **Phase 2 declarations T024–T030** are independent of each other and of the migrations.
- Every test task marked [P] within a story is a separate file.
- Frontend component tasks marked [P] are separate files; the view and router tasks that wire them are
  not.
- **US3 and US5 can be worked in parallel** once US2 lands: they touch different services and
  different screens.

---

## Parallel Example: Foundational migrations

```bash
# Twelve independent migration files, one developer or twelve:
Task: "Migration alter-tickets-add-due-source"      # T004
Task: "Migration alter-users-add-alert-phone"       # T005
Task: "Migration create-sla-policies"               # T006
Task: "Migration create-business-calendars"         # T007
Task: "Migration create-calendar-exceptions"        # T008
Task: "Migration create-ticket-sla"                 # T009
Task: "Migration create-assignment-settings"        # T010
Task: "Migration create-user-competencies"          # T011
Task: "Migration create-automation-rules"           # T012
Task: "Migration create-automation-runs"            # T013
Task: "Migration create-alert-subscriptions"        # T014
Task: "Migration create-alert-deliveries"           # T015
```

## Parallel Example: User Story 2 tests

```bash
Task: "backend/tests/escalation/breach.test.ts"        # T067
Task: "backend/tests/escalation/idempotency.test.ts"   # T068
Task: "backend/tests/escalation/downtime.test.ts"      # T069
Task: "backend/tests/escalation/new-status.test.ts"    # T070
Task: "backend/tests/escalation/exclusions.test.ts"    # T071
Task: "backend/tests/escalation/warning.test.ts"       # T072
Task: "backend/tests/escalation/unassigned.test.ts"    # T073
```

---

## Implementation Strategy

### MVP

**Setup + Foundational + US1** (T001–T057). Targets are computed, visible, and driving Phase 4's due
date. Demo quickstart Scenario 1. Nothing escalates yet, and the phase is already useful: agents stop
guessing what "soon" means.

### Recommended increments

1. **Setup + Foundational** → schema, permissions, declarations, the widened actor. Nothing new works;
   nothing existing is broken.
2. **+ US1** → MVP. Targets exist. Demo Scenario 1.
3. **+ US6** → the clock is complete and correct. Demo Scenario 3.
4. **+ US2** → 🏁 **the Definition of done is met.** Demo Scenario 2. First deployable increment.
5. **+ US3** → work routes itself. Demo Scenario 4.
6. **+ US5** → alerts leave the application. Demo Scenario 6.
7. **+ US4** → the rule builder. Demo Scenario 5.
8. **+ US7** → the automation record.
9. **+ Polish** → the four manual passes, the real transport, and the constitution amendment.

### Parallel Team Strategy

After Foundational, US1 and US6 are one developer's critical path — they are the same service and
splitting them would mean two people editing `sla-target.service.ts`. Once US2 lands, a second
developer takes US5 and US7 (alerts and the record, both largely isolated) while the first continues
through US3 into US4, which is the largest single piece of work in the phase.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- Commit after each task or logical group.
- **The marker holds a value, not a flag.** Any sweep that stores a boolean has thrown away FR-042
  and FR-030 — a flag cannot tell a re-save from a reschedule, which is the warning Phase 4 wrote
  into `ticket-due.service.ts` and this phase is the one that pays for ignoring.
- **Automation calls services, never models.** If a task tempts you toward `Ticket.update` inside the
  executor, stop: that is a second enforcement path, and the lifecycle, the assignee check, and the
  opt-out rules all stop applying at once.
- **Nothing in the `afterCommit` body may throw.** FR-071 is not best effort; the enclosing
  transaction has already committed, so there is nothing left to roll back and nothing to gain from
  propagating.
- **The calendar default is an assumption, not a fact** (T141). It is the first thing a real
  installation should change, and the last thing this phase should quietly leave unverified.
