# Contract: Visibility

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01

The phase's central contract. Two mechanisms, each with one place to be correct and one enumerated test
that proves it:

1. **The scope** — which records a portal session may reach at all (D5).
2. **The projection** — which fields of a reachable record may leave the building (D14).

They are separate on purpose. A correct scope with a leaky projection shows a customer their own
ticket's SLA breach state. A tight projection with a leaky scope shows them a colleague's subject line.
Neither substitutes for the other.

---

## 1. The scope

### The one function

```text
portalScope(session) → {
  customer_id:           session.customerId,
  requesting_contact_id: session.contactId,
}
```

Applied **inside the `where` of every portal query**, never as a filter over loaded rows, never as a
check after a `findByPk` (FR-016). The rule `timeline.service.ts` states for its own filter is the rule
here: applied at fetch time _"so that when a later phase narrows ticket visibility this service narrows
with it instead of quietly disclosing."_

`customer_id` is redundant given `requesting_contact_id` — a contact belongs to one customer, so the
second clause implies the first. It is applied anyway. It costs nothing and it means a future mistake
in the contact clause fails closed at the customer boundary rather than open.

### The three refusals, all identical

| Target                                                  | Response          |
| ------------------------------------------------------- | ----------------- |
| A record on another customer                            | `404 not_found`   |
| A record on the same customer, another contact          | `404 not_found`   |
| A ticket with `requesting_contact_id IS NULL`           | `404 not_found`   |
| A reference that has never existed                      | `404 not_found`   |

One response, four causes (FR-017). There is no code, message, header, or timing difference between
them. A distinct "not yours" answer would confirm the record exists, which is the disclosure the 404
exists to prevent — and on a company record it would confirm a colleague's activity.

### NULL fails closed

`requesting_contact_id IS NULL` means **no portal account sees this ticket**. Not "the customer's
tickets", not "visible to every contact on the record". This is stated in three places — the spec
(FR-026f), the data model, and here — because reading absence as permission is the single mistake that
would reintroduce the leak Clarifications Q2 exists to prevent, silently, on the oldest data in the
system.

Its visible cost is accepted and must be communicated, not hidden: at launch a newly invited customer
may see nothing, because their history predates the association. That is a **normal** state
(FR-026g/h give the two routes out of it), and the interface says so rather than presenting an error.

### Every read, including the ones that are not tickets

| Read                | Scoped by                                                                         |
| ------------------- | --------------------------------------------------------------------------------- |
| Ticket list         | `portalScope`                                                                      |
| Ticket detail       | `portalScope` on the ticket, before anything else is loaded                        |
| Messages            | The ticket, resolved through `portalScope` first — never by `ticket_id` from the URL |
| Attachments         | Session → ticket → message → attachment, resolved **together** (D15)              |
| Satisfaction        | `portalScope` on the ticket; submitter must be the requester (FR-055)             |
| Knowledge content   | Not scoped by contact — `audience: 'customer'` and `status: 'published'` literals (FR-039) |
| `GET /me`           | The session's own contact only                                                     |

The attachment row is the one where a plausible implementation is dangerous.
`message-attachment.service.findForDownload(attachmentId)` already exists, takes an id and no scope,
and has no callers. Calling it from a portal controller and checking ownership afterwards would be the
defect Phase 2's controller comment names: _"serving it would make an attachment reachable by anyone
who obtains its address, which is the same defect as not checking permission at all."_ The portal
service takes the session **first**.

### The enumerated test (SC-002, SC-003, SC-028, SC-029)

`portal/endpoints.ts` declares the endpoint list. Two generated suites iterate it:

**Realm matrix** — for every portal endpoint: a staff access token, a staff refresh token, a portal
refresh token, and a malformed token each produce the same 401. For every **staff** endpoint: a portal
access token produces the same 401 as no token, and no staff user is resolved from it.

**Scope matrix** — a fixture with two customers, one of which has two contacts, and four tickets: one
per contact, one unassociated, one on the other customer. For every portal endpoint that takes a
reference or id, all three wrong targets return the identical 404.

Enumeration rather than sampling is what SC-002 and SC-003 ask for in words, and it is the mechanism
this project already uses for security properties: Phase 1's permission matrix over the whole catalog
and Phase 3's 36-pair lifecycle test that reads `TRANSITIONS` directly. A portal endpoint added later
without a scope is then a failing test rather than a leak nobody thought to look for.

---

## 2. The projection

### The frozen key set

`PortalTicketView` is built by `portal-ticket.service.ts` field by field. It is never a Sequelize
instance, never a spread of one, and never `toJSON()` with deletions.

```text
PortalTicketView = {
  reference:      string          // TKT-000042 — never the id (FR-065)
  subject:        string
  description:    string | null
  state:          CustomerState   // from portal/customer-status.ts (D7)
  isSettled:      boolean         // resolved or closed — drives the rating and reply affordances
  raisedAt:       string
  lastChangedAt:  string
  category:       string          // taxonomy key, rendered from i18n
  priority:       string          // taxonomy key, rendered from i18n
  satisfaction:   { score, comment, submittedAt } | null
  messages: [{
    direction:    'inbound' | 'outbound'
    channel:      Channel         // which channel it travelled on
    occurredAt:   string
    body:         string
    attachments:  [{ id, fileName, contentType, byteSize }]
  }]
}
```

`projection.test.ts` asserts that `Object.keys` of the response — and of each message — **equals** this
list, on a ticket fixture carrying every excluded thing below. Equality, not containment: a field added
to the composer fails the test, which is the point (FR-030).

### Never present

Absent from the **response body**, not hidden in the interface. Constitution Principle II is explicit
that hiding is not a control.

| Excluded                                              | Owner    | Why                                                                      |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| Internal notes, note mentions                         | Ph. 2/4  | FR-031. Written to colleagues, about the customer                        |
| Tasks                                                 | Ph. 4    | FR-031                                                                   |
| Assignee identity, assignment history                 | Ph. 3/4  | FR-031. Also a staff-safety matter, not only a privacy one               |
| SLA targets, countdowns, breach state                 | Ph. 6    | FR-031, and Phase 6 said it would be excluded                            |
| Automation runs, rule names                           | Ph. 6    | FR-031                                                                   |
| Merge and duplicate-override records                  | Ph. 3    | FR-031. Says a colleague or another customer raised the same thing        |
| `is_provisional`                                      | Ph. 5    | FR-031. An internal judgement about the customer's own record            |
| Internal status names (`escalated`, `pending`)         | Ph. 3    | FR-028 — mapped to a customer state (D7)                                 |
| Ticket, customer, contact, user, article **ids**       | —        | FR-065. `reference` and `slug` are the handles                            |
| `created_by_user_id`, any `users` row or name          | Ph. 1    | No staff identity crosses the boundary                                    |
| `ticket_history` of any kind                           | Ph. 3    | Correspondence only — Phase 5's property, preserved                       |
| Inline attachments                                     | Ph. 5    | Signature logos and tracking pixels bury the real file (Phase 5 FR-036)   |
| Internal (agent-uploaded, non-correspondence) files     | Ph. 2    | FR-033. Near the ticket is not part of the conversation                   |

### Why the message list is safe to include

Phase 5 built the timeline over `messages` and nothing else — no `ticket_notes`, no `ticket_history` —
and said why in `timeline.service.ts`:

> _"That is not a layout preference: it means the structure Phase 8 will build a customer-facing view
> on contains nothing internal to leak. A later phase that adds notes or history here destroys that
> property, and it will not be obvious that it has."_

This phase is the beneficiary and must not be the phase that breaks it. Two obligations follow:

1. The portal reads `messages` directly through its own scoped query. It does not add anything to the
   timeline structure.
2. `projection.test.ts` is the guard against the "not obvious" part. A future phase that adds internal
   content to `messages` breaks a named test rather than quietly widening a customer's view.

### Outbound message bodies

An outbound message body is what an agent sent the customer, so it is already customer-facing text and
goes out verbatim. It is rendered as **text**, never as HTML — `body_format: 'html_source'` exists for
inbound email, and rendering stored HTML in the portal would be a stored-XSS surface for the price of
prettier quoting.

---

## 3. What the customer state mapping may and may not do

`portal/customer-status.ts` (D7) is a total function over `TICKET_STATUSES`. Adding a seventh status to
Phase 3's lifecycle without extending the mapping is a **type error**, not a runtime fallback — the same
property `TRANSITIONS` gives, where an undeclared pair is refused rather than defaulted.

| Internal            | Customer state | Rating offered | Reply offered      |
| ------------------- | -------------- | -------------- | ------------------ |
| `new`               | `received`     | no             | yes                |
| `open`              | `in_progress`  | no             | yes                |
| `escalated`         | `in_progress`  | no             | yes                |
| `pending`           | `awaiting_you` | no             | yes                |
| `resolved`          | `resolved`     | **yes**        | yes → **reopens**  |
| `closed`            | `closed`       | **yes**        | **no** (D9)        |

The mapping is not injective and must not be made so: `open` and `escalated` deliberately collapse,
because the difference between them is the organisation's internal posture (FR-028).

`pending → awaiting_you` is the one judgement in the table and is research open question 1. If
`pending` is used operationally for "waiting on a third party", this line tells a customer to act when
they cannot — one line, one file, one word.
