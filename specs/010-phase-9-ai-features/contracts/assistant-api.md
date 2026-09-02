# Contract: Customer Assistant Endpoints

**Feature**: `010-phase-9-ai-features` | **Date**: 2026-09-02

Two surfaces, one service. The portal surface authenticates through Phase 8's
`authenticate-portal` middleware; the chat surface is anonymous and carries a conversation token.

**Everything here is served by the local provider.** No route in this file can reach an external
processor — see [provider-contract.md](./provider-contract.md) for how that is enforced rather than
intended.

---

## Portal (authenticated)

Mounted under the Phase 8 portal router, listed in `portal/endpoints.ts`, and therefore included in
Phase 8's generated realm and scoping tests automatically (its FR-018 / D10 property, inherited).

### `POST /api/portal/assistant/messages`

**Authority**: a valid portal session. The conversation binds to `portal_accounts.id` (FR-041).

**Rate limit**: `ai-assistant`, keyed by portal account id — **not IP**. Phase 8's D11 recorded why:
an office behind one address is many customers, and keying their reads on the IP means one person
clicking quickly denies service to their colleagues.

Request: `{ conversationId?: number, body: string }`

| Response | Body                                                                                        |
| -------- | --------------------------------------------------------------------------------------------- |
| 200      | `{ conversationId, reply: { body, citedArticles: [{ slug, title }] }, escalation: null }`     |
| 200      | `{ conversationId, reply: { body, citedArticles: [] }, escalation: { ticketReference } }`      |
| 403      | Conversation belongs to another portal account                                                 |
| 409      | `{ code: 'ai_feature_disabled' }` — client falls back to the Phase 8 ticket form (FR-042)      |
| 429      | Rate limited                                                                                   |
| 503      | `{ code: 'ai_unavailable' }` — local processing down; **never falls back externally** (FR-008b) |

`citedArticles` carries **slug and title, never id** — Phase 8's FR-065 rule that no customer surface
exposes an internal id, and the slug is what the public KB URL already uses.

**A refusal is a 200, not an error.** "I cannot answer that, shall I raise a request?" is the system
working correctly (D3 step 2). It arrives with `citedArticles: []` and an offer to escalate.

### `POST /api/portal/assistant/escalate`

Explicit escalation — the "talk to a person" path (FR-036, US3 scenario 4).

| Response | Body                                            |
| -------- | ------------------------------------------------ |
| 200      | `{ ticketReference }`                            |
| 409      | `{ code: 'already_escalated', ticketReference }` |

**409 is not a failure the customer sees as one.** `UNIQUE(ticket_id)` makes double escalation a
constraint violation rather than a second ticket (FR-036c); the client renders the returned reference
exactly as it would a fresh one. This is Phase 8's satisfaction-service pattern — translate the
constraint violation, never check-then-insert.

The created ticket:

- carries the conversation rendered into its description, marked as assistant dialogue (FR-036a, FR-036b)
- is attributed to the portal account's contact and customer, so it appears in their request list
  under Phase 8's existing scoping — no new visibility rule
- has `source = 'portal'` and `assistant_conversation_id` set
- gets the default category. **The classifier does not run on it and could not set one anyway**
  (Clarifications Q2)

### `GET /api/portal/assistant/conversations/:id`

Own conversation only, scoped by portal account. 404 — never 403 — for another account's conversation,
matching every other Phase 8 portal read.

---

## Chat widget (anonymous)

### `POST /api/public/assistant/messages`

**No authentication.** Carries an opaque conversation token; the server stores only its hash
(`anon_token_hash`).

**Rate limit**: `ai-assistant`, keyed by IP. There is no better key — an anonymous visitor *is* their
address, which is Phase 8's own reasoning for its unauthenticated portal endpoints.

Same request and response shape as the portal route, with one difference: **escalation requires an
email address**, because a ticket with no route back to the person is not a ticket anyone can answer.
The assistant asks for it before escalating, and the ticket is created through the Phase 5 intake path
so identity resolution, threading, and the ledger all apply unchanged.

| Response | Body                                                                    |
| -------- | ------------------------------------------------------------------------ |
| 200      | As portal, or `{ escalation: { needs: 'email' } }` when an address is required |
| 429      | Rate limited                                                             |
| 503      | `{ code: 'ai_unavailable' }`                                             |

**This route may be disabled independently** of the portal assistant (research open question 3). The
anonymous surface has the weaker rate-limit key and no identity, so an operator may reasonably want the
portal assistant on and this one off.

---

## What the assistant cannot do

Structural, not instructional — each is a property of what the service is able to call:

| Cannot                                    | Because                                                        |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Change a ticket's status, priority, category, or assignment | No such call exists in the assistant service (FR-037) |
| Read any ticket, including the customer's own | No ticket data enters the prompt corpus (FR-035; grounding contract) |
| Reach another conversation                 | Queries are scoped to `conversation_id`                          |
| Answer from unpublished content            | `audience: 'customer'` literal in retrieval (FR-033)             |
| Create two tickets for one conversation    | `UNIQUE(ticket_id)` (FR-036c)                                    |
| Send email, SMS, or WhatsApp               | No channel adapter is imported                                    |
| Reach an external AI provider              | Import boundary (FR-008, D2)                                      |

---

## Bilingual behaviour

`conversation.lang` is fixed at first message from the customer's text and the portal locale, and the
assistant answers in it (FR-057, D9). A conversation does not switch language mid-exchange — a customer
who switches gets an answer in the established language, which is the honest behaviour when the retrieval
corpus and quality gate were both selected for that language.

If `conversation.lang` is not in `AI_ASSISTANT_LANGS` (D4), the assistant is not offered at all and the
Phase 8 ticket route is presented instead. **A language the assistant is not good enough in gets no
assistant**, not a worse one.
