# Data Model: Phase 2 — Customer Management

**Feature**: `003-phase-2-customer-management` | **Date**: 2026-08-27

Derived from the spec's Key Entities. Phase 2 adds **five tables** and changes nothing existing.
Every table is `utf8mb4` / `utf8mb4_0900_ai_ci`, inherited from the database default — that collation
is what makes Arabic and case-insensitive email comparison work without per-query handling
(research.md D4).

Per Clarifications Q1 there is no delete path, per Q2 no note-visibility column, and per Q3 no
scan-state column on attachments.

---

## `customers`

The record every later module attaches to.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `display_name` | `VARCHAR(255)` | NOT NULL | The person or organisation. Arabic-safe (D4) |
| `company` | `VARCHAR(255)` | NULL | Optional; searchable |
| `address` | `TEXT` | NULL | Single free-text field — Arabic and English addresses do not share a structure (spec Assumptions) |
| `is_active` | `BOOLEAN` | NOT NULL, default `true` | Deactivation is the only removal (FR-007, D8) |
| `created_by_user_id` | `INTEGER UNSIGNED` | NULL, FK → `users.id` | Null-able so a deactivated creator never blocks the row |
| `version` | `INTEGER UNSIGNED` | NOT NULL, default `0` | Optimistic locking, as `users` established (FR-045) |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Indexes**: `is_active` (default listings exclude inactive); `display_name`; `company`.

The last two do **not** serve `LIKE '%term%'` — a leading wildcard cannot use a B-tree. They are
present for sorting and for the prefix case, and research.md D3 records the accepted linear cost and
the volume at which to revisit.

**Validation** (service layer):

- `display_name` is required and trimmed.
- At least one contact method must exist (FR-003) — enforced when creating, and on update when the
  last remaining contact would be removed. A customer nobody can contact is not usable.

**No delete path.** No endpoint, service method, or interface control deletes a customer. This is
what lets Phase 3 treat a customer reference as permanent (Clarifications Q1, D8).

---

## `customer_contacts`

One row per phone number or email address. Rows rather than columns, because the duplicate check is
this phase's core requirement and it needs a single indexed lookup regardless of how many contacts a
customer holds (research.md D7).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE CASCADE` | Cascade is schema hygiene; customers are never deleted |
| `kind` | `ENUM('phone','email')` | NOT NULL | |
| `value_raw` | `VARCHAR(255)` | NOT NULL | **Exactly what the user typed.** Always what a human is shown |
| `value_normalised` | `VARCHAR(255)` | NOT NULL | E.164 for a parseable phone, digits-only fallback otherwise; lowercased for email. **Never displayed** |
| `is_primary` | `BOOLEAN` | NOT NULL, default `false` | At most one primary per kind per customer |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Indexes**: **`value_normalised`** — the one that matters, since every duplicate check and every
contact search is a lookup against it; plus `customer_id` and a composite `(customer_id, kind)`.

**Deliberately not unique.** FR-023 requires that a shared number be enterable after an explicit
decision — a household phone belonging to two people is ordinary. Uniqueness here would turn a
question into a refusal.

**Validation**:

- `value_normalised` is computed in exactly one place, `backend/src/lib/phone.ts` for phones and a
  lowercase-trim for emails. Three callers each normalising slightly differently is how SC-002 rots
  (research.md D1).
- Email shape is validated before storage; a phone that will not parse is still stored, with the
  digits-only fallback as its normalised form.

---

## `customer_notes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE CASCADE` | |
| `author_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | Attribution is the point of a note |
| `body` | `TEXT` | NOT NULL | Arabic-safe (D4) |
| `edited_at` | `DATETIME` | NULL | Non-null means it was changed after writing (FR-026) |
| `created_at` / `updated_at` | `DATETIME` | NOT NULL | |

**Indexes**: composite `(customer_id, created_at)` — the profile reads one customer's notes, most
recent first, paged.

**No visibility column** (Clarifications Q2). Every note is visible to anyone who may view the
customer. If a later phase needs supervisor-only notes that is an additive column plus a filter, but
nothing is built for it now.

`edited_at` is separate from `updated_at` deliberately: `updated_at` moves for any write, while
`edited_at` means specifically *a human changed what this says*, which is what FR-026 asks the
interface to surface.

---

## `customer_attachments`

Metadata only. The binary lives on the filesystem (research.md D2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE CASCADE` | |
| `uploaded_by_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | |
| `original_name` | `VARCHAR(255)` | NOT NULL | What the user called it. **Display and `Content-Disposition` only — never a path** |
| `storage_key` | `VARCHAR(255)` | NOT NULL, **UNIQUE** | Generated identifier. The only thing that resolves to a location on disk |
| `content_type` | `VARCHAR(100)` | NOT NULL | The **sniffed** type, not the client's claim (FR-032) |
| `size_bytes` | `INTEGER UNSIGNED` | NOT NULL | |
| `created_at` | `DATETIME` | NOT NULL | No `updated_at`: an attachment is written once |

**Indexes**: composite `(customer_id, created_at)`; unique on `storage_key`.

**Why `storage_key` and `original_name` are separate columns.** `original_name` is
attacker-controlled input, and a filename containing `../..` is how it becomes a path traversal.
The generated key is the only value that ever touches the filesystem.

**No scan state** (Clarifications Q3). Files are not virus-scanned in this phase, so there is no
pending/clean/infected column and no download path that has to interpret one. **Revisit before Phase
8**, whose customer portal would let files arrive from outside the organisation.

**Write ordering** (FR-034): the file is written to disk **before** the row is committed, and deleted
if the commit fails. An orphan file is harmless and sweepable; a committed row pointing at a file
that was never written is a broken download.

**Delete ordering** (FR-035): the row is deleted in a transaction with its audit entry; the file is
removed after the commit succeeds. If file removal then fails it is logged at `error`, but the
attachment is already unreachable through the application, which is what the requirement asks.

---

## `customer_duplicate_overrides`

A record that someone was warned and decided anyway.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER UNSIGNED` | PK, auto-increment | |
| `customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE CASCADE` | The record that was created or edited |
| `matched_customer_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `customers.id`, `ON DELETE CASCADE` | The existing record they were warned about |
| `decided_by_user_id` | `INTEGER UNSIGNED` | NOT NULL, FK → `users.id` | |
| `matched_on` | `ENUM('phone','email')` | NOT NULL | Which contact kind triggered the warning |
| `matched_value` | `VARCHAR(255)` | NOT NULL | The normalised value that matched, for later investigation |
| `created_at` | `DATETIME` | NOT NULL | |

**Indexes**: `customer_id`, `matched_customer_id`.

One row per match: being warned about three existing customers and proceeding writes three rows, so
the record of what was shown is complete rather than summarised.

This exists because FR-020 and SC-005 require the override to be retrievable **months later**. An
audit entry alone records that a save happened with acknowledgement; these rows record precisely
which records were on screen when the decision was made.

---

## Permission catalog additions

Nine entries added to `backend/src/auth/permissions.ts`. **Code, not schema** — a later phase adds a
module by extending this constant and the grants seeder, with no migration (research.md D6).

| Module | Actions |
|---|---|
| `customers` | `view`, `create`, `update`, `deactivate`, `export` |
| `notes` | `create`, `manage` |
| `attachments` | `upload`, `delete` |

`notes:manage` covers editing or deleting **another user's** note (FR-027); a user with
`notes:create` may always edit their own.

**Default grants added by the seeder** (reconciling, never deleting an Administrator's changes):

| Role | Gains |
|---|---|
| `agent` | `customers:view`, `customers:create`, `customers:update`, `notes:create`, `attachments:upload` |
| `supervisor` | all of the above plus `customers:deactivate`, `customers:export`, `notes:manage`, `attachments:delete` |
| `admin` | every catalog key |

The generated permission matrix picks these up automatically and **fails until each has both a grant
decision and a route enforcing it**. That failure is the mechanism working as designed.

---

## Audit actions

No new keys. Customer events reuse the Phase 1 vocabulary, with the specific action carried in the
`action` field and the record identified by `target_type: 'customer'`.

| Event | Action key |
|---|---|
| Customer created | `customer.created` |
| Customer updated | `customer.updated` |
| Customer deactivated / reactivated | `customer.deactivated` / `customer.reactivated` |
| Duplicate warning overridden | `customer.duplicate.overridden` |
| Note added / edited / removed | `customer.note.created` / `.updated` / `.deleted` |
| Attachment uploaded / removed | `customer.attachment.uploaded` / `.deleted` |
| Customer list exported | **`data.exported`** — the key Phase 1 defined (FR-044) |

`record.deleted` gains **no caller**: nothing here is permanently deleted (Clarifications Q1). Phase
1 defined it expecting Phase 2 to be the first phase with records to delete; that expectation was
overturned by the clarification, and the key is carried forward again.

As in Phase 1, every state-changing audit write shares the transaction of the change it records, so
an unrecorded change cannot exist.

---

## Entity relationships

```text
customers 1 ──── * customer_contacts          (cascade)
customers 1 ──── * customer_notes             (cascade)
customers 1 ──── * customer_attachments       (cascade)
customers 1 ──── * customer_duplicate_overrides   (as subject and as match)
users     1 ──── * customer_notes             (author)
users     1 ──── * customer_attachments       (uploader)
users     1 ──── * customers                  (creator, nullable)
```

Customers are never deleted, so every cascade above exists for schema correctness rather than as an
expected path — the same posture Phase 1 took with users.

---

## Configuration added

Extends the frozen config object, validated by the same zod schema at startup so a bad value fails
fast rather than at first upload.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ATTACHMENT_STORAGE_PATH` | no | `./storage/attachments` | Directory for uploaded files. Backed by a Docker volume; **never** under a static route |
| `ATTACHMENT_MAX_BYTES` | no | `10485760` | 10 MB (FR-031). Enforced before anything reaches disk |
| `ATTACHMENT_ALLOWED_TYPES` | no | see below | Comma-separated MIME types, matched against the **sniffed** type |
| `DEFAULT_PHONE_REGION` | no | `EG` | Region for parsing a number entered without a country code (D1) |

Default allowed types: `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
`text/plain`, `application/msword`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## State transitions

### Customer

```text
active ──deactivated──> inactive     (hidden from default results; every reference stays valid)
inactive ──reactivated──> active
```

There is no third state and no terminal one. A customer never leaves the system.

### Attachment

```text
(none) ──file written──> on disk, uncommitted
on disk, uncommitted ──row committed──> available
on disk, uncommitted ──commit fails──> file deleted, nothing recorded
available ──removed──> row deleted, then file deleted
```

The middle branch is FR-034: the only reachable failure leaves an orphan file, never a row pointing
at nothing.

### Duplicate resolution

```text
save attempted ──no match──> saved
save attempted ──match found──> refused (409) with the matching records
refused ──user opens the existing record──> nothing created
refused ──user acknowledges──> saved + override rows + audit entry
```

The refusal is a question, not a rejection (FR-023). There is no path where a duplicate is created
without someone deciding, and no path where a legitimate shared number cannot be entered.
