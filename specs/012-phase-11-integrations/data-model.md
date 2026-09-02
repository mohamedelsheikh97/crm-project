# Phase 1 Data Model: Integrations

**Feature**: Phase 11 — Integrations | **Date**: 2026-09-02

Eight new tables. No existing table gains a column, and that is a deliberate constraint rather than a
coincidence — see [D5](#d5-why-the-erp-link-is-its-own-table) at the end.

Every table below states its invariants and, where a shape was chosen over an obvious alternative, why.

---

## `api_clients`

A named external system permitted to reach the published interface.

| Column        | Type              | Notes                                                          |
| ------------- | ----------------- | -------------------------------------------------------------- |
| `id`          | INT UNSIGNED PK   |                                                                |
| `client_id`   | VARCHAR(40)       | **UNIQUE.** The public half of the credential; travels in the request |
| `name`        | VARCHAR(120)      | The external system, for humans                                |
| `is_active`   | BOOLEAN           | Default true. Revocation sets this false                       |
| `created_by_user_id` | INT UNSIGNED NULL | The administrator who issued it. `ON DELETE SET NULL`   |
| `last_used_at` | DATETIME NULL    | FR-022. Written on successful authentication                   |
| `created_at` / `updated_at` | DATETIME |                                                    |

**No secret column.** Secrets live in their own table so that rotation is a row rather than a schema
concern (see below).

`client_id` is a generated, non-guessable, human-recognisable identifier (a short prefix plus random
characters) so that an administrator can match a leaked credential's visible half to a record without
ever holding the secret.

**`last_used_at` is written on the authentication path**, which means a write on a read request. It is
a single indexed-key update and it is what makes FR-022 answerable — "which of these forty credentials
is still in use?" is the question that precedes every credential cleanup, and without this column the
answer requires reading the audit log.

---

## `api_client_secrets`

One row per secret. Several may be valid at once, which is what makes rotation non-disruptive.

| Column         | Type              | Notes                                                        |
| -------------- | ----------------- | ------------------------------------------------------------ |
| `id`           | INT UNSIGNED PK   |                                                              |
| `api_client_id` | INT UNSIGNED FK  | → `api_clients.id`, `ON DELETE CASCADE`                      |
| `secret_hash`  | CHAR(64)          | SHA-256 hex of a 32-byte random secret. **Never the secret** |
| `expires_at`   | DATETIME NULL     | NULL = current. Set to now+overlap when rotated out          |
| `created_at`   | DATETIME          |                                                              |

**Index**: `(api_client_id, expires_at)`.

**Invariants.**

- At most one row per client with `expires_at IS NULL` — the current secret.
- Authentication accepts any row where `expires_at IS NULL OR expires_at > NOW()`.
- A row is never updated to hold a different hash; rotation inserts.

**Why SHA-256 and not bcrypt** is argued in research D3 and belongs there rather than here, but the
short form: the secret is 32 random bytes, so there is no dictionary for a slow KDF to defend
against, and bcrypt at this project's password cost factor would add ~100ms of CPU to every API
request. Phase 8 stores portal invitation tokens the same way for the same reason.

---

## `api_client_permissions`

A client's authority, in the same vocabulary as a person's.

| Column           | Type            | Notes                                          |
| ---------------- | --------------- | ---------------------------------------------- |
| `id`             | INT UNSIGNED PK |                                                |
| `api_client_id`  | INT UNSIGNED FK | → `api_clients.id`, `ON DELETE CASCADE`        |
| `permission_key` | VARCHAR(100)    | A key from the existing permission catalogue   |
| `created_at` / `updated_at` | DATETIME |                                     |

**UNIQUE** `(api_client_id, permission_key)`.

Deliberately identical in shape to `role_permissions`. One vocabulary means the existing
authorization matrix covers both, and a permission added later cannot be granted to a client without
also being a real key — which is the failure Phase 10 found in `ai:manage`, where a key existed with
no probe and the matrix suite had been failing since the phase that introduced it.

**FR-020 is enforced at grant time**, not per request: an administrator cannot grant a key they do not
hold. Checking per request would mean a client's authority changing when its creator changed roles,
which is surprising to the integrator whose integration broke and hard to explain. Research D5 states
the corresponding rule for FR-023: revoking a person does not revoke the client, because the client's
authority is its own.

---

## `webhook_subscriptions`

Where notifications go, and what they are for.

| Column               | Type              | Notes                                                       |
| -------------------- | ----------------- | ----------------------------------------------------------- |
| `id`                 | INT UNSIGNED PK   |                                                             |
| `api_client_id`      | INT UNSIGNED FK   | → `api_clients.id`, `ON DELETE CASCADE`                     |
| `url`                | VARCHAR(2048)     | HTTPS. Validated publicly-routable at save **and** delivery |
| `event_types`        | JSON              | The events this subscription wants                          |
| `signing_secret_hash` | CHAR(64)         | SHA-256. The secret itself is shown once, as a credential is |
| `previous_signing_secret_hash` | CHAR(64) NULL | Valid during a rotation overlap                    |
| `secret_rotated_at`  | DATETIME NULL     | When the overlap started                                    |
| `is_active`          | BOOLEAN           |                                                             |
| `health`             | ENUM              | `healthy` \| `degraded` \| `failing` \| `unknown`            |
| `created_at` / `updated_at` | DATETIME   |                                                             |

**It belongs to an `api_client`, not to a user, and that is load-bearing.** FR-037 says an event must
not be delivered to a subscriber whose credential does not cover the record, because the notification
itself discloses that the record exists. Hanging the subscription off the credential is what makes
that checkable: at delivery time there is an authority to consult. Hanging it off a user would mean
either checking a person's authority for a machine's delivery, or not checking at all.

**`health` is an enum, not a colour.** FR-058 wants an administrator to see health without inferring
it from a list of failures, and FR-064 forbids conveying it by colour alone. Storing the state as data
means the label is translated text and the icon is chosen from the value — a green dot cannot become
the only carrier of meaning, because there is a word beside it by construction.

**Signing secret rotation uses two columns rather than a table**, unlike the credential's. The
difference is intentional: a credential's rotation is an operational event with its own lifecycle and
may legitimately overlap more than twice; a subscription's signature only ever needs "current and
one previous", and a table would be more machinery than the requirement asks for.

---

## `integration_events`

The transactional outbox. One row per thing that happened.

| Column         | Type              | Notes                                                        |
| -------------- | ----------------- | ------------------------------------------------------------ |
| `id`           | BIGINT UNSIGNED PK | Monotonic, and the delivery sweep's natural order            |
| `event_key`    | CHAR(36)          | **UNIQUE.** The stable identifier a receiver deduplicates on |
| `event_type`   | VARCHAR(60)       | `ticket.created`, `ticket.resolved`, `customer.created`, …    |
| `subject_type` | VARCHAR(30)       | `ticket` \| `customer`                                        |
| `subject_id`   | INT UNSIGNED      | The record that changed                                      |
| `occurred_at`  | DATETIME(3)       | Millisecond precision — see the invariant below              |
| `payload`      | JSON              | Identifiers and metadata ONLY (FR-028)                       |
| `created_at`   | DATETIME          |                                                              |

**Index**: `(created_at)` for the sweep; `(subject_type, subject_id)` for the overview.

**Invariants.**

- **The row is written inside the transaction that caused it.** This is the whole design: the event
  exists exactly when the change does. Written before commit and rolled back, a webhook would fire
  for something that never happened; written after commit in a separate step, a crash in between
  loses it silently. Research D7 has the full argument.
- **`payload` never contains record content.** No ticket subject or body, no customer name, no
  message text, no reporting figure. A test asserts this against a fixture whose subject and customer
  name are distinctive strings, so the assertion is a search rather than a review.
- **`event_key` is generated once and never regenerated.** A re-send delivers the same key, which is
  what lets a receiver tell a re-send from a new event (FR-031).

**`occurred_at` is millisecond-precision** while most of this schema is second-precision. Two events
for the same ticket inside one second are ordinary — a status change that triggers an automation
rule, for instance — and FR-032 tells receivers to order events by occurrence time. Second precision
would make that instruction unfollowable in exactly the case where ordering matters most.

**The payload is stored, not recomputed at delivery.** A retry twelve hours later must deliver what
happened, not what is true now; recomputing would mean the retry of a "ticket resolved" event
describing a ticket that has since been reopened.

---

## `webhook_delivery_attempts`

One row per attempt, so the history is the record rather than a counter.

| Column          | Type              | Notes                                                       |
| --------------- | ----------------- | ----------------------------------------------------------- |
| `id`            | BIGINT UNSIGNED PK |                                                            |
| `event_id`      | BIGINT UNSIGNED FK | → `integration_events.id`, `ON DELETE CASCADE`             |
| `subscription_id` | INT UNSIGNED FK  | → `webhook_subscriptions.id`, `ON DELETE CASCADE`          |
| `attempt_number` | SMALLINT          | 1-based                                                     |
| `state`         | ENUM              | `pending` \| `succeeded` \| `failed` \| `abandoned`          |
| `next_attempt_at` | DATETIME NULL   | When `pending`. NULL otherwise                              |
| `response_status` | SMALLINT NULL   | What the receiver said                                      |
| `failure_reason` | VARCHAR(255) NULL | In terms an administrator can act on (FR-060)              |
| `resent_by_user_id` | INT UNSIGNED NULL | Set when an administrator re-sent it (FR-059)           |
| `attempted_at`  | DATETIME NULL     |                                                             |
| `created_at` / `updated_at` | DATETIME |                                                   |

**Index**: `(state, next_attempt_at)` — the sweep's only query. `(subscription_id, created_at)` for the
overview and health derivation.

**Invariants.**

- A `pending` row always has `next_attempt_at`; a terminal row never does. This is what makes the
  sweep's query a single index range rather than a scan with conditions.
- **Claiming is a conditional update**, not a read-then-write. Two ticks in one process cannot both
  take the same attempt. It does not solve the multi-process case, which is recorded as a known limit
  in the plan and made survivable by FR-031's at-least-once contract.
- `abandoned` means every retry was exhausted (FR-033). The row and its event are retained and
  surfaced, never deleted — an event that vanished when delivery gave up is the failure nobody
  notices.
- `failure_reason` is a phrase for a human, distinct from `response_status`. "Connection refused" and
  "TLS certificate expired" are both actionable; "delivery failed" is not.

---

## `erp_links`

The correspondence between a customer here and its counterpart in the ERP.

| Column               | Type              | Notes                                                        |
| -------------------- | ----------------- | ------------------------------------------------------------ |
| `id`                 | INT UNSIGNED PK   |                                                              |
| `customer_id`        | INT UNSIGNED FK   | **UNIQUE.** → `customers.id`, `ON DELETE CASCADE`            |
| `external_id`        | VARCHAR(120)      | **UNIQUE.** The ERP's own identifier                         |
| `adapter_key`        | VARCHAR(40)       | Which adapter established the link                           |
| `last_reconciled_at` | DATETIME NULL     | When a sync last considered this record                      |
| `last_synced_values` | JSON              | **The values the sync last wrote** — the human-edit detector |
| `created_at` / `updated_at` | DATETIME   |                                                              |

**Unique in both directions** (FR-041): one customer has one counterpart, one counterpart maps to one
customer. Two ERP records claiming the same external identifier fail at the database rather than on a
check that could race, which is what the edge case asks for.

**`last_synced_values` is the interesting column.** FR-043 forbids a sync silently overwriting a value
a person edited, which requires answering "did a human change this field since we last wrote it?".
Comparing the current value against what the sync last wrote answers it exactly: equal means nobody
touched it, different means somebody did. Research D12 records why the two obvious alternatives are
worse — `customers.updated_at` is too coarse to be per-field, and reading the audit log makes
correctness depend on retention, so pruning the log would start silently overwriting agents' work.

---

## `erp_sync_runs`

One row per synchronisation.

| Column           | Type              | Notes                                                      |
| ---------------- | ----------------- | ---------------------------------------------------------- |
| `id`             | INT UNSIGNED PK   |                                                            |
| `adapter_key`    | VARCHAR(40)       | Which adapter ran                                          |
| `mode`           | ENUM              | `preview` \| `apply`                                        |
| `state`          | ENUM              | `running` \| `completed` \| `failed` \| `abandoned`          |
| `cursor`         | VARCHAR(255) NULL | Position in the ERP's own paging, for resumption           |
| `created_count` / `updated_count` / `skipped_count` | INT UNSIGNED | Default 0                |
| `conflict_count` | INT UNSIGNED      | Where a human edit was involved (FR-043)                   |
| `started_by_user_id` | INT UNSIGNED NULL | `ON DELETE SET NULL`                                    |
| `started_at` / `finished_at` | DATETIME NULL |                                                |
| `failure_reason` | VARCHAR(255) NULL |                                                            |
| `created_at` / `updated_at` | DATETIME |                                                     |

**One `running` row per adapter at a time** (FR-048), enforced by a generated column plus a unique
index — a database constraint rather than a check, so two concurrent starts cannot both pass.

**`mode` distinguishes preview from apply on the same table**, so SC-017's requirement that a preview
report the same set the run applies is checkable by comparing two rows of the same shape rather than
two different structures.

---

## `erp_sync_records`

What each run did to each record, and why.

| Column          | Type              | Notes                                                       |
| --------------- | ----------------- | ----------------------------------------------------------- |
| `id`            | BIGINT UNSIGNED PK |                                                            |
| `sync_run_id`   | INT UNSIGNED FK   | → `erp_sync_runs.id`, `ON DELETE CASCADE`                   |
| `external_id`   | VARCHAR(120)      | The ERP record                                              |
| `customer_id`   | INT UNSIGNED NULL | Null where creation was skipped. `ON DELETE SET NULL`       |
| `outcome`       | ENUM              | `created` \| `updated` \| `skipped` \| `conflict` \| `failed` |
| `reason`        | VARCHAR(255) NULL | Required when not `created`/`updated` (FR-046)              |
| `changed_fields` | JSON NULL        | What moved, so FR-049 answers a question weeks later        |
| `created_at`    | DATETIME          |                                                             |

**Index**: `(sync_run_id, outcome)` so the administration screen can show skips without reading the
whole run.

**`reason` is mandatory for every non-trivial outcome.** A skip with no reason is a record an
administrator cannot act on, and FR-046 exists because the natural implementation logs "skipped: 47"
and leaves the reader to guess.

`changed_fields` records the field names and the before/after, which is what makes FR-043's "recorded
and visible" true for the conflict case — the value that lost is still readable.

---

## Relationships

```text
users ──(created_by)──> api_clients ──< api_client_secrets
                             │
                             ├──< api_client_permissions
                             │
                             └──< webhook_subscriptions ──< webhook_delivery_attempts
                                                                    │
integration_events ─────────────────────────────────────────────────┘

customers ──1:1── erp_links

erp_sync_runs ──< erp_sync_records ──(customer_id)──> customers
```

`orders` is **not** a table. Orders are read from the ERP and never stored — the ERP is their system of
record (spec Assumptions), and a local copy would be a second truth about a customer's purchases with
no way to tell which was current. They are cached in memory for 60 seconds (research D14), which is a
performance decision that survives a restart losing it.

---

## Cross-cutting notes

### D1 — Nothing here stores a retrievable secret

`api_client_secrets.secret_hash` and `webhook_subscriptions.signing_secret_hash` are hashes. The ERP
adapter's connection details come from the environment, not a table, following
`channels/registry.ts`'s division: the *provider* is environmental because it decides which code
runs, and only *enablement* is a database setting an administrator changes. That also keeps
connection credentials out of any administration screen that might echo them, which FR-066 requires.

### D2 — Retention

`integration_events`, `webhook_delivery_attempts`, `erp_sync_runs` and `erp_sync_records` are retained
90 days by default and pruned by a scheduler sweep. They answer the same kind of after-the-fact
question as an audit record, so they get the same basis. The prune is a sweep rather than a cascade so
that "missing a tick is harmless" continues to hold.

### D3 — What is deliberately absent

- **No `api_request_log` table.** Rate limiting is in-memory (the existing `lib/rate-limit.ts`) and
  attribution is in the audit log. A row per request would be this system's highest-volume write, for
  data nothing in the spec asks for.
- **No `webhook_event_subscriptions` join table.** `event_types` is JSON on the subscription. A join
  table would let an event type exist as a row without existing in the code, which is a foot-gun with
  no upside at this cardinality.
- **No `api_versions` table.** A version is code, not data. A table would imply a version could be
  added by inserting a row.

### D4 — Indexes this phase adds, and the one it needs from elsewhere

New: the ones named per table above. The published interface's keyset paging orders by
`(updated_at, id)` on `customers` and `tickets`, so both need that composite index — **`tickets` did
not have one**, and Phase 10 added `tickets(created_at)` rather than `updated_at`. This is the same
class of finding Phase 10 recorded when it discovered `tickets` had no `created_at` index at all: the
index every published-interface list depends on does not exist yet, and paging without it is a sort of
the whole table per page.

### D5 — Why the ERP link is its own table

The obvious design is `customers.erp_external_id`. It is rejected for three reasons, in order of
weight:

1. `last_synced_values` has nowhere sensible to live on `customers`. It is sync bookkeeping, not a
   property of the customer, and a JSON column of shadow values sitting beside the real ones invites
   somebody to read the wrong one.
2. A second adapter later — two ERPs, or a migration between them — needs two links for one customer.
   A column makes that a schema change; a table makes it a row and a unique-index adjustment.
3. Phase 2 owns `customers`. Adding integration bookkeeping to it would mean this phase's concerns
   appearing in a table five other phases read, and every one of them would then carry a column they
   must know to ignore.

The cost is a join to display the ERP link on a customer, which is one indexed lookup on a
`UNIQUE(customer_id)` column.
