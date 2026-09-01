---
description: 'Task list for Phase 8 — Customer Portal'
---

# Tasks: Phase 8 — Customer Portal

**Input**: Design documents from `/specs/009-phase-8-customer-portal/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested, and Principle II makes the authorization matrix non-optional. This phase has a third reason,
stronger than Phase 7's: **its two central properties are invisible in a diff and catastrophic when
wrong.** Nothing in a code review reliably shows that a portal token cannot pass staff
authentication, or that one contact cannot reach a colleague's conversation — and a mistake in either
is a disclosure, not a defect. `backend/tests/portal/realm.test.ts` and
`backend/tests/portal/scope.test.ts` are therefore not checks on the work; they are the only places
those properties are observable. Both **enumerate** rather than sample, per SC-002 and SC-003.

**Organization**: Grouped by user story, running **US1 → US2 → US3 → US4 → US5 → US6 → US7 → US8** —
strict priority order, with no deviation. Two ordering facts are worth stating because they were
checked rather than assumed:

- **US2 (raise) before US3 (track)** is forced: US3's Independent Test needs tickets that carry a
  contact association, and until US2 exists the only source of one is the staff association path in
  US8. Building US3 first means testing it against fixtures that have to be torn out.
- **US1 already contains the staff invitation screen.** Clarifications Q1 made invite-only the model,
  so no customer can reach the portal until a staff member invites them; the spec moved issuing into
  US1 for that reason. US8 holds ongoing management only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US8 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Configuration and directories. **No new dependencies** — `jsonwebtoken` and `bcrypt` are
already present from Phase 1, and invitation mail rides Phase 5's email adapter (research D3).

- [X] T001 Add `PORTAL_JWT_ACCESS_SECRET` and `PORTAL_JWT_REFRESH_SECRET` (both `min(32)`, required) plus `PORTAL_INVITE_TTL_HOURS` (default 168) and `PORTAL_RATE_PER_MINUTE` (default 20) to the schema in `backend/src/config/env.ts`
- [X] T002 Extend the existing `superRefine` in `backend/src/config/env.ts` so all four JWT secrets must be **pairwise distinct**, with the error naming which pair collided (research D1)
- [X] T003 [P] Document the four new variables in `.env.example` with a comment saying why a portal secret sharing the staff secret is the one misconfiguration in this phase that works perfectly until somebody notices they can act as staff
- [X] T004 [P] Create directories: `backend/src/portal/`, `backend/src/routes/portal/`, `backend/src/controllers/portal/`, `backend/src/channels/portal/`, `backend/tests/portal/`, `frontend/src/views/portal/`, `frontend/tests/portal/`
- [X] T005 [P] Add the `portal.*` locale namespace skeleton to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` — shell, states, empty states, errors, and the no-uploads sentence (FR-022a, FR-061)

**Checkpoint**: configuration refuses to start without portal secrets; directories exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the second identity realm, the contact association, and the declarations every story
reads. **⚠️ No user story work can begin until this phase is complete** — every portal endpoint in
every story depends on the middleware and the scope function built here.

### Schema

- [X] T006 Migration `backend/src/db/migrations/20260901000007-add-requesting-contact-to-tickets.cjs` — nullable `requesting_contact_id` FK to `customer_contacts` `ON DELETE SET NULL`, plus its index (data-model.md)
- [X] T007 [P] Migration `backend/src/db/migrations/20260901000008-create-portal-accounts.cjs` — including **UNIQUE** `customer_contact_id`, `session_epoch`, and the two lockout columns mirroring `users`
- [X] T008 [P] Migration `backend/src/db/migrations/20260901000009-create-portal-invitations.cjs` — including **UNIQUE** `token_hash`
- [X] T009 [P] Migration `backend/src/db/migrations/20260901000010-create-ticket-satisfaction.cjs` — including **UNIQUE** `ticket_id` (FR-049)
- [X] T010 [P] Migration `backend/src/db/migrations/20260901000012-seed-portal-channel-setting.cjs` — a `channel_settings` row for `portal`, enabled
- [X] T011 Migration `backend/src/db/migrations/20260901000011-backfill-ticket-requesting-contact.cjs` — associate a ticket only where its earliest inbound message's `sender_identity_normalised` matches **exactly one** contact on its own customer; leave NULL on zero or two matches; idempotent; never overwrite non-NULL (FR-026g, research D4). Depends on T006

### Models

- [X] T012 [P] `backend/src/models/portal-account.model.ts` — no `customer_id` column, and a comment citing `timeline.service.ts`'s reasoning for deriving rather than copying it (research D2)
- [X] T013 [P] `backend/src/models/portal-invitation.model.ts` — with a `usable()` scope or helper expressing `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`
- [X] T014 [P] `backend/src/models/ticket-satisfaction.model.ts`
- [X] T015 Add `requesting_contact_id` to `backend/src/models/ticket.model.ts` with the NULL-means-invisible rule stated in the column comment (FR-026f)
- [X] T016 Register the three new models and their associations in `backend/src/models/index.ts`

### Declarations

- [X] T017 Add `PORTAL: 'portal'` to `CHANNELS` and to `REPLYABLE_CHANNELS` in `backend/src/models/message.model.ts`, with the comment explaining why inbound-only fails: `conversationFor` reads the last inbound **replyable** message, so a portal-only ticket would have no reply path (research D6)
- [X] T018 [P] Add `'portal'` to `TICKET_SOURCES` in `backend/src/models/ticket.model.ts` (FR-021)
- [X] T019 [P] `backend/src/portal/customer-status.ts` — a **total** mapping over `TICKET_STATUSES` to four customer states, plus `ratingOffered` and `replyOffered` per state (research D7, contracts/visibility-contract.md §3). No runtime fallback: an unmapped status must be a type error
- [X] T020 [P] `backend/src/portal/satisfaction.ts` — the 1–5 scale, declared once (research D8)
- [X] T021 [P] `backend/src/portal/endpoints.ts` — the declared list of every portal endpoint, exported for both the router and the realm/scope tests (research D10, FR-018)
- [X] T022 [P] Add `define('portal', 'manage')` to `backend/src/auth/permissions.ts` and grant it to Administrator and Supervisor in the permission seeder (FR-058, research D12)
- [X] T023 [P] Add the ten `portal.*` audit actions to `AUDIT_ACTIONS` in `backend/src/services/audit.service.ts`, namespaced so a Phase 1 query for staff sign-ins does not start returning customers (FR-008)

### The realm (research D1, D10)

- [X] T024 `backend/src/services/portal-token.service.ts` — sign/verify access and refresh with the portal secrets and `type: 'portal-access'` / `'portal-refresh'`, `sub` = `portal_accounts.id`, and `session_epoch` as a claim on the refresh token
- [X] T025 `backend/src/middleware/authenticate-portal.ts` — verify, then load account + contact + customer **fresh**; one identical 401 for absent, malformed, expired, wrong-realm, withdrawn, contact-removed, customer-deactivated, and stale-epoch (FR-009, FR-013)
- [X] T026 [P] Augment the Express request type with `req.portal = { accountId, contactId, customerId, language }` in `backend/src/types/express.d.ts` — no role, no permissions (FR-014)
- [X] T027 `backend/src/routes/portal/index.ts` — one file, `authenticate-portal` applied once, opening with a comment declaring what the file is for in the manner of `routes/public/index.ts`; mount it in `backend/src/routes/index.ts`
- [X] T028 `portalScope(session)` in `backend/src/services/portal-ticket.service.ts` — returns `{ customer_id, requesting_contact_id }` for use **inside** a query's `where`, with a comment on why the redundant `customer_id` clause is kept (contracts/visibility-contract.md §1)

### The portal channel (research D6)

- [X] T029 `backend/src/channels/portal/inbound.ts` — an adapter whose `send` performs no network call, `provider: 'inbound'`; the mirror image of `channels/form/inbound.ts`
- [X] T030 Add the `portal` case to `resolve()` in `backend/src/channels/registry.ts` and exclude `portal` from `assertProductionReady` alongside `chat` and `form`
- [X] T031 Exclude `portal` from the opt-out check in `backend/src/services/message.service.ts`, in one place, citing FR-037 — a customer cannot opt out of the portal they signed into
- [X] T032 [P] Map `portal` to contact kind `email` in `contactKindFor` in `backend/src/services/identity.service.ts`

### The two enumerated suites

- [X] T033 `backend/tests/portal/realm.test.ts` — iterate `portal/endpoints.ts`: every portal endpoint refuses a staff access token, a staff refresh token, a portal refresh token, and a malformed token, all with the identical 401. Then every **staff** endpoint refuses a portal access token whose `sub` equals a real `users.id` (SC-002)
- [X] T034 `backend/tests/portal/fixtures.ts` — two customers, one with two contacts, four tickets (one per contact, one unassociated, one on the other customer). Shared by the scope, projection, reply and satisfaction suites
- [X] T035 `backend/tests/portal/scope.test.ts` — iterate `portal/endpoints.ts`: every read attempted with another customer's, a colleague's, and an unassociated ticket's identifiers returns the **same** response as a nonexistent one (SC-003, SC-028, SC-029). Depends on T034

### Front-end foundation (research D13)

- [X] T036 [P] `frontend/src/layouts/PortalLayout.vue` — organisation name, language switch, help link, requests link, sign out. **Not** `DefaultLayout` with items removed (FR-063)
- [X] T037 Make the shell selection in `frontend/src/App.vue` three-way: `publicShell` → bare, `portalShell` → `PortalLayout`, otherwise `DefaultLayout`
- [X] T038 [P] `frontend/src/services/portal-http.ts` — its own client, attaching only the portal token; a comment on why it is not the staff client with a flag
- [X] T039 [P] `frontend/src/stores/portal.ts` — its own session state, so a staff session and a portal session can coexist in one browser
- [X] T040 Add the portal route block to `frontend/src/router/index.ts` with `meta.portalShell`, references and slugs in paths, and **no** register route (FR-002a, FR-065)

**Checkpoint**: the realm boundary exists and is proven by T033. A portal token reaches nothing yet,
and a staff token reaches nothing new. User story work can begin.

---

## Phase 3: User Story 1 — A Customer Is Invited In, and Gets a Surface That Is Theirs (Priority: P1) 🎯 MVP

**Goal**: a staff member invites an email contact; that person accepts, sets a credential, signs in,
and holds a session that expires, can be ended, and dies the moment access is withdrawn.

**Independent Test**: invite a contact, accept the invitation, sign in, reload, sign out. Then present
the portal token to a staff endpoint and a staff token to a portal endpoint and confirm both are
refused identically to an absent token.

### Tests for User Story 1

- [X] T041 [P] [US1] `backend/tests/portal/invitations.test.ts` — single-use, expiry, revocation, and a hash matching nothing all produce **one identical** refusal (FR-002c, SC-026); acceptance binds the account to the invitation's contact and ignores any contact supplied by the caller
- [X] T042 [P] [US1] `backend/tests/portal/invitation-delivery.test.ts` — the invitation goes only to the address on the named contact, whatever address is supplied when issuing or accepting (FR-002d, SC-027), and **no `messages` row is written** (research D3)
- [X] T043 [P] [US1] `backend/tests/portal/no-registration.test.ts` — assert that no route in the mounted application creates a `portal_accounts` row except the invitation-acceptance endpoint (FR-002a, SC-025)
- [X] T044 [P] [US1] `backend/tests/portal/login.test.ts` — unknown address, address without an account, wrong password, withdrawn, locked, and deactivated customer all return the identical 401 (FR-006, SC-006); lockout at the configured threshold; counter reset on success
- [X] T045 [P] [US1] `backend/tests/portal/session.test.ts` — withdrawal ends access on the next request and refuses a live refresh token via `session_epoch`, on two devices (FR-060, SC-031, SC-004)

### Implementation for User Story 1

- [X] T046 [US1] `backend/src/services/portal-invitation.service.ts` — issue (random token, store only its SHA-256, set `expires_at` from `PORTAL_INVITE_TTL_HOURS`), look up by hash, accept, revoke; one error type for every unusable case; the provisional-record rule enforced here with a warning returned to the caller (FR-002f, research open question 2)
- [X] T047 [US1] Invitation delivery in `backend/src/services/portal-invitation.service.ts` — call `adapterFor('email').send(...)` directly, writing no `messages` row, following `alert.service.ts` (research D3)
- [X] T048 [P] [US1] Bilingual invitation email body in `backend/src/locales/` (or the existing mail templating site) naming the organisation and the address — text a recipient who was not expecting it can trust
- [X] T049 [US1] `backend/src/services/portal-auth.service.ts` — sign-in with uniform failure, lockout using `failed_login_attempts` / `locked_until`, refresh with epoch check, logout, logout-all, change-password, forgot/reset password reusing the invitation token mechanics
- [X] T050 [US1] Audit writes for every portal access event in `backend/src/services/portal-auth.service.ts` and `backend/src/services/portal-invitation.service.ts` (FR-008, SC-023)
- [X] T051 [US1] `backend/src/controllers/portal/auth.controller.ts` — login, refresh, logout, logout-all, change-password, forgot-password (always 204), reset-password
- [X] T052 [US1] `backend/src/controllers/portal/invitations.controller.ts` — show (minimum needed to render acceptance) and accept
- [X] T053 [US1] Mount the session and invitation routes in `backend/src/routes/portal/index.ts` with the `portal-auth` and `portal-invite` rate-limit scopes keyed by IP (FR-010, research D11), and add them to `portal/endpoints.ts`
- [X] T054 [US1] `backend/src/services/portal-access.service.ts` — issue and revoke invitations on behalf of staff, with `portal:manage` enforced by the route and the contact validated as belonging to the named customer
- [X] T055 [US1] `backend/src/controllers/admin/portal-access.controller.ts` and the staff routes for issuing and revoking invitations, with `requirePermission('portal:manage')` (FR-059)
- [X] T056 [P] [US1] `frontend/src/views/portal/PortalLoginView.vue` — language switch works **before** sign-in (FR-061); one error message for every failure
- [X] T057 [P] [US1] `frontend/src/views/portal/AcceptInviteView.vue` — names the organisation and the address **before** asking for a password; one message for all four invalid-token cases
- [X] T058 [P] [US1] `frontend/src/views/portal/PortalResetView.vue` — forgot and reset, always reporting "check your email"
- [X] T059 [US1] Portal invitation controls in `frontend/src/views/customers/CustomerProfileView.vue`, showing the provisional-record warning before confirming, hidden without `portal:manage`

**Checkpoint**: a customer can be invited, can get in, and can be locked out and withdrawn. The realm
boundary is proven end to end. **This is the MVP.**

---

## Phase 4: User Story 2 — A Customer Raises a Ticket Without Phoning Anyone (Priority: P1)

**Goal**: a signed-in customer submits a request; an ordinary ticket appears on the agent side with
the portal as its source and the submitting contact recorded.

**Independent Test**: submit from the portal, then confirm from the agent side that it is an ordinary
ticket — assignable, transitionable, under SLA policy — with `source: portal` and the right contact.

### Tests for User Story 2

- [X] T060 [P] [US2] `backend/tests/portal/submit.test.ts` — the ticket's `customer_id` and `requesting_contact_id` come from the session and a supplied one is ignored (FR-015, FR-026b); out-of-range category or priority is **refused, not coerced** (FR-023); an incomplete submission creates nothing
- [X] T061 [P] [US2] `backend/tests/portal/no-uploads.test.ts` — no portal endpoint accepts a file: a multipart body is refused on submission, reply, and satisfaction (FR-022, SC-030)
- [X] T062 [P] [US2] `backend/tests/portal/submit-integration.test.ts` — a portal-submitted ticket appears in the agent queue and dashboard, is assignable, and acquires an SLA target like any other (FR-020)

### Implementation for User Story 2

- [X] T063 [US2] Submission in `backend/src/services/portal-ticket.service.ts` — `source: 'portal'`, `status: INITIAL_STATUS`, `created_by_user_id: NULL`, contact and customer from the session, taxonomy validated against `tickets/taxonomy.ts`
- [X] T064 [US2] `backend/src/controllers/portal/tickets.controller.ts` — create, returning `{ reference }` only (FR-065)
- [X] T065 [US2] Mount `POST /tickets` with the `portal-submit` scope, separate from `portal-read` (FR-025), and add it to `portal/endpoints.ts`
- [X] T066 [US2] Refuse multipart on the whole portal router in `backend/src/routes/portal/index.ts` — a body with files is rejected, not silently ignored (FR-022)
- [X] T067 [P] [US2] `frontend/src/views/portal/NewRequestView.vue` — subject, description, taxonomy from i18n keys, validation errors announced (FR-062), and **no upload control**: in its place the locale sentence saying how to send a file (FR-022a)
- [X] T068 [P] [US2] Show `requestingContact` in `backend/src/services/ticket.service.ts`'s detail response and in `frontend/src/views/tickets/TicketDetailView.vue`, labelled as who can see the conversation in the portal (FR-026i)

**Checkpoint**: a customer can raise a request and an agent works it normally.

---

## Phase 5: User Story 3 — A Customer Tracks Their Requests Without Asking (Priority: P1)

**Goal**: the list of this contact's requests, each with a customer-meaningful state — and nobody
else's.

**Independent Test**: on a customer record with two contacts, tickets split between them and one
associated with neither, open the portal as one contact and confirm exactly that contact's tickets
appear.

### Tests for User Story 3

- [X] T069 [P] [US3] `backend/tests/portal/list.test.ts` — a colleague's ticket and an unassociated ticket are both absent from the list and both 404 on direct request (FR-026f, SC-028, SC-029)
- [X] T070 [P] [US3] `backend/tests/portal/customer-status.test.ts` — the mapping is total over `TICKET_STATUSES`; `escalated` renders as `in_progress` and no internal status string appears in any response (FR-028)
- [X] T071 [P] [US3] `backend/tests/portal/association-write-sites.test.ts` — a ticket created from an inbound message and one from a public form both carry the matched contact (FR-026c, FR-026d); an agent-created ticket may carry none (FR-026e)
- [X] T072 [P] [US3] `backend/tests/portal/backfill.test.ts` — the migration associates on an exact single match, declines on zero and on two, and never overwrites a non-NULL value (FR-026g)

### Implementation for User Story 3

- [X] T073 [US3] List in `backend/src/services/portal-ticket.service.ts` — `portalScope` applied **inside** the query, paged, ordered with open before settled
- [X] T074 [US3] Pass the resolved contact into `createTicketFor` in `backend/src/services/intake.service.ts` so an inbound-message ticket records its requester (FR-026c)
- [X] T075 [US3] Set the requesting contact on public form submissions in `backend/src/services/form.service.ts` from the address the submitter gave (FR-026d)
- [X] T076 [US3] Allow an agent to set the requesting contact when creating a ticket in `backend/src/services/ticket.service.ts`, validating that the contact belongs to the ticket's own customer, and allowing NULL (FR-026e)
- [X] T077 [US3] Add list and detail to `backend/src/controllers/portal/tickets.controller.ts` and mount them with the `portal-read` scope; add to `portal/endpoints.ts`
- [X] T078 [P] [US3] `frontend/src/views/portal/RequestListView.vue` — reference, subject, state, last activity; open before settled, distinguishable without colour
- [X] T079 [US3] The empty state in `frontend/src/views/portal/RequestListView.vue` — "you have no open requests" with a prominent way to raise one, plus a quieter line for someone expecting history. This is the **normal** first experience for a newly invited customer (research D4); it must not read as an error (SC-021)

**Checkpoint**: a customer sees exactly their own requests, and a colleague's are indistinguishable
from nonexistent.

---

## Phase 6: User Story 4 — A Customer Reads the Whole Conversation and Nothing Else (Priority: P1)

**Goal**: the full correspondence across channels, and nothing internal — absent from the response,
not hidden in the interface.

**Independent Test**: on a ticket carrying internal notes, tasks, mentions, an assignee, a breached
SLA target, an automation run, a merge record, and correspondence on two channels, open the customer
view and confirm the correspondence is complete and everything else absent — asserted against the
composed response, not the rendered page.

### Tests for User Story 4

- [X] T080 [P] [US4] `backend/tests/portal/projection.test.ts` — `Object.keys` of the response, and of each message, **equals** the frozen list in contracts/visibility-contract.md §2, on a fixture carrying every excluded thing (FR-030, SC-008)
- [X] T081 [P] [US4] `backend/tests/portal/attachments.test.ts` — a file on the contact's own correspondence downloads; an internal agent-uploaded file on the same ticket, any file on a colleague's ticket, and any file on another customer's ticket are all refused identically (FR-033, SC-010)
- [X] T082 [P] [US4] `backend/tests/portal/merged-ticket.test.ts` — a merged-away reference resolves to the survivor **only** where this contact is associated with the survivor, and 404s otherwise (FR-032, FR-026j, SC-009)
- [X] T083 [P] [US4] `backend/tests/portal/opt-out-history.test.ts` — a customer opted out of a channel still reads the complete history of what was said on it (FR-037, SC-012)

### Implementation for User Story 4

- [X] T084 [US4] `PortalTicketView` and its composer in `backend/src/services/portal-ticket.service.ts` — built field by field, never a Sequelize instance, never a spread, never `toJSON()` with deletions (research D14)
- [X] T085 [US4] Scoped message reading in `backend/src/services/portal-ticket.service.ts` — the ticket resolved through `portalScope` **first**, messages then read by that ticket's id, never by an id from the URL
- [X] T086 [US4] Merge resolution in `backend/src/services/portal-ticket.service.ts` using `resolveSurvivorId`, re-applying the scope to the **survivor** before returning it (FR-026j)
- [X] T087 [US4] Scoped attachment resolution in `backend/src/services/message-attachment.service.ts` — a new function taking the portal session, the ticket reference, and the attachment id **together**; `findForDownload(attachmentId)` is not called from the portal (research D15)
- [X] T088 [US4] Attachment download in `backend/src/controllers/portal/attachments.controller.ts` — headers per Phase 2's customer-attachment controller: `Content-Disposition: attachment`, sanitised filename, `X-Content-Type-Options: nosniff`, storage never served
- [X] T089 [US4] Mount detail and attachment routes; add to `portal/endpoints.ts`
- [X] T090 [P] [US4] `frontend/src/views/portal/RequestDetailView.vue` — one chronological conversation across channels, each entry marked as from the customer or the organisation, with a real heading structure a screen reader can move through
- [X] T091 [US4] Render outbound bodies as **text**, never as HTML, in `frontend/src/views/portal/RequestDetailView.vue` — `body_format: 'html_source'` exists for inbound email and rendering stored HTML here would be a stored-XSS surface (contracts/visibility-contract.md §2)

**Checkpoint**: the conversation is complete and nothing internal is in the response. The phase's
central privacy claim is now proven by T080, T081 and T035 together.

---

## Phase 7: User Story 5 — A Customer Answers Back Without Opening a Second Ticket (Priority: P2)

**Goal**: a reply joins the same conversation as an inbound message on the `portal` channel, and the
agent can answer in place.

**Independent Test**: reply from the portal on an open ticket and confirm it appears in the agent's
timeline as an inbound `portal` message with no new ticket created; then have the agent reply on the
same channel and confirm the customer sees it.

### Tests for User Story 5

- [X] T092 [P] [US5] `backend/tests/portal/reply.test.ts` — a reply creates one inbound `portal` message and **no** new ticket (SC-011); a reply on another contact's ticket 404s
- [X] T093 [P] [US5] `backend/tests/portal/reopen.test.ts` — a reply on a `resolved` ticket transitions it to `open` via the system actor and **only** that edge; a reply on a `closed` ticket returns `ticket_settled` and stores nothing (FR-036, research D9)
- [X] T094 [P] [US5] `backend/tests/portal/agent-reply.test.ts` — `conversationFor` returns a `portal` conversation for a portal-only ticket, so an agent can reply where the customer wrote (research D6)

### Implementation for User Story 5

- [X] T095 [US5] Reply in `backend/src/services/portal-ticket.service.ts` — writes the inbound `portal` message with the contact's address as `sender_identity` and `author_user_id: NULL`, participating in response-clock and automation behaviour like any inbound message (FR-035)
- [X] T096 [US5] Reopen in `backend/src/services/portal-ticket.service.ts` — the system actor with the target status as a **constant**, never a parameter, because `actor.id === null` bypasses permission checks (research D9)
- [X] T097 [US5] Refuse a reply on a `closed` ticket with `ticket_settled` (409) in `backend/src/services/portal-ticket.service.ts`, before anything is written (FR-036)
- [X] T098 [US5] Report `read` on outbound `portal` messages when the owning contact's portal returns them, in `backend/src/services/portal-ticket.service.ts` — the one channel here that can know this truthfully (research D6)
- [X] T099 [US5] Add the reply route with the `portal-reply` scope; add to `portal/endpoints.ts`
- [X] T100 [P] [US5] Reply box in `frontend/src/views/portal/RequestDetailView.vue` — present when the state allows it, **absent** on a closed request and replaced by "raise a new request" prefilled with a reference to this one; usable with a keyboard covering half the screen

**Checkpoint**: a conversation works in both directions without leaving the portal.

---

## Phase 8: User Story 6 — A Customer Finds the Answer Before Raising Anything (Priority: P2)

**Goal**: Phase 7's published, customer-visible content inside the portal, plus deflection while a
request is being described.

**Independent Test**: search from inside the portal and confirm the results are identical to the
public help centre's for the same query, and that nothing unpublished or internal is reachable.

### Tests for User Story 6

- [X] T101 [P] [US6] `backend/tests/portal/kb-parity.test.ts` — for the same query and language, portal results **equal** public help-centre results (FR-039); a draft, archived, or internal article is unreachable and indistinguishable from absent (FR-040)
- [X] T102 [P] [US6] `backend/tests/portal/deflection.test.ts` — suggestions are returned for matching draft text, an empty result is a normal answer, and submission is never blocked or delayed (FR-042, FR-044, SC-014)

### Implementation for User Story 6

- [X] T103 [US6] `backend/src/controllers/portal/kb.controller.ts` — categories, article by slug, search, and suggestions, calling Phase 7's services with `audience: 'customer'` and `status: 'published'` as **literals**, exactly as `controllers/public/kb.controller.ts` does; no parameter can widen either
- [X] T104 [US6] Mount the four knowledge routes with `portal-read` and `portal-search` scopes; add to `portal/endpoints.ts` (FR-045)
- [X] T105 [P] [US6] `frontend/src/views/portal/PortalHelpView.vue` — browse, search, and read inside the portal shell, keeping Phase 7's language badge on one-language articles (FR-043)
- [X] T106 [US6] Deflection panel in `frontend/src/views/portal/NewRequestView.vue` — debounced and cancellable using the `signal` pattern Phase 7 added to the HTTP client; submitting stays exactly one action away whether or not an article was offered

**Checkpoint**: a customer can answer their own question, and is never obstructed by the attempt.

---

## Phase 9: User Story 7 — A Customer Says Whether It Was Actually Fixed (Priority: P2)

**Goal**: one rating per resolved request, visible to staff, and costless to ignore.

**Independent Test**: resolve a ticket, rate it, confirm it is stored once and visible on the agent
side, and confirm a second submission neither overwrites nor duplicates it.

### Tests for User Story 7

- [X] T107 [P] [US7] `backend/tests/portal/satisfaction.test.ts` — a rating is refused before `resolved` (FR-047); exactly one row survives **concurrent** double submission, with the second reported as `already_recorded` from the unique index rather than from a preceding read (FR-049, SC-016)
- [X] T108 [P] [US7] `backend/tests/portal/satisfaction-scope.test.ts` — a rating on a ticket this contact is not the requester of 404s, identically to a nonexistent reference (FR-055)
- [X] T109 [P] [US7] `backend/tests/portal/satisfaction-reopen.test.ts` — a rated ticket that is reopened and re-resolved offers no second rating and holds no second score (FR-054); ignoring the invitation creates nothing and changes no ticket, SLA record, or automation outcome (FR-051, SC-018)

### Implementation for User Story 7

- [X] T110 [US7] `backend/src/services/satisfaction.service.ts` — validate state and requester, insert, and translate the unique-constraint violation into `already_recorded` (409). **Not** a check-then-insert
- [X] T111 [US7] `backend/src/controllers/portal/satisfaction.controller.ts`, mounted and added to `portal/endpoints.ts`
- [X] T112 [US7] Include `satisfaction` in `PortalTicketView` and extend the frozen key list in `backend/tests/portal/projection.test.ts` deliberately (research D14)
- [X] T113 [US7] Show the score, comment, and date in `backend/src/services/ticket.service.ts`'s detail response and in `frontend/src/views/tickets/TicketDetailView.vue` (FR-053, SC-017)
- [X] T114 [P] [US7] Rating control in `frontend/src/views/portal/RequestDetailView.vue` — **radio-group semantics**, not a row of clickable icons; a page section, never a modal; shows the recorded score back after submission and never nags

**Checkpoint**: PLAN.md's Definition of done is complete end to end.

---

## Phase 10: User Story 8 — Someone Can See Who Has Access, and Turn It Off (Priority: P3)

**Goal**: ongoing management of portal access, and a way to make an old ticket visible to the person
who raised it.

**Independent Test**: withdraw a customer's portal access while they hold a live session and confirm
their next request is refused; then confirm both the withdrawal and the refusal are attributable.

### Tests for User Story 8

- [X] T115 [P] [US8] `backend/tests/portal/access-admin.test.ts` — withdraw, restore, unlock, and reset-credential are each refused server-side without `portal:manage`, regardless of what the interface offers (FR-059); withdrawing one contact leaves every other contact on the record unaffected (FR-060a, SC-031)
- [X] T116 [P] [US8] `backend/tests/portal/associate-contact.test.ts` — a ticket can be associated with a contact on its **own** customer and never with one on another customer; the association makes it visible to that contact and to nobody else (FR-026h, SC-029)
- [X] T117 [P] [US8] `backend/tests/portal/access-audit.test.ts` — every invitation, grant, withdrawal, revocation, lockout, release, reset, and association is present in the audit log with its actor (FR-008, SC-023)

### Implementation for User Story 8

- [X] T118 [US8] Extend `backend/src/services/portal-access.service.ts` — per-contact access view, withdraw (incrementing `session_epoch`), restore, unlock, and reset-credential without learning the secret (FR-056, FR-057)
- [X] T119 [US8] Ticket-contact association in `backend/src/services/ticket.service.ts` — validated against the ticket's own customer, audited (FR-026h, FR-057a)
- [X] T120 [US8] Extend `backend/src/controllers/admin/portal-access.controller.ts` and its routes for the five management actions, all behind `requirePermission('portal:manage')`
- [X] T121 [US8] `PATCH /api/tickets/:id/requesting-contact` in `backend/src/routes/tickets/tickets.routes.ts` and `backend/src/controllers/tickets/tickets.controller.ts`, behind `portal:manage`
- [X] T122 [P] [US8] Portal-access section in `frontend/src/views/customers/CustomerProfileView.vue` — per contact: has an account, invitation outstanding, locked out; with all five actions
- [X] T123 [P] [US8] A control in `frontend/src/views/tickets/TicketDetailView.vue` to set the requesting contact where absent, labelled by what it does operationally rather than by the column name

**Checkpoint**: the phase is operable — a compromised credential has a remedy, and D4's fail-closed
tickets have a route to visibility.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T124 [P] Complete the `portal.*` locale keys in `frontend/src/locales/ar.json` and `en.json`, and assert both files have identical key sets in `frontend/tests/` (FR-061)
- [ ] T125 [P] Confirm every portal screen renders correctly in Arabic RTL and English LTR with no per-component direction overrides (Principle I, SC-020)
- [ ] T126 [P] WCAG 2.1 AA pass over the portal in both languages: keyboard operation, contrast, announced validation errors, announced empty states (Principle IV, FR-062)
- [ ] T127 [P] Mobile pass: the portal is the first mobile-first surface in this project — target sizes, no horizontal scroll of the conversation, reply box usable with a keyboard covering half the screen
- [ ] T128 [P] Greyscale pass: open and settled requests distinguishable without colour
- [X] T129 Confirm `portal/endpoints.ts` lists every mounted portal route and nothing else, and that T033 and T035 iterate it (FR-018)
- [X] T130 Confirm no portal URL or response exposes an internal id where a reference or slug serves (FR-065, SC-024)
- [X] T131 [P] Update `README.md` and deployment notes with the four new environment variables and the startup refusal
- [ ] T132 Run `quickstart.md` end to end, including **Scenario 4's inference hunting** — the tests prove specific reads are refused; only a person trying to learn something can find the fact that leaks by counting
- [ ] T133 Read the invitation email and acceptance screen cold, in both languages, and judge whether they read as legitimate rather than as phishing (quickstart manual passes)
- [ ] T134 Answer research open question 1 with a human: does `pending` mean "awaiting you"? Every test passes under either mapping. One word in `backend/src/portal/customer-status.ts`
- [ ] T135 Confirm with operations that a customer reply reopening a resolved ticket restarting SLA response behaviour is the intended outcome (research D9)
- [ ] T136 Confirm the empty request list reads as normal for a newly invited customer whose history predates the association (SC-021, research D4)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001–T002 are the same file and serialise.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.** The realm tasks
  (T024–T028) are the hard gate — no portal endpoint exists until they do.
- **US1 (Phase 3)**: depends on Foundational only. Nothing else depends on it except through the
  session, which every later story needs to be testable.
- **US2 (Phase 4)**: depends on Foundational. Testable with a session from US1.
- **US3 (Phase 5)**: depends on **US2** for tickets that carry an association — the one real
  cross-story dependency in this phase.
- **US4 (Phase 6)**: depends on US2 for a ticket to open, and on Foundational's scope function.
- **US5 (Phase 7)**: depends on US4 — a reply is composed on the detail view.
- **US6 (Phase 8)**: depends on Foundational only; **fully independent** of US2–US5. Deliverable at
  any point after Phase 2.
- **US7 (Phase 9)**: depends on US4 (the detail view) and on a resolvable ticket from US2.
- **US8 (Phase 10)**: depends on US1 (accounts to manage) and US3 (association to be worth setting).
- **Polish (Phase 11)**: depends on every story being shipped.

### Within Each User Story

- Tests first, and failing, before the implementation they cover.
- Migrations before models; models before services; services before controllers; controllers before
  routes; routes before front-end views.
- `portal/endpoints.ts` is appended by the story that mounts the route, not up front — T129 is the
  reconciliation.

### Parallel Opportunities

- **Phase 1**: T003, T004, T005 in parallel. T001 → T002 serialise (same file).
- **Phase 2**: T007–T010 in parallel (separate migrations). T012–T014 in parallel (separate models).
  T017–T023 in parallel (separate declaration files). T036, T038, T039 in parallel. T006 → T011 and
  T034 → T035 serialise.
- **Every story's test tasks are all [P]** — separate files by design.
- **US6 can be built alongside US2–US5 by a second developer**: it touches only
  `controllers/portal/kb.controller.ts`, one view, and the deflection panel.
- **`RequestDetailView.vue` serialises US4, US5 and US7's front-end work** (T090/T091, T100, T114).
  Their back-end tasks do not.
- `portal-ticket.service.ts` is touched by T028, T063, T073, T084–T086, T095–T098 — one file across
  five stories. Sequence it deliberately; it is the busiest file in the phase.

---

## Parallel Example: Foundational declarations

```bash
# After the migrations land, six declaration files with no shared edges:
Task: "Add 'portal' to TICKET_SOURCES in backend/src/models/ticket.model.ts"
Task: "Create backend/src/portal/customer-status.ts"
Task: "Create backend/src/portal/satisfaction.ts"
Task: "Create backend/src/portal/endpoints.ts"
Task: "Add portal:manage to backend/src/auth/permissions.ts and the seeder"
Task: "Add the portal.* audit actions to backend/src/services/audit.service.ts"
```

## Parallel Example: User Story 4 tests

```bash
# Four independent test files, all against the shared fixture from T034:
Task: "backend/tests/portal/projection.test.ts — the frozen key set"
Task: "backend/tests/portal/attachments.test.ts — scoped retrieval"
Task: "backend/tests/portal/merged-ticket.test.ts — survivor resolution"
Task: "backend/tests/portal/opt-out-history.test.ts — history stays complete"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 — Setup.
2. Phase 2 — Foundational. **Do not shorten this.** T033 and T035 are what make the rest of the
   phase safe to build, and they are cheapest to write before there is anything to break.
3. Phase 3 — US1.
4. **STOP and VALIDATE**: quickstart Scenarios 1 and 2. A customer can be invited in, can be locked
   out, can be withdrawn, and their token reaches nothing staff-side.

An MVP that stops here delivers no customer-visible value beyond a login — which is honest: the value
in US1 is that the realm boundary exists and is proven. Shipping it alone is a deployment decision,
not a demo.

### Incremental delivery

1. Setup + Foundational → the boundary exists.
2. US1 → invitation and session. Validate Scenarios 1–2.
3. US2 → raising a request. First real customer value.
4. US3 → tracking. Validate Scenario 4 — **the colleague test**, the one that matters most.
5. US4 → the conversation. Validate Scenario 5 against the raw JSON.
6. US5 → replies both ways. Validate Scenario 6.
7. US6 → help content and deflection.
8. US7 → satisfaction. **PLAN.md's Definition of done is now met.**
9. US8 → management. The phase becomes operable rather than only demonstrable.
10. Polish, including the four manual judgements (T133–T136) that no test can make.

### Parallel team strategy

After Phase 2:

- **Developer A**: US1 → US2 → US3 (the spine; US3 needs US2).
- **Developer B**: US6 (fully independent), then US7's back end.
- **Developer C**: US4 → US5, coordinating with A on `portal-ticket.service.ts` and owning
  `RequestDetailView.vue` outright to avoid the three-story collision on it.
- US8 last, by whoever is free — it touches mostly staff-side files nobody else is in.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- Two tasks in this phase are load-bearing beyond their size: **T033** (realm) and **T035** (scope).
  If either is weakened to make a later task pass, the phase's central security claims stop being
  true and nothing else will say so.
- **Absence is uniform.** Any task that returns a distinguishable answer for "not yours" instead of
  "not found" has undone FR-017, whatever else it got right.
- **NULL fails closed.** Any query that treats `requesting_contact_id IS NULL` as visible has
  reintroduced the leak Clarifications Q2 exists to prevent, on the oldest data in the system.
- Commit after each task or logical group. Stop at any checkpoint to validate independently.
