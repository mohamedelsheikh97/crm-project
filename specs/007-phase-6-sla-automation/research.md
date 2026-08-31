# Phase 0 Research: Phase 6 — SLA & Automation

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

Fifteen decisions. Each one was forced by something already in the codebase, and each is written so
that `/speckit-tasks` can be generated from it without reopening the question.

The spec left three questions open and `/speckit-specify` closed all three (Clarifications Q1–Q3).
Nothing below reopens them; D2, D6, and D14 implement them.

---

## D1 — SLA state lives in a `ticket_sla` table, not in columns on `tickets`

**Decision**: One row per ticket, primary key `ticket_id`, created when a policy matches and never
when one does not. `tickets` gains exactly one new column (`due_source`, D6).

**Rationale**: `tickets` is the hottest row in the system — every queue query, every list, every
dashboard count reads it — and it already carries fifteen columns accumulated over four phases. SLA
state is roughly a dozen more, of which every one is null for a ticket matching no policy (FR-014).
Keeping them separate leaves the list queries untouched and gives the detection sweep its own narrow
index on `resolution_target_at` rather than a partial index over the wide table.

The join is cheap and rare: the sweep reads `ticket_sla` first and joins to `tickets` for the
handful of rows that matched; the ticket detail view joins once. The queue does **not** join at all,
because it reads `tickets.due_at` — the Phase 4 seam, which D6 keeps populated.

**Alternatives considered**:

- _Columns on `tickets`._ Widens the most-read row in the system for state that two code paths read.
- _One row per target (two rows per ticket)._ The two targets do have different lifecycles, but every
  read wants both, every write sets both, and it doubles the row count for a join nobody needs.
- _JSON blob on `tickets`._ Cannot be indexed for the sweep, which is the one query that must stay
  cheap.

---

## D2 — Working-time arithmetic is written here, against `Intl`, with no new dependency

**Decision**: `backend/src/lib/business-hours.ts` — pure functions over a calendar value object, no
runtime dependency. Two primitives, and everything else is built from them:

```
addWorkingTime(from: Date, ms: number, calendar): Date
workingTimeBetween(from: Date, to: Date, calendar): number
```

Zone handling uses `Intl.DateTimeFormat(locale, { timeZone, hour12: false, … }).formatToParts()` to
convert an instant into zoned wall-clock parts, and a two-pass guess-and-correct to convert zoned
parts back into an instant. Day walking is bounded (400 iterations, then throw) so a malformed
calendar — every day marked non-working — fails loudly instead of hanging a sweep.

**Rationale**: Clarifications Q1 makes every SLA number in the system depend on this, and the
default calendar is `Africa/Cairo`, which **reinstated daylight saving in 2023**. A naive fixed-offset
implementation would silently mis-time every target for half the year in the project's own default
configuration — the failure mode that discredits the whole feature (FR-028).

Only two operations are needed, both pure, both exhaustively testable with a table of instants either
side of a DST boundary. Phase 5 spent this project's "new runtime dependency" budget on MIME parsing,
where hand-rolling was genuinely unsafe because the input is hostile and the format is enormous. This
input is a calendar row and an integer.

**Alternatives considered**:

- _`luxon` or `date-fns-tz`._ Correct, well-trodden, and a new runtime dependency plus its transitive
  tail for two functions. The constitution asks for complexity to be justified against YAGNI; "two
  pure functions" does not clear that bar. Recorded in Complexity Tracking as the fallback if the
  DST test table proves the hand-written helper insufficient.
- _`Temporal`._ Would be the right answer and is not stable in Node 22.
- _Fixed UTC offset per calendar._ Wrong twice a year in the default configuration.
- _Storing everything in UTC and ignoring zones._ Cannot express "09:00–17:00 local", which is the
  whole requirement.

---

## D3 — Pausing rewrites the target; it does not accumulate an offset

**Decision**: On pause (a transition into a paused status), compute
`remaining = workingTimeBetween(now, target)` and store it. On resume, set
`target = addWorkingTime(now, remaining)`. `total_paused_ms` is accumulated for display only and is
never used in arithmetic. The sweep excludes paused rows with `paused_at IS NOT NULL`.

**Rationale**: FR-022 requires paused time to be excluded *exactly once* across any number of cycles.
The obvious implementation — accumulate `paused_ms` and subtract it at read time — has to subtract
*working* time, not wall-clock time, or a weekend spent paused is deducted twice (once by the
calendar, once by the offset). Recomputing the target at the pause and resume boundaries makes
double-counting structurally impossible: the target is always "now plus what was left", and there is
no accumulated quantity to get wrong.

It also keeps FR-029 honest. The stored value is still an absolute time, still written at a real
event, and still immune to a later calendar edit; pause and resume are simply two more events at
which it is written.

**Alternatives considered**:

- _Accumulate `paused_ms`, subtract at read._ Double-counts non-working time; every read must know the
  calendar; and "remaining" becomes a computation rather than a stored fact.
- _Null the target while paused._ Loses the display FR-020 requires and costs the sweep its index.

---

## D4 — Idempotency markers are value comparisons, exactly as Phase 4 built them

**Decision**: `ticket_sla` carries `response_warned_for`, `resolution_warned_for`, and
`resolution_escalated_for` — each a `DATETIME` holding *the target value already acted on*, not a
boolean and not the time of the act. The sweep's predicate is column-to-column:

```
resolution_target_at <= :now
AND (resolution_escalated_for IS NULL OR resolution_escalated_for <> resolution_target_at)
```

Written as a Sequelize `literal`, for the reason `ticket-due.service.ts` already documents at length:
Sequelize's operators compare a column to a *value*, so expressing this through them produces a bound
parameter holding the string `"resolution_target_at"`, which matches nothing and makes the sweep
silently never fire.

**Rationale**: This is Phase 4's `due_warning_sent_for` pattern, and it gives three requirements for
free rather than as separate code:

- FR-034 (exactly once) — the marker equals the target, so a second pass matches nothing.
- FR-042 (no re-escalation after a manual de-escalation) — nothing changed, so nothing re-arms.
- FR-030 (a reopened ticket is not instantly breached) — the recomputed target is a *new value*, so
  the marker no longer matches and a fresh escalation is armed.

A boolean flag cannot distinguish a re-save from a reschedule. Phase 4 wrote that warning into the
source; this phase is the one that would have paid for ignoring it.

---

## D5 — Detection extends the existing scheduler; no new timer, no job queue

**Decision**: One new sweep, `sweepSlaTargets(now)`, added to `runScheduledSweeps()` in
`lib/scheduler.ts` alongside the two Phase 4 sweeps. Same 60-second tick, same `unref`'d interval,
same "started from `server.ts`, never `app.ts`" rule, same "exported and called directly by tests
with a controlled clock" discipline.

Within one pass the order is: satisfy-checks, then warnings, then breaches. FR-037's "never both in
one pass" is enforced by setting the warn marker as part of the escalation, so a ticket that breaches
before it was ever warned is escalated and never warned retrospectively.

**Rationale**: Phase 4's sweeps are written so that missing a tick is harmless, and FR-035 asks for
exactly that property. Adding a third sweep inherits it. Introducing a job queue would add a runtime
dependency and an operational component to run one query a minute.

**Alternatives considered**:

- _A queue (BullMQ/Redis) with a job per target._ A scheduled job per ticket must be cancelled and
  rescheduled on every priority change, category change, pause, resume, and reopen — five ways to
  leave a stale job behind. A state comparison has no such failure mode.
- _Database events / cron._ Moves business logic out of the layered architecture and out of test
  reach.

---

## D6 — The resolution target writes `tickets.due_at`; `due_source` records who set it

**Decision**: `tickets` gains `due_source ENUM('policy','manual') NOT NULL DEFAULT 'manual'`. The
backfill leaves every existing row `'manual'`, which is FR-024c exactly: dates set by hand in Phase 4
are human overrides, not machine values to be replaced.

- A policy computing a target writes `due_at` **only when** `due_source = 'policy'`.
- `ticket-due.service.setDueDate` sets `due_source = 'manual'`, and no policy evaluation touches that
  ticket's `due_at` again (FR-024a).
- Clearing a manual override sets `due_source = 'policy'` and rewrites `due_at` from the live target,
  or leaves it null if the ticket has no policy (FR-024d).

**Rationale**: This is the seam Phase 4 declared in its FR-028 and defended in a source comment on
`ticket-due.service.ts`: _"this is the seam Phase 6 replaces … everything downstream reads `due_at`
and nothing else."_ Honouring it means the queue sort, the overdue filter, the overdue indicator, and
the approaching-due warning are all untouched by this phase, and their Phase 4 tests keep passing
unmodified — which is SC-014 stated as a build instruction.

`due_source` is one column because the alternative — inferring "did a human set this?" from the
history — is a query, not a fact, and it would be wrong for every pre-Phase-6 ticket.

**Alternatives considered**:

- _A second date column beside `due_at`._ Two meanings of "late" on one queue row (spec Q2, option C).
- _Retiring manual setting._ Leaves `tickets:set_due_date` enforcing nothing and makes a deadline
  negotiated with a customer unrepresentable.

---

## D7 — The clock's start, stop, and pause points are declared, not scattered

**Decision**: `backend/src/sla/clock.ts` declares the whole state machine as data:

```
PAUSED_STATUSES = ['pending']
RESOLVED_STATUSES = ['resolved', 'closed']
```

derived from and cross-checked against `tickets/lifecycle.ts` by a test that fails if a status is
added to the lifecycle without being classified here. This file sits beside `tickets/lifecycle.ts`
and `auth/permissions.ts`, not inside `services/`, on the precedent Phase 5 set with
`channels/types.ts`: a declaration several layers read, holding no decisions of its own.

**Rationale**: FR-023 forbids a second parallel state machine. The failure this prevents is concrete
and cheap to hit: Phase 12 or a later phase adds a seventh status, the lifecycle declares its edges,
and the SLA clock silently treats it as active because nobody remembered a second list existed. A
declaration plus an exhaustiveness test makes that a red test rather than a wrong clock.

---

## D8 — Automation acts through the existing services, which means `Actor.id` becomes nullable

**Decision**: Every rule action and every automatic assignment calls the same service function a
person's request would: `ticket.service.update`, `ticket.service.assign`,
`ticket-lifecycle.service.transition`, `message.service.send`. To make that possible,
`Actor.id` widens from `number` to `number | null`, and `Actor.email` / `Actor.roleId` become
nullable alongside it. A null id means *the system acted*.

Every branch that consults the actor is made explicit about the system case:

- Permission-conditional branches (`tickets:manage_any`, close-ownership) treat a system actor as
  permitted. Automation's gate is the closed-ended action catalog (D9) plus the authority of the user
  who configured the rule — not a per-act permission lookup, because there is no request and no role.
- Audit attribution splits deliberately (FR-039 vs FR-086): **ticket history** records
  `SYSTEM_ACTOR`, so the ticket reads "the system did this"; the **audit log** records the rule
  owner's id where a rule caused it, with the rule id in metadata, so the accountability record names
  who authorised it. An SLA escalation has no configuring user and records `null`.

**Rationale**: The alternative is what Phase 5 did under time pressure — `intake.service` calls
`Ticket.create` directly rather than going through `ticket.service`. That was defensible for creation
(there is no "create as system" path and no lifecycle to violate), but it is not defensible for
*mutation*: a rule that changes a status by writing the model bypasses `TRANSITIONS`, and a rule that
assigns by writing the model bypasses the active/permitted assignee check. That is a second
enforcement path, which is precisely the failure Phase 3's generated 36-pair matrix exists to catch.

Making the actor honestly nullable is the smaller change. Phase 5 already made the *data* nullable in
three columns (`tickets.created_by_user_id`, `ticket_history.actor_user_id`,
`ticket_links.created_by_user_id`); this phase makes the *code path* agree with the schema.

**Scope of the ripple** (recorded so `/speckit-tasks` sizes it correctly): `ticket.service.ts`,
`ticket-lifecycle.service.ts`, `ticket-due.service.ts`, `message.service.ts` — the interface is
declared once in `ticket.service.ts` and re-exported, so this is one type change plus the branches
that read `actor.id`. Controllers are unaffected: a request always has a real actor.

---

## D9 — Triggers, conditions, and actions are a closed catalog; rules are JSON validated against it

**Decision**: `backend/src/automation/catalog.ts` declares the three catalogs as `as const` arrays
with their operand types. `automation_rules` stores `conditions_json` and `actions_json` (MySQL 8
JSON), validated against the catalog **at write time**, so a stored rule can never name a trigger,
field, or action the catalog does not contain.

**Rationale**: FR-058's bounded authority is only real if it is structural. Validating on write means
the executor can trust its input, and a catalog entry removed in a later phase makes existing rules
fail validation loudly on edit rather than doing something unintended at 03:00.

JSON rather than child tables because conditions and actions are a variable-length list always read
and written as a whole, and nothing queries an individual condition. Three tables and two joins would
buy nothing.

**Alternatives considered**:

- _A small expression language._ Free-text formulas over untrusted-triggered events is an evaluator
  this project should not own, and FR-054 explicitly asks for a screen, not a syntax.
- _Child tables._ Joins for a list that is never queried piecewise.
- _Validating only at execution._ A rule that is invalid can then be saved, enabled, and silently do
  nothing.

---

## D10 — Rules run after commit, in-process, depth-bounded, and never fail their trigger

**Decision**: Services emit automation events explicitly —
`automation.emit(event, transaction)` registers an `afterCommit` callback — following the exact
ordering rule `notification-hub.ts` documents: *everything publishes after its transaction commits*.
Execution is synchronous in-process, wrapped so no failure escapes (FR-071).

An `ExecutionContext` carries `depth` (max 3) and a `Set<"ruleId:ticketId">` of pairs already run.
FR-064 is the set; FR-062 and FR-063 are the depth bound. Hitting either records an
`automation_runs` row with outcome `suppressed` and the reason.

**Rationale**: Sequelize model hooks were the obvious shortcut and are wrong three ways: they live in
models (Principle III), they fire *inside* the transaction (so a rule could act on a state that then
rolls back — the lie `notification-hub.ts` was written to prevent), and they cannot see the actor,
which D8 needs for attribution.

Synchronous-after-commit rather than deferred-to-the-sweep because FR-060's visible ordering and
User Story 4's "the priority changes" are both immediate expectations, and the work is bounded by the
depth limit.

---

## D11 — `new → escalated` is added to the lifecycle declaration

**Decision**: Add one edge to `TRANSITIONS` in `tickets/lifecycle.ts`:
`new: [{ to: 'open', … }, { to: 'escalated', permission: 'tickets:transition' }]`.

**Rationale**: This is a finding, not a preference. Phase 3 declares thirteen edges, and `new` has
exactly one: `new → open`. So a ticket that arrives overnight, that **nobody has opened**, and that
blows its first-response target cannot be escalated — FR-038 would record "attempted and refused" for
the single case escalation most exists for. The worst-handled tickets in the system would be the only
ones that never escalate.

The lifecycle file says of itself: _"Later phases inherit it: Phase 4 groups its dashboard by these
statuses, Phase 5 starts and stops its SLA clock on these transitions … Changing this table changes
those phases."_ It is a declaration meant to be extended, the generated 36-pair test regenerates from
it, and the human consequence is reasonable: a triager holding `tickets:transition` can now say "this
one is a fire" without opening it first.

FR-038 stays in force for the cases that remain genuinely illegal — `resolved → escalated` and
`closed → escalated` — which do not arise, because a resolved ticket has satisfied its resolution
target and a closed one is excluded by FR-032.

**Alternatives considered**:

- _Record every `new` breach as refused._ Satisfies the letter of FR-038 and defeats the phase's
  Definition of done for its most important case.
- _Force the transition from the system path._ A bypass of the lifecycle gate — the exact second
  enforcement path D8 exists to avoid.
- _Auto-open then escalate._ Two history entries for one event, and it fabricates a "someone opened
  this" that never happened.

---

## D12 — Assignment eligibility reuses the manual guard, verbatim

**Decision**: An eligible agent is `is_active`, not locked (`locked_until` null or past), and their
role holds `tickets:view` — the same three conditions `ticket.service.assign` already enforces for a
Supervisor's manual assignment. Round-robin's cursor is a column on the assignment settings row,
advanced in the same transaction as the assignment. FR-053 is a conditional update
(`WHERE assignee_user_id IS NULL`), so two concurrent attempts cannot both win.

**Rationale**: FR-045 says "the permission required to work a ticket", and the codebase already
answers that question in one place with a comment explaining it: _"Assigning work to someone who
cannot open it is a silent dead end."_ Automation must not be able to produce an assignment a
Supervisor could not have made by hand.

The cursor is stored rather than derived because deriving it (`the assignee of the most recent
auto-assigned ticket`) breaks the moment a ticket is reassigned, merged, or deleted from the
consideration set, and FR-046 requires determinism.

---

## D13 — Two outbound paths, deliberately: alerts are not messages

**Decision**:

- An alert to a **user** goes straight to the channel adapter (`adapterFor('email').send(...)`) and
  writes **no** `messages` row. It is recorded in `alert_deliveries`.
- A rule's customer-visible **message** action goes through `message.service.send`, gets a `messages`
  row, and inherits opt-out, rate limiting, the reply window, and the automated-mail rules.

`users` gains one nullable column, `alert_phone`, normalised through the existing `lib/phone.ts`. A
user with none is skipped for SMS (FR-077).

**Rationale**: `messages` is customer correspondence attached to a ticket and read by the Phase 5
timeline, which Clarifications Q3 fixed as correspondence only and which Phase 8 will build a
customer-facing view on. Writing "your SLA breached" to an agent into that table would put internal
operational traffic inside the structure whose safety property is that it contains nothing internal.
The adapter contract already takes a bare `recipientIdentity`, so no new transport is needed.

`alert_phone` rather than `phone` because it is not a profile field, is never shown to a customer, and
Phase 12 should not inherit it as a contact directory.

---

## D14 — Competency is a join table over the existing category taxonomy

**Decision**: `user_competencies(user_id, category)` — a flat set, no levels, no weights. Routing:
eligible ∧ competent in `ticket.category`, tie-broken by load, falling back to least-loaded across all
eligible agents when nobody is competent (FR-044b).

**Rationale**: Clarifications Q3. Categories are already a fixed code enumeration
(`tickets/taxonomy.ts`) that this organisation classifies work by, so competency needs no second
taxonomy, no management screen for the skill list itself, and no teams. The fallback is what stops a
missing competency record from silently parking tickets.

Storage is a join table rather than a JSON column on `users` because the routing query filters by it
(`WHERE category = ?`), which is exactly what a JSON column is bad at.

---

## D15 — Configuration is rows; only two knobs are environment

**Decision**: SLA policies, the business calendar, the assignment policy, alert subscriptions, and
automation rules are all **database rows**, editable at runtime by an administrator. The environment
gains only `SLA_WARNING_LEAD_MINUTES` (default 60) and `AUTOMATION_MAX_DEPTH` (default 3), plus
`ALERT_MAX_PER_RECIPIENT_PER_HOUR` (default 20) for the FR-078 ceiling.

**Rationale**: PLAN.md's scope bullet is "SLA policy *configuration*", and FR-001, FR-026, FR-043,
FR-054, and FR-079 all require runtime editability with audit. An environment variable is neither
editable by an administrator nor auditable. The two that stay in the environment are operational
tuning that no screen exposes, matching Phase 4's `DUE_WARNING_LEAD_MINUTES` precedent.

Alert ceilings reuse `lib/rate-limit.ts` (Phase 5), keyed by `alert:{userId}`, inheriting its stated
per-process limit unchanged.

---

## Open questions carried into implementation

None blocking. Two things are deliberately left to `/speckit-tasks` and the implementation:

1. **The exact policy precedence order** (FR-013). The intended order is
   `priority + category` → `priority` → `category` → catch-all, with the most recently updated policy
   winning a tie between two policies of identical specificity. It must be declared in one place and
   covered by a test that enumerates all four specificity levels.
2. **Whether the dry-run (FR-066) samples the last N tickets or a date window.** N = 50 most recent
   non-merged tickets is the starting point; it is a tuning question, not a design one.
