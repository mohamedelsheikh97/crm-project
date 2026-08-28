# Contract: Ticket API

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

All routes are mounted under `/api/tickets`, require authentication, and carry a permission enforced
by the route-level `authorize()` middleware. Envelopes follow the shape fixed in Phase 1: success is
`{ "data": ... }`, failure is `{ "error": { "code", "message", "details" } }`. Sibling keys alongside
`error` are permitted (Phase 2 established this with `duplicates`); Phase 3 adds none.

Every state-changing route writes an audit entry **and** a ticket-history entry inside the request's
transaction (FR-052).

---

## Ticket resource

```json
{
  "id": 42,
  "reference": "TKT-000042",
  "subject": "لا يمكنني تسجيل الدخول",
  "description": "...",
  "category": "technical",
  "priority": "high",
  "status": "open",
  "customer": { "id": 7, "displayName": "شركة النور", "isActive": true },
  "assignee": { "id": 3, "name": "Sara", "isActive": true },
  "createdBy": { "id": 2, "name": "Omar" },
  "escalationReason": null,
  "mergedIntoTicketId": null,
  "version": 4,
  "createdAt": "2026-08-28T09:14:00.000Z",
  "updatedAt": "2026-08-28T11:02:00.000Z"
}
```

`category`, `priority`, and `status` are **keys**, never display labels — the interface renders them
through i18n (FR-057). `customer` and `assignee` are summaries, not full records; a ticket list must
not become a customer export.

---

## Endpoints

### `GET /api/tickets`

**Permission**: `tickets:view`

| Query | Meaning |
|---|---|
| `page`, `pageSize` | Pagination, defaults 1 and 20, `pageSize` capped at 100 |
| `q` | Matches reference or subject, accent- and case-insensitive via the collation (FR-024) |
| `status` | Repeatable — `?status=open&status=pending` |
| `priority` | Repeatable |
| `category` | Repeatable |
| `assigneeId` | A user id, or `unassigned` for the null case (FR-027) |
| `customerId` | Tickets for one customer (FR-025) |
| `sort` | `createdAt`, `updatedAt`, `priority`; prefix `-` for descending. Default `-updatedAt` |
| `includeMerged` | Default `false` — merged tickets are excluded from the working list (FR-044) |

Sorting by `priority` sorts by the taxonomy's **numeric rank**, not alphabetically. Alphabetical
order puts `urgent` below `normal`, which is precisely backwards.

Response `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`.

### `POST /api/tickets`

**Permission**: `tickets:create`

```json
{ "customerId": 7, "subject": "...", "description": "...", "category": "technical", "priority": "high" }
```

- `subject`, `customerId`, `category`, `priority` required (FR-006).
- `category` and `priority` must be taxonomy keys, otherwise `VALIDATION_ERROR` naming the accepted
  values, so the caller is not left guessing at a closed set.
- Customer must exist and be **active** (FR-007), otherwise `CUSTOMER_INACTIVE`.
- Status is `new`; it is not accepted from the caller. A client that could post `status: "closed"`
  would have bypassed the entire lifecycle.
- `201` with the created ticket, including its generated `reference` (FR-004).

### `GET /api/tickets/:id`

**Permission**: `tickets:view`

Returns the ticket, its customer summary, its links, and — when merged — `mergedIntoTicketId` plus
the **survivor** the chain resolves to (FR-045).

Non-numeric `:id` returns `404`, not `500` — the guard Phase 2 added after finding this exact defect.

### `PATCH /api/tickets/:id`

**Permission**: `tickets:update`

Accepts `subject`, `description`, `category`, `priority`, and requires `version` (FR-010).

- Version mismatch returns `409 CONFLICT` with the current version in `details`.
- `status` is **not** accepted here — status changes go through the transition routes, so the
  lifecycle cannot be bypassed by an edit (FR-017).
- Refused when the ticket is `closed` (FR-009): `TICKET_CLOSED`.
- Refused when the ticket is merged (FR-043): `TICKET_MERGED`, naming the survivor.
- Each changed field produces its own history entry with previous and new values (FR-033).

### `GET /api/tickets/:id/transitions`

**Permission**: `tickets:view`

The moves available to the caller on this ticket. See [ticket-lifecycle.md](./ticket-lifecycle.md).
The interface renders its buttons from this and holds no copy of the table.

### `POST /api/tickets/:id/transitions`

**Permission**: `tickets:transition` — plus the edge's own permission

```json
{ "to": "resolved", "version": 4, "note": "optional" }
```

- Illegal pair returns `422 TRANSITION_NOT_ALLOWED` with `details.allowed` (FR-017).
- Missing edge permission returns `403 FORBIDDEN`.
- `to: "escalated"` requires `reason` (FR-029); `VALIDATION_ERROR` without it.
- `to: "closed"` is additionally gated on ownership unless the caller holds `tickets:manage_any`.
- `to: "open"` from `closed` requires `tickets:reopen` and retains all history (FR-022).

One endpoint covers every lifecycle move. Separate `/close` and `/reopen` routes would have meant
four places that write a status, which is four places to forget a check.

### `PUT /api/tickets/:id/assignee`

**Permission**: `tickets:assign` — **Supervisor and Administrator only** (Q3)

```json
{ "userId": 3, "version": 4 }
```

- `userId: null` unassigns (FR-028).
- The target user must exist, be **active**, and hold `tickets:view` — assigning work to someone who
  cannot open it is a silent dead end.
- Reassignment is permitted at any time (FR-026) and records both the previous and new assignee.
- An Agent calling this gets `403`, including when assigning to themselves. **There is no claim
  action** (Q3), and Phase 4's dashboard is read-only with respect to assignment as a result.

### `GET /api/tickets/:id/history`

**Permission**: `tickets:view` — deliberately **not** `audit:view` (FR-037)

Oldest first (FR-035), paginated, with `id` as the ordering tiebreaker because `DATETIME` is
second-precision and several events land in the same second.

```json
{
  "data": [
    { "id": 11, "event": "ticket.created", "actorName": "Omar", "field": null,
      "previousValue": null, "newValue": null, "note": null, "createdAt": "..." },
    { "id": 12, "event": "ticket.status.changed", "actorName": "Sara", "field": "status",
      "previousValue": "new", "newValue": "open", "note": null, "createdAt": "..." }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 2, "totalPages": 1 }
}
```

`actorName` is the name captured when the event happened, so an entry stays attributed after the
actor is deactivated (FR-038). There is **no write endpoint** — the history is append-only and is
appended to only as a side effect of a real change (FR-034).

For a merged ticket, the history returned **spans** the chain (FR-041): entries recorded against the
absorbed ticket appear alongside the survivor's own, each labelled with the ticket it happened to.
Rewriting `ticket_id` on merge would have been simpler and would have destroyed the provenance the
history exists to preserve.

### `POST /api/tickets/:id/merge`

**Permission**: `tickets:merge` — Supervisor and Administrator

```json
{ "intoTicketId": 55, "version": 4, "note": "Same outage" }
```

- Self-merge refused: `VALIDATION_ERROR`.
- Target must exist, must not itself be merged into this ticket (cycle guard), and must not be
  `closed`.
- Merging an already-merged ticket is refused, naming the survivor it already resolves to.
- On success: `merged_into_ticket_id` is set, the ticket becomes unworkable through **every** route
  (FR-043) because the guard lives in the service and not in each endpoint, and both `ticket.merged`
  and **`record.deleted`** are audited (FR-053).
- The absorbed ticket is **not** deleted. Its history stays where it was recorded, and every existing
  reference to it keeps resolving.

### `POST /api/tickets/:id/links` and `DELETE /api/tickets/:id/links/:linkedId`

**Permission**: `tickets:link`

- Symmetric: linking A to B makes B linked to A, stored as one row normalised so the lower id is
  `ticket_id` (FR-047).
- Self-link refused; duplicate refused by the unique index rather than by an application check that
  could be forgotten (FR-048).
- Unlinking removes the relationship and **neither ticket is otherwise affected** (FR-049) — this is
  the difference between a link and a merge.
- Both directions audited: `ticket.linked` and `ticket.unlinked`.

---

## Error codes

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or malformed field; unknown category or priority |
| `UNAUTHENTICATED` | 401 | No or invalid token |
| `FORBIDDEN` | 403 | Permission missing, including the conditional close and assignment cases |
| `NOT_FOUND` | 404 | No such ticket, or a non-numeric id |
| `CONFLICT` | 409 | Version mismatch (FR-010) |
| `TICKET_CLOSED` | 422 | Editing a closed ticket (FR-009) |
| `TICKET_MERGED` | 422 | Any workable action on a merged ticket (FR-043); `details.survivorId` names where to go |
| `TRANSITION_NOT_ALLOWED` | 422 | Pair absent from the lifecycle table; `details.allowed` lists what is |
| `CUSTOMER_INACTIVE` | 422 | Creating against a deactivated customer (FR-007) |

Messages are resolved server-side from the request's language (FR-056), as since Phase 1. A code is
never shown to a user; a message is never parsed by a client.
