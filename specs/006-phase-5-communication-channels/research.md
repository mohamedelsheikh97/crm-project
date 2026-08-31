# Phase 0 Research: Phase 5 — Communication Channels

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

Decisions taken before design, each one resolving something the spec deliberately left to the plan,
or something the existing codebase forced. Every decision is written so a later phase can see what
was rejected and why.

---

## D1 — The channel adapter boundary

**Decision.** Every channel is reached through an adapter exposing exactly two capabilities:
`receive` (turn a provider's delivery into a normalised inbound message) and `send` (deliver an
outbound message and report what happened). The adapter is the only module allowed to know a
provider exists. Selection is by configuration: `CHANNEL_<NAME>_PROVIDER=simulator|<vendor>`.

**Rationale.** Clarifications Q1 fixes this shape, and FR-004 and FR-112 make it structural rather
than stylistic. The normalised inbound message is the seam: intake, identity resolution, threading,
the timeline, and the reply surface are written against it and never against a vendor payload. This
is the same move Phase 3 made with `tickets/lifecycle.ts` and Phase 4 with `lib/notification-hub.ts`
— one declaration that several layers read, so a substitution touches one file.

**Alternatives considered.** Per-channel services calling vendor SDKs directly (rejected: the vendor
shape leaks into the service layer, and Q1's promise that a provider swap is a configuration change
becomes false). A single generic "messaging provider" abstraction across all five channels
(rejected: email threading, WhatsApp's reply window, and SMS segmentation are genuinely different,
and one interface wide enough for all of them describes none of them).

---

## D2 — The simulator is a transport, not a mode

**Decision.** The simulator is an adapter like any other, selected by the same configuration
variable. It writes outbound messages to a local store an agent and a test can read, and accepts
inbound messages through a development-only endpoint. `env.ts` refuses to start when
`NODE_ENV=production` and any enabled channel resolves to the simulator.

**Rationale.** FR-005b and FR-005c. If the simulator were a global "test mode" flag, production
would be one environment variable away from silently sending nothing — the single worst failure this
phase can have, because it is invisible: tickets keep arriving, replies keep being marked sent, and
no customer ever hears anything. Making it an adapter means the refusal is a startup check against
real configuration, and the code path under test is the same code path that runs in production up to
the adapter boundary.

**Alternatives considered.** A `MOCK_PROVIDERS=true` flag (rejected for the reason above). Recorded
HTTP fixtures against the real vendor APIs (rejected: they need real credentials to record, which is
exactly the dependency Q1 removes, and they rot silently when a vendor changes).

---

## D3 — Email needs dependencies, and this is where the streak ends

**Decision.** Add three backend dependencies: `imapflow` (IMAP collection), `mailparser` (MIME
parsing), `nodemailer` (SMTP send).

**Rationale.** Phases 1–4 added no runtime dependency, and that was right each time — SSE is a wire
format, the scheduler is a `setInterval`, the hub is an `EventEmitter`. MIME is not in that
category. It is a decades-deep format with nested multiparts, transfer encodings, character sets,
and malformed real-world mail; a hand-rolled parser is a security surface and a permanent
maintenance burden, and the constitution's YAGNI rule is about speculative abstraction, not about
refusing to use a parser for a standardised format. This is recorded in Complexity Tracking rather
than waved through.

**Alternatives considered.** Requiring a mail provider with a JSON inbound webhook instead of IMAP
(rejected: it forces exactly the commercial dependency Q1 removed, and PLAN.md names SMTP/IMAP
explicitly). Hand-rolling a "good enough" MIME subset (rejected: "good enough" here means silently
mangling a customer's message, and FR-009 forbids showing agents a lossy rewriting).

---

## D4 — Threading is by recorded message identifier, never by subject

**Decision.** Every outbound email carries a `Message-ID` this system generates, and that identifier
is stored on the outbound message row. An inbound message threads by looking up its `In-Reply-To`
and each entry of `References` against stored identifiers. If none match, a signed conversation
token in the delivery address (`support+<token>@…`) is consulted. If that also fails, the message
starts a new ticket. Subject text is never consulted.

**Rationale.** FR-023 forbids subject-only threading, and for good reason: subject lines are edited,
translated, and prefixed by every mail client differently, and two unrelated customers writing
"Invoice question" would collide. `References` is what the standard provides and what every mail
client populates. The address token is the fallback for clients that strip headers, and being signed
means a guessed token cannot attach a stranger's message to someone else's ticket.

**Alternatives considered.** A visible reference in the subject, `[TKT-000123]` (rejected: FR-023,
and a customer who edits the subject silently forks their own conversation). Threading on sender
address plus a time window (rejected: it merges two genuinely different questions from the same
customer into one ticket, which is worse than splitting one question into two).

---

## D5 — Webhook signatures need the raw body, so the JSON parser must preserve it

**Decision.** `express.json()` in `app.ts` gains a `verify` callback that stashes the raw buffer on
the request. Webhook routes verify the provider's signature against that buffer before anything
parses or trusts the payload.

**Rationale.** FR-054 and FR-064. A signature is over the exact bytes sent; re-serialising a parsed
object changes key order and whitespace and the signature stops matching. The alternative — mounting
webhook routers before the JSON middleware — works but splits the middleware stack in `app.ts`,
which currently has a fixed, commented order that Phases 0–4 have all respected. A `verify` callback
is four lines and leaves that order intact.

**Note for implementation.** `express.json({ limit: '100kb' })` is the current global limit. Webhook
payloads carrying media metadata can exceed it; the webhook routes need their own larger limit, and
that limit is the FR-010 size ceiling rather than an arbitrary number.

**Alternatives considered.** Verifying against the re-serialised body (rejected: intermittently
fails, which is worse than always failing). Skipping verification for the simulator (rejected: the
simulator should exercise the verification path, or the path is untested until production).

---

## D6 — Identity resolution is one service with three outcomes

**Decision.** A single `identity.service.ts` answers one question — *which customer does this sender
belong to?* — with exactly three outcomes: `resolved` (one match), `ambiguous` (more than one), or
`unknown` (none). Matching is an exact lookup on `customer_contacts.value_normalised`, normalised
through the existing `lib/phone.ts`. On `unknown`, a provisional customer is created. On `ambiguous`,
nothing is chosen and the ticket is flagged for a person.

**Rationale.** FR-011–FR-016 and Clarifications Q2. `lib/phone.ts` already is the single
normalisation site and `customer_contacts.value_normalised` is already indexed for Phase 2's
duplicate check — the lookup this phase needs is the lookup Phase 2 built. Three outcomes rather
than a nullable customer id is deliberate: `ambiguous` and `unknown` are different situations with
different handling, and collapsing them into "no customer" is how one silently becomes the other.

**Alternatives considered.** Fuzzy or domain-based matching, e.g. attributing anyone at
`@acme.com` to Acme (rejected by FR-016: a shared corporate domain is not an identity, and being
wrong here discloses correspondence). Matching against ticket history rather than contacts
(rejected: FR-011 fixes contacts as the only source, and history is a derived signal that drifts).

---

## D7 — Provisional customers are a flag on Phase 2's table, not a new kind of record

**Decision.** Add `customers.is_provisional`. A provisional customer is an ordinary customer in
every respect except that it is marked as system-created and unverified. Merging one into a real
customer uses Phase 2's existing `duplicate.service.findDuplicates` and its merge path unchanged.

**Rationale.** Clarifications Q2, FR-014a–FR-014d. A separate "pending contact" table would mean
every consumer — the Phase 4 queue, the context panel, the timeline, Phase 10's reporting — needs to
understand two kinds of customer, and each of them would have to remember. A flag means they all
keep working and only the places that must distinguish (FR-014b) look at it.

**Consequence worth recording.** This makes `customers` the first table in the project the outside
world can cause rows in. FR-020 and the intake rate limits (D11) are the whole of the defence, and
Phase 10's reporting must not count provisional customers as onboarded ones.

**Alternatives considered.** A nullable `customer_id` on tickets for unknown senders (rejected in
the spec's Q2, and confirmed here: `tickets.customer_id` is `NOT NULL` and every Phase 3 and Phase 4
consumer assumes it). A separate `unidentified_senders` table promoted on confirmation (rejected:
two tables holding the same shape, and correspondence stranded on the wrong one during promotion).

---

## D8 — A reply to a closed ticket creates a linked ticket. It does not reopen.

**Decision.** An inbound message that threads to a `closed` ticket creates a **new ticket linked to
the closed one** through Phase 3's existing `ticket_links`, carrying the message. The agent sees the
link. Reopening remains a human act.

**Rationale — this corrects an assumption in the spec.** The spec's Assumptions proposed "a reply to
a closed ticket reopens it where Phase 3's lifecycle permits". Reading
`backend/src/tickets/lifecycle.ts` shows that it does not permit it: `closed → open` is declared with
permission `tickets:reopen`, which Phase 3 Clarifications Q2 deliberately restricted to Supervisors,
on the stated reasoning that reopening undoes something already finished. An inbound message has no
actor and therefore holds no permission. Honouring the assumption would require the intake path to
bypass a permission the lifecycle declares — precisely the kind of second enforcement path
Principle II exists to prevent.

Linking instead satisfies FR-025 (one declared rule, applied on every channel, visible to the agent)
using machinery Phase 3 already built, and leaves the Supervisor-only reopen rule intact. A
Supervisor who wants the old ticket reopened can still do it, deliberately.

**Alternatives considered.** A system bypass of `tickets:reopen` (rejected: it creates a second path
through the lifecycle gate, which is the failure Phase 3's generated matrix test exists to catch).
Appending the message to the closed ticket without reopening (rejected: a message nobody is working
sitting on a closed ticket is a lost customer, and FR-025 requires the outcome to be visible).

---

## D9 — Tickets gain a source, and `created_by_user_id` becomes nullable

**Decision.** Add `tickets.source` (`manual`, `email`, `whatsapp`, `sms`, `chat`, `form`) and relax
`tickets.created_by_user_id` to `NULL`. A ticket with a null creator and a non-`manual` source is
one the system created.

**Rationale.** FR-026 requires a system-created ticket to be distinguishable from a hand-created
one, and `created_by_user_id` is currently `NOT NULL`. The two candidate solutions are a seeded
"system" user or a nullable column plus a source. A system user is worse than it looks: it appears
in user lists and assignment pickers, it needs a role and a password hash, and Phase 1's
last-administrator tests and Phase 4's ownership matrix would both have to learn to ignore it.

**Alternatives considered.** A seeded system user (rejected above). Inferring the source from the
presence of messages (rejected: an agent who creates a ticket by hand and then sends an email reply
would be misreported as an email intake).

---

## D10 — Chat rides Phase 4's SSE pattern; no WebSocket dependency

**Decision.** Visitor → server is an ordinary authenticated-by-token POST. Server → visitor and
server → agent are Server-Sent Events, the same shape Phase 4 established. `lib/notification-hub.ts`
is generalised from a `user:{id}` channel key to an opaque channel key, keeping its publish /
subscribe / unsubscribe surface unchanged.

**Rationale.** Phase 4 already proved this transport in this codebase, with a documented reason for
consuming it via `fetch` rather than `EventSource`. Chat traffic is low-frequency and each direction
has a natural carrier already. Adding a WebSocket library would introduce a second real-time
mechanism with its own authentication story for the sake of a message rate a human can type.

**Constraint carried forward.** The hub is process memory. Phase 4 recorded the single-process limit
in its Complexity Tracking and deferred lifting it to Phase 11; chat inherits that limit exactly and
does not worsen it. A dropped connection costs latency, never a message, because every message is a
row before it is an event — the Phase 4 ordering rule applies unchanged.

**Alternatives considered.** WebSockets via `ws` or Socket.IO (rejected above). Client polling
(rejected: FR-071 requires messages to pass without reloading, and polling at conversational latency
costs more requests than a held stream).

---

## D11 — Rate limiting is a small in-process limiter in `lib/`

**Decision.** A fixed-window counter in `lib/rate-limit.ts`, keyed by a caller-supplied string, used
as middleware on every public endpoint and as a plain function inside the intake path. No new
dependency.

**Rationale.** FR-078, FR-086, FR-099, FR-105. The semantics needed are a counter and a window; the
project has precedent for writing infrastructure of exactly this size itself (`scheduler.ts`,
`notification-hub.ts`). The single-process limit is already accepted and recorded, and a per-process
limiter under that constraint is honest rather than approximate.

**Alternatives considered.** `express-rate-limit` (a reasonable choice; rejected only because the
required behaviour is smaller than the configuration surface, and this phase is already adding three
dependencies in D3). A shared store such as Redis (rejected: it introduces infrastructure this
project does not have, to solve a multi-process problem this project does not yet have).

---

## D12 — Automated mail is detected by headers, and loops are bounded by a counter

**Decision.** A message is treated as automated when it carries `Auto-Submitted` other than `no`
(RFC 3834), a `Precedence` of `bulk`, `list`, or `junk`, an `X-Auto-Response-Suppress` directive, or
an empty return path. Automated mail is recorded in the intake ledger and converted to nothing.
Separately, exchanges with any one sender are bounded per window, and reaching the bound is recorded.

**Rationale.** FR-029 and FR-030. Header detection catches the well-behaved majority; the counter is
what stops the badly-behaved minority, and the two together are the standard defence. Both are
needed: headers alone fail against a naive auto-responder, and a counter alone would create a ticket
for every out-of-office before the bound engages.

**Alternatives considered.** Subject-prefix matching on "Out of Office" / "Automatic reply"
(rejected: language-dependent, and this project is bilingual by constitution). Never replying
automatically at all (rejected: not a choice this phase makes — the loop risk comes from the
customer's responder answering an agent's genuine reply).

---

## D13 — One intake ledger serves idempotency, retention, and the audit trail

**Decision.** A single `channel_intake` table records every accepted inbound delivery: its channel,
the provider's identifier, when it arrived, what became of it (`converted`, `ignored`, `failed`), the
reason if any, and the raw payload. The provider identifier is uniquely indexed per channel.

**Rationale.** Three requirements that look separate are one table. FR-007, FR-039, FR-055 and
FR-094 (idempotency) need a record of what has been seen — that is the unique index. FR-037 and
FR-038 (nothing lost, reprocessable) need the raw payload retained with its failure reason — that is
the same row. FR-101 (an administrator can determine what arrived and what became of it) is a query
over it. Three tables holding overlapping subsets of this would drift.

**Alternatives considered.** A processed-ids table plus a dead-letter table (rejected: a message that
fails is exactly a message that was seen, so the two tables would hold the same rows with different
lifetimes). Idempotency by unique index on the message row itself (rejected: an ignored or failed
delivery produces no message row, so the very deliveries most likely to be redelivered would not be
recorded).

---

## D14 — The chat widget is a second build output, not a route in the app

**Decision.** The widget is a separate Vite entry producing a standalone bundle, embeddable with one
script tag on a page the organisation controls. It shares the locale files and nothing else. Visitor
identity is an opaque high-entropy token issued when the conversation starts, stored on the session
row and held in the visitor's browser; it authorises exactly one conversation.

**Rationale.** FR-068 requires embedding without the host page reaching any authenticated interface,
and FR-075 requires a visitor to reach only their own conversation. Shipping the main SPA to a
third-party page would put the whole authenticated application — its routes, its stores, its API
client — on a page the organisation does not fully control. An opaque per-conversation token is the
smallest credential that does the job: it is not a user, it grants nothing but one conversation, and
revoking it is deleting a row.

**Alternatives considered.** An iframe of an app route (rejected: still ships the app, and adds
cross-frame messaging for the sizing and focus behaviour a11y needs). A JWT for visitors (rejected:
a token format that carries claims implies a principal, and a visitor is not one — an opaque
capability is the honest model).

---

## Resolved: nothing outstanding

Every `NEEDS CLARIFICATION` from the spec was closed before this plan (Clarifications Q1–Q3, session
2026-08-30). No Technical Context field is unresolved. One spec **Assumption is corrected** by D8 and
is carried into `plan.md` under *Changed during planning*.
