# Data Model: Phase 8 — Customer Portal

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01

Three new tables, one altered table, two extended declarations. The altered table is the consequential
one: `tickets.requesting_contact_id` is what makes Clarifications Q2 expressible at all.

Naming and conventions follow Phases 0–7: `snake_case` columns, `created_at`/`updated_at` on every
table, `utf8mb4_0900_ai_ci`, migrations named `20260901______-<verb>-<subject>.cjs` continuing after
Phase 7's `…000006`.

---

## Altered: `tickets`

| Column                  | Type              | Null | Notes                                                       |
| ----------------------- | ----------------- | ---- | ----------------------------------------------------------- |
| `requesting_contact_id` | INT UNSIGNED      | YES  | FK → `customer_contacts.id`, `ON DELETE SET NULL`           |

**Index**: `(requesting_contact_id)` — every portal ticket read filters on it.

**The NULL rule (FR-026f).** `NULL` means **no contact can see this ticket in the portal**. It does not
mean "visible to all contacts on the record", and no query may treat it that way. This is the phase's
single most important invariant after realm separation: reading absence as permission is how the leak
Q2 exists to prevent would reappear, silently, on the oldest data in the system.

`ON DELETE SET NULL` rather than `CASCADE`: removing a contact must not delete a ticket. The ticket
becomes invisible in the portal, which is the correct fail-closed outcome and matches
`customers`'/`tickets`' standing rule that records are deactivated or merged, never deleted.

**Who sets it** (D4):

| Origin                           | Value                                                              |
| -------------------------------- | ------------------------------------------------------------------ |
| Portal submission                | The session's contact — from the session, never the request (FR-026b) |
| Inbound message (`intake`)       | The contact `identityService.resolveOrCreate` matched or created (FR-026c) |
| Public web form                  | The contact matching the submitted address (FR-026d)               |
| Agent-created                    | Optional; may stay NULL (FR-026e)                                  |

**Validation**: the referenced contact MUST belong to the ticket's own `customer_id`. Enforced in the
service on every write, including the staff association path (FR-026h) — the FK alone cannot express
it, and an association across customers would be a cross-customer disclosure.

**Merge (FR-026j)**: the surviving ticket keeps **exactly one** association. Where the two tickets
disagree, the survivor's own value stands; the merged-away ticket's requester does not gain access to
a conversation they could not previously see.

**Backfill migration (FR-026g)**: a single `UPDATE` associating a ticket only where its earliest
inbound message's `sender_identity_normalised` equals `customer_contacts.value_normalised` for
**exactly one** contact on that ticket's own customer. Zero matches or two matches → left NULL. Runs
once, is idempotent, and never overwrites a non-NULL value.

---

## New: `portal_accounts`

The customer's credential. One row per **contact** (D2), not per customer.

| Column                  | Type              | Null | Notes                                                                 |
| ----------------------- | ----------------- | ---- | --------------------------------------------------------------------- |
| `id`                    | INT UNSIGNED PK   | NO   |                                                                       |
| `customer_contact_id`   | INT UNSIGNED      | NO   | FK → `customer_contacts.id`, `ON DELETE CASCADE`, **UNIQUE**          |
| `password_hash`         | VARCHAR(255)      | NO   | bcrypt/Argon2, Phase 1's standard (FR-004)                            |
| `status`                | ENUM              | NO   | `active` \| `withdrawn`; default `active`                             |
| `failed_login_attempts` | INT UNSIGNED      | NO   | Default 0 — mirrors `users` (D2)                                      |
| `locked_until`          | DATETIME          | YES  | Lockout is "is this in the future", derived not stored                |
| `session_epoch`         | INT UNSIGNED      | NO   | Default 0. Incremented to invalidate issued refresh tokens            |
| `invited_by_user_id`    | INT UNSIGNED      | YES  | FK → `users.id`, `ON DELETE SET NULL` — who let them in               |
| `activated_at`          | DATETIME          | NO   | When the invitation was accepted                                      |
| `last_login_at`         | DATETIME          | YES  |                                                                       |
| `preferred_language`    | ENUM(`ar`,`en`)   | YES  | FR-064; NULL means "not chosen yet"                                   |

**No `customer_id`.** The customer is the contact's customer, derived by join — the reasoning
`timeline.service.ts` records for messages: a denormalised copy is a second place for the truth to
live, which Phase 2's customer merge would have to keep in step, and a stale one would point a portal
account at the wrong company.

**No `role_id`, and no row in `users`.** Portal capability comes from holding a portal session, not
from a grant (D12).

**UNIQUE on `customer_contact_id`** makes "one account per contact" a schema fact. Two contacts on one
company record are two independent accounts (FR-003a), and neither can reach the other's tickets.

**`session_epoch`** is what makes FR-060 and SC-031 work on a refresh token. Access tokens expire in
15 minutes and the per-request freshness read (D10) catches `withdrawn` immediately; a refresh token
lives seven days, so withdrawal increments the epoch and refresh tokens carrying an older one are
refused. Incremented on withdrawal, on credential reset, and on the customer's own "sign out
everywhere".

**Validation**: `customer_contact_id` MUST reference a contact of kind `email` (D3 — invitation and
recovery both need a deliverable address).

**States**: `active` ⇄ `withdrawn`, by staff act only (FR-056). A locked-out account is `active` with
`locked_until` in the future — lockout is temporary and self-clearing, withdrawal is not.

---

## New: `portal_invitations`

| Column                | Type            | Null | Notes                                                              |
| --------------------- | --------------- | ---- | ------------------------------------------------------------------ |
| `id`                  | INT UNSIGNED PK | NO   |                                                                    |
| `customer_contact_id` | INT UNSIGNED    | NO   | FK → `customer_contacts.id`, `ON DELETE CASCADE`                   |
| `token_hash`          | CHAR(64)        | NO   | SHA-256 of the emailed token, **UNIQUE**. The token is never stored |
| `issued_by_user_id`   | INT UNSIGNED    | NO   | FK → `users.id` — FR-002e attribution                              |
| `expires_at`          | DATETIME        | NO   | `PORTAL_INVITE_TTL_HOURS`, default 168                             |
| `accepted_at`         | DATETIME        | YES  | Non-NULL = spent (FR-002b)                                         |
| `revoked_at`          | DATETIME        | YES  | Non-NULL = revoked (FR-002c)                                       |
| `revoked_by_user_id`  | INT UNSIGNED    | YES  | FK → `users.id`, `ON DELETE SET NULL`                              |

**Index**: `(customer_contact_id, accepted_at)` — "does this contact have an outstanding invitation?"
is the question the staff screen asks (FR-056).

**Usable** means: `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`. Anything else —
including a hash that matches nothing — raises **one identical error** (FR-002c). The four cases are
never distinguished in a response, and the lookup is written so the distinction does not exist above
the service.

**The token itself** is a cryptographically random value, emailed once, never stored, never logged,
never returned by an API. `token_hash` is unique so a collision is a constraint violation rather than
an ambiguous match.

**Delivery** goes to the address on `customer_contact_id` (FR-002d) — never to an address supplied when
issuing or accepting. This is the invitation's equivalent of `conversationFor`'s refusal to take a
recipient from the request.

**Rows are retained** after acceptance or revocation: they are the audit trail of who let whom in.

---

## New: `ticket_satisfaction`

| Column                  | Type             | Null | Notes                                                     |
| ----------------------- | ---------------- | ---- | --------------------------------------------------------- |
| `id`                    | INT UNSIGNED PK  | NO   |                                                           |
| `ticket_id`             | INT UNSIGNED     | NO   | FK → `tickets.id`, **UNIQUE** (FR-049)                    |
| `score`                 | TINYINT UNSIGNED | NO   | 1–5, scale declared in `portal/satisfaction.ts`           |
| `comment`               | TEXT             | YES  | Optional free text (FR-048). No attachments (FR-022)      |
| `submitted_by_contact_id` | INT UNSIGNED   | NO   | FK → `customer_contacts.id`, `ON DELETE SET NULL`… see note |
| `submitted_at`          | DATETIME         | NO   |                                                           |

**UNIQUE on `ticket_id`** is the whole of FR-049 and SC-016. A check-then-insert passes every test and
still admits two rows when a customer double-clicks; a unique index makes the second insert fail, and
"already recorded" is then the truthful response rather than a race the code hoped not to lose.

**`submitted_by_contact_id`** is nullable at the FK level (`SET NULL`) so removing a contact does not
delete a score Phase 10 has counted — but it is `NOT NULL` on insert, because a rating with no author
could not have been validated against FR-055.

**Validation**: the ticket's status MUST be `resolved` or `closed` at submission (FR-047), and the
submitting contact MUST be the ticket's `requesting_contact_id` (FR-055). Both checked in the service;
neither is expressible as a constraint.

**Reopen rule (FR-054, D9)**: the first response stands. A reopened, re-resolved ticket does not invite
a second rating, and the unique index means it could not hold one.

---

## Extended declarations

### `models/message.model.ts`

```text
CHANNELS            + PORTAL: 'portal'
REPLYABLE_CHANNELS  + CHANNELS.PORTAL        (D6 — a portal ticket must be answerable in place)
```

`portal` is the sixth channel. It participates in `ALL_CHANNELS`, so it acquires a `channel_settings`
row (an administrator can switch the portal channel off), an entry in the adapter registry, and a
label in both locales. It is **excluded** from `assertProductionReady` alongside `chat` and `form` —
there is no external provider it could be pointed at — and **excluded from opt-out enforcement**
(FR-037: a customer cannot opt out of the portal they signed into).

### `models/ticket.model.ts`

```text
TICKET_SOURCES      + 'portal'               (FR-021)
```

Distinguishable from `form`, which is the other self-service origin, so an administrator can ask "which
of these came from the portal?" without joining.

### `auth/permissions.ts`

```text
PERMISSIONS         + define('portal', 'manage')     (FR-058, D12)
```

One key. Distinct from `customers:update` so access management is grantable without customer editing.
Phase 1's generated matrix test extends over it automatically. Seeded to Administrator and Supervisor.

### `services/audit.service.ts`

Ten new actions under `portal.*` (D12): `invitation.issued`, `invitation.accepted`,
`invitation.revoked`, `login.success`, `login.failure`, `account.locked`, `account.unlocked`,
`access.withdrawn`, `credential.reset`, `ticket.contact_associated`.

Namespaced rather than reusing `auth.*` so a Phase 1 audit query for staff sign-ins does not silently
start returning customers — FR-008's attribution requires telling the two apart.

---

## Entity relationships

```text
customers ──1:N── customer_contacts ──1:1── portal_accounts
                        │      │
                        │      └──1:N── portal_invitations
                        │
                        └──1:N── tickets.requesting_contact_id   (nullable — NULL = invisible in portal)

tickets ──1:1── ticket_satisfaction        (unique ticket_id)
tickets ──1:N── messages                   (+ channel 'portal', both directions)
```

**The visibility path is one hop, and that is deliberate.** A portal session resolves to a
`portal_accounts` row, which resolves to exactly one contact, which is compared to
`tickets.requesting_contact_id`. No set membership, no role evaluation, no traversal that could return
more than it should. The scope constraint is
`customer_id = <contact's customer> AND requesting_contact_id = <contact>`; the first clause is
redundant given the second and is applied anyway, because a defence that costs nothing and catches a
future mistake in the second clause is worth its keystrokes.

## Migrations

| Order | Migration                                       | Notes                                                        |
| ----- | ----------------------------------------------- | ------------------------------------------------------------ |
| 1     | `…000007-add-requesting-contact-to-tickets.cjs` | Nullable column + index. Reversible.                          |
| 2     | `…000008-create-portal-accounts.cjs`            |                                                              |
| 3     | `…000009-create-portal-invitations.cjs`         |                                                              |
| 4     | `…000010-create-ticket-satisfaction.cjs`        | Unique `ticket_id`                                           |
| 5     | `…000011-backfill-ticket-requesting-contact.cjs` | Data only (D4). Idempotent; never overwrites a non-NULL value |
| 6     | `…000012-seed-portal-channel-setting.cjs`       | `channel_settings` row for `portal`, enabled                 |

Migration 5 runs after 1 and can be re-run safely. Its down migration sets back to NULL only the rows
it set, which it identifies by the same deterministic condition — a backfill that cannot be undone
cleanly would make the column's introduction irreversible in practice.
