# `backend/src/reporting/`

Query construction and figure presentation. **Never business rules.**

The same role `src/portal/` plays for Phase 8 and `src/ai/` for Phase 9: a small set of declarations
and helpers that the services in `src/services/` import, rather than a layer of its own.

## What belongs here

| File             | Holds                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `period.ts`      | A requested date range → resolved UTC bounds, in the calendar's timezone  |
| `filters.ts`     | The one filter shape every report accepts, validated against the taxonomy |
| `figure.ts`      | The `Figure<T>` envelope every reported number is returned in             |
| `suppression.ts` | The small-sample floor, declared once                                     |
| `sources.ts`     | **The only module that names a table owned by another phase**             |

## What does NOT belong here

- **Business rules.** SLA state, working-hour arithmetic, the ticket lifecycle and the taxonomy are
  owned by other phases and are _called_, never restated (FR-007). `sources.ts` lists the owners.
- **Controllers or routes.** Those live in `controllers/reports/` and `routes/reports/`.
- **Anything that writes to an operational record.** Reporting is read-only (FR-064), and
  `backend/tests/reports/read-only.test.ts` asserts it.

## Why `sources.ts` exists

Reporting is the first thing in this codebase that legitimately reads across every phase, and that
coupling cannot be removed — an SLA compliance figure genuinely needs `ticket_sla`, `tickets`,
`business_calendars` and `users` together.

What it can be is **reviewable**. Concentrating every foreign table name in one file means SC-025's
verification — that SLA state, working hours and the lifecycle are read from their owning services — is
a one-file read rather than a search across six services.

It is also the single place a Phase 12 department predicate will need to land.
