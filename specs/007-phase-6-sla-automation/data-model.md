# Phase 1 Data Model: Phase 6 — SLA & Automation

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31

Ten new tables, two new columns, one declaration change. Every table is MySQL 8.4,
`utf8mb4_0900_ai_ci`, `INT UNSIGNED` surrogate keys, `created_at` / `updated_at` in snake_case, and
migrations named `20260831NNNNNN-*.cjs` — the conventions Phases 0–5 established without exception.

Where a column exists to make a requirement structurally true rather than merely checked, the reason
is written beside it. Those comments belong in the migration and the model, not only here.

---

## Changes to existing tables

### `tickets` — one new column

| Column | Type | Notes |
| --- | --- | --- |
| `due_source` | `ENUM('policy','manual') NOT NULL DEFAULT 'manual'` | Who put the value in `due_at`. **The backfill leaves every existing row `'manual'`**, which is FR-024c: dates set by hand in Phase 4 are human overrides, not machine values to replace (D6). |

`due_at` itself is unchanged, and that is the point (D6). Phase 4's queue sort, overdue filter,
overdue indicator, and approaching-due warning all read `due_at` and are not touched by this phase.

### `users` — one new column

| Column | Type | Notes |
| --- | --- | --- |
| `alert_phone` | `VARCHAR(32) NULL` | Normalised through `lib/phone.ts` on write. **Not a profile field**, never shown to a customer, and not a contact directory Phase 12 should inherit. Null means SMS alerts are skipped for this user (FR-077), not that the alert failed (D13). |

### `tickets/lifecycle.ts` — one new edge

```
new: [
  { to: 'open',      permission: 'tickets:transition' },
  { to: 'escalated', permission: 'tickets:transition' },   // NEW (D11)
]
```

Fourteen edges of 36 ordered pairs. The generated transition test regenerates from this declaration,
so the only other change is its expected-count assertion.

---

## `sla_policies`

One named service commitment. Rows, not code, because FR-001 requires runtime editability with audit
(D15).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `name` | `VARCHAR(120) NOT NULL` | The administrator's own label. Presented as stored; the *default* policies' names are seeded per locale via `name_ar` so a fresh install is not English-only (FR-004). |
| `name_ar` | `VARCHAR(120) NULL` | Set for seeded defaults, optional for user-created policies, which fall back to `name`. |
| `priority` | `VARCHAR(20) NULL` | Null = any priority. Validated against `TICKET_PRIORITIES`. |
| `category` | `VARCHAR(30) NULL` | Null = any category. Validated against `TICKET_CATEGORIES`. |
| `response_minutes` | `INT UNSIGNED NOT NULL` | Working minutes (D2). Positive (FR-008). |
| `resolution_minutes` | `INT UNSIGNED NOT NULL` | Working minutes. `>= response_minutes` (FR-008). |
| `is_active` | `BOOLEAN NOT NULL DEFAULT TRUE` | Deactivation is the only removal (FR-005, FR-019). |
| `specificity` | `TINYINT UNSIGNED NOT NULL` | Derived on write: 3 = priority+category, 2 = priority, 1 = category, 0 = catch-all. **Stored rather than computed at match time** so precedence is a single `ORDER BY specificity DESC, updated_at DESC` and cannot drift between the matcher and the screen that explains it (FR-013). |
| `created_by_user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. |
| `version` | `INT UNSIGNED NOT NULL DEFAULT 0` | Optimistic locking, per the Phase 2 precedent. |

**Indexes**: `(is_active, specificity)`, `(priority, category)`.

**No unique constraint on `(priority, category)`.** Two policies may overlap; precedence resolves it
(FR-013). Forbidding overlap would mean an administrator cannot add a temporary override without
deleting the standing one.

**NO DESTROY PATH.** FR-019. Deactivate instead.

## `business_calendars`

One row, in practice. The table exists rather than a settings blob because it is audited configuration
with typed columns and per-day hours (FR-026).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `name` | `VARCHAR(120) NOT NULL` | |
| `time_zone` | `VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo'` | An IANA zone name. Validated on write by round-tripping it through `Intl.DateTimeFormat`, so an unknown zone is refused at the API rather than throwing inside a sweep. |
| `working_days` | `TINYINT UNSIGNED NOT NULL DEFAULT 62` | A 7-bit mask, Sunday = bit 0. 62 = Sun–Thu. A mask rather than seven booleans because every consumer wants the set, and a mask makes "no working days" (0) a single check the validator can refuse. |
| `day_start_minute` | `SMALLINT UNSIGNED NOT NULL DEFAULT 540` | 09:00, as minutes from local midnight. |
| `day_end_minute` | `SMALLINT UNSIGNED NOT NULL DEFAULT 1020` | 17:00. `> day_start_minute`. |
| `is_active` | `BOOLEAN NOT NULL DEFAULT TRUE` | Exactly one active row, enforced in the service. |
| `updated_by_user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. |
| `version` | `INT UNSIGNED NOT NULL DEFAULT 0` | |

**Minutes-from-midnight rather than a `TIME` column** because the arithmetic in
`lib/business-hours.ts` works in minutes, and a `TIME` round-tripped through Sequelize arrives as a
string that every caller would have to parse identically.

## `calendar_exceptions`

Dated non-working days (FR-027). Separate from `business_calendars` because it is a growing list, not
a setting.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `calendar_id` | `INT UNSIGNED NOT NULL` | FK `business_calendars`, `ON DELETE CASCADE`. |
| `exception_date` | `DATE NOT NULL` | A local date in the calendar's zone, not an instant. |
| `label` | `VARCHAR(120) NULL` | "Eid al-Fitr". Display only. |

**Unique**: `(calendar_id, exception_date)`. **Index**: `(calendar_id, exception_date)` covers the
range scan the arithmetic performs.

**Only full non-working days.** Half-days were considered and rejected as unrequested complexity: the
requirement is FR-027, "a public holiday does not consume a target".

## `ticket_sla`

The per-ticket clock (D1). One row per ticket **that matched a policy** — a ticket matching none has
no row, which is FR-014 made structural rather than checked.

| Column | Type | Notes |
| --- | --- | --- |
| `ticket_id` | `INT UNSIGNED PK` | FK `tickets`, `ON DELETE CASCADE`. Primary key, not a surrogate: one row per ticket, enforced by the schema. |
| `policy_id` | `INT UNSIGNED NULL` | FK `sla_policies`, `ON DELETE SET NULL`. FR-012. Null only if a policy was hard-deleted, which FR-019 forbids — kept nullable so a manual database repair cannot orphan a ticket. |
| `started_at` | `DATETIME NOT NULL` | When the clock began. The ticket's creation time, or the reopening time (FR-030). |
| `response_target_at` | `DATETIME NULL` | Absolute, stored (FR-029). |
| `resolution_target_at` | `DATETIME NULL` | Absolute, stored. Mirrored into `tickets.due_at` while `due_source = 'policy'` (D6). |
| `response_satisfied_at` | `DATETIME NULL` | Set by the first outbound customer-visible message (FR-015). **Once set, never cleared** — FR-016 by construction, not by a guard. |
| `resolution_satisfied_at` | `DATETIME NULL` | Set on transition into `resolved` or `closed`. |
| `response_breached_at` | `DATETIME NULL` | Recorded outcome, for Phase 10 (FR-018 makes the stored outcome the record). |
| `resolution_breached_at` | `DATETIME NULL` | |
| `response_warned_for` | `DATETIME NULL` | **Holds the target value warned about**, not a flag and not the warn time (D4). |
| `resolution_warned_for` | `DATETIME NULL` | |
| `resolution_escalated_for` | `DATETIME NULL` | Holds the target value escalated for. FR-034, FR-042, and FR-030 all fall out of this one column being a value rather than a boolean. |
| `paused_at` | `DATETIME NULL` | Non-null = the clock is stopped and the sweep skips this row (FR-021, D3). |
| `response_remaining_ms` | `INT UNSIGNED NULL` | Working milliseconds left, captured at pause. |
| `resolution_remaining_ms` | `INT UNSIGNED NULL` | |
| `total_paused_ms` | `BIGINT UNSIGNED NOT NULL DEFAULT 0` | **Display only.** Never used in arithmetic — the target is rewritten at resume instead, which is what makes FR-022's "exactly once" structural (D3). |

**Indexes**: `(resolution_target_at, paused_at)` and `(response_target_at, paused_at)` — the two the
sweep uses; `(policy_id)`.

**The sweep's predicate**, written as a Sequelize `literal` for the reason `ticket-due.service.ts`
already documents:

```sql
resolution_target_at IS NOT NULL
AND resolution_target_at <= :now
AND paused_at IS NULL
AND resolution_satisfied_at IS NULL
AND (resolution_escalated_for IS NULL
     OR resolution_escalated_for <> resolution_target_at)
```

**No `is_breached` boolean.** Breach is `target < now AND satisfied_at IS NULL`, and a denormalised
flag would need maintaining at every one of the seven events that move a target.

## `assignment_settings`

Single-row configuration (FR-043). A table rather than env because FR-043 requires runtime editability
and FR-044d requires audit.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `strategy` | `ENUM('off','round_robin','least_loaded','competency') NOT NULL DEFAULT 'off'` | `'off'` is a strategy, not a null — FR-043 requires turning it off, and an enum member cannot be forgotten by a caller the way a null check can. |
| `max_open_per_agent` | `SMALLINT UNSIGNED NULL` | Null = no ceiling (FR-047). |
| `round_robin_cursor_user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. Advanced in the same transaction as the assignment. **Stored, not derived**: deriving it from the last auto-assigned ticket breaks on reassignment and merge, and FR-046 requires determinism (D12). |
| `updated_by_user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. |
| `version` | `INT UNSIGNED NOT NULL DEFAULT 0` | |

## `user_competencies`

The flat competency set (D14, FR-044a, FR-044c).

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `INT UNSIGNED NOT NULL` | FK `users`, `ON DELETE CASCADE`. |
| `category` | `VARCHAR(30) NOT NULL` | Validated against `TICKET_CATEGORIES`. |

**Primary key**: `(user_id, category)` — a set, so a duplicate is impossible rather than deduplicated.
**Index**: `(category)` for the routing query.

**No level, weight, or team column.** FR-044c, and Phase 12 owns the reopening.

## `automation_rules`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `name` | `VARCHAR(120) NOT NULL` | |
| `trigger_key` | `VARCHAR(60) NOT NULL` | Validated against the catalog on write (D9). |
| `conditions_json` | `JSON NOT NULL` | `[{ field, operator, value }]`. Empty array = always (FR-055). Every entry validated against the catalog on write, so the executor can trust its input. |
| `actions_json` | `JSON NOT NULL` | `[{ action, params }]`. At least one (FR-055). |
| `is_enabled` | `BOOLEAN NOT NULL DEFAULT FALSE` | **Defaults to off.** A rule created and not yet tested must not fire (FR-066's dry-run exists to be used first). |
| `run_order` | `SMALLINT UNSIGNED NOT NULL` | A single global sequence (FR-060, spec Assumptions). Reordering rewrites the affected rows in one transaction. |
| `created_by_user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. **The configuring user FR-086 attributes automated acts to in the audit log** — which is why it is captured at creation rather than read from the current session. |
| `version` | `INT UNSIGNED NOT NULL DEFAULT 0` | |

**Index**: `(is_enabled, trigger_key, run_order)` — the executor's only lookup.

**Rules are hard-deletable** (FR-054), and `automation_runs` does **not** cascade (FR-070): the record
of what a rule did outlives the rule.

## `automation_runs`

The answerability record (FR-067, User Story 7).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `rule_id` | `INT UNSIGNED NULL` | FK `automation_rules`, **`ON DELETE SET NULL`** — FR-070. |
| `rule_name` | `VARCHAR(120) NOT NULL` | **Denormalised deliberately.** A deleted or renamed rule must still be identifiable in the record; the FK alone cannot survive FR-070. |
| `trigger_key` | `VARCHAR(60) NOT NULL` | |
| `ticket_id` | `INT UNSIGNED NULL` | FK `tickets`, `ON DELETE SET NULL`. |
| `outcome` | `ENUM('acted','no_match','suppressed','failed') NOT NULL` | FR-067 names all four. `no_match` is recorded, not discarded — User Story 4 scenario 2 requires a non-match to be visibly not an error. |
| `detail` | `TEXT NULL` | The suppression reason or the failure reason. An i18n key plus parameters where the interface renders it; never a stack trace. |
| `actions_applied` | `JSON NULL` | What actually happened, per action — so a partially failed rule (FR-065) is legible. |
| `depth` | `TINYINT UNSIGNED NOT NULL DEFAULT 0` | Which cascade level this ran at. Makes a suppressed cycle readable rather than merely reported. |
| `created_at` | `DATETIME NOT NULL` | |

**Indexes**: `(rule_id, created_at)`, `(ticket_id, created_at)`, `(created_at)`.

**No destroy path**, following the audit log: bounded by paging, retained (spec Assumptions).

## `alert_subscriptions`

Which events reach whom, over what (FR-079).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `event_key` | `VARCHAR(60) NOT NULL` | `sla.response_at_risk`, `sla.resolution_breached`, `assignment.failed`, … |
| `recipient_kind` | `ENUM('assignee','role') NOT NULL` | Not a user id: FR-041's audience is "the assignee plus supervisory recipients", and naming individuals would break the moment someone changes job. |
| `role_id` | `INT UNSIGNED NULL` | FK `roles`, `ON DELETE CASCADE`. Required when `recipient_kind = 'role'`. |
| `in_app` | `BOOLEAN NOT NULL DEFAULT TRUE` | |
| `by_email` | `BOOLEAN NOT NULL DEFAULT FALSE` | |
| `by_sms` | `BOOLEAN NOT NULL DEFAULT FALSE` | |

**Unique**: `(event_key, recipient_kind, role_id)`.

**`in_app` is stored but cannot be turned off** — the service always creates the in-app notification
(FR-073), and the column exists so the screen can show it as an always-on, disabled control rather
than hiding a transport that is silently different from the others.

## `alert_deliveries`

One attempt, one row (FR-076).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `event_key` | `VARCHAR(60) NOT NULL` | |
| `ticket_id` | `INT UNSIGNED NULL` | FK `tickets`, `ON DELETE SET NULL`. |
| `user_id` | `INT UNSIGNED NULL` | FK `users`, `ON DELETE SET NULL`. Null when the recipient was a customer. |
| `customer_id` | `INT UNSIGNED NULL` | FK `customers`, `ON DELETE SET NULL`. |
| `transport` | `ENUM('in_app','email','sms') NOT NULL` | |
| `outcome` | `ENUM('delivered','skipped','suppressed','failed') NOT NULL` | `skipped` = no reachable address (FR-077); `suppressed` = the ceiling (FR-078); `failed` = the transport refused (FR-076). **Four values because "nobody was told" and "we tried and the gateway refused" must be distinguishable**, which is FR-076 verbatim. |
| `detail` | `VARCHAR(255) NULL` | The transport's own reason. Never a credential. |
| `created_at` | `DATETIME NOT NULL` | |

**Indexes**: `(event_key, created_at)`, `(user_id, created_at)` — the second is what the FR-078
ceiling would query if the in-process limiter were ever replaced by a shared store.

---

## Additions to existing declarations

### `auth/permissions.ts` — four new keys

```
define('sla',        'manage')   // policies AND the business calendar
define('assignment', 'manage')   // strategy, ceiling, AND agent competencies
define('automation', 'manage')   // rules: CRUD, enable, reorder, dry-run
define('automation', 'view')     // the automation record
```

Two deliberate merges, recorded so they are not read as oversights:

- **`sla:manage` covers the calendar.** A policy expressed in working hours and the definition of a
  working hour are one administrator's single concern; granting either without the other produces a
  configuration nobody can reason about.
- **`assignment:manage` covers competencies.** Competency exists only to serve routing (D14), so
  routing authority is one permission. Granting "may edit who is competent" separately from "may
  choose the routing strategy" would let a holder of the first silently redirect work.

`assignment:manage` is additionally conditioned on `tickets:assign` in the service (FR-051): configuring
automatic assignment is self-assignment by a longer route, so an agent must not hold it.

**No `sla:view` key.** A ticket's SLA state rides on `tickets:view` and is returned with the ticket —
the same reasoning that kept `notifications:view` out of Phase 4's catalog and `timeline:view` out of
Phase 5's.

### `models/notification.model.ts` — three new types

```
SLA_AT_RISK:        'sla.at_risk'
SLA_BREACHED:       'sla.breached'
ASSIGNMENT_FAILED:  'assignment.failed'
```

No new columns: all three reference a ticket, which the table already carries. Automatic assignment
reuses the existing `ticket.assigned` type, because FR-050 requires it to produce the same downstream
effects as a manual one.

### `services/ticket-history.service.ts` — five new events

```
SLA_TARGET_SET:      'ticket.sla.target_set'
SLA_TARGET_CHANGED:  'ticket.sla.target_changed'
SLA_BREACHED:        'ticket.sla.breached'
SLA_CLOCK_PAUSED:    'ticket.sla.paused'
SLA_CLOCK_RESUMED:   'ticket.sla.resumed'
```

Automated escalations and assignments reuse the existing `ESCALATED` and `ASSIGNED` events with
`SYSTEM_ACTOR` (FR-039) — a separate "escalated by policy" event would fork the timeline for one
reader and duplicate it for every other.

### `services/audit.service.ts` — new actions

```
SLA_POLICY_CREATED / _UPDATED / _ACTIVATED / _DEACTIVATED
CALENDAR_UPDATED
ASSIGNMENT_SETTINGS_UPDATED
USER_COMPETENCIES_CHANGED
AUTOMATION_RULE_CREATED / _UPDATED / _ENABLED / _DISABLED / _DELETED / _REORDERED
TICKET_ESCALATED                  // reused; actor_user_id NULL for a policy escalation
```

Rule *runs* are not audited individually — `automation_runs` is their record, and flooding the log an
investigator reads is the failure Phase 4 explicitly avoided when it declined to audit ordinary note
and task activity.

---

## Seeded data

| Seeder | Contents |
| --- | --- |
| `20260831000001-sla-permissions.cjs` | The four new keys granted to Administrator; `automation:view` additionally to Supervisor. Agents receive none — FR-051. |
| `20260831000002-default-calendar.cjs` | One active calendar: Sun–Thu, 09:00–17:00, `Africa/Cairo` (Clarifications Q1). No exceptions — a holiday list is organisation-specific and must not be guessed. |
| `20260831000003-default-sla-policies.cjs` | Four policies, one per priority, per spec FR-009: urgent 60/240, high 240/480, normal 480/1440, low 480/2400 working minutes. Bilingual names. All active. |
| `20260831000004-default-alert-subscriptions.cjs` | `sla.resolution_breached` → assignee (in-app) + Supervisor role (in-app + email); `sla.*_at_risk` → assignee (in-app); `assignment.failed` → Supervisor role (in-app + email). Email defaults on for the supervisory rows and off elsewhere, so a fresh install alerts without shouting. |

Assignment settings are seeded as **`strategy = 'off'`**. Automatic assignment changes who does the
work, and a fresh installation must not start redistributing tickets before an administrator has
chosen to.

---

## State transitions

### The SLA clock

```
(no row)  ── ticket created, a policy matches ──▶  running
running   ── priority/category changed ─────────▶  running   (targets recomputed, FR-017)
running   ── first outbound message ────────────▶  running   (response_satisfied_at set, never cleared)
running   ── status → pending ──────────────────▶  paused    (remaining_ms captured, D3)
paused    ── status → new/open/escalated ───────▶  running   (target = now + remaining)
running   ── status → resolved/closed ──────────▶  satisfied (resolution_satisfied_at set)
satisfied ── ticket reopened ───────────────────▶  running   (fresh target, FR-030; markers re-armed by value, D4)
any       ── ticket merged ─────────────────────▶  dormant   (excluded from every sweep, FR-031)
```

`escalated` is an **active** status, not a terminal one: a breached ticket's clock keeps running so a
second breach of a re-armed target is still detectable, and Phase 3 already declares
`escalated → open/pending/resolved`.

### A rule run

```
event emitted (afterCommit)
  → rules for trigger, ordered by run_order
      → conditions evaluated  ──not all true──▶  run recorded: no_match
      → depth > MAX or (rule,ticket) seen ────▶  run recorded: suppressed
      → actions executed through services
            all succeed ────────────────────▶  run recorded: acted
            some fail ─────────────────────▶  run recorded: acted, actions_applied names the failures
            all fail ──────────────────────▶  run recorded: failed
      → each successful action may emit its own event at depth + 1
```

Nothing in this diagram can throw into the caller. FR-071 is a `try/catch` around the whole
`afterCommit` body, with the failure recorded and logged.
