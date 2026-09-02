# Data Model: Phase 10 — Reports & Management

**Feature**: `011-phase-10-reports-management` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**One new table, seven new indexes, zero new columns on existing tables, and no changes to any existing
column.** That ratio is the point: a reporting phase that needed new operational columns would be
admitting the earlier phases had not recorded what they should.

---

## What this phase does NOT add, and why

Recorded first because the absences are the design.

| Not added                       | Why                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A summary or rollup table       | Reintroduces the staleness Clarifications Q3 rejected, and a stale summary is the phase's central hazard in its purest form — a wrong number that looks right and never errors. |
| A period-snapshot table         | Clarifications Q3 chose current state. A snapshot that is subtly wrong is undetectable afterwards.                                                |
| A report-definition table       | The six reports are code. Storing definitions is the first half of a report builder, which is out of scope.                                       |
| A materialised view or cache    | D1 establishes the figures are countable from indexed columns. Caching would trade a solved problem for an unsolved one.                          |
| Any new instrumentation of staff | FR-035. Reporting on what is already recorded is in scope; recording more in order to report on it is not.                                        |
| An `elapsed_working_ms` column  | It would make D3's omitted average computable — and it belongs to Phase 6, which owns the arithmetic. Open Question 2.                            |

---

## New table: `dashboard_arrangements`

One row per user, holding their own dashboard layout (FR-040).

| Column       | Type               | Null | Notes                                                                 |
| ------------ | ------------------ | ---- | --------------------------------------------------------------------- |
| `id`         | INT UNSIGNED PK    | no   |                                                                       |
| `user_id`    | INT UNSIGNED FK    | no   | **UNIQUE.** `users.id`, CASCADE on delete.                            |
| `layout`     | JSON               | no   | Ordered list of figure keys the user has chosen.                      |
| `created_at` | DATETIME           | no   |                                                                       |
| `updated_at` | DATETIME           | no   |                                                                       |

**Invariants**

- `UNIQUE(user_id)` — one arrangement per person. FR-040's "belongs only to them" is a schema fact, so
  there is no path by which one manager's layout could become another's.
- CASCADE on user delete: an arrangement has no meaning without its owner, and it is not a record
  anybody would want retained.
- **`layout` holds figure KEYS, never queries, filters or thresholds.** A user arranging their dashboard
  must not be able to define what a figure means — that would make the layout a report definition, and
  a figure whose meaning varies per user is unauditable. The keys are validated against the declared
  figure catalog on write, so an unknown key is rejected rather than stored and later ignored.
- **No `is_shared` column and no shared arrangements.** FR-065 says a user rearranging their own
  dashboard needs no audit entry, and that is only safe while an arrangement cannot affect anybody else.
  A shared dashboard would need an audit entry, a permission, and an answer to FR-042 for viewers with
  different authority — three problems bought for a convenience nobody asked for.

**Why a table rather than browser storage.** FR-040 requires the choice to persist for the user's next
visit, which a per-device store does not do — a manager who arranged their dashboard on a desktop and
opens it on a laptop would find it reset, and would reasonably call that a bug.

---

## New indexes on existing tables (D1)

The only schema change the reports themselves require. **No column is added or altered**, so no existing
behaviour can change.

| Table                 | Index                            | Serves                                     |
| --------------------- | -------------------------------- | ------------------------------------------ |
| `tickets`             | `(created_at)`                   | Every date-range filter in the phase       |
| `tickets`             | `(created_at, category)`         | Volume by category                         |
| `tickets`             | `(created_at, source)`           | Volume by channel                          |
| `tickets`             | `(assignee_user_id, created_at)` | Agent volumes within a period              |
| `ticket_sla`          | `(response_breached_at)`         | Response compliance counts                 |
| `ticket_sla`          | `(resolution_breached_at)`       | Resolution compliance counts               |
| `ticket_satisfaction` | `(submitted_at)`                 | CSAT within a period                       |

**Why these and not others.** `tickets` had nine indexes before this phase and not one of them covered
`created_at`, because every previous phase needed to find a working set rather than count a period.
`ticket_satisfaction` had only `(ticket_id)`, which is Phase 8's uniqueness constraint. `ticket_sla`'s
two existing indexes are `(response_target_at, paused_at)` and `(resolution_target_at, paused_at)`,
built for Phase 6's due-date sweep — they answer "what is due" and not "what was breached".

`ticket_history` already has `(ticket_id, created_at)` and needs nothing: D4's current-assignee
attribution means reporting does not walk history at all.

---

## Read model: what each report counts, and from where

No new storage — this is the map from a reported figure to the column that answers it. It is the
substance of `reporting/sources.ts` (D2), recorded here so a reviewer can check the mapping without
reading the query builder.

### Volume and status

| Figure                     | Source                                                     |
| -------------------------- | ---------------------------------------------------------- |
| Received in period         | `tickets.created_at` within resolved bounds                |
| Open at period end         | `tickets.status`, classified via `sla/clock.ts`            |
| By category / channel      | `tickets.category`, `tickets.source`                       |
| Merged handling (FR-017)   | `tickets.merged_into_ticket_id` — counted on the surviving side, once |

### SLA (D3 — recorded outcomes only)

| Figure                     | Source                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Response compliance        | `ticket_sla.response_breached_at` / `response_satisfied_at` |
| Resolution compliance      | `ticket_sla.resolution_breached_at` / `resolution_satisfied_at` |
| Excluded: no policy        | `ticket_sla.policy_id IS NULL` — counted and reported (FR-023) |
| Paused time                | Already excluded when the outcome was recorded. Not recomputed. |
| Average elapsed working time | **Not offered** — cannot be aggregated in SQL (D3, Open Question 2) |

### CSAT

| Figure                     | Source                                                       |
| -------------------------- | ------------------------------------------------------------ |
| Score distribution         | `ticket_satisfaction.score`, 1–5                             |
| Response rate denominator  | Tickets that reached a settled state in the period (FR-027)   |
| Comments                   | `ticket_satisfaction.comment`, with its `ticket_id` (FR-028)  |

### Agent (supervisory only — D11)

| Figure                     | Source                                                        |
| -------------------------- | ------------------------------------------------------------- |
| Attribution                | `tickets.assignee_user_id` — the CURRENT assignee (D4)         |
| Active period (FR-032)     | `users.is_active` and the user's own timestamps               |
| Deactivated agents (FR-033) | Still joined; a deactivated user's historical work is reportable |

### AI (Phase 9 — counts only)

| Figure                     | Source                                                        |
| -------------------------- | ------------------------------------------------------------- |
| Usage, outcomes, cost      | `ai_invocations` — metadata only, which is all Phase 9 keeps    |
| Proposal acceptance rate   | `ai_category_proposals.state`                                 |
| Assistant deflection       | `ai_invocations.outcome = 'refused_ungrounded'`                |
| Prompt / completion content | **Does not exist** — FR-057 requires the report to say so rather than appear to have lost it |

---

## The figure envelope (D10)

Not persisted — the shape every report returns, declared in `reporting/figure.ts`. It is in this
document because it is the phase's most load-bearing structure: six honesty requirements are fields on
one type rather than six things each surface must remember.

```text
Figure {
  value                     the headline number
  count, total              FR-005 — never a bare percentage
  excluded[]                FR-004 — { reason, count }, stated rather than silent
  suppressed                FR-006 / FR-036 — sample too small to characterise
  period, timeZone          FR-003 / D5 — resolved bounds, not a date string
  filters                   FR-003 — what produced this
  computedAt                FR-043 — last SUCCESSFUL computation
  reflectsCurrentState      FR-011a — Clarifications Q3, stated in the payload
}
```

**No field is optional.** A service that has not decided what belongs in `excluded` has to decide,
rather than omitting it and leaving a figure that looks complete. `reflectsCurrentState` is a literal
`true` rather than a computed value: it documents Q3 where a reader will see it, and it is the field a
later snapshot phase would flip rather than having to redefine what every existing figure means.

---

## Relationships

```text
users ──1:0..1── dashboard_arrangements   (UNIQUE user_id, CASCADE)

reporting reads (never writes):
  tickets, ticket_sla, ticket_satisfaction, ticket_history,
  users, customers, messages, ai_invocations, ai_category_proposals,
  business_calendars, sla_policies
```

**Every arrow into reporting is one-directional.** No operational table gains a foreign key to anything
in this phase, and no reporting code writes to an operational table — FR-064, verified by SC-028 rather
than asserted here.

---

## State transitions

None. Nothing in this phase has a lifecycle: a figure is computed and discarded, and an arrangement is
overwritten. The absence is worth stating because every phase since Phase 3 has had a state machine to
get right, and reviewers reasonably look for one.
