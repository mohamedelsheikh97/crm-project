# Data Model: Phase 5 — Communication Channels

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

Seven new tables, one new column on `customers`, two changes to `tickets`. Conventions follow Phases
0–4 unchanged: `INTEGER UNSIGNED` surrogate keys, `snake_case` columns, `created_at` / `updated_at`
on every table, `utf8mb4_0900_ai_ci` collation, and foreign keys declared with an explicit
referential action rather than a default.

## Changes to existing tables

### `tickets` (Phase 3)

| Column | Change | Why |
| --- | --- | --- |
| `source` | **ADD** `VARCHAR(20) NOT NULL DEFAULT 'manual'` | FR-026. One of `manual`, `email`, `whatsapp`, `sms`, `chat`, `form`. The default backfills every existing ticket correctly — they were all created by hand. |
| `created_by_user_id` | **ALTER** to `NULL` | FR-026, research D9. A system-created ticket has no human creator, and a seeded system user would appear in user lists and assignment pickers and break Phase 1's last-administrator tests. |

`customer_id` stays `NOT NULL`. An unknown sender produces a provisional customer, never a
customerless ticket (research D7) — this is the constraint that keeps every Phase 3 and Phase 4
consumer working unchanged.

Index: `tickets_source` on `source`, serving "which of these arrived on their own?".

### `customers` (Phase 2)

| Column | Change | Why |
| --- | --- | --- |
| `is_provisional` | **ADD** `BOOLEAN NOT NULL DEFAULT FALSE` | Clarifications Q2, FR-014b. `TRUE` means the system created this record from an unrecognised sender and nobody has confirmed it. Existing rows are all `FALSE`, which is correct — a person created every one of them. |

Deliberately **not** a separate table (research D7): every consumer — the Phase 4 queue, the context
panel, the timeline, Phase 10's reporting — keeps working, and only the places that must distinguish
look at the flag.

Index: `customers_is_provisional`, serving the "unconfirmed customers" review list.

---

## `messages`

One customer communication on a ticket. The central table of the phase.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `ticket_id` | `INT UNSIGNED NOT NULL` | FK → `tickets.id`, `ON DELETE CASCADE`. Every message belongs to a ticket (FR-001). |
| `channel` | `VARCHAR(20) NOT NULL` | `email`, `whatsapp`, `sms`, `chat`, `form`. |
| `direction` | `VARCHAR(10) NOT NULL` | `inbound` or `outbound`. |
| `author_user_id` | `INT UNSIGNED NULL` | FK → `users.id`, `ON DELETE RESTRICT`. Set on outbound, null on inbound (FR-046). |
| `sender_identity` | `VARCHAR(255) NULL` | The address or number the message came from or went to, as received. |
| `sender_identity_normalised` | `VARCHAR(255) NULL` | Through `lib/phone.ts`. What identity resolution matched on. |
| `body` | `MEDIUMTEXT NOT NULL` | Readable content. Never active content (FR-008), never a lossy rewriting (FR-009). |
| `body_format` | `VARCHAR(10) NOT NULL` | `text` or `html_source`. Records what arrived, so nothing is re-guessed on read. |
| `provider_message_id` | `VARCHAR(255) NULL` | The provider's own identifier (FR-007). |
| `outbound_message_id` | `VARCHAR(255) NULL` | The `Message-ID` this system generated for an outbound email. What inbound `In-Reply-To` / `References` are matched against (research D4). |
| `delivery_state` | `VARCHAR(20) NOT NULL` | `pending`, `sent`, `delivered`, `read`, `failed`. Inbound is `delivered` on arrival. |
| `delivery_detail` | `VARCHAR(500) NULL` | Why it failed, shown to the sending agent (FR-048). |
| `occurred_at` | `DATETIME NOT NULL` | When the communication happened, per the channel. Distinct from `created_at`, which is when this system recorded it — FR-092 orders by this one. |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

**Indexes**

- `messages_ticket_occurred` on `(ticket_id, occurred_at)` — the thread read.
- `messages_customer_timeline` — see below.
- `messages_outbound_message_id` **UNIQUE** on `outbound_message_id` — threading lookup (D4).
- `messages_provider` on `(channel, provider_message_id)`.

**The timeline index.** FR-087 and FR-092 need a customer's messages across every ticket, ordered by
`occurred_at`. `messages` has no `customer_id` — a message's customer is its ticket's customer, and
duplicating it would create two places for the truth to live, which FR-019 (customer merge) would
then have to keep in step. The timeline therefore joins through `tickets`, and the supporting index
is `tickets (customer_id, id)` — which Phase 3 already has as `tickets_customer_id`.

**Validation**

- `direction = 'outbound'` requires `author_user_id` (FR-046).
- `direction = 'inbound'` requires `author_user_id IS NULL`.
- `channel = 'form'` requires `direction = 'inbound'` — a form has no reply path (FR-003).
- `body_format = 'html_source'` is a record of what arrived; rendering always sanitises (FR-008).

**Deliberately absent.** No `is_internal` column. Internal notes are Phase 4's `ticket_notes` and stay
there. One table with a boolean deciding whether content may leave the building is exactly the design
FR-002, FR-044 and SC-006 exist to prevent — a wrong default becomes a disclosure. Two tables make
the mistake unrepresentable.

---

## `message_attachments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `message_id` | `INT UNSIGNED NOT NULL` | FK → `messages.id`, `ON DELETE CASCADE`. |
| `file_name` | `VARCHAR(255) NOT NULL` | As the sender named it. |
| `content_type` | `VARCHAR(100) NOT NULL` | Sniffed from content, never trusted from the sender — Phase 2's rule (FR-035). |
| `byte_size` | `INT UNSIGNED NOT NULL` | |
| `storage_key` | `VARCHAR(255) NOT NULL` | Under `ATTACHMENT_STORAGE_PATH`, never statically served. |
| `is_inline` | `BOOLEAN NOT NULL DEFAULT FALSE` | FR-036. An inline image referenced by an HTML body is not a document the customer chose to attach, and must not be listed as one. |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

Reuses Phase 2's storage path, size ceiling, and content-sniffing rules rather than defining a second
regime (spec Assumptions). Separate from `customer_attachments` because the owner differs: those
belong to a customer, these to a message.

---

## `channel_intake`

The ledger. One row per accepted delivery, written **before** conversion is attempted. Research D13:
this single table is idempotency, nothing-is-lost retention, and the intake audit trail.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `channel` | `VARCHAR(20) NOT NULL` | |
| `provider_message_id` | `VARCHAR(255) NOT NULL` | For email, the `Message-ID`; for webhooks, the provider's event id. |
| `received_at` | `DATETIME NOT NULL` | |
| `status` | `VARCHAR(20) NOT NULL` | `pending`, `converted`, `ignored`, `failed`. |
| `reason` | `VARCHAR(500) NULL` | Why ignored or failed (FR-037). Human-readable, shown to an administrator. |
| `raw_payload` | `MEDIUMTEXT NOT NULL` | What arrived, retained so a failure is reprocessable (FR-038). |
| `message_id` | `INT UNSIGNED NULL` | FK → `messages.id`, `ON DELETE SET NULL`. Set when `converted`. |
| `attempts` | `INT UNSIGNED NOT NULL DEFAULT 0` | |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

**Index**: `channel_intake_provider` **UNIQUE** on `(channel, provider_message_id)`. This one
constraint is FR-039, FR-055 and FR-094 — redelivery hits it and becomes a no-op, on every channel,
without any channel implementing idempotency itself.

**State transitions**: `pending → converted`, `pending → ignored`, `pending → failed`,
`failed → converted` (a successful reprocess). `converted` is terminal — a converted delivery is
never reprocessed, or FR-039 breaks.

**Why `ignored` is distinct from `failed`.** An out-of-office reply is not an error (FR-029); it was
recognised and deliberately not converted. Collapsing the two would fill an administrator's failure
review with correctly-handled automated mail, and the genuine failures would be lost in it.

---

## `channel_settings`

Non-secret, administrator-editable channel configuration. **Credentials are not here** — FR-006 puts
them in environment configuration, unreadable through any interface, exactly as Phases 0–4 handle
every other secret.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `channel` | `VARCHAR(20) NOT NULL` | **UNIQUE**. One row per channel. |
| `is_enabled` | `BOOLEAN NOT NULL DEFAULT FALSE` | FR-005. Disabled by default: a channel starts working because someone turned it on. |
| `settings_json` | `JSON NULL` | Non-secret knobs — intake address, display name, greeting keys. |
| `updated_by_user_id` | `INT UNSIGNED NULL` | FK → `users.id`, `ON DELETE SET NULL`. FR-104. |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

The provider selection itself is environment configuration, not a row: it decides which code runs,
and code selection through a database row an administrator can edit is a larger blast radius than
this phase needs.

---

## `chat_sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `visitor_token` | `CHAR(64) NOT NULL` | **UNIQUE**. High-entropy opaque capability, hashed at rest. Authorises exactly one conversation (FR-075, research D14). |
| `ticket_id` | `INT UNSIGNED NULL` | FK → `tickets.id`, `ON DELETE CASCADE`. Null only between the session opening and the first message. |
| `visitor_name` | `VARCHAR(255) NULL` | As given, if given. |
| `visitor_identity` | `VARCHAR(255) NULL` | Address or number, if given (FR-073). |
| `locale` | `VARCHAR(5) NOT NULL` | `ar` or `en`. The widget's own direction comes from this (FR-076). |
| `state` | `VARCHAR(20) NOT NULL` | `open` or `ended`. |
| `last_seen_at` | `DATETIME NOT NULL` | Drives "visitor left". |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

The token is **hashed at rest** for the same reason a password is: a database read should not hand
over live capabilities. It is compared by hashing the presented value.

---

## `form_definitions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `slug` | `VARCHAR(64) NOT NULL` | **UNIQUE**. What the public URL carries. |
| `title_en` / `title_ar` | `VARCHAR(255) NOT NULL` | FR-079, both languages. |
| `fields_json` | `JSON NOT NULL` | Ordered field definitions: key, type, required, `label_en`, `label_ar`. |
| `default_category` | `VARCHAR(30) NULL` | Restricted to Phase 3's declared taxonomy (FR-084). |
| `default_priority` | `VARCHAR(20) NULL` | Likewise. |
| `is_published` | `BOOLEAN NOT NULL DEFAULT FALSE` | |
| `created_by_user_id` | `INT UNSIGNED NULL` | FK → `users.id`, `ON DELETE SET NULL`. |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

**FR-085 without a version table.** A submission stores the answers **together with the label text as
it was asked**, inside the resulting message body. Editing a definition therefore cannot change what
an old ticket says, because the old ticket never referred to the definition — it carries its own
copy. A version table was considered and rejected: it makes every read a join to reconstruct text
that could simply have been kept.

---

## `channel_opt_outs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED PK AI` | |
| `channel` | `VARCHAR(20) NOT NULL` | |
| `identity_normalised` | `VARCHAR(255) NOT NULL` | Through `lib/phone.ts`. |
| `opted_out_at` | `DATETIME NOT NULL` | |
| `source` | `VARCHAR(20) NOT NULL` | `keyword`, `provider`, `agent`. |
| `created_at` / `updated_at` | `DATETIME NOT NULL` | |

**Index**: `channel_opt_outs_identity` **UNIQUE** on `(channel, identity_normalised)`.

**Keyed by identity, not by customer, on purpose.** A person who opts out has refused messages to
that number, and that refusal must survive the number being moved between customer records, a
customer merge, or the customer being deleted. Keying on `customer_id` would let a merge quietly
resurrect consent (FR-051, FR-060, FR-065).

---

## Entity relationships

```text
customers (+ is_provisional)
   │ 1
   ├───────< customer_contacts        ← the ONLY identity source (FR-011)
   │              value_normalised    ← what inbound senders match against
   │ 1
   └───────< tickets (+ source, created_by_user_id now nullable)
                  │ 1
                  ├───────< messages ────< message_attachments
                  │             ▲
                  │             └──────── channel_intake.message_id (nullable)
                  │ 1
                  ├───────< ticket_notes        (Phase 4 — internal, NOT messages)
                  │ 1
                  └───────< chat_sessions

channel_settings   — one row per channel, no relationships
channel_opt_outs   — keyed by (channel, identity), deliberately not by customer
form_definitions   — referenced only at submission time; answers are copied, not joined
```

## Permission catalog additions

Four keys, following Phase 4's naming. Kept in step with `backend/src/auth/permissions.ts`; the
generated matrix test fails the build on drift.

| Key | Grants | Default holders |
| --- | --- | --- |
| `messages:send` | Send correspondence to a customer on any channel | Agent, Supervisor, Administrator |
| `messages:reattribute` | Move a ticket's correspondence to the correct customer (FR-017) | Supervisor, Administrator |
| `channels:manage` | Enable, disable, and configure channels | Administrator |
| `forms:manage` | Define and publish web forms | Supervisor, Administrator |

**No `timeline:view` key.** The timeline rides on `customers:view` and is filtered by ticket
visibility (FR-090). A key every role holds unconditionally cannot refuse anything — the same
reasoning Phase 4 used in declining `notifications:view`.

**`messages:send` is separate from `ticket_notes:create` on purpose** (FR-043). They are the two
composers on one screen, and the whole of SC-006 is that holding one must not imply the other.
