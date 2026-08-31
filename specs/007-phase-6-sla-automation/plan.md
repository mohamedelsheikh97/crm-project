# Implementation Plan: Phase 6 — SLA & Automation

**Branch**: `007-phase-6-sla-automation` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-phase-6-sla-automation/spec.md`

**PLAN.md Reference**: Phase 6 — SLA & Automation

**Builds on**: Phase 5 — Communication Channels, merged to `main` at `a25fa3f`

## Summary

Phase 6 gives the system a mandate. Tickets acquire service targets computed from configurable
policies; the targets are measured in working time against a business calendar; breaches escalate and
notify without anyone watching; unassigned work routes itself to an eligible agent; and a supervisor
can add rules of their own from a screen.

Six decisions shape the implementation.

**The SLA clock is a separate table, and `tickets.due_at` stays the seam.** `ticket_sla` holds one row
per ticket that matched a policy (D1). The resolution target writes `tickets.due_at`, and one new
column, `due_source`, records whether a policy or a person put it there (D6). That is the seam Phase 4
declared in its FR-028 and defended in a source comment: everything downstream reads `due_at` and
nothing else, so the queue sort, the overdue filter, the indicator, and the approaching-due warning
are untouched and their tests keep passing unmodified.

**Working time is computed here, not imported.** `lib/business-hours.ts` is two pure functions over
`Intl` (D2). The default calendar is Africa/Cairo, which reinstated daylight saving in 2023, so a
fixed-offset implementation would mis-time every target for half the year in the project's own
default configuration. A date library would be a new runtime dependency for two functions; Phase 5
spent that budget on MIME, where the input was hostile and the format enormous. Here the input is a
calendar row and an integer.

**Idempotency is Phase 4's value-comparison pattern, reused exactly.** Each marker stores the *target
value already acted on*, not a boolean (D4). That one choice delivers three requirements together:
fire once (FR-034), do not re-fire after a manual de-escalation (FR-042), and re-arm on a genuine
reschedule such as a reopen (FR-030). Phase 4 wrote the warning about flags into the source; this is
the phase that would have paid for ignoring it.

**Automation acts through the services a person's request would, which makes `Actor.id` nullable**
(D8). A rule that changed a status by writing the model would bypass `TRANSITIONS`; one that assigned
by writing the model would bypass the active-and-permitted assignee check. That is a second
enforcement path — the failure Phase 3's generated matrix exists to catch. Phase 5 already made the
data nullable in three columns; this phase makes the code path agree with the schema.

**The action catalog is closed-ended, and rules are validated against it on write** (D9). FR-058's
bounded authority is only real if it is structural: the executor can then trust its input, and an
invalid rule fails loudly at save time rather than doing something unintended at 03:00.

**Alerts are not messages** (D13). An alert to an agent goes straight to the channel adapter and
writes no `messages` row, because `messages` is the correspondence structure Clarifications Q3 kept
free of internal content and Phase 8 will build a customer-facing view on.

**One correction to the spec came out of planning.** FR-038 assumed automatic escalation would
sometimes be refused by the lifecycle and should then be recorded as attempted. Reading
`tickets/lifecycle.ts` shows the case that actually arises is fatal to the phase's Definition of done:
`new` has exactly one outgoing edge, `new → open`, so a ticket that arrived overnight and that
**nobody has opened** could never escalate. This plan adds `new → escalated` to the lifecycle
declaration (D11). See _Changed during planning_.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22 LTS, both workspaces — unchanged from
Phases 0–5.

**Primary Dependencies**: **None added.** The one candidate was a date library for working-time
arithmetic, declined in D2 in favour of ~120 lines of `Intl`-based helper with a DST test table.
Everything else reuses what exists: `lib/scheduler.ts` (Phase 4) gains a third sweep,
`lib/rate-limit.ts` (Phase 5) bounds alert volume, `lib/notification-hub.ts` (Phase 4, generalised in
Phase 5) delivers in-app alerts, `lib/phone.ts` (Phase 2) normalises the one new user column, and
Phase 5's channel adapters carry email and SMS alerts.

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Ten new tables** — `sla_policies`,
`business_calendars`, `calendar_exceptions`, `ticket_sla`, `assignment_settings`,
`user_competencies`, `automation_rules`, `automation_runs`, `alert_subscriptions`,
`alert_deliveries` — plus **two new columns**, `tickets.due_source` and `users.alert_phone`. **One
declaration change**: a fourteenth edge in `tickets/lifecycle.ts` (D11). No table is dropped or
renamed.

**Testing**: Vitest across both workspaces, backend serially against `crm_support_test`. Everything
clock-dependent is tested by calling `runScheduledSweeps(now)` directly with a controlled date, never
by waiting on a timer — the discipline Phase 4 established and Phase 5 kept. The Phase 1 authorization
matrix extends automatically over the four new permission keys and will fail until each has a probe.
Working-time arithmetic gets a table-driven test across a DST boundary in both directions, which is
the single highest-risk piece of new logic in the phase.

**Target Platform**: Linux/Windows server; evergreen browsers. No new build output.

**Performance Goals**: A breach is detected and escalated within one scheduler tick (60s) of its
target passing (SC-003). The sweep reads `ticket_sla` on an index over `resolution_target_at` and
joins to `tickets` only for matched rows, so its cost tracks breaches rather than ticket count. Rule
evaluation adds no perceptible latency to the interaction that triggered it, because it runs after
the response's transaction commits and cannot fail it (FR-071).

**Constraints**:

- Every target is stored as an absolute time, written at a real event, never recomputed on read
  (FR-029) — so a calendar edit moves future targets only.
- The sweep's idempotency markers hold target *values* and are compared column-to-column in a
  `literal` (D4). Sequelize's operators compare a column to a value and would silently match nothing.
- Paused rows are excluded from the sweep by `paused_at IS NOT NULL`; pausing rewrites the target
  rather than accumulating an offset (D3).
- Automation never writes a model directly; it calls the same service a request would (D8).
- No rule may name a trigger, condition, or action outside the catalog, enforced at write time (D9).
- Rules run after commit, depth-bounded, and never propagate a failure to their trigger (D10).
- Automatic assignment never overwrites a human assignment, and its eligibility test is byte-for-byte
  the one `ticket.service.assign` already applies (D12, FR-049).
- Alerts to users write no `messages` row (D13).
- In-app notification is created independently of every other transport and cannot be prevented by
  one failing (FR-073, FR-075).
- Ticket history attributes automated acts to the system; the audit log attributes them to the rule's
  configuring user (FR-039 vs FR-086).
- Single backend process, inherited unchanged from Phase 4 and 5 — see Complexity Tracking.

**Scale/Scope**: ~22 new backend endpoints across five routers (SLA policies, calendar, assignment,
automation, alerts), 10 new tables, 2 new columns, 1 lifecycle-declaration edge, 4 new permission
catalog entries, 3 new notification types, 4 new frontend admin views, ~10 new components, and one
widened `Actor` type rippling through four services.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle | Assessment |
| --- | --- |
| **I — Bilingual-First & RTL** (NON-NEGOTIABLE) | **At risk in a specific new way.** This phase renders *durations and countdowns* — "3 working hours left", "breached 2 days ago" — which are the hardest thing yet to get right in RTL, because a number, a unit, and a direction word have to read correctly in both scripts. It also introduces machine-generated alert bodies, whose language is decided per recipient rather than per viewer. |
| **II — Security by Default** (NON-NEGOTIABLE) | **At high risk, differently from Phase 5.** Phase 5's hazard was untrusted *input*; this phase's is untrusted input causing *state change*. A rule triggered by "a message arrived" means a stranger's email can flip a status, reassign work, and cause an outbound send — with no user, no role, and no route middleware in the path. |
| **III — Layered Architecture** (NON-NEGOTIABLE) | **At risk.** A rule engine is a natural home for logic that belongs in services, and Sequelize model hooks are the obvious shortcut for event emission — which would put business logic in models and fire it inside the transaction. |
| **IV — Accessibility** | **At risk.** "Met / at risk / breached" is the most colour-tempting state this project has produced (FR-085), and a rule builder is a complex, dynamic form — the hardest kind of screen to keep keyboard-operable and correctly labelled. |
| **V — Phase-Gated Delivery** | **Passes.** `/speckit-specify` complete, three clarifications resolved, no markers remaining; this plan precedes `/speckit-tasks`; PLAN.md traceability tables are in the spec. |

**Outcome: proceed to research with four named constraints**, each carried into a decision.

### Post-design re-evaluation

| Principle | Resolution |
| --- | --- |
| **I** | **Passes.** Durations are never composed by string concatenation: the API returns structured values (`{ unit, value, state }`) and the interface renders them through `vue-i18n` pluralisation per locale, with numerals per the active convention (FR-084, contracts/sla-automation-ui.md). Alert bodies are composed from locale content in the *recipient's* language at delivery time (FR-080), which is why the alert payload carries keys and parameters rather than a sentence — the same rule the notification table has followed since Phase 4. |
| **II** | **Passes with the defence written down.** Automation's authority is bounded structurally, not by a check: the catalog is closed-ended and validated on write (D9), every action executes through the service that already enforces the lifecycle, the assignee test, opt-out, and the reply window (D8), execution is depth-bounded with a per-event rule/ticket set (D10), outbound volume is ceilinged (D15), and every run — acting, skipped, suppressed, or failed — is recorded (FR-067). Four new permission keys are enforced server-side and covered by the generated matrix. FR-081 is enforced by alerts carrying identifiers rather than content. |
| **III** | **Passes.** `src/sla/` and `src/automation/` hold declarations only (the clock's status classification, the policy precedence order, the three catalogs), beside `tickets/lifecycle.ts` and `auth/permissions.ts` on the precedent Phase 5 set with `channels/types.ts`. Decisions live in services; `lib/business-hours.ts` is pure arithmetic reading no business rules, which is why it sits in `lib/` with the scheduler and the rate limiter. Event emission is an explicit service call registering an `afterCommit`, never a model hook (D10). |
| **IV** | **Passes.** SLA state carries an icon and text alongside colour (FR-085), the rule builder is a sequence of labelled fieldsets with each condition and action row individually reachable and removable by keyboard, and validation errors are announced rather than only shown — reusing the pattern Phases 1–5 established rather than inventing a second one. |
| **V** | **Passes.** Artifacts complete; this section is the reviewer's gate before `/speckit-tasks`. |

**Outcome: gate passes with no violations.** Four items are recorded in Complexity Tracking — the
hand-written working-time helper, ten new tables, the widened `Actor`, and the inherited
single-process limit. None is a principle violation; each is the kind of thing the constitution asks
to be justified rather than absorbed silently.

## Project Structure

### Documentation (this feature)

```text
specs/007-phase-6-sla-automation/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D15
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── sla-api.md              # Policies, calendar, targets, assignment, alerts
│   ├── automation-engine.md    # Trigger/condition/action catalogs, execution contract
│   └── sla-automation-ui.md    # Screens, states, i18n keys, a11y contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── auth/
│   │   └── permissions.ts                      # + 4 catalog entries (D11 in contracts)
│   ├── sla/                                    # NEW — declarations only (D7)
│   │   ├── clock.ts                            # PAUSED/RESOLVED status classification
│   │   └── precedence.ts                       # Policy match specificity order (FR-013)
│   ├── automation/                             # NEW — declarations only (D9)
│   │   ├── catalog.ts                          # Triggers, conditions, actions
│   │   └── events.ts                           # Event shapes services emit
│   ├── tickets/
│   │   └── lifecycle.ts                        # + one edge: new → escalated (D11)
│   ├── config/
│   │   └── env.ts                              # + 3 knobs (D15)
│   ├── controllers/
│   │   ├── sla/                                # Policies, calendar, ticket SLA read
│   │   ├── assignment/                         # Strategy, ceiling, competencies
│   │   ├── automation/                         # Rules CRUD, reorder, dry-run, runs
│   │   └── alerts/                             # Subscriptions
│   ├── db/
│   │   ├── migrations/                         # 10 new tables + 2 columns
│   │   └── seeders/                            # Permissions, default policies, default calendar
│   ├── lib/
│   │   ├── business-hours.ts                   # NEW — pure working-time arithmetic (D2)
│   │   └── scheduler.ts                        # + sweepSlaTargets (D5)
│   ├── models/                                 # 10 new models + 2 model changes
│   ├── routes/
│   │   └── sla/ assignment/ automation/ alerts/
│   └── services/
│       ├── sla-policy.service.ts               # NEW — CRUD, matching, precedence
│       ├── sla-target.service.ts               # NEW — compute, pause/resume, satisfy (D3)
│       ├── sla-escalation.service.ts           # NEW — detect, warn, escalate (D4)
│       ├── assignment.service.ts               # NEW — strategies, eligibility (D12)
│       ├── automation.service.ts               # NEW — emit, evaluate, execute (D10)
│       ├── alert.service.ts                    # NEW — fan-out to transports (D13)
│       ├── ticket.service.ts                   # Actor.id widened to nullable (D8)
│       ├── ticket-lifecycle.service.ts         # Actor widened; pause/resume hook
│       ├── ticket-due.service.ts               # due_source honoured (D6)
│       └── message.service.ts                  # Actor widened; first-response satisfaction
└── tests/
    ├── sla/                # business-hours (DST table), targets, pause, precedence
    ├── escalation/         # idempotency, downtime catch-up, unassigned, new → escalated
    ├── assignment/         # strategies, eligibility, ceiling, concurrency, no-eligible
    ├── automation/         # catalog validation, ordering, cycles, dry-run, failures
    ├── alerts/             # transport independence, skipping, ceiling, i18n
    └── authorization.matrix.test.ts            # + 4 probes

frontend/
├── src/
│   ├── components/
│   │   ├── sla/            # SlaState, SlaCountdown, DueSourceBadge
│   │   └── automation/     # RuleBuilder, ConditionRow, ActionRow, DryRunResults
│   ├── views/admin/
│   │   ├── SlaPoliciesView.vue  BusinessCalendarView.vue
│   │   ├── AssignmentView.vue   AutomationRulesView.vue
│   ├── services/           # sla.service.ts, automation.service.ts, assignment.service.ts
│   └── locales/            # ar.json / en.json — new namespaces
└── tests/
    ├── sla/                # countdown rendering, RTL, greyscale distinguishability
    └── automation/         # builder interaction, keyboard, validation announcement
```

**Structure Decision**: The established two-workspace layout is unchanged. Two new backend
declaration directories appear — `src/sla/` and `src/automation/` — placed beside `src/tickets/` and
`src/channels/` rather than inside `services/`, on the precedent those two set: they are declarations
several layers read, holding no business decisions. One new `lib/` module appears,
`business-hours.ts`, which is pure arithmetic reading no business rules — the same reasoning that put
`clock.ts`, `phone.ts`, and `rate-limit.ts` there. No new frontend build output.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **Hand-written working-time arithmetic** (`lib/business-hours.ts`, ~120 lines) instead of a date library | Clarifications Q1 makes every SLA number depend on zone-correct working-time arithmetic, and the default calendar is Africa/Cairo, which reinstated DST in 2023 | A library (`luxon`, `date-fns-tz`) is correct but is a new runtime dependency plus its transitive tail for exactly two pure functions, which does not clear the constitution's YAGNI bar. `Temporal` is not stable in Node 22. A fixed UTC offset is wrong twice a year in the project's own default configuration. **If the DST test table proves the helper insufficient, adopting `luxon` is a contained swap behind these two functions** (research D2). |
| **Ten new tables in one phase** (three more than Phase 5) | Five distinct configuration concerns (policy, calendar, assignment, alerts, rules) plus three records (per-ticket state, rule runs, alert deliveries) | Each is a distinct entity in the spec's Key Entities. The merges available were considered: SLA state as columns on `tickets` widens the most-read row in the system for state two code paths read (D1); competencies as a JSON column on `users` cannot be filtered by the routing query (D14); rule runs and alert deliveries hold genuinely different rows with different retention questions. `calendar_exceptions` is separated from `business_calendars` only because it is a growing list, not a setting. |
| **`Actor.id` widened to `number \| null`**, rippling through four services | Automation must act through the services a person's request uses, so that the lifecycle, the assignee test, opt-out, and the reply window all apply to it without a second enforcement path | Duplicating the write paths inside the automation service is what Phase 5's intake did for *creation*, and it is not defensible for *mutation*: a rule writing the model bypasses `TRANSITIONS`. Phase 5 already made the data nullable in three columns; leaving the type non-nullable keeps the code disagreeing with the schema (research D8). |
| **Single backend process**, inherited | The scheduler, the stream hub, the mail poller, and now the alert rate limiter are all in-process | Recorded unchanged from Phases 4 and 5. This phase adds a third sweep to the existing timer rather than a new one, so it adds no new instance of the assumption — but it raises the cost of violating it, because a double-fired sweep now escalates a ticket rather than duplicating a notification. Lifting it needs a lock, not a rewrite; Phase 11 still owns it. |

### Changed during planning

Recorded because each was a decision forced by reading existing code, not a preference, and the next
phase will meet the consequences.

| Planned in the spec | Will be built | Why |
| --- | --- | --- |
| FR-038: automatic escalation "records attempted and refused" where the lifecycle forbids it | **`new → escalated` is added to `tickets/lifecycle.ts`**, and FR-038 governs only the residual cases | `new` has exactly one outgoing edge. A ticket that arrived overnight and that nobody has opened could never escalate — the worst-handled tickets would be the only ones that never escalate, which defeats the Definition of done for the case escalation most exists for. The lifecycle file states that later phases inherit and change it; the generated 36-pair test regenerates from the declaration (research D11). |
| — | **`Actor.id` becomes `number \| null`** across `ticket.service`, `ticket-lifecycle.service`, `ticket-due.service`, `message.service` | Automation acts through those services (D8). Phase 5 made `ticket_history.actor_user_id`, `tickets.created_by_user_id`, and `ticket_links.created_by_user_id` nullable; the type is the last place the code still claims every act has a person behind it. |
| — | **`tickets.due_source`** added, defaulting to `'manual'` for every existing row | FR-024c requires dates set by hand in Phase 4 to be treated as human overrides. Inferring that from the history is a query, not a fact, and would be wrong for every pre-Phase-6 ticket (research D6). |
| — | **`users.alert_phone`** added, nullable | FR-072 requires SMS alerting and FR-077 requires a recipient with no address to be skipped. Users currently carry no number at all, so SMS to a user is unreachable rather than skipped (research D13). |
| Alerts "go through Phase 5's channel transports" (FR-074) | Alerts to **users** call the adapter directly and write no `messages` row; only a rule's **customer-visible message** action goes through `message.service.send` | `messages` is the correspondence structure Clarifications Q3 kept free of internal content, and Phase 8 will build a customer-facing view on it. Operational traffic to agents must not enter it (research D13). |

### Changed during implementation

Recorded because each was forced by the code, not a typo, and the next phase will meet the
consequences.

| Planned | Built | Why |
| --- | --- | --- |
| `Actor.id` widened to `number \| null` across four services (D8) | **`Actor` widened AND a new `UserActor` type introduced**, with `dashboard`, `task`, `template`, and `ticket-note` services plus their four controllers pointed at `UserActor` | Widening the shared type rippled into services that genuinely require a person: a task belongs to its owner, a note has an author, a queue belongs to whoever is looking at it. Casting or null-checking in those bodies would have weakened the type rather than widened it. `UserActor` says "a person, required" and the compiler enforces it — which is exactly right, because the automation catalog contains no action that reaches any of them. |
| Business calendar default `working_days = 62`, described as Sun–Thu | **`31`** | With Sunday as bit 0, **62 is Mon–Fri and 31 is Sun–Thu** — the two are one shift apart and mean opposite things in this project's default locale. Caught by the first run of the DST test table, which would otherwise have encoded a Monday-start week into every seeded installation. The constants are now spelled in binary at every site, with the neighbouring wrong value named in the comment. |
| `addWorkingTime` walks forward from the start day | **A start day that is already past closing advances the date before the walk** | The first draft cleared the "use a partial first day" flag but left the cursor on the same date, so the loop re-examined the finished day as a fresh full one. A ticket raised at 18:00 was given the whole of the day that had just ended and landed at 10:00 **that morning** — a target in the past. Caught by the FR-025c test. |
| — | **Two `undefined`-vs-`null` bugs in the same function**, both fixed | A freshly created Sequelize instance returns `undefined` for a column never assigned; a reloaded one returns `null`. `=== null` therefore silently failed to claim a new ticket's due date for its policy, and `!== null` then dereferenced `undefined` and took down every ticket creation in the system. Both sites now normalise with `?? null` / `== null` and say why. |
| Seeded `urgent` policy: 60-minute first response; `SLA_WARNING_LEAD_MINUTES` default 60 | Unchanged, but **recorded as a configuration hazard** in `tests/sla/target-computation.test.ts` | A target shorter than or equal to the warning lead is born `at_risk`, because "within the lead time of its target" is true from the moment it exists. That is literally what FR-037's configurable lead means and is not a bug — but it means every urgent ticket starts at risk under the shipped defaults. Surfaced in the test rather than silently tuned, because which number to change is the organisation's decision (quickstart T141). |
| Phase 3's `new → open` assertions | **Four test assertions updated** across `ticket-lifecycle.matrix.test.ts` and `tickets/transitions.test.ts` | Consequences of the D11 lifecycle edge. Each was updated rather than deleted: they still prove the endpoint reflects `TRANSITIONS` rather than a second copy of it, which is the property they were written for. |
| The rule engine's depth bound and `seen` set (D10) | **The cascade context is carried in an `AsyncLocalStorage`**, not created per emission | Found by a test that expected two runs and got three. `emit` registers an `afterCommit` callback, so by the time a rule's action causes the NEXT event, the async context of the code that caused it is gone — every hop started again at depth 0 with an empty `seen` set. FR-062 and FR-063 were therefore only true *inside* one synchronous cascade, and a self-triggering rule was stopped by a no-op check in `ticket.service.update` rather than by anything designed. The store makes the context follow the work rather than the call stack; it is the only place in this codebase that needs one, because it is the only place causally-connected work is deliberately detached from its caller. |
| The round-robin cursor "advanced in the same transaction as the assignment" (D12) | **It now actually is** | The comment was written and the write was not. `choose()` reads the cursor to decide who is next, so leaving it unchanged handed every ticket to the same agent while looking, from outside, exactly like a working strategy — even distribution, no errors, no complaints until somebody counted. Caught by the six-tickets-three-agents test. |
| `assignment.error.requiresAssignAuthority` refused with a validation error | **403 with a detail**, and `forbidden()` gained an optional `details` argument | 400 mislabels an authority refusal as a payload problem. The detail is what makes the 403 actionable: an administrator who has just granted `assignment:manage` and still cannot save would otherwise read a bare "you may not" as a bug rather than as FR-051 working. |
| The locale parity test compared placeholder LISTS | **It compares placeholder SETS** | Arabic has six plural categories to English's two, so a correctly translated plural repeats `{value}` six times in one file and twice in the other. Counting occurrences failed every correct translation — the opposite of what the test is for. What matters is that no NAMED placeholder is missing. |
| — | **The Phase 1 admin-user seeder now catches its own duplicate-key error**, and `tests/helpers/database.ts` gained a diagnostic comment | Killing a long test run mid-flight left MySQL connections holding open transactions. Under REPEATABLE READ those connections carry a stale snapshot, so the seeder's SELECT-then-INSERT idempotency check passed against rows that no longer existed and the insert then collided — aborting the reseed chain and failing whole files on 401/403 for a reason that looked nothing like the cause. The seeder documents itself as idempotent; now it is, in the awkward cases too. **Worth knowing for future phases: a suite that suddenly fails wholesale on authorization is more likely an abandoned connection than a regression** — the pre-change tree and the post-change tree were both verified green once the connections timed out. |

### Non-violations worth recording

- **`src/sla/` and `src/automation/` outside `services/`** are not new layers. They follow
  `tickets/lifecycle.ts`, `auth/permissions.ts`, and `channels/types.ts`: declarations several layers
  read, holding no business decisions.
- **A system actor passing permission-conditional branches** is not a permission bypass. Automation's
  gate is the closed-ended catalog and the authority of the user who configured the rule; there is no
  request, no role, and no route middleware in the path, which is exactly why the catalog must be
  closed-ended (D8, D9).
- **Adding a lifecycle edge** is not a Phase 3 violation. The declaration documents itself as the
  thing later phases inherit and change, and the generated test regenerates from it.
- **No `sla:view` permission key.** A ticket's SLA state rides on `tickets:view` and is returned with
  the ticket — the same reasoning that kept `notifications:view` out of Phase 4's catalog and
  `timeline:view` out of Phase 5's: a key every role holds unconditionally cannot refuse anything.

## Phase closeout

**PLAN.md Phase 6 Definition of done** — _"A ticket that breaches its SLA escalates and notifies the
right people without manual intervention."_

| Clause | Delivered by | Verified by |
| --- | --- | --- |
| "A ticket that breaches its SLA" | `sla-policy.service` + `sla-target.service` + `lib/business-hours.ts`; targets computed at creation and recomputed on priority/category change, pause, resume, and reopen | `backend/tests/sla/` — including the DST table and the pause/resume double-count test |
| "escalates" | `sla-escalation.service` on the third scheduler sweep, through `ticket-lifecycle.service` with a system actor | `backend/tests/escalation/` — idempotency across many passes with a controlled clock, downtime catch-up, `new → escalated` |
| "notifies the right people" | `alert.service` — in-app always, email and SMS where configured and addressable; assignee plus supervisory recipients, deduplicated | `backend/tests/alerts/` — transport independence, skipping, ceiling, recipient dedup |
| "without manual intervention" | The sweep, plus `assignment.service` for unassigned work and `automation.service` for everything a supervisor adds | `backend/tests/assignment/`, `backend/tests/automation/` |

**As built** (2026-08-31): 138 of 144 tasks complete. The backend suite is 836 tests across 59
files, the frontend 146 across 18; lint, both typechecks, and Prettier are clean. The six open tasks
are T136–T141 — the by-eye greyscale, Arabic RTL and screen-reader passes, the quickstart
walkthrough against a running application, one real email transport, and confirming the default
calendar with whoever owns the SLA commitments. None can be closed by a machine, and each is listed
below for the reason it exists.

**What the automated suite will not verify**, and is therefore owed to `quickstart.md`:

- A real email or SMS gateway carrying an alert. Every test runs against Phase 5's simulators by
  construction; the first real send is a configuration exercise.
- That the default calendar matches the organisation's actual working week. The default is a stated
  assumption (Sun–Thu, 09:00–17:00, Africa/Cairo), not a discovered fact, and it is the first thing an
  administrator should change.
- Keyboard and screen-reader operation of the rule builder, and the greyscale distinguishability of
  met / at risk / breached. Phases 4 and 5 recorded the same limit; happy-dom reaches the attributes
  and no further.
- Behaviour under two backend processes, which remains out of scope and would double-fire the sweep.

**Carried into Phase 7.** Knowledge-base article suggestion is a natural rule action and is
deliberately not in the catalog. Adding it is one catalog entry plus one executor branch — the
catalog was shaped so that a later phase extends it rather than reopening the engine.

**Carried into Phase 8.** SLA state is internal. Nothing in this phase exposes a target, a countdown,
or a breach to a customer, and the customer-facing view must decide deliberately whether to.

**Carried into Phase 10.** Every input reporting needs is already recorded: `ticket_sla` holds
outcomes per ticket, `automation_runs` holds what fired, `alert_deliveries` holds what was sent.
Reporting must not recompute SLA outcomes from history — the stored outcome is the record, because the
policy that produced it may since have changed (FR-018).

**Carried into Phase 11.** The single-process limit now has a consumer whose failure mode is worse
than duplication: a double-fired sweep escalates a ticket twice. A lock before the sweep is the
cheapest fix and should land with whatever multi-process work Phase 11 does.

**Carried into Phase 12.** Competency is per-user and per-category with no teams, by decision
(Clarifications Q3). Departments will reopen routing, and the fallback in FR-044b is the behaviour to
preserve: a missing competency must never park a ticket.

## Outstanding from earlier phases

- **Constitution Open Item — SLA targets before Phase 6.** **Resolved by this phase's Clarifications
  Q1**: working time against a configurable calendar, defaulting to Sun–Thu 09:00–17:00 Africa/Cairo,
  with the default targets in spec FR-009. Striking it from the constitution's Open Items is an
  amendment requiring the governance procedure and is **not** performed by this plan. **A written
  proposal now exists at `constitution-amendment.md` (task T143), unsigned**; it is the one
  governance action this phase leaves outstanding, and it needs a person, not a phase.
- **Constitution Open Item — messaging provider selection.** Raised by Phase 5, still not listed in
  the constitution, still deferred behind the adapter. This phase adds a consumer of it (alerts),
  which raises the stakes: an installation running on the simulator now silently fails to escalate
  to anybody OUTSIDE the application, on top of failing to reply to customers. Section 2 of the
  amendment proposal asks for it to be recorded.
- **Phase 4 carried forward**: T103–T106, the manual keyboard, RTL, greyscale, and quickstart passes,
  remain unfinished on Phase 4 and are not absorbed here. This phase adds its own equivalents rather
  than closing Phase 4's.
- **Phase 5 carried forward**: the manual widget-on-a-foreign-page and real-provider passes.
- Remaining Open Items (ERP identity for Phase 11, AI provider for Phase 9, branding for Phase 12) are
  untouched and not due.
