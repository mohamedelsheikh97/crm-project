# Implementation Plan: Phase 8 — Customer Portal

**Branch**: `009-phase-8-customer-portal` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-phase-8-customer-portal/spec.md`

**PLAN.md Reference**: Phase 8 — Customer Portal

**Builds on**: Phase 7 — Knowledge Base, merged to `main` at `6744f02`

## Summary

Phase 8 hands a session to somebody the organisation does not employ. Two problems are hard and the
rest is ordinary work.

**"Authenticated" currently means one thing, and it means `users`.** `verifyAccessToken` returns
`{ id, email }`; `middleware/authenticate.ts` passes that id to `User.findByPk`. A portal token shaped
the same way and signed with the same key would have resolved to the staff user whose id equalled the
customer's. The fix is not new — it is Phase 1's own pattern applied to a second axis. Portal tokens
get **their own secrets** and a realm-named `type`, so a token from the wrong realm fails signature
verification before any claim is read (D1). Phase 1's `token.service.ts` already argues for exactly
this pair of defences; the portal is its second application, not its first.

**Per-contact visibility needs data the database does not have.** Clarifications Q2 scopes the portal
to the signing-in contact, and `tickets` records a customer and nothing narrower. So the phase adds
`tickets.requesting_contact_id`, sets it at all four points a ticket is born, treats `NULL` as
invisible, and backfills only where an existing ticket's earliest inbound sender address matches
exactly one contact (D4). Three of the four write sites are a value `identity.service.resolve`
already returns, passed one level further down. The fourth is the new portal submission.

Everything else follows from those two, plus three decisions worth flagging up front:

**The portal is a sixth channel, and it is replyable** (D6). Making it inbound-only like `form` looked
cheaper and does not work: `conversationFor` derives the reply path from the last inbound *replyable*
message, so a portal-only ticket would have no reply path at all — the hole Phase 5 left for form
submissions, inherited into the one phase whose Definition of done requires a conversation. The
adapter is `channels/form/inbound.ts` inverted: that one refuses `send`, this one performs no network
call because the message is delivered by being read.

**A reply on a settled ticket uses the lifecycle boundary, not a new time window** (D9). FR-036
offered a window; `TRANSITIONS` already has a better boundary. `resolved → open` is an ordinary
transition, while `closed → open` is Supervisor-only because _"closing finishes work, reopening undoes
something already finished"_. A customer reply reopens a resolved ticket and is not offered at all on
a closed one.

**Message attachments have no download endpoint anywhere in this codebase** (D15). FR-033 reads like a
scoping requirement on an existing capability; `findForDownload` exists with no callers and no route,
so it is a new endpoint. The portal builds the first one, scoped by session. The agent-side equivalent
stays Phase 5's gap rather than being absorbed silently.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22 LTS, both workspaces — unchanged from
Phases 0–7.

**Primary Dependencies**: **None added.** `jsonwebtoken` and `bcrypt` are already present from
Phase 1 and cover the portal realm; the email path for invitations is Phase 5's adapter, called
directly as `alert.service.ts` already does.

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Three new tables** — `portal_accounts`,
`portal_invitations`, `ticket_satisfaction`. **One altered table**: `tickets` gains a nullable
`requesting_contact_id` (D4) — the first alteration to `tickets` since Phase 6's due-date columns.
Two declaration changes: `CHANNELS` gains `portal` (D6) and `TICKET_SOURCES` gains `portal`.

**Testing**: Vitest across both workspaces, backend serially against `crm_support_test`. Three
generated or enumerated suites carry the phase:

- **The realm matrix** — every staff endpoint refused a portal token, every portal endpoint refused a
  staff token (SC-002), iterating the declared endpoint list rather than a sample.
- **The scope matrix** — every portal read attempted with another customer's ids, a colleague's ids,
  and an unassociated ticket's id (SC-003, SC-028, SC-029).
- **The projection key freeze** — the exact JSON key set of the customer ticket view (SC-008).

Phase 1's authorization matrix extends automatically over `portal:manage`. The portal is tested for
what it **cannot** reach, following Phase 7's public-surface precedent.

**Target Platform**: Linux/Windows server; evergreen browsers. The portal is the third front-end
surface after the staff application and Phase 7's help centre, and the first authenticated one that
is not the staff application. Phones matter more here than anywhere else in the project — a customer
checking a request is holding one.

**Performance Goals**: no new hot path. Portal reads are primary-key and indexed-FK lookups over one
contact's tickets, which is a smaller working set than any agent query. Knowledge search reuses Phase
7's token index unchanged.

**Constraints**:

- Portal and staff tokens are signed with **different secrets**; cross-realm use fails at signature
  verification, not at a conditional (D1, FR-012).
- Portal authentication reads the account, contact, and customer **fresh per request**, so withdrawal
  and deactivation propagate immediately rather than at token expiry (D10, FR-009, FR-060).
- Every portal read applies `portalScope` **inside the query**, never after loading (D5, FR-016).
- `requesting_contact_id IS NULL` means invisible in the portal — absence is never read as
  "visible to all" (D4, FR-026f).
- The customer ticket view is composed from a declared interface with a frozen key set; a field added
  to an internal surface cannot appear here (D14, FR-030, FR-031).
- **No portal endpoint accepts a file** (Clarifications Q3, FR-022). Not on submission, not on reply,
  not on a satisfaction comment.
- The portal exposes **no registration route** of any kind (FR-002a).
- Invitation tokens are stored hashed; expired, accepted, revoked, and nonexistent produce one
  identical refusal (D3, FR-002c).
- Satisfaction uniqueness is a database index, not a check-then-insert (D8, FR-049).
- The system-actor transition available to the portal is hard-coded to `resolved → open` (D9).
- `portal` is excluded from opt-out enforcement and from `assertProductionReady`, in one place each
  (D6, FR-037).
- Single backend process, inherited unchanged from Phases 4–7; the rate limiter is per process.

**Scale/Scope**: ~19 new backend endpoints across one new router, 3 new tables, 1 altered table, 1
new permission key, 10 new audit actions, 1 new channel and adapter, 2 new declaration files, 1 new
middleware, ~6 new services, 1 new front-end shell with ~7 views, and one new front-end HTTP client.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle                                       | Assessment                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — Bilingual-First & RTL** (NON-NEGOTIABLE)  | **At risk in a new way.** Every bilingual surface so far has been read by staff who chose to work here. The portal is read by customers who did not, so a missing Arabic key is not an internal blemish — it is what the organisation looks like. It also inherits Phase 7's one-language articles (Q3 there) and must not present them as a page that failed.                                                            |
| **II — Security by Default** (NON-NEGOTIABLE)   | **At maximum risk, higher than any previous phase.** This is the first authenticated non-staff identity, so the principle's own rationale — _"a permission gap found in Phase 8 is far more expensive than one caught in Phase 1"_ — is now literal. Two distinct hazards: realm confusion (a customer token accepted as staff) and scope leakage (a customer seeing a colleague's or another customer's correspondence). |
| **III — Layered Architecture** (NON-NEGOTIABLE) | **At moderate risk.** The temptation is a portal controller that reads models directly "because it's just the customer's own tickets", and a projection assembled by spreading a Sequelize instance.                                                                                                                                                                                                                    |
| **IV — Accessibility**                          | **At risk, and with the widest audience yet.** A staff screen is used by trained people; a portal is used by whoever the customer happens to be, including on a phone and with a screen reader.                                                                                                                                                                                                                          |
| **V — Phase-Gated Delivery**                    | **Passes.** `/speckit-specify` complete, three clarifications resolved, no markers remaining; this plan precedes `/speckit-tasks`; PLAN.md traceability tables are in the spec.                                                                                                                                                                                                                                        |

**Outcome: proceed to research with two named hazards** — realm confusion and scope leakage — each of
which gets a decision and an enumerated test rather than a review promise.

### Post-design re-evaluation

| Principle | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I**     | **Passes.** The portal shell carries the same language switch and root-level direction toggle as the staff application (D13) — no per-component flipping. Customer-facing states are i18n keys derived from a declared mapping (D7), never rendered from the internal status string, so there is no path by which an untranslated internal word reaches a customer. Phase 7's one-language articles keep their language badge (FR-043). The absent upload control's explanation (FR-022a) is locale text, not a hardcoded English sentence.                                                                                                                                             |
| **II**    | **Passes, and this is where most of the phase's design went.** Realm confusion is closed cryptographically (D1) rather than by convention, using the pattern Phase 1 already documented. Scope leakage is closed by one function applied inside every query (D5) and proven by enumeration over a declared endpoint list, not by sampling. Absence is uniform: another customer's record, a colleague's record, and an unassociated ticket all return what a nonexistent record returns (FR-017). `NULL` fails closed (D4). The projection's key set is frozen by test (D14). No inbound files at all (FR-022) removes upload-borne risk from the phase entirely. One new permission key, server-enforced, covered by Phase 1's generated matrix (D12). Withdrawal propagates per request, not per token (D10). |
| **III**   | **Passes.** `portal/customer-status.ts` and `portal/satisfaction.ts` are declarations beside `tickets/lifecycle.ts` and `auth/permissions.ts`, holding no business decisions — the placement precedent those files set. The channel adapter sits behind `channels/types.ts` like every other. Business logic is in services; the portal router delegates to controllers exactly as the others do; the projection is built by a service, never spread from a model.                                                                                                                                                                                                                     |
| **IV**    | **Passes.** Customer state carries text, not colour alone. The portal is built mobile-first, which no previous surface has been. Empty states are explicit everywhere and, per D4's fail-closed rule, "no visible requests" is a **normal** first experience for a newly invited customer rather than an error to be styled as one. Validation errors are announced, not only shown (FR-062).                                                                                                                                                                                                                                                                                        |
| **V**     | **Passes.** Artifacts complete; this section is the reviewer's gate before `/speckit-tasks`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Outcome: gate passes with no violations.** Four items are recorded in Complexity Tracking — the
second identity realm, the new column on `tickets`, the sixth channel, and the third front-end shell.
None is a principle violation; each is the kind of thing the constitution asks to be justified rather
than absorbed silently.

## Project Structure

### Documentation (this feature)

```text
specs/009-phase-8-customer-portal/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D15
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── portal-api.md         # Every portal endpoint, and the realm boundary
│   ├── visibility-contract.md # The scope function and the frozen projection
│   └── portal-ui.md          # Shell, screens, states, i18n, a11y
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── auth/
│   │   └── permissions.ts                  # + portal:manage (D12)
│   ├── channels/
│   │   ├── portal/inbound.ts               # NEW — no-transport adapter (D6)
│   │   ├── registry.ts                     # + portal case, + assertProductionReady exclusion
│   │   └── ...
│   ├── config/
│   │   └── env.ts                          # + 2 secrets, invite TTL, portal rate limits
│   ├── controllers/
│   │   ├── portal/                         # NEW — auth, tickets, replies, kb, satisfaction
│   │   └── admin/portal-access.controller.ts  # NEW — staff side (US8)
│   ├── db/
│   │   ├── migrations/                     # 3 new tables, 1 alter, 1 backfill (D4)
│   │   └── seeders/                        # portal:manage grant, portal channel setting
│   ├── middleware/
│   │   └── authenticate-portal.ts          # NEW — the second realm (D1, D10)
│   ├── models/
│   │   ├── portal-account.model.ts         # NEW (D2)
│   │   ├── portal-invitation.model.ts      # NEW (D3)
│   │   ├── ticket-satisfaction.model.ts    # NEW (D8)
│   │   ├── message.model.ts                # + CHANNELS.PORTAL, REPLYABLE (D6)
│   │   └── ticket.model.ts                 # + requesting_contact_id (D4)
│   ├── portal/
│   │   ├── customer-status.ts              # NEW — the status mapping (D7)
│   │   ├── satisfaction.ts                 # NEW — the score scale (D8)
│   │   └── endpoints.ts                    # NEW — the declared endpoint list (D10)
│   ├── routes/
│   │   └── portal/index.ts                 # NEW — ONE FILE, the whole surface (D10)
│   └── services/
│       ├── portal-token.service.ts         # NEW — the second realm's tokens (D1)
│       ├── portal-auth.service.ts          # NEW — sign-in, lockout, sessions
│       ├── portal-invitation.service.ts    # NEW — issue, accept, revoke (D3)
│       ├── portal-access.service.ts        # NEW — staff side, grant/withdraw (US8)
│       ├── portal-ticket.service.ts        # NEW — scope + projection (D5, D14)
│       ├── satisfaction.service.ts         # NEW (D8)
│       ├── intake.service.ts               # + contact association (D4, FR-026c)
│       ├── form.service.ts                 # + contact association (D4, FR-026d)
│       └── message.service.ts              # + portal channel handling (D6)
└── tests/
    └── portal/
        ├── realm.test.ts                   # THE REALM MATRIX (SC-002)
        ├── scope.test.ts                   # THE SCOPE MATRIX (SC-003, SC-028, SC-029)
        ├── projection.test.ts              # THE FROZEN KEY SET (SC-008)
        ├── invitations.test.ts             # single-use, expiry, revocation, uniform refusal
        ├── reply.test.ts                   # reopen on resolved, refused on closed (D9)
        ├── satisfaction.test.ts            # one per ticket, under concurrency
        └── no-uploads.test.ts              # no portal endpoint accepts a file (SC-030)

frontend/
├── src/
│   ├── layouts/
│   │   └── PortalLayout.vue                # NEW — third shell (D13)
│   ├── views/portal/                       # NEW — sign-in, accept invite, list, detail,
│   │                                       #       new request, help, rate
│   ├── stores/portal.ts                    # NEW — its own token, its own state (D13)
│   ├── services/portal-http.ts             # NEW — its own client (D13)
│   └── App.vue                             # publicShell → three-way shell selection
└── tests/portal/                           # scoping in the UI, RTL, empty states, mobile
```

**Structure Decision**: the two-workspace layout is unchanged. Two genuinely new backend areas appear.
`src/portal/` holds declarations several layers read — the status mapping, the score scale, the
endpoint list — on the reasoning that put `tickets/lifecycle.ts` and `auth/permissions.ts` outside
`services/`. `channels/portal/` is a sixth adapter behind the existing boundary, not a new pattern.
On the front end, `layouts/PortalLayout.vue` is the third shell and the first authenticated one
outside the staff application; the separate store and HTTP client are the front-end half of D1.

## Complexity Tracking

| Violation                                                              | Why Needed                                                                                                                                                                                                                       | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A second identity realm** — new tokens, new middleware, new account table | FR-001 and FR-012–FR-014. A customer must authenticate, and must not be a `users` row.                                                                                                                                            | Reusing `users` with a "customer" role was the cheap option and is the dangerous one: a customer would appear in assignment pickers and user lists, need a `role_id`, and count toward Phase 1's last-administrator invariant — and one forgotten permission grant would be an escalation. Reusing the access secret with a realm claim makes every verification site a place a missed comparison grants staff access (D1).                                                 |
| **A new column on `tickets`** (`requesting_contact_id`) and a backfill        | Clarifications Q2. Per-contact visibility is not expressible against the current schema — `tickets` records a customer and nothing narrower.                                                                                       | Record-wide visibility needed no column and was rejected in the spec: a company record routinely represents several people, and inviting one hands them their colleagues' requests. A join table permits two requesters and makes visibility a set operation with an ambiguous empty case. Deriving from messages on read changes a ticket's visibility when correspondence arrives and has no answer for an agent-created ticket (D4).                                     |
| **A sixth channel with no transport**                                  | FR-034–FR-036 and PLAN.md's "entirely without agent involvement". A customer must be answerable where they wrote.                                                                                                                  | Inbound-only, like `form`, leaves a portal-submitted ticket with **no reply path at all** — `conversationFor` reads the last inbound *replyable* message. That is the hole Phase 5 left for forms, and inheriting it breaks this phase's Definition of done. Replying by email instead requires `conversationFor` to take a recipient from the customer record rather than the conversation, which is the mail-relay widening that function exists to prevent (D6).          |
| **A third front-end shell**                                            | FR-063. The portal is authenticated but must expose no staff navigation or permission-derived menu.                                                                                                                                | Reusing `DefaultLayout` leaks staff chrome; reusing Phase 7's `publicShell` gives no sign-out, no language persistence, and no customer navigation. The addition is one branch in `App.vue` driven by route meta — the mechanism Phase 7 already introduced — plus one layout (D13).                                                                                                                                                                                       |

### Changed during planning

Recorded because each was forced by reading the existing code, not chosen from preference, and the
next phase will meet the consequences.

| Planned in the spec                                                | Will be built                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-033 "a customer MUST be able to retrieve attachments"           | **A new download endpoint**, not a scope added to an existing one                                          | `message-attachment.service.findForDownload` exists, does `findByPk`, and **has no caller and no route anywhere in the codebase**. Phase 5 listed message attachments without ever serving their bytes. The portal builds the first one, scoped by session first; the agent-side gap stays Phase 5's and is recorded below (D15).                                |
| FR-036 "reopening it within a defined window"                      | **Reopen on `resolved`; no reply box at all on `closed`** — the lifecycle boundary rather than a window     | `TRANSITIONS` already encodes finality: `closed → open` is Supervisor-only because _"closing finishes work, reopening undoes something already finished"_. A configurable window would be a second, competing answer to a question Phase 3 settled, and would let a customer reply route around a Supervisor-only edge (D9).                                     |
| FR-002 "an invitation"                                             | **A hashed token in a table**, and invitation mail sent by calling the email adapter directly              | A stateless signed invitation cannot be revoked, which FR-002c requires. Delivery follows `alert.service.ts` — adapter called directly, **no `messages` row** — because Phase 6 established that operational traffic must not enter the correspondence structure this phase builds a customer view on (D3).                                                     |
| —                                                                  | **`portal` excluded from opt-out enforcement**                                                            | `message.service.send` refuses a send to an opted-out identity. A customer cannot meaningfully opt out of the portal they signed into, and FR-037 forbids opt-out reducing what they can read. One exclusion, in one place (D6).                                                                                                                               |
| —                                                                  | **`read` reported as a delivery state on outbound portal messages**                                       | The portal is the only channel in this project that can know a message was read without a provider, because the read happens against our own endpoint. Phase 5 built the ladder because _"`pending` and `sent` are NOT `delivered`"_; using the honest rung where it is genuinely knowable strengthens that rather than diluting it (D6).                        |
| —                                                                  | **`portal/customer-status.ts`**, four customer states from six internal ones                              | FR-028 forbids exposing `escalated`, and the spec's Assumptions forbid a second lifecycle. A declared mapping in one file gives both. `pending → awaiting_you` is the one judgement in it and is open question 1 (D7).                                                                                                                                        |

### Changed during implementation

Recorded because each was forced by the code rather than chosen, and the next phase will meet the
consequences. Following the Phase 5, 6 and 7 precedent.

| Planned                                                                | Built                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two tables — `portal_invitations`, and nothing for password resets      | **ONE table with a `purpose` column** (`invitation` \| `password_reset`)                    | They are the same object: a one-time, expiring, revocable, hashed token emailed to a named contact and redeemed by setting a password. Every rule that matters is shared — single use, uniform refusal, delivery only to the contact's own address, never storing the token. A second table would have duplicated code that must refuse identically in four cases, and that is where a fifth case which refuses differently comes from.                                                              |
| Invitation mail carrying `JSON.stringify({ key, params })`, as every other outbound body does | **Bilingual PROSE, both languages in one message** (`portal/invitation-mail.ts`)            | `alert.service.ts`'s rule — "the key travels rather than prose" — was written for mail to AGENTS, who have an account, a stored language, and an application that resolves keys. An invitation goes to somebody with none of those; a JSON key in a customer's inbox is not a deferred translation, it is an unreadable email. Both languages, because this is the ONE message whose recipient's language is genuinely unknown: they have no account yet.                                            |
| `contactKindFor(channel)`                                              | **`contactKindFor(channel, identity?)`** — and a Phase 5 bug fixed                          | Found while implementing FR-026d. `form.service` picks a submission's identity from the first field typed `email` OR `phone`, so the channel cannot say which it is — and every form fell through to `'phone'`, normalising an email address as a phone number. It matched no existing contact, so **each submission created another provisional customer for a person the system already knew**. FR-026d cannot work without this. It also improves Phase 5's behaviour, which is stated here rather than slipped in. |
| `TicketInput.source` honoured for any caller                           | **Honoured only for a SYSTEM actor**                                                        | The staff controller passes `req.body` straight through, so without the rule an agent could post `source: 'portal'` and make a ticket they typed claim a customer raised it. Nothing breaks if they do, but `source` is the column an administrator reads to ask "which of these arrived on their own?", and an answer that can be typed is not an answer.                                                                                                                                          |
| `rateLimit(scope, limit)`, keyed by address                            | **`rateLimitKeyed(scope, limit, keyOf)`**, with authenticated portal scopes keyed on the ACCOUNT | An anonymous visitor IS their address, so the public surface had no alternative. An office behind one address is many customers: keying their portal reads on the IP means one person clicking quickly denies service to all their colleagues, which is a self-inflicted outage rather than a defence (D11).                                                                                                                                                                                        |
| A picker of the customer's contacts on the staff ticket screen          | **A plain contact-id field**                                                                | The picker is the better screen and needs an endpoint listing a customer's contacts for this purpose. The id field is what makes the capability reachable now — and without it, every ticket predating this phase stays permanently invisible to the customer who raised it. The smaller thing done deliberately rather than the better thing left undone.                                                                                                                                          |
| —                                                                      | **A separate portal refresh cookie, scoped to `/api/portal/auth`**                          | An agent testing the portal in the browser they work in is ordinary, and one cookie name would mean signing into one surface silently signing them out of the other. The path scoping also means neither realm's refresh token is ever sent to the other's endpoint — belt to D1's braces.                                                                                                                                                                                                          |
| A portal access-token lifetime was not specified                        | **10 minutes, against the staff session's 15**                                              | The access token is the one window in which a withdrawal is not yet enforced by the per-request freshness read, and a portal credential lives on a customer's own device — a shared laptop, a phone in a drawer — rather than a managed machine inside the building.                                                                                                                                                                                                                                |

#### One real bug the tests caught, and one guard that caught me

**The reopen never worked.** `reopenIfResolved` called
`ticketService.transition(id, { to: 'open' }, SYSTEM_ACTOR)` with no `version`, and `transition` calls
`assertVersion`, which throws `staleRecord()` for a missing one. So every customer reply on a resolved
request answered **409** instead of reopening it — the central behaviour of Clarifications D9, broken,
with nothing about the call site looking wrong. `backend/tests/portal/reply.test.ts` failed on it,
which is the whole argument for testing the journey rather than the unit: a service test of
`reopenIfResolved` written by the same hand would have mocked `transition` and passed.

**`portal:manage` had no probe.** `backend/tests/authorization.matrix.test.ts` requires every catalog
key to have either a route probe or a named conditional test, and refuses to let a key exist without
one — "a permission nothing checks is dead: it can be granted, it appears in the roles screen, and it
protects nothing." Adding the key without the probe crashed the parameterised test on
`PROBES[key].method`, and the crash left that file's fixtures behind, which in turn made **32 later
tests in the same run fail on data that should have been truncated**. Every one of those passed again
once the probe was added. Recorded because the second-order damage was far more alarming than the
cause, and the next person to see a wall of unrelated failures after adding a permission key should
know where to look first.

**One API change rippled into existing tests.** `IdentityOutcome` gained `contactId` (FR-026c), so two
assertions in `backend/tests/identity/resolution.test.ts` that compared the whole object with
`toEqual` needed the new field. Updated rather than loosened to `toMatchObject`: the point of those
two is that the outcome is EXACTLY these fields, and weakening them to make room would have thrown
that away.

#### Two tests corrected rather than the code

`backend/tests/portal/invitations.test.ts` originally asserted that every registration-shaped path
returns **404**. It does not: an unmatched path under the portal router meets `authenticate-portal`
before route matching gives up, so it answers 401. That is a different refusal rather than a weaker
one, and pinning the status would have made the test a description of Express's middleware ordering
rather than of FR-002a. It now asserts what the requirement actually says — **never succeeds, and
creates no account** — with the `PortalAccount.count()` assertion carrying the weight.

`backend/tests/portal/access-admin.test.ts` originally demanded a **200** from an agent editing a
ticket subject, as the contrast half of "the association is gated on `portal:manage`, not
`tickets:update`". It failed on an optimistic-locking `version` the test had guessed. The contrast is
the point, so it now asserts only that the edit is **not refused for lack of permission** — which is
the claim being made — rather than becoming a test about `version`.

### Non-violations worth recording

- **`src/portal/` outside `services/`** is not a new layer. It holds declarations — a status mapping,
  a score scale, an endpoint list — read by several layers and containing no business decisions,
  which is why `tickets/lifecycle.ts`, `auth/permissions.ts` and `channels/types.ts` sit there too.
- **No `portal:view` permission key.** Portal capability comes from holding a portal session, not
  from a grant. A key every portal account holds unconditionally cannot refuse anything — the
  reasoning that kept `kb:read`, `timeline:view` and `notifications:view` out of the catalog — and
  putting customers into the staff permission catalog is the realm confusion D1 exists to prevent.
- **A second lockout implementation** (`failed_login_attempts`, `locked_until` on `portal_accounts`)
  is not duplication of Phase 1's. Mirroring two columns is smaller than generalising an account
  abstraction across two realms whose only shared behaviour is counting to a threshold — and sharing
  the columns would mean sharing the table, which D2 rejects.
- **The portal reads Phase 7's help centre content through the authenticated router**, not the public
  one. Same service, same `audience: 'customer'` and `status: 'published'` literals, same results
  (FR-039). It is not a second content surface; Phase 7's Q1 asked this phase to decide, and reuse is
  the decision.
- **A customer-visible `read` state** is not SLA or internal-state disclosure. It is a fact about the
  organisation's own message, not about the organisation's targets, and FR-031's exclusions are
  untouched.

## Phase closeout

**PLAN.md Phase 8 Definition of done** — _"A customer can log in, raise and track a ticket, browse help
content, and rate the resolution — entirely without agent involvement."_

| Clause                               | Delivered by                                                                     | Verified by                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| "A customer can log in"              | `portal-token` + `portal-auth` + `authenticate-portal` (D1, D10)                 | `tests/portal/realm.test.ts` — the full endpoint matrix          |
| "raise … a ticket"                   | `portal-ticket.service` submission, `source: 'portal'`, contact set from session | `tests/portal/scope.test.ts`; agent-side queue assertions        |
| "and track"                          | `portalScope` + the frozen projection (D5, D14)                                  | `tests/portal/scope.test.ts`, `projection.test.ts`               |
| "browse help content"                | Phase 7's services, unchanged, behind the portal router (FR-039)                 | Parity test: portal results equal public results for one query   |
| "rate the resolution"                | `satisfaction.service` + unique index (D8)                                       | `tests/portal/satisfaction.test.ts`, including concurrent submit |
| "entirely without agent involvement" | The above, plus the portal channel making a reply answerable in place (D6)       | One end-to-end journey test with zero staff actions after invite |

**What the automated suite will not verify**, and is therefore owed to `quickstart.md`:

- **Whether the portal reveals anything by inference.** The tests prove specific reads are refused;
  they cannot prove that a count, a timestamp, or an error's timing does not tell a customer that a
  colleague's ticket exists. That needs a human trying to learn something they should not.
- **Whether `pending` should read as "awaiting you"** (open question 1). Every test passes under
  either mapping; only a person who runs support can say which is true.
- **Whether the invitation email is comprehensible** to somebody who was not expecting it, in both
  languages. A confusing invitation is indistinguishable from phishing, and the tests cannot tell.
- **The portal on a phone**, which is the device a customer checking a request is holding.
- Arabic RTL reading of a whole conversation, including Latin technical terms and file names inside
  it, and screen-reader navigation of the request list and the rating control.
- **That "no visible requests" reads as normal** for a newly invited customer whose history predates
  the association (D4), rather than as a failure.

**Carried into Phase 9.** The portal is where the chatbot will live, and it now has an authenticated
identity to attach a conversation to — which the Phase 5 chat widget did not. Phase 9 must not
introduce a second customer credential for the chatbot; the portal session is the one. The `portal`
channel is also the natural home for a bot handoff, because a ticket raised there is already
answerable in place (D6).

**Carried into Phase 10.** `tickets.requesting_contact_id` is a reporting dimension and a trap: a
company's ticket count is not the sum of its contacts' portal views, and an unassociated ticket
belongs to the customer but to no contact. `ticket_satisfaction` holds one score per ticket by
construction (D8), so CSAT arithmetic is a straight average with no de-duplication — and `NULL` means
"not asked or not answered", never "neutral".

**Carried into Phase 11.** Two things now depend on the single-process assumption rather than one: the
rate limiter (inherited) and the portal's per-request freshness reads, which are cheap only because
they are local. Neither breaks under two processes; the limiter's ceiling doubles, as Phase 4 already
recorded.

**Carried into Phase 12.** Portal accounts are keyed to a contact on a customer, with no department
dimension. When departments arrive, the question is whether a portal account sees requests across all
departments of its organisation, and `requesting_contact_id` is where that question will bite first.

**Still open for Phase 5 to answer, not absorbed here.** Agents cannot download a message attachment;
`findForDownload` has no route (D15). The portal gets one because FR-033 requires it. The agent-side
equivalent is a Phase 5 omission and is left visible.

## Outstanding from earlier phases

- **Constitution amendment — Phase 6's, still unsigned.** `specs/007-phase-6-sla-automation/
  constitution-amendment.md` has been through no approval. This phase does not touch it.
- **Constitution Open Item — messaging provider selection.** Still unrecorded. Phase 8 adds a
  consumer of the email adapter (invitations, D3), which makes the provider decision matter for a
  surface a customer sees rather than only for agent alerts.
- **Constitution Open Item — AI provider selection.** Now due **next phase**. Phase 8 adds the
  authenticated surface the chatbot will sit on, so the decision cannot be deferred past Phase 9.
- **Phase 6 carried forward**: T136–T141 — greyscale, RTL, screen-reader, quickstart, real-transport
  and calendar-confirmation passes. Unfinished, and not absorbed here; this phase adds its own
  equivalents rather than closing Phase 6's.
- **Phase 4, 5 and 7 carried forward**: their own manual passes remain open, including Phase 7's
  corpus review and suggestion-floor tuning.
- Remaining Open Items (ERP identity for Phase 11, branding for Phase 12) are untouched.
