# Phase 0 Research: Phase 8 — Customer Portal

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

Fifteen decisions. Each was forced by reading the existing code, not chosen from preference — and in
three cases the code says something different from what the spec assumed, which is recorded here
rather than discovered during implementation.

The phase has two hard problems and everything else is ordinary work. The first is that this codebase
has exactly one notion of "authenticated" and it means `users`. The second is that portal visibility
is per **contact** (Clarifications Q2) and no ticket in the database records which contact it came
from. D1–D3 answer the first. D4–D5 answer the second.

---

## D1 — Realm separation: two more secrets and a realm-named token type

**Decision.** Portal sessions are signed with **new, separate secrets** —
`PORTAL_JWT_ACCESS_SECRET` and `PORTAL_JWT_REFRESH_SECRET` — and carry
`type: 'portal-access'` / `'portal-refresh'`. `portal-token.service.ts` exports its own
`signPortalAccessToken` / `verifyPortalAccessToken`, and the subject is a `portal_accounts.id`, not a
`users.id` and not a `customers.id`. `env.ts`'s existing refinement is extended so all four secrets
must be pairwise distinct.

**Rationale.** This is not a new pattern — it is the pattern Phase 1 already chose, applied to a
second axis. `token.service.ts` says so in its own words:

> _"Distinct secrets make cross-use cryptographically impossible; the `type` assertion makes the
> rejection explicit and testable. Both are deliberate (research.md D5) — neither is redundant with
> the other."_

Phase 1 used it to stop a refresh token being presented as an access token. FR-012 needs the same
property between realms, and gets it for the cost of two environment variables. The consequence is
the one the spec asked for: a staff token handed to `verifyPortalAccessToken` fails **signature
verification**, before any claim is read, and a portal token handed to `verifyAccessToken` fails the
same way. There is no code path in which a missed check produces escalation, because the failure is
cryptographic rather than conditional.

The starting position made this urgent rather than merely tidy. `verifyAccessToken` returns
`{ id, email }` and `middleware/authenticate.ts` passes that `id` straight to
`authService.getSessionContext(id)`, which is `User.findByPk(id)`. A portal token signed with
`JWT_ACCESS_SECRET` and shaped the same way would therefore have resolved to **the staff user whose
id equals the customer's id** — a real account, with a real role, and whatever permissions it holds.

**Alternatives considered.**

- **One secret plus a `realm` claim.** Rejected. Every verification site becomes a place where
  forgetting one comparison grants full staff access. The whole point of Phase 1's note is that the
  claim is the *legible* half of the defence, not the load-bearing half.
- **Reusing the access secret with a different subject namespace** (e.g. `portal:41`). Rejected for
  the same reason, and worse: string parsing in the security path.
- **A separate process or service for the portal.** Rejected as infrastructure the project has
  deliberately avoided since Phase 0, and it would not remove the need for realm-distinct tokens
  anyway.

---

## D2 — The portal account is its own table, keyed to a contact

**Decision.** A new `portal_accounts` table with a **unique** `customer_contact_id`. It carries the
credential and the lockout state, mirroring the two columns Phase 1 put on `users`
(`failed_login_attempts`, `locked_until`) rather than sharing them. It does **not** carry a
`customer_id`: the customer is the contact's customer, derived by join.

**Rationale.** Three candidate homes existed, and two are wrong for reasons already written down in
this codebase.

`users` is wrong because `user.model.ts` and Phase 1's tests treat every row as a staff member: a
customer there would appear in assignment pickers and user lists, would need a `role_id`, and would
count toward the last-administrator invariant. A column on `customers` is wrong because
Clarifications Q2 makes the credential belong to a *contact*, and a company record has several.

Keying on `customer_contacts.id` with a unique index makes "one account per contact" a schema fact
rather than a service rule, and makes two accounts on one company record independent by construction
(FR-003a). Omitting `customer_id` follows the reasoning `timeline.service.ts` states for messages —
_"NO customer_id ON MESSAGES … a denormalised copy would be a second place for the truth to live,
which FR-019's customer merge would then have to keep in step."_ Phase 2's merge moves contacts
between customers; a copied `customer_id` here would be a second thing for it to update, and a stale
one would mean a portal account pointing at the wrong company.

`ON DELETE CASCADE` from the contact gives FR-003b for free: Phase 2 can remove a contact, and the
account goes with it rather than resolving to nothing.

**Alternatives considered.**

- **A `role_id` on the portal account** so the portal could have roles. Rejected — the spec puts
  portal-side roles out of scope, and an unused column invites someone to invent a meaning for it.
- **Reusing `password_history`** for portal credentials. Rejected: its rows reference `users`, and
  the spec sets no reuse-prevention requirement for the portal.

---

## D3 — Invitations: a hashed, single-use, revocable row, delivered by calling the email adapter

**Decision.** A `portal_invitations` table holding a **hash** of a random token, its
`customer_contact_id`, `issued_by_user_id`, `expires_at`, and nullable `accepted_at` / `revoked_at`.
Delivery calls `adapterFor('email').send(...)` **directly** and writes no `messages` row. All four
failure modes — expired, accepted, revoked, never existed — raise one identical error.

**Rationale.** The delivery mechanism is already precedented: `alert.service.ts` sends staff email by
importing the registry and calling the adapter, and Phase 6's plan states why it writes no `messages`
row — _"`messages` is the correspondence structure … Phase 8 will build a customer-facing view on
it. Operational traffic must not enter it."_ An invitation is operational traffic about an account,
not correspondence about a request, so it follows the alert path exactly. It also means the portal
inherits a working mail path with no new transport.

Storing a hash rather than the token is Phase 1's rule for secrets applied to a secret that grants
account creation. A leaked `portal_invitations` table must not be a list of live invitations.

The identical-refusal rule is FR-002c, and it is cheaper to get right by throwing before the
distinction exists than by remembering to flatten four error types at the controller.

**Alternatives considered.**

- **A signed stateless invitation** (a JWT, no table). Rejected outright: FR-002c requires
  revocation, and a stateless token cannot be revoked without a table — at which point the table is
  the design.
- **Emailing a temporary password.** Rejected. A password sitting in an inbox is a password sitting
  in an inbox, and it collides with Phase 1's refusal to hold recoverable secrets.
- **Reusing the chat widget's opaque conversation token** (Phase 5 D14). Rejected by FR-011, and the
  spec explains why: a token held by an unverified visitor and scoped to one conversation is not an
  identity.

---

## D4 — `tickets.requesting_contact_id`, nullable, with a deterministic backfill

**Decision.** One new nullable column on `tickets`, an FK to `customer_contacts`. Set at all four
points a ticket is born. `NULL` means invisible in the portal. A one-time backfill migration
associates a ticket **only** where its earliest inbound message's `sender_identity_normalised`
matches exactly one contact on that ticket's own customer; where zero or two match, it leaves the
column NULL.

**Rationale.** Clarifications Q2 needs an association the schema does not have. `ticket.model.ts`
carries `customer_id` and nothing narrower, so per-contact visibility is not a filter that can be
written today — the data does not exist. This column is the phase's second-largest piece of work
after D1–D5, and it touches four existing call sites:

| Where a ticket is born             | What sets the association                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Portal submission (new)            | The session's own contact (FR-026b) — from the session, never the request                        |
| `intake.service.createTicketFor`   | The contact `identityService.resolveOrCreate` matched or created (FR-026c)                        |
| Public form submission             | The contact matching the submitted address (FR-026d) — the same resolution path                   |
| Agent-created ticket               | Optional, offered in the form, allowed to stay NULL (FR-026e)                                     |

`identity.service.resolve` already looks up `customer_contacts.value_normalised` and returns the
matched contact, so three of the four are a value already in hand being passed one level further
down rather than new logic.

The backfill is deliberately narrow. `messages.sender_identity_normalised` exists and is populated by
the same normaliser that wrote `customer_contacts.value_normalised`, so an exact match between them
is a fact, not a guess. Two contacts matching is possible (the same address recorded twice) and the
migration declines rather than picking — FR-026g says so, and a wrong association here is a
disclosure, not a cosmetic error.

**Alternatives considered.**

- **A `ticket_contacts` join table.** Rejected: it permits two contacts per ticket, and then portal
  visibility becomes a set operation whose empty case is ambiguous. One column makes "exactly one
  requester" unrepresentable otherwise — the same argument Phase 3 used against a stored reference.
- **`NOT NULL` with a default.** Rejected by FR-026e: an agent raising a ticket during a phone call
  may genuinely not know which contact, and a default would invent a requester.
- **Deriving visibility on read** from the ticket's messages, with no column. Rejected: it makes
  every portal read a join over `messages`, it silently changes a ticket's visibility when new
  correspondence arrives, and a ticket with no messages (agent-created) has no answer at all.
- **A wider backfill** using fuzzy or name matching. Rejected — see FR-026g. The failure mode is
  showing one person another person's ticket.

---

## D5 — One scope function, applied in the query, proven by a generated test

**Decision.** A single `portalScope(session)` builds the ticket constraint
(`customer_id = … AND requesting_contact_id = …`), and **every** portal read applies it inside its
`WHERE`. A generated test enumerates every portal endpoint and asserts that each one refuses (a) a
ticket on another customer, (b) a ticket belonging to a colleague on the same customer record, and
(c) a ticket with no association — all three with the same response as a nonexistent record.

**Rationale.** FR-016 forbids post-filtering, and this codebase already knows why: the timeline
service applies its visibility filter _"HERE rather than after loading, so that when a later phase
narrows ticket visibility this service narrows with it instead of quietly disclosing."_ One function
means the narrowing has one place to be correct.

The generated test is the load-bearing half. This project has two precedents for proving a security
property by enumeration rather than by sampling — Phase 1's permission matrix over the whole
catalog, and Phase 3's 36-pair lifecycle test that reads `TRANSITIONS` directly. SC-002 and SC-003
both say "across the full endpoint set, not a sample", so the endpoint list is declared once (D10)
and the test iterates it. A portal endpoint added later without a scope is then a failing test rather
than a leak nobody looked for.

**Alternatives considered.**

- **A Sequelize default scope on `Ticket`.** Rejected: a model-level default that changes behaviour
  depending on who is asking is exactly the business logic Principle III keeps out of models, and it
  would silently apply to staff queries too.
- **Per-endpoint ownership checks.** Rejected: n places to be right, and the failure is silent.

---

## D6 — `portal` is a sixth channel: replyable, no transport, self-delivered

**Decision.** Add `PORTAL: 'portal'` to `CHANNELS`, include it in `REPLYABLE_CHANNELS`, and give it
an adapter whose `send` performs no network call — the message is delivered by being readable in the
portal. Outbound portal messages are written `sent`, and become `read` when the owning contact's
portal actually returns them. `portal` is excluded from `assertProductionReady` (as chat and form
are) and from opt-out enforcement. `TICKET_SOURCES` gains `'portal'`.

**Rationale.** The alternative looked cheaper and does not work. `message.service.conversationFor`
derives the reply channel and recipient from _"the most recent inbound message"_ filtered to
`REPLYABLE_CHANNELS`, and returns `null` otherwise — so if `portal` were inbound-only like `form`, a
portal-submitted ticket would have **no reply path at all**. That is a real hole Phase 5 already left
for form submissions, and inheriting it here would break PLAN.md's Definition of done: a customer who
raises a request in the portal and can never be answered in it has not been given a conversation.

Making it replyable costs one adapter of the shape `channels/form/inbound.ts` already demonstrates,
inverted — that one refuses `send` and this one refuses nothing. No provider, no credential, no
`CHANNEL_PORTAL_PROVIDER`; this system is the provider, which is the reasoning the registry already
records for `chat`.

Two consequences are worth stating rather than discovering:

- **`read` is honest here.** Phase 5's `DELIVERY_STATES` ladder exists because
  _"`pending` and `sent` are NOT `delivered`"_ — an agent who believes an answer arrived stops
  chasing it. The portal is the only channel in this project that can report `read` truthfully with
  no provider, because the read happens against our own endpoint. Reporting it is a small addition
  that makes the ladder more honest, not less.
- **Opt-out must not apply.** `message.service.send` refuses a send to an opted-out identity. A
  customer cannot meaningfully opt out of the portal they signed into, and FR-037 forbids opt-out
  reducing what they can read. `portal` is therefore excluded at the opt-out check, deliberately and
  in one place.

**Alternatives considered.**

- **Inbound-only, agents reply by email to the contact's address.** Rejected. It requires
  `conversationFor` to accept a recipient derived from the customer record rather than from the
  conversation, and that function's comment states precisely why it does not: _"That is the
  difference between answering a customer and being a mail relay for anyone holding
  `messages:send`."_ Widening it is a Phase 5 change with Phase 5 consequences.
- **Reusing the `chat` channel.** Rejected: it would make the timeline lie about where a message
  came from, and Phase 5's channel labels are customer-visible.

---

## D7 — Customer-facing state is a declared mapping, not a second lifecycle

**Decision.** `portal/customer-status.ts` maps the six statuses to four customer states, and nothing
else in the portal reads `ticket.status`:

| Internal              | Customer state | Why                                                                                      |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `new`                 | `received`     | Truthful: it has arrived and nobody has picked it up. "Open" would overstate it.          |
| `open`, `escalated`   | `in_progress`  | FR-028 — escalation is the organisation's internal posture, not a state the customer acts on |
| `pending`             | `awaiting_you` | Verified against Phase 3's edges, not assumed — see below                                 |
| `resolved`            | `resolved`     | The state that invites a rating (FR-047)                                                  |
| `closed`              | `closed`       | Final; the boundary D9 uses                                                              |

**Rationale.** A mapping in one declaration file, read by the projection and by the i18n keys, keeps
Phase 3's lifecycle the only lifecycle — FR-028 and the spec's Assumptions both require that. Putting
it beside `tickets/lifecycle.ts` rather than in a service follows the precedent that file sets: a
declaration several layers read, holding no business decisions.

**One caution carried into the plan.** `pending` is mapped to `awaiting_you` on the strength of its
position in `TRANSITIONS` — it is the state `open` moves to and returns from, and the codebase treats
it as a hold. Phase 3 does not define in words *whose* hold it is, and if it is used operationally
for "waiting on a supplier" rather than "waiting on the customer", `awaiting_you` tells the customer
to act when they cannot. This is a one-line change in one file if so, and it is listed as open
question 1 rather than assumed silently.

**Alternatives considered.**

- **Showing the internal status name.** Rejected by FR-028 — `escalated` is not information a
  customer can use, and it invites the question "escalated to whom?".
- **A `customer_status` column.** Rejected: two lifecycles to keep in step, and Phase 3's is the
  authority.

---

## D8 — Satisfaction: one row per ticket, uniqueness in the index

**Decision.** `ticket_satisfaction` with a **unique** `ticket_id`, a score on a 1–5 scale declared
once in `portal/satisfaction.ts`, an optional comment, the submitting contact, and a timestamp.
FR-054's reopen rule: **the first response stands.** A ticket reopened and re-resolved does not invite
a second rating.

**Rationale.** The unique index is what makes FR-049 and SC-016 structural. A check-then-insert would
pass every test and still admit two rows under a double submit, which is exactly the case a customer
double-clicking produces. Making the second insert fail at the database, and reporting "already
recorded", is the cheaper true thing.

"The first stands" is chosen over "the latest wins" because the alternative lets a ticket's score
change after Phase 10 has counted it, and because a customer who has already told you the answer was
wrong has not withdrawn that by asking again.

**Alternatives considered.**

- **A rating per resolution event**, so a reopened ticket can be rated twice. Rejected: it makes
  "this ticket's score" a question with more than one answer, which FR-054 forbids and Phase 10's
  arithmetic would inherit.
- **Reusing an article rating mechanism.** There is none, by Phase 7's deliberate omission
  (FR-052).

---

## D9 — A reply on a settled ticket: the lifecycle boundary, not a new time window

**Decision.** A portal reply on a **resolved** ticket reopens it (`resolved → open`) as a **system**
transition. A **closed** ticket shows no reply box at all: the portal offers "raise a new request"
instead, so no message is ever accepted and discarded. The system transition is hard-coded to that
one edge.

**Rationale.** The spec's FR-036 offered "a defined window" as one shape of the rule. The lifecycle
already contains a better boundary, so inventing a second one would be a competing answer to a
question Phase 3 settled. `TRANSITIONS` says `resolved → open` needs `tickets:transition`, while
`closed → open` needs `tickets:reopen` — held only by a Supervisor — because _"closing finishes work,
reopening undoes something already finished."_ A customer reply that reopened a closed ticket would
route around that decision. Resolved is a state a conversation can still come back from; closed is
the one that cannot.

Phase 6's `LifecycleActor` already supports the system actor (`actor.id === null` skips the
permission check), so no new machinery is needed — but that same bypass is why the portal service
must name the target status as a constant rather than accept one, and why the transition is invoked
from exactly one place.

**Consequence for Phase 6.** Reopening restarts response-clock behaviour on a ticket the SLA machinery
had finished with. That is the correct outcome — the request is live again — and it is called out in
the plan's closeout so it is verified rather than assumed.

**Alternatives considered.**

- **A configurable reopen window in days.** Rejected as above: a second finality rule competing with
  the lifecycle's.
- **Accepting the reply on a closed ticket without reopening**, so it lands unanswered. Rejected: it
  is the silent discard FR-036 forbids, dressed as a stored row nobody is looking at.

---

## D10 — One portal router file, and the endpoint list is a declaration

**Decision.** `routes/portal/index.ts` mounts every portal endpoint, in one file, with the whole set
declared as an exported constant that both the router and D5's generated test read.
`middleware/authenticate-portal.ts` is applied by the router, once.

**Rationale.** FR-018 asks for the property `routes/public/index.ts` already provides, and that
file's own comment is the argument: _"Every other router in this project begins with `authenticate`;
this one deliberately does not, and keeping that exception in a single visible place is what stops it
spreading."_ The portal is the third surface with its own authentication rule, and the second
exception to "authenticated means staff". Enumerating it once means the reviewer sees the entire
customer-reachable surface at once, and the test iterates the same list rather than a hand-maintained
copy.

Portal authentication reads the account, the contact, and the customer **fresh on every request**,
mirroring `middleware/authenticate.ts`'s reasoning: the token carries no state claims, so
propagation of a withdrawal or a deactivation is immediate (FR-009, FR-060, SC-004) rather than
capped by a token's lifetime.

---

## D11 — Rate-limit scopes, reusing Phase 5's limiter

**Decision.** Six new scopes through `lib/rate-limit.ts`: `portal-auth`, `portal-invite`,
`portal-read`, `portal-submit`, `portal-reply`, `portal-search`. Unauthenticated portal endpoints
(sign-in, invitation acceptance, credential recovery) key on IP; authenticated ones key on the portal
account id.

**Rationale.** FR-010, FR-025, FR-045 and SC-022 all require one scope's exhaustion not to affect
another's, which is the property Phase 5 built the limiter's per-scope keying for and Phase 7 reused.
Keying authenticated scopes on the account rather than the IP is the difference that matters here: an
office behind one address is many customers, and IP-keying would let one of them lock out the rest.

The known limit is inherited and unchanged: the limiter is process memory, and Phase 4 deferred the
shared store to Phase 11.

---

## D12 — One permission key, and audit actions under `portal.*`

**Decision.** One new catalog entry, `portal:manage`. New audit actions namespaced `portal.*`
(`portal.invitation.issued`, `portal.invitation.accepted`, `portal.invitation.revoked`,
`portal.login.success`, `portal.login.failure`, `portal.account.locked`, `portal.account.unlocked`,
`portal.access.withdrawn`, `portal.credential.reset`, `portal.ticket.contact_associated`).

**Rationale.** FR-058 requires the key to be distinct from `customers:update` so access management is
grantable without customer editing. One key rather than four (invite/withdraw/unlock/associate)
because nothing in the spec distinguishes those audiences, and Phase 6's catalog note records the
same restraint. Phase 1's generated matrix test extends over the new key automatically.

There is deliberately **no `portal:view` key for customers.** Portal capability comes from holding a
portal session, not from a grant — the reasoning that kept `kb:read`, `timeline:view` and
`notifications:view` out of the catalog in earlier phases. A key every portal account holds
unconditionally cannot refuse anything, and putting customers in the staff permission catalog is the
realm confusion D1 exists to prevent.

---

## D13 — A third shell, and two token stores that cannot see each other

**Decision.** `PortalLayout.vue` plus `meta.portalShell`, making `App.vue`'s shell selection a
three-way branch. A separate Pinia store and a separate HTTP client instance for the portal, each
holding only its own token.

**Rationale.** `App.vue` currently branches on `route.meta.publicShell === true` for Phase 7's help
centre, and everything else gets `DefaultLayout`. The portal is neither: it is authenticated, so it
needs a shell with a sign-out control, a language switch, and customer navigation — but it must show
no staff navigation and no permission-derived menu (FR-063).

The two-client separation is the front-end half of D1 and matters as much. A single shared HTTP
client with one auth interceptor would attach whichever token it holds to whichever call is made — a
staff token to a portal endpoint, or a portal token to a staff endpoint. Both are refused server-side
by D1, so this is not a security hole, but it produces confusing 401s and invites someone to "fix" it
by relaxing the server. Two clients make the correct thing the easy thing.

---

## D14 — The projection type is the contract, and a test freezes its keys

**Decision.** `PortalTicketView` is an explicit interface built by a dedicated composer in
`portal-ticket.service.ts`, never a Sequelize instance and never a spread of one. A test asserts the
exact set of JSON keys in the response against a frozen list.

**Rationale.** FR-030 and FR-031 require that adding a field to an internal ticket surface cannot
make it appear here, and SC-008 requires that asserted against the response body. Composition alone
does not give that — someone adds one field to the composer and no test notices. Freezing the key set
means a new field is a deliberate edit to a test that says, in one place, what a customer may see.

Phase 5 established the underlying property and said so in `timeline.service.ts`: the timeline reads
`messages` and nothing else, so _"the structure Phase 8 will build a customer-facing view on contains
nothing internal to leak. A later phase that adds notes or history here destroys that property, and
it will not be obvious that it has."_ D14 is the guard against the "not obvious" part.

---

## D15 — Message attachments have no download endpoint yet; the portal builds the first one

**Decision.** Build a portal-scoped message-attachment download following Phase 2's controller
pattern, with a service lookup that takes the portal session and the attachment id and resolves them
together. The agent-side equivalent is **not** built here.

**Rationale.** FR-033 reads as a scoping requirement on an existing capability. It is not.
`message-attachment.service.findForDownload(attachmentId)` exists, does `findByPk`, and **has no
caller anywhere in the codebase** — `AttachmentView` exposes `{ id, fileName, contentType, byteSize }`
and no route serves the bytes. Phase 5 listed message attachments without ever making them
retrievable.

So this is a new endpoint, and it is the one place in the phase where a naive implementation is
actively dangerous: `findForDownload` takes an id and no scope, which is precisely the shape that
serves any attachment to any caller. The portal version takes the session first. Phase 2's
`getForDownload(customerId, attachmentId)` is the shape to copy, and its controller comment states
the rule the portal inherits — _"The storage directory is never mounted or served — serving it would
make an attachment reachable by anyone who obtains its address, which is the same defect as not
checking permission at all."_

Not building the agent-side download keeps the phase's boundary honest: it is Phase 5's gap, it is
recorded in the plan's outstanding items, and absorbing it silently would hide that agents have been
unable to open customer attachments since Phase 5.

---

## Open questions

1. **What does `pending` mean operationally?** D7 maps it to `awaiting_you`. If the organisation uses
   it for "waiting on a third party" rather than "waiting on the customer", the mapping tells
   customers to act when they cannot. One line in one file; wants a human answer before the phase is
   accepted, not a code change.
2. **May a provisional customer be invited?** FR-002f requires the rule to be enforced server-side
   and stated. The plan implements "yes, with a warning shown to the issuer", because forbidding it
   would leave every customer Phase 5 created automatically permanently unable to use the portal.
   Reversing it is a single guard.
3. **Invitation lifetime.** Implemented as `PORTAL_INVITE_TTL_HOURS`, default 168 (seven days) — long
   enough to survive a holiday, short enough that a forwarded mailbox is not a standing key. No
   requirement fixes it; the default is a judgement.
4. **Whether reopening on a customer reply should notify the previous assignee.** Phase 4's
   notification machinery makes it cheap, but nothing in the spec asks for it, and inventing a
   notification rule is Phase 4's business. Left out; noted so it is a decision rather than an
   omission.
