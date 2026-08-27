# API Contract: Customers (Phase 2)

**Feature**: `003-phase-2-customer-management` | **Date**: 2026-08-27

Base path **`/api`**, unversioned, as established in Phase 0. Every endpoint is subject to the
Phase 1 authorization pipeline — `authenticate`, `requirePasswordChange`, `requirePermission` — and
uses the Phase 0 error envelope. See
[Phase 1 authorization.md](../../002-phase-1-security-administration/contracts/authorization.md);
nothing about it changes here.

Two things this contract adds to what earlier phases established:

- a **`409 DUPLICATE_CUSTOMER`** response carrying the matching records, and
- **binary** request and response bodies for attachments.

---

## Customers

### `GET /api/customers` — `customers:view`

Search and list in one endpoint. A single `search` term is matched against name, company, phone, and
email — the caller never chooses a field first (FR-010).

Query: `search`, `company`, `isActive` (default: active only), `page`, `pageSize`
(default 25, **max 100**, clamped not rejected).

**Success — `200 OK`**

```json
{
  "items": [
    {
      "id": 42,
      "displayName": "شركة النيل للتجارة",
      "company": "Nile Trading",
      "isActive": true,
      "primaryPhone": { "raw": "+20 100 123 4567", "normalised": "+201001234567" },
      "primaryEmail": "info@niletrading.example",
      "contactCount": 3,
      "createdAt": "2026-08-27T09:00:00.000Z",
      "version": 0
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1
}
```

`raw` is what the user typed and is what a human is shown; `normalised` is included so the interface
can highlight *why* a record matched a phone search. Deactivated customers are excluded unless
`isActive=false` or `isActive=all` is passed (FR-008).

### `GET /api/customers/:id` — `customers:view`

Returns the full record including every contact method. `404` only when the caller had permission to
look — a caller without `customers:view` gets `403` whether or not the customer exists (FR-019 of
Phase 1's authorization contract).

### `POST /api/customers` — `customers:create`

```json
{
  "displayName": "Ahmed Hassan",
  "company": null,
  "address": null,
  "contacts": [
    { "kind": "phone", "value": "01001234567", "isPrimary": true },
    { "kind": "email", "value": "ahmed@example.com", "isPrimary": true }
  ],
  "acknowledgeDuplicates": false
}
```

**Success — `201 Created`** with the full customer.

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | No contact method supplied (FR-003), malformed email, or missing name |
| **`409`** | **`DUPLICATE_CUSTOMER`** | A phone or email already belongs to an existing customer and `acknowledgeDuplicates` was not set |

### The duplicate response

```json
{
  "error": {
    "code": "DUPLICATE_CUSTOMER",
    "message": "One or more contact details already belong to an existing customer.",
    "details": []
  },
  "duplicates": [
    {
      "matchedOn": "phone",
      "matchedValue": "+201001234567",
      "customer": {
        "id": 42,
        "displayName": "Ahmed Hassan",
        "company": null,
        "isActive": true,
        "primaryPhone": { "raw": "+20 100 123 4567", "normalised": "+201001234567" },
        "primaryEmail": null
      }
    }
  ]
}
```

**`duplicates` is a sibling of `error`, not part of it.** Phase 0's `details[]` is
`{field, message}` pairs and cannot carry a customer summary without abusing a field with a defined
meaning. Adding a sibling key leaves every existing consumer of the envelope working (research.md
D5).

Rules this response obeys:

- **All** matches are returned, not the first (FR-022).
- Deactivated customers are included, or a retired customer is silently recreated (FR-019).
- Matching is on the **normalised** value, so formatting cannot defeat it (FR-005, SC-002).
- The response is a **question, not a refusal**. Resubmitting with `acknowledgeDuplicates: true`
  succeeds (FR-023) and records the decision.

### `PATCH /api/customers/:id` — `customers:update`

```json
{ "displayName": "…", "company": "…", "address": "…", "contacts": [...], "version": 0, "acknowledgeDuplicates": false }
```

`version` is required; a mismatch is `409 CONFLICT` (FR-045). `contacts`, when present, replaces the
set wholesale.

**The same `409 DUPLICATE_CUSTOMER` applies here.** FR-021 is the same rule as FR-017 at a different
moment, and both paths call the same detector — editing a customer's phone into one another customer
holds is the identical problem to creating it that way.

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Removing the last contact method (FR-003) |
| `409` | `CONFLICT` | Stale `version` |
| `409` | `DUPLICATE_CUSTOMER` | As above, unacknowledged |

### `POST /api/customers/:id/deactivate` — `customers:deactivate`

`204`. Removes the customer from default results while leaving every reference valid (SC-014).

### `POST /api/customers/:id/reactivate` — `customers:deactivate`

`204`. Shares the permission deliberately: changing active state is one capability.

**There is no `DELETE` on this resource at any path.** Deactivation is the only removal
(Clarifications Q1), which is what lets Phase 3 treat a customer reference as permanent.

### `POST /api/customers/check-duplicates` — `customers:create`

```json
{ "contacts": [{ "kind": "phone", "value": "01001234567" }], "excludeCustomerId": null }
```

Returns the same `duplicates` array with `200`. This exists for live feedback while typing — an
**aid, not the barrier**. The barrier is the `409` on save, because a matching customer could be
created between a check and a save (research.md D5).

---

## Notes

### `GET /api/customers/:id/notes` — `customers:view`

Paged, most recent first (FR-025).

```json
{
  "items": [
    {
      "id": 7,
      "body": "Customer called about invoice 1042.",
      "author": { "id": 3, "fullName": "Support Agent" },
      "createdAt": "2026-08-27T10:00:00.000Z",
      "editedAt": null
    }
  ],
  "page": 1, "pageSize": 25, "total": 1
}
```

`editedAt` non-null means a human changed what the note says, and the interface must show that
(FR-026). It is distinct from a generic updated timestamp on purpose.

Every note is visible to anyone who may view the customer — there is no private or supervisor-only
note (Clarifications Q2).

### `POST /api/customers/:id/notes` — `notes:create`

`{ "body": "…" }` → `201` with the note.

### `PATCH /api/customers/:id/notes/:noteId` — `notes:create` *or* `notes:manage`

The author may always edit their own note with `notes:create`. Editing **someone else's** requires
`notes:manage` (FR-027); without it the server returns `403`. Sets `editedAt`.

### `DELETE /api/customers/:id/notes/:noteId` — same rule as PATCH

`204`.

---

## Attachments

### `GET /api/customers/:id/attachments` — `customers:view`

```json
{
  "items": [
    {
      "id": 11,
      "originalName": "signed-form.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 248310,
      "uploadedBy": { "id": 3, "fullName": "Support Agent" },
      "createdAt": "2026-08-27T10:05:00.000Z"
    }
  ]
}
```

`storage_key` is **never** returned. It is an internal locator, and exposing it would invite someone
to try addressing the file directly.

### `POST /api/customers/:id/attachments` — `attachments:upload`

`multipart/form-data`, one `file` part.

**Success — `201 Created`** with the attachment metadata.

| Status | Code | Condition |
|---|---|---|
| `400` | `VALIDATION_ERROR` | No file part |
| `413` | `VALIDATION_ERROR` | Exceeds the configured limit — the message names the limit (FR-031). Enforced **before** anything reaches disk |
| `415` | `VALIDATION_ERROR` | Type not allowed, judged by **sniffed content** rather than filename or client-supplied MIME type (FR-032) |

A file named `.pdf` whose contents are something else is refused. The client's `Content-Type` and the
extension are both treated as claims.

### `GET /api/customers/:id/attachments/:attachmentId/download` — `customers:view`

Streams the file with `Content-Disposition: attachment; filename="<originalName>"` and the stored
sniffed `Content-Type`.

**This is an authenticated, permission-checked endpoint — not a static file route** (FR-033). The
storage directory is never mounted or served. A user without `customers:view` receives `403`
regardless of whether they hold a valid attachment id, so guessing an address achieves nothing.

### `DELETE /api/customers/:id/attachments/:attachmentId` — `attachments:delete`

`204`. The row is deleted in a transaction with its audit entry; the file is removed after the commit
succeeds (FR-035). A failure to remove the file is logged at `error` — the attachment is already
unreachable through the application, which is what the requirement asks.

---

## Export

### `GET /api/customers/export` — `customers:export`

Accepts the **same query parameters as the list endpoint**, so an export is always "what I am
currently looking at" rather than a separate query someone has to keep in step.

**Success — `200 OK`**, `text/csv; charset=utf-8`, streamed, with a UTF-8 BOM.

The BOM is not cosmetic: without it Excel misreads UTF-8, and Arabic customer names arrive as
mojibake in the one place they are most likely to be read outside the team (research.md D9).

- Contains **exactly** the rows the filter produced, never the whole table (FR-038).
- Contains no field the caller could not already see on screen (FR-039).
- Writes a `data.exported` audit entry with the row count (FR-040) — the key Phase 1 defined for
  exactly this purpose, rather than a new one (FR-044).

---

## Cross-cutting

**Paging** — every list carries `{ items, page, pageSize, total }`; `pageSize` is clamped
server-side at 100. A default alone would not stop a caller asking for everything (FR-050).

**Optimistic locking** — `PATCH` requires the `version` last read; a mismatch is `409 CONFLICT`
(FR-045).

**Audit coupling** — every state-changing endpoint writes its audit entry **inside the same
transaction** as the change, exactly as Phase 1 established. There is no path where a customer
change succeeds unrecorded.

**Permission before existence** — a caller lacking permission gets `403` whether or not the target
exists. `404` appears only for a permitted caller. Reversing that order leaks existence through the
status code.

**Arabic** — every text field accepts and returns Arabic unchanged. The database collation delivers
this without per-endpoint handling (research.md D4).

**Timestamps** — ISO 8601 UTC throughout.
