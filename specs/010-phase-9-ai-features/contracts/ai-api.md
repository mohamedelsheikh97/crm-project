# Contract: Staff and Admin AI Endpoints

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02

All routes below sit behind the existing staff `authenticate` middleware. None is reachable from the
portal realm — Phase 8's realm separation applies unchanged, and `backend/tests/portal/realm.test.ts`
gains these paths to its enumeration.

**Every endpoint here returns 404, not 403, for a ticket the caller may not view**, matching the
existing ticket surface. A 403 tells you the ticket exists.

---

## Summarisation

### `GET /api/tickets/:id/ai/summary`

Computes on demand. Stores nothing (D7, FR-065b).

**Authority**: `tickets:view` on that ticket — the same check the ticket detail endpoint makes
(FR-020, FR-061).

**Rate limit**: `ai-summary`, keyed by user id.

| Response | Body                                                                    |
| -------- | ------------------------------------------------------------------------ |
| 200      | `{ text, contentLang, generatedAt, messageCount }`                       |
| 404      | Ticket not found **or** not visible to caller                            |
| 409      | `{ code: 'ai_feature_disabled' }`                                        |
| 429      | Rate limited, or `{ code: 'ai_budget_exhausted' }`                       |
| 503      | `{ code: 'ai_unavailable' }` — provider failed (FR-003)                  |

`generatedAt` is always "now" — there is no cached summary to be stale (FR-018 discharged by
recomputation). `messageCount` lets the client show which thread length the summary covers.

---

## Reply drafting

### `POST /api/tickets/:id/ai/draft`

Returns text. **Creates nothing** (FR-026).

**Authority**: `messages:send` **and** ticket visibility (FR-028, FR-061). An agent without
`messages:send` is not offered the button and is refused server-side if they call it anyway.

**Rate limit**: `ai-draft`, keyed by user id.

| Response | Body                                                          |
| -------- | -------------------------------------------------------------- |
| 200      | `{ text, contentLang, citedArticles: [{ id, slug, title }] }`  |
| 403      | Caller lacks `messages:send`                                   |
| 404      | Ticket not found or not visible                                |
| 409 / 429 / 503 | As above                                                |

`citedArticles` are articles visible to **this agent** (FR-016). A draft is never persisted, never
queued, and has no id — there is nothing to reference later because nothing was created. Sending is the
existing Phase 5 `POST /api/tickets/:id/messages`, unchanged, with the agent as author (FR-027).

---

## Similar tickets

### `GET /api/tickets/:id/similar`

No model call (D8). Deterministic, and tests assert exact ids.

**Authority**: `tickets:view` on the subject ticket; results additionally scoped by the caller's ticket
visibility **in the query** (FR-052).

| Response | Body                                                                                  |
| -------- | --------------------------------------------------------------------------------------- |
| 200      | `{ items: [{ ticketId, reference, subject, resolvedAt, resolutionExcerpt, score }] }`    |
| 404      | Subject ticket not found or not visible                                                  |

An empty `items` array is the correct, expected answer when nothing scores above the floor (FR-054) —
the UI says so rather than showing weak matches. There is no AI disclosure on this panel: nothing here
was generated.

---

## Category proposals

### `GET /api/tickets/:id/ai/category-proposal`

| Response | Body                                                                  |
| -------- | ---------------------------------------------------------------------- |
| 200      | `{ proposal: { id, proposed, confidence, createdAt } \| null }`         |
| 404      | Ticket not found or not visible                                        |

`null` when there is no pending proposal, when one was dismissed, or when it is suppressed because a
human has since categorised the ticket (FR-049).

### `POST /api/tickets/:id/ai/category-proposal/accept`

**Authority**: `tickets:update` — the authority to set a category, unchanged (FR-061).

Writes `tickets.category` **through the existing Phase 3 ticket update path**, so the audit entry,
history record, and any Phase 6 side effects are identical to a human typing it. Marks the proposal
`accepted`.

| Response | Body                                                    |
| -------- | -------------------------------------------------------- |
| 200      | `{ ticket }` — the standard ticket detail shape          |
| 403      | Caller lacks `tickets:update`                            |
| 409      | `{ code: 'proposal_not_pending' }`                       |

**This is the only endpoint in the phase that changes a ticket field, and a human invoked it.** That
sentence is the whole of Clarifications Q2.

### `POST /api/tickets/:id/ai/category-proposal/dismiss`

Marks it `dismissed`. Terminal — `UNIQUE(ticket_id)` prevents re-proposal (FR-047).

---

## Administration

### `GET /api/admin/ai/config` · `PATCH /api/admin/ai/config`

**Authority**: `ai:manage`.

```text
{
  enabled:  boolean,
  features: { summary: bool, draft: bool, classify: bool, similar: bool, assistant: bool },
  ceilings: { summary: int, draft: int, classify: int, assistant: int },   // per day
  assistantLangs: ('ar' | 'en')[],
  groundingFloor: number
}
```

**Never returns a secret** (FR-064). No API key, no base URL, no model id — the response describes
policy, not credentials. Processing location is **absent from this payload entirely**: it is not
configurable (D2, FR-008a), and including it read-only would invite a later PATCH.

Every change writes `ai.config.changed` / `ai.feature.enabled` / `ai.feature.disabled` /
`ai.ceiling.changed` (FR-062).

### `GET /api/admin/ai/activity`

**Authority**: `ai:manage`. Paginated `ai_invocations` (FR-063).

Returns feature, subject reference, requester, location, outcome, token counts, timestamp. **Never
prompt or completion text** — there is none stored (FR-065). The admin screen states this explicitly,
so a reader looking for "what did it say" learns why they cannot see it rather than assuming a bug.

### `GET /api/admin/ai/conversations` · `GET /api/admin/ai/conversations/:id`

**Authority**: `ai:manage`. Chatbot conversations with their turns (FR-043) — the exception to
metadata-only, for the reason FR-065a gives.

---

## Not built in this phase

- No endpoint returns an AI artefact by id. Nothing is stored to have an id.
- No endpoint accepts a model, provider, temperature, or processing location as a parameter.
- No endpoint regenerates a stored artefact — regeneration is just calling the same endpoint again.
