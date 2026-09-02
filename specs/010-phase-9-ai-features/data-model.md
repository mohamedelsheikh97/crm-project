# Data Model: Phase 9 — AI Features

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

Four new tables, one new nullable column, no existing column altered. Six migrations.

The shape of this model is mostly decided by two clarifications. Q2 means **no table here writes
`tickets.category`** — the proposals table sits beside the field and never in it. Q3 means **no table
here stores a prompt or a completion** — `ai_invocations` is metadata, and `assistant_messages` stores
text for an entirely different reason (D6).

---

## Overview

| Table                     | Purpose                                                | Stores content? |
| ------------------------- | ------------------------------------------------------ | --------------- |
| `ai_invocations`          | What ran, for what, at whose request, at what cost      | **No** (D6)     |
| `ai_category_proposals`   | A pending classification a human accepts or dismisses   | No — a category key |
| `assistant_conversations` | One customer↔bot exchange, escalatable exactly once     | No — metadata + link |
| `assistant_messages`      | The turns of that exchange                              | **Yes** (FR-043) |

Plus `tickets.assistant_conversation_id` — nullable, the link back from an escalated ticket.

---

## `ai_invocations`

One row per attempt to produce AI output. Written by the shared adapter path (D1), so no feature can
skip it.

| Column           | Type                | Null | Notes                                                                 |
| ---------------- | ------------------- | ---- | --------------------------------------------------------------------- |
| `id`             | BIGINT UNSIGNED PK  | no   | Volume is per-view, not per-ticket — BIGINT, unlike most tables here.  |
| `feature`        | VARCHAR(30)         | no   | One of `ai/features.ts`. Indexed with `created_at` for D11's counting. |
| `subject_type`   | VARCHAR(20)         | no   | `ticket` \| `conversation` \| `none`                                   |
| `subject_id`     | INT UNSIGNED        | yes  | **A reference, never content** (FR-011).                              |
| `requested_by`   | INT UNSIGNED FK     | yes  | `users.id`. NULL when the requester is a customer or the system.      |
| `portal_account_id` | INT UNSIGNED FK  | yes  | `portal_accounts.id`. The assistant's requester.                      |
| `location`       | VARCHAR(20)         | no   | `external` \| `local`. What SC-024a asserts against.                  |
| `outcome`        | VARCHAR(20)         | no   | `success` \| `failed` \| `refused_budget` \| `refused_disabled` \| `refused_ungrounded` |
| `input_tokens`   | INT UNSIGNED        | yes  | Cost accounting only.                                                 |
| `output_tokens`  | INT UNSIGNED        | yes  |                                                                       |
| `duration_ms`    | INT UNSIGNED        | yes  |                                                                       |
| `error_code`     | VARCHAR(50)         | yes  | A code, never a provider message — messages can echo input.           |
| `created_at`     | DATETIME            | no   |                                                                       |

**Invariants**

- Exactly one of `requested_by` / `portal_account_id` is set, or neither (system-initiated
  classification). Never both — they are different identity realms, and Phase 8 exists because
  conflating them is dangerous.
- **No column may hold prompt or completion text.** A test asserts the column list against a frozen
  set, in the style of Phase 8's `projection.test.ts`, so adding one is a deliberate act that fails a
  test rather than a quiet commit.
- `refused_ungrounded` records D3's step 2 — the assistant declining *without* calling a model. It is
  an invocation record for a call that never happened, on purpose: SC-015's deflection rate is
  computed from it.

**Indexes**: `(feature, created_at)` for ceiling counting; `(subject_type, subject_id)` for the
per-ticket activity view; `(created_at)` for retention pruning.

---

## `ai_category_proposals`

A proposal sits **beside** `tickets.category`, never in it (Clarifications Q2, FR-045).

| Column          | Type               | Null | Notes                                                        |
| --------------- | ------------------ | ---- | ------------------------------------------------------------ |
| `id`            | INT UNSIGNED PK    | no   |                                                              |
| `ticket_id`     | INT UNSIGNED FK    | no   | **UNIQUE** — one live proposal per ticket, structurally.      |
| `proposed`      | VARCHAR(30)        | no   | Must be a `TICKET_CATEGORIES` member; validated on write.     |
| `confidence`    | DECIMAL(4,3)       | yes  | For tuning and SC-010 reporting. Never gates display alone.   |
| `state`         | VARCHAR(20)        | no   | `pending` \| `accepted` \| `dismissed`                        |
| `resolved_by`   | INT UNSIGNED FK    | yes  | `users.id` — who accepted or dismissed.                       |
| `resolved_at`   | DATETIME           | yes  |                                                               |
| `category_at_proposal` | VARCHAR(30) | no   | What the ticket's category was when proposed.                 |
| `created_at`    | DATETIME           | no   |                                                               |

**Invariants**

- `UNIQUE(ticket_id)` makes FR-047's "a dismissed proposal is not re-proposed" structural: a second
  proposal cannot be inserted, and the classifier's insert uses the same
  translate-the-constraint-violation pattern Phase 8's satisfaction service used rather than
  check-then-insert.
- `state != 'pending'` requires `resolved_by` and `resolved_at`.
- **Nothing in this table is read by Phase 6.** Automation conditions and SLA policy selection read
  `tickets.category` and know nothing of proposals — which is FR-045b, expressed as the absence of a
  join rather than as a rule anyone must remember.
- `category_at_proposal` exists for FR-049: if the ticket's category changed after the proposal was
  made, a human has since decided, and the proposal is suppressed rather than shown as a correction.

---

## `assistant_conversations`

| Column              | Type               | Null | Notes                                                        |
| ------------------- | ------------------ | ---- | ------------------------------------------------------------ |
| `id`                | INT UNSIGNED PK    | no   |                                                              |
| `portal_account_id` | INT UNSIGNED FK    | yes  | Set for signed-in portal customers (FR-041).                 |
| `anon_token_hash`   | CHAR(64)           | yes  | Hashed chat-visitor token. Never the raw token.              |
| `lang`              | VARCHAR(5)         | no   | The `contentLang` of the exchange (D9).                      |
| `ticket_id`         | INT UNSIGNED FK    | yes  | **UNIQUE** where not null. Set once, on escalation.          |
| `escalated_at`      | DATETIME           | yes  |                                                              |
| `last_activity_at`  | DATETIME           | no   | For pruning unescalated conversations.                       |
| `created_at`        | DATETIME           | no   |                                                              |

**Invariants**

- Exactly one of `portal_account_id` / `anon_token_hash` is set. A conversation belongs to one identity,
  and never to a `users.id` — the realm separation Phase 8 established holds here unchanged.
- **`UNIQUE(ticket_id)` is what makes FR-036c true.** Escalating twice is a duplicate-key violation, not
  a race a check can lose. A customer who keeps typing after escalation continues the same conversation
  against the same ticket.
- A conversation with `ticket_id IS NULL` is disposable. Pruning them on `last_activity_at` is
  operational hygiene, not a feature — the ones that mattered became tickets.

---

## `assistant_messages`

The one table in this phase that stores generated text, for the reason FR-065a gives (D6).

| Column            | Type                | Null | Notes                                              |
| ----------------- | ------------------- | ---- | -------------------------------------------------- |
| `id`              | BIGINT UNSIGNED PK  | no   |                                                    |
| `conversation_id` | INT UNSIGNED FK     | no   | Cascade on conversation delete.                    |
| `role`            | VARCHAR(10)         | no   | `customer` \| `assistant`                          |
| `body`            | TEXT                | no   |                                                    |
| `cited_article_ids` | JSON              | yes  | Assistant turns only. The grounding, per FR-016.   |
| `created_at`      | DATETIME            | no   |                                                    |

**Invariants**

- `role = 'customer'` rows have `cited_article_ids IS NULL`.
- Every `role = 'assistant'` row either cites at least one article or is a refusal — D3 step 4 admits
  no third case.
- **These are not `messages` rows and must never be merged with them** (D5). The Phase 5 timeline stays
  correspondence-only; Phase 8's customer view depends on it.

---

## `tickets.assistant_conversation_id` (new column)

| Column                       | Type            | Null | Notes                                    |
| ---------------------------- | --------------- | ---- | ---------------------------------------- |
| `assistant_conversation_id`  | INT UNSIGNED FK | yes  | NULL for every ticket not born from a bot escalation. |

Nullable, and NULL is the overwhelming default — the same shape as Phase 8's
`requesting_contact_id`. It exists so the ticket view can show FR-036b's provenance without a reverse
lookup, and so Phase 10 can report on assistant-originated tickets.

**No backfill migration.** Unlike Phase 8's `requesting_contact_id`, there is no historical truth to
recover: no ticket before this phase came from an assistant, so every existing row is correctly NULL.

---

## Relationships

```text
users ──< ai_invocations.requested_by
portal_accounts ──< ai_invocations.portal_account_id
portal_accounts ──< assistant_conversations.portal_account_id

tickets ──1:0..1── ai_category_proposals   (UNIQUE ticket_id)
tickets ──1:0..1── assistant_conversations (UNIQUE ticket_id, set once)
tickets.assistant_conversation_id ──> assistant_conversations.id

assistant_conversations ──< assistant_messages
kb_articles ──(by id, in JSON)── assistant_messages.cited_article_ids
```

`cited_article_ids` is a JSON id list rather than a join table deliberately. It is display provenance
for a message already written, not a queryable relationship — and an article later archived should not
alter what the bot said at the time. A join table with a foreign key would either block the archive or
rewrite history.

---

## State transitions

**Category proposal**

```text
                  ┌── accept ──> accepted   (writes tickets.category via the Phase 3 path)
(none) ──> pending┤
                  └── dismiss ─> dismissed  (terminal; UNIQUE(ticket_id) prevents re-proposal)
```

`pending` is also **suppressed** without a state change when `tickets.category != category_at_proposal`
— a human decided in the meantime (FR-049).

**Assistant conversation**

```text
active ──> escalated   (ticket_id set once; irreversible)
   │
   └────> pruned       (only while ticket_id IS NULL)
```

---

## What this model deliberately does not contain

- **No prompt or completion storage** (Clarifications Q3). The absence is asserted by a frozen-column
  test on `ai_invocations`.
- **No embeddings or vector column.** D8 and D3 reuse Phase 7's token index.
- **No `ai_summaries` table.** Summaries are computed on read and discarded (D7, FR-065b).
- **No `ai_drafts` table.** A draft has no existence until the agent sends it, at which point it is an
  ordinary Phase 5 message (FR-026, FR-065c).
- **No per-model or per-provider configuration table.** Provider choice is deployment configuration,
  and the egress boundary is compile-time (D2). A settings row would be the thing FR-008a forbids.
