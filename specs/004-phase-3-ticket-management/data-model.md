# Data Model: Phase 3 — Ticket Management (Core)

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

Derived from the spec's Key Entities. Phase 3 adds **three tables** and changes nothing existing.
Every table is `utf8mb4` / `utf8mb4_0900_ai_ci`, inherited from the database default.

Per Clarifications Q1 there are no category or priority tables — both are code enumerations
(research.md D6).

---

## `tickets`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `reference` | `VARCHAR(20)` | **UNIQUE**, NOT NULL | `TKT-000123`, derived from `id` (research.md D5). Unique by construction, with nothing to contend over |
| `customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE RESTRICT` | Permanent: Phase 2 chose deactivation over deletion precisely so this reference cannot dangle |
| `subject` | `VARCHAR(255)` | NOT NULL | Arabic-safe |
| `description` | `TEXT` | NULL | The longest free text this system accepts |
| `category` | `VARCHAR(30)` | NOT NULL | A key from the code taxonomy — never a display label |
| `priority` | `VARCHAR(20)` | NOT NULL | Likewise |
| `status` | `VARCHAR(20)` | NOT NULL, default `new` | One of six; legality of change is decided by the lifecycle table, not by this column |
| `assignee_user_id` | `INTEGER UNSIGNED` | NULL, FK → `users.id`, `ON DELETE RESTRICT` | Null means unassigned. Restrict, so a user with tickets cannot be hard-deleted — users deactivate, they do not disappear |
| `created_by_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | FR-005 |
| `merged_into_ticket_id` | `INTEGER UNSIGNED` | NULL, FK → `tickets.id` | Non-null means merged; the ticket is a redirect and is unworkable (FR-042, FR-043) |
| `escalation_reason` | `TEXT` | NULL | The current escalation's reason; the full history of escalations lives in `ticket_history` |
| `version` | `INTEGER UNSIGNED` | NOT NULL, default `0` | Optimistic locking (FR-010) |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Indexes**: unique on `reference`; `customer_id`; `assignee_user_id`; `status`; `priority`;
composite `(status, priority)` for the common "open work, most urgent first" listing; and
`merged_into_ticket_id`.

**Validation** (service layer):

- `subject`, `category`, and `priority` are required (FR-006); `description` is optional.
- `category` and `priority` must be keys the code taxonomy defines — an unknown value is a validation
  error, not a stored string.
- A ticket cannot be created against a **deactivated** customer (FR-007), though an existing ticket
  stays workable if its customer is later deactivated (FR-008).
- Editing is refused when `status = 'closed'` (FR-009) or `merged_into_ticket_id` is set (FR-043).
  **Both checks live in the service**, so every route inherits them.

**No delete path.** Tickets are merged or closed, never deleted. `record.deleted` is emitted on
merge as the security-relevant fact (research.md D8), but the row is retained so every reference to
it stays valid.

---

## `ticket_history`

Append-only. **Separate from `audit_logs` on purpose** (research.md D2): this is read routinely by
anyone who can view the ticket, while the audit log is `audit:view` only. Reconciling those two
access rules inside one store would mean every audit query carries a visibility condition, and the
failure direction is leaking administrative events to an agent.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `BIGINT UNSIGNED` | PK, auto-increment | Grows with ticket volume |
| `ticket_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `tickets.id`, `ON DELETE CASCADE` | The ticket the event happened **to**. Never rewritten on merge — provenance is the point (D3) |
| `event` | `VARCHAR(50)` | NOT NULL | `ticket.created`, `ticket.status.changed`, `ticket.assigned`, `ticket.escalated`, `ticket.merged`, … |
| `actor_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | Every ticket event has an authenticated actor |
| `actor_name` | `VARCHAR(255)` | NOT NULL | Captured at the time, so an entry stays attributed and readable when the actor is later deactivated (FR-038) |
| `field` | `VARCHAR(50)` | NULL | Which field changed, for edit events |
| `previous_value` | `TEXT` | NULL | FR-033 |
| `new_value` | `TEXT` | NULL | FR-033 |
| `note` | `TEXT` | NULL | Free text the event carries — an escalation reason, a merge explanation |
| `created_at` | `DATETIME` | NOT NULL | No `updated_at`: an append-only row is never updated |

**Indexes**: composite `(ticket_id, created_at)`, and `(ticket_id, id)` — `id` is the tiebreaker
because MySQL `DATETIME` is second-precision and several events routinely land in the same second, as
Phase 2 discovered with notes.

**Ordering is oldest first** (FR-035), so a ticket reads as a story rather than a stack. That is the
opposite of the audit log and of customer notes, both newest-first, and it is deliberate: those are
scanned for the latest event, this is read from the beginning to understand what happened.

**Append-only** is enforced by the absence of a write path — no update or destroy method, no
endpoint (FR-034), the same posture `audit_logs` took in Phase 1.

**Contains no credential** (FR-039). The events are domain changes, but the same deny-list redaction
the audit writer uses is applied, because `note` accepts free text.

---

## `ticket_links`

A symmetric relationship between two distinct tickets that bear on each other without either losing
its identity (FR-047).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `ticket_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `tickets.id`, cascade | |
| `linked_ticket_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `tickets.id`, cascade | |
| `created_by_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | |
| `created_at` | `DATETIME` | NOT NULL | |

**Indexes**: composite **UNIQUE** on `(ticket_id, linked_ticket_id)`; plus an index on
`linked_ticket_id` so the reverse lookup is cheap.

**Stored as a single row per pair, normalised so the lower id is always `ticket_id`.** The
relationship is symmetric, so storing both directions would double the rows and create the
possibility of the two halves disagreeing. Normalising on write means the unique index alone prevents
duplicate links in either direction (FR-048) — no application check to forget.

**Self-links are refused** in the service before any write (FR-048).

---

## The lifecycle table

**Code, not schema** — `backend/src/tickets/lifecycle.ts` (research.md D1). This is the phase's
central declaration, read by the enforcement service, by the endpoint that tells the interface which
moves to offer, and by the generated transition test.

| From | May move to | Permission required |
|---|---|---|
| `new` | `open` | `tickets:transition` |
| `open` | `pending`, `escalated`, `resolved` | `tickets:transition` |
| `pending` | `open`, `escalated`, `resolved` | `tickets:transition` |
| `escalated` | `open`, `pending`, `resolved` | `tickets:transition` |
| `resolved` | `open`, `closed` | `open` needs `tickets:transition`; `closed` needs `tickets:close` |
| `closed` | `open` | `tickets:reopen` — Supervisor-only (Clarifications Q2) |

Reading the requirements off this table:

- **New cannot reach Resolved** (FR-018) — nothing is resolved before anyone opened it.
- **Closed is reachable only from Resolved** (FR-019).
- **Escalated is not a dead end** (FR-030) — it reaches Resolved directly.
- **Reopening is a distinct authority** (FR-020, Q2), which is why `closed → open` carries a
  different permission from every other edge.
- **Any pair not listed is forbidden.** The default is refusal, so adding a status without deciding
  its edges produces a ticket that cannot move rather than one that can move anywhere.

There are **36 ordered pairs** across six statuses; 13 are permitted and 23 are not. The generated
test walks all 36.

---

## Taxonomy

**Code, not schema** — `backend/src/tickets/taxonomy.ts` (Clarifications Q1, research.md D6).

| Categories | Priorities | Rank |
|---|---|---|
| `general` | `low` | 1 |
| `technical` | `normal` | 2 |
| `billing` | `high` | 3 |
| `complaint` | `urgent` | 4 |

Both are stored as their key and rendered from an i18n key (`ticket.category.billing`,
`ticket.priority.urgent`), so a category name is never an untranslated English string in an Arabic
interface.

**Priority carries a numeric rank** because sorting by urgency is a real requirement — and
alphabetical order would put `urgent` below `normal`, which is exactly wrong.

**No management interface exists** (Q1). If a later phase needs Administrator-managed categories,
that is an additive migration plus a screen; nothing built here blocks it and nothing anticipates it.

---

## Permission catalog additions

Nine entries added to `backend/src/auth/permissions.ts`. Code, not schema, so a later module needs no
migration.

| Key | Held by |
|---|---|
| `tickets:view` | agent, supervisor, admin |
| `tickets:create` | agent, supervisor, admin |
| `tickets:update` | agent, supervisor, admin |
| `tickets:transition` | agent, supervisor, admin |
| `tickets:close` | agent, supervisor, admin — **conditional on assignment** |
| `tickets:link` | agent, supervisor, admin |
| `tickets:assign` | **supervisor, admin only** (Q3) |
| `tickets:reopen` | **supervisor, admin only** (Q2) |
| `tickets:merge` | supervisor, admin |
| `tickets:manage_any` | supervisor, admin — act on a ticket assigned to someone else |

`tickets:close` is **conditional**, like `notes:manage` in Phase 2: the route requires
`tickets:close`, and the service additionally requires `tickets:manage_any` when the ticket belongs
to someone else. It is declared in the matrix test's `CONDITIONAL_PERMISSIONS` and must name the test
that covers it.

**There is no self-assign or claim permission** (Q3). An Agent cannot assign a ticket to anyone,
including themselves — which is why Phase 4's dashboard is read-only with respect to assignment.

---

## Audit actions

New keys, alongside the ticket's own history (FR-052 requires both):

| Event | Audit action |
|---|---|
| Ticket created | `ticket.created` |
| Status changed | `ticket.status.changed` |
| Assigned / unassigned | `ticket.assigned` / `ticket.unassigned` |
| Escalated / de-escalated | `ticket.escalated` / `ticket.deescalated` |
| Closed / reopened | `ticket.closed` / `ticket.reopened` |
| Linked / unlinked | `ticket.linked` / `ticket.unlinked` |
| Merged | `ticket.merged` **and `record.deleted`** |

**`record.deleted` finally has a caller.** Phase 1 defined it; Phase 2 carried it forward when
deletion was ruled out. Merge matches what the key means — a record a user created is permanently
removed from active use — so both are emitted: `record.deleted` for the security-relevant fact and
`ticket.merged` for the domain detail (research.md D8).

Every state-changing audit write shares the transaction of the change it records, as since Phase 1.
The ticket-history write joins the same transaction, so the two cannot diverge.

---

## Entity relationships

```text
customers 1 ──── * tickets              (RESTRICT — customers are never deleted anyway)
users     1 ──── * tickets              (assignee, nullable)
users     1 ──── * tickets              (creator)
tickets   1 ──── * ticket_history       (cascade)
tickets   1 ──── * ticket_links         (both sides)
tickets   0..1 ── * tickets             (merged_into — a redirect, resolved transitively)
```

---

## State transitions

### Ticket status

```text
new ──────────> open
open ─────────> pending | escalated | resolved
pending ──────> open | escalated | resolved
escalated ────> open | pending | resolved
resolved ─────> open | closed
closed ───────> open        (Supervisor only)
```

Every other pair is refused, and the refusal names the reachable set rather than only saying no.

### Merge

```text
active ──merged into another──> merged (a redirect; unworkable by every route)
merged ──target itself merged──> still resolves, transitively, to one survivor
```

There is no un-merge in this phase. A merge is irreversible, which is part of why `record.deleted` is
the honest audit key for it.

### Assignment

```text
unassigned ──Supervisor assigns──> assigned
assigned ──Supervisor reassigns──> assigned to someone else
assigned ──Supervisor unassigns──> unassigned
```

No transition here is available to an Agent (Q3).
