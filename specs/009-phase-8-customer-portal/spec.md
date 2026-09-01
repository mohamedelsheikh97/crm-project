# Feature Specification: Phase 8 — Customer Portal

**Feature Branch**: `009-phase-8-customer-portal`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Build the customer self-service portal: authenticated ticket submission, status tracking, full interaction history, knowledge base browsing, and post-resolution satisfaction feedback collection."

**PLAN.md Reference**: Phase 8 — Customer Portal

**Depends on**: Phase 1 — Security & Administration Foundations (the authentication, lockout, and
audit machinery this phase must mirror without reusing the staff identity itself),
Phase 3 — Ticket Management (Core) (the ticket, its lifecycle, and its reference),
Phase 5 — Communication Channels (the correspondence-only timeline the history view is built on),
Phase 7 — Knowledge Base (the published, customer-visible content the portal browses)

## Overview

Phase 8 is the first phase that gives somebody outside the organisation a **session**.

Every public surface built so far is anonymous and momentary. A webhook delivery is authenticated by
signature and belongs to a provider, not a person. A Phase 5 web form is submitted once by someone
who is gone before the ticket exists. Phase 7's help centre serves three read-only endpoints and
remembers nobody. In all three cases the system never has to answer the question _"who is this, and
what is theirs?"_ — because the answer is always "nobody, and nothing".

The portal changes that, and four consequences follow. Each one is a first for this codebase.

**There are now two identity realms, and they must not be confusable.** Until this phase,
authentication meant exactly one thing: a bearer token resolving to a row in `users`, with a role and
permission grants read fresh on every request. A portal customer has no row in `users` and must never
be given one — a customer in the staff user list would appear in assignment pickers, need a role and
a password history, and interfere with Phase 1's last-administrator invariant. But the access token
issued today carries only an id and an email, with no claim naming the realm it belongs to, so a
customer token signed by the same key would resolve to a **staff user with that id** and pass staff
authentication. The separation therefore cannot be a convention that reviewers enforce; it has to be
structural, and it has to fail closed — a token from the wrong realm must be refused in the
verification step, not by whichever handler happens to read it.

**Authorization stops being permission-shaped and becomes ownership-shaped.** Phase 1's RBAC answers
_"may this role perform this action"_ — a question about the caller alone. The portal asks a question
about the caller **and the record**: _is this ticket yours?_ Every read is a scoped read, and the
failure mode differs in kind. A permission bug lets an agent do something they should not do inside
data they were already entitled to see. A scoping bug shows one customer another customer's
correspondence. There is no partial version of that mistake.

**Read surfaces built for internal eyes become consumer-facing.** Phase 5 kept the message timeline
correspondence-only and said in writing that this is what would make it safe for Phase 8 to build a
window on. That promise holds for the timeline — but the ticket is surrounded by things it never
covered: internal notes, tasks and mentions (Phases 2 and 4), SLA targets and breach state (Phase 6),
automation runs, assignment history, merge and duplicate-override records, the `is_provisional` flag,
and the identity of the assignee. None of it goes out. The portal's ticket view is therefore not "the
ticket detail page with fields hidden" — hiding is exactly what Constitution Principle II refuses to
accept as a control. It is a **separately composed projection** that can only ever contain what it was
built to contain.

**And the system starts asking questions rather than answering them.** Every outbound message so far
has been a response: Phase 5 sent replies, Phase 6 sent alerts, and in both cases the system was
*answering*. A satisfaction request is the system *asking* — which means it can be ignored, and being
ignored must cost nothing and produce nothing rather than escalating into a nag.

The phase also arrives at the point where files would start travelling inward from people the
organisation has neither employed nor vetted, which is the condition Phase 2 named when it deferred
virus scanning "until before Phase 8". Clarifications Q3 answers that by **declining the capability
rather than the safeguard**: the portal accepts no uploads at all in this phase (FR-022), so the
deferral is neither resolved by ignoring it nor allowed to roll forward invisibly.

Phase 8 also inherits four commitments earlier phases made **on its behalf**, and must honour rather
than quietly reinterpret them:

- **Phase 2 Clarifications Q3** deferred virus scanning with an explicit instruction to revisit it
  before this phase. Question 3 below is that revisit, not a new question — and it is answered by
  admitting no inbound files (FR-022), which is the one answer that neither ignores the deferral nor
  postpones it again without saying so.
- **Phase 5's carry-forward** identified the chat widget's per-conversation opaque token (D14) as
  "the closest thing this project has to a customer credential" and asked Phase 8 to decide
  deliberately whether to promote or replace it. It is **replaced**, not promoted: a token scoped to
  one conversation, held by an unverified visitor, is not an identity and must not become one
  (FR-011).
- **Phase 7 Clarifications Q1** delivered a public, unauthenticated help centre and stated that the
  authenticated portal inherits it, leaving Phase 8 to decide deliberately whether to reuse that
  surface or build a second one. It is **reused**, and the authenticated portal adds no new
  content-reading capability (FR-046).
- **Phase 7's contracts** state that articles carry no "was this helpful?" rating because Phase 8 owns
  satisfaction feedback, and two rating mechanisms would be two things to reconcile. This phase
  therefore introduces exactly one, and it rates a **resolution**, not an article (FR-052).

## Clarifications

### Session 2026-09-01

Three questions were raised during `/speckit-specify`. Each is a point where PLAN.md's Phase 8 scope
depends on a decision PLAN.md itself does not make, and where the plausible readings differ enough to
change what gets built rather than only how it looks. All three are resolved; no
`[NEEDS CLARIFICATION]` markers remain.

- **Q1 — How does a customer come to hold a portal credential?**
  **Decision: INVITE-ONLY. There is no self-registration.** A permitted staff member issues an
  invitation to an existing email contact on an existing customer record; accepting it is what creates
  the portal account. Nobody can obtain access by asserting an email address.

  This closes the phase's largest security question by construction rather than by validation. With
  self-registration, the system would have to decide what an unrecognised email means — create a
  record, attach to an existing one, or refuse — and every one of those answers is a way for an
  outsider to claim a customer record. Phase 5 makes that worse than hypothetical: it creates
  **provisional** customer records automatically from inbound traffic, from senders nobody has
  verified. Self-registration would let the sender of one email become the portal identity of the
  record their email created.

  It also resolves the ambiguity Phase 2 made possible. Two customer records may hold the same email
  address; an invitation is issued to **one contact row on one record**, so the credential's target is
  decided by the person issuing it and never inferred from an address (FR-003).

  The cost is honest and belongs in the plan: adoption is gated on staff effort, so the portal is
  empty until somebody invites people into it, and inviting at scale is a bulk operation this phase
  does not build. Self-registration remains available as a later addition on top of an invitation
  model; the reverse — retrofitting verification onto self-registration already in production — is the
  expensive direction.

- **Q2 — What does one portal account see, given that a customer record can hold several email
  contacts and a company name?**
  **Decision: A PORTAL ACCOUNT SEES ONLY THE TICKETS ASSOCIATED WITH ITS OWN CONTACT**, not
  everything raised under its customer record.

  This is the more expensive of the two readings and it is chosen deliberately. `customers.company`
  means a single record routinely represents an organisation, and its contacts are three or five
  different people. Under record-wide visibility, inviting one of them to the portal hands them every
  request their colleagues ever raised — including the ones about their colleagues. Support tickets
  carry payroll questions, complaints, and disputes; a colleague reading them is not a lesser version
  of a cross-customer leak, it is the same kind of harm inside a smaller blast radius.

  It has a structural consequence this phase must build, and it is the largest single piece of work
  the three answers create: **a ticket does not currently record which contact it came from.** It
  records a customer. That association has to exist (FR-026a) and has to be set at every point a
  ticket is born — portal submission, inbound message, web form, and agent-created (FR-026b–FR-026e).

  It also forces a decision about every ticket that already exists, and the answer is to **fail
  closed**: a ticket with no contact association is not visible in the portal at all (FR-026f). The
  alternative — showing unassociated tickets to every contact on the record — would reintroduce
  exactly the leak this answer exists to prevent, and it would do so silently, on the oldest data.
  Failing closed has a visible cost that must be stated rather than discovered: at launch, most
  historical tickets are invisible in the portal. FR-026g permits the one backfill that involves no
  guessing — where a ticket's originating inbound message came from an address matching exactly one
  contact on that record — and FR-026h gives staff a way to associate the rest by hand.

- **Q3 — May a portal customer attach a file, given that Phase 2 deferred virus scanning until this
  phase?**
  **Decision: NO. The portal accepts no uploads in this phase** — not on submission, not on a reply.
  Customers may still **retrieve** files that form part of their own correspondence (FR-033); the
  restriction is on files travelling inward.

  Phase 2 recorded, in three places, that its no-virus-scanning deferral had to be revisited before
  this phase, because a portal is precisely what lets a file arrive from somebody the organisation has
  neither employed nor vetted. Accepting uploads under type-and-size limits alone would resolve that
  revisit by ignoring it, and would put unscanned external files in front of agents who have every
  reason to open them. Building a quarantine-and-scan pipeline resolves it properly but is a
  substantial addition to a phase whose real difficulty is the identity realm and the visibility
  scoping — and doing both badly is worse than doing one well.

  The cost is a genuine usability loss on the commonest case: a customer with a screenshot. It is
  bounded rather than absolute, because Phase 5's channels still accept attachments — a customer with
  a file replies by email and it lands on the same ticket. FR-022a requires the portal to say so
  rather than leave the absence to be discovered, and the deferral is re-recorded in Out of Scope with
  a named condition for lifting it, so it does not silently roll forward a third time.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — A Customer Is Invited In, and Gets a Surface That Is Theirs (Priority: P1)

A permitted staff member invites an email contact on a customer record to the portal. That person
accepts the invitation, sets up their credential, signs in, and lands on a surface showing their own
requests and nothing else. Their session behaves like a session: it expires, it can be ended, it
survives a page reload, and it is refused the moment their access is withdrawn.

**Why this priority**: nothing else in the phase exists without it. It also carries the phase's entire
security weight — the realm separation, the ownership scoping, and the audit trail all attach here.
Issuing the invitation is part of this story rather than of User Story 8 because Clarifications Q1
makes the two inseparable: under invite-only, no customer can reach the portal until a staff member
has invited them, so the phase has no demonstrable first slice without both halves.

**Independent Test**: invite a contact, accept the invitation, sign in, reload, sign out, and confirm
the session is gone. Then present the portal token to a staff endpoint and a staff token to a portal
endpoint, and confirm both are refused identically to an absent token.

**Acceptance Scenarios**:

1. **Given** an email contact on a customer record, **When** a permitted staff member invites it,
   **Then** the invitation is delivered to that address, is recorded with its issuer in the audit log,
   and no portal account exists until it is accepted.
2. **Given** a valid invitation, **When** the recipient accepts it, **Then** a portal account is
   created for that one contact, and the invitation cannot be used again.
3. **Given** somebody who has not been invited, **When** they attempt to obtain access by asserting any
   email address, **Then** there is no route by which they can — the portal exposes no registration.
4. **Given** an invitation that has expired, has already been accepted, or has been revoked, **When**
   it is presented, **Then** it is refused, and the refusal is identical for all three cases and for an
   invitation that never existed.
5. **Given** a customer holding a valid portal credential, **When** they sign in, **Then** they reach
   the portal and see only requests associated with their own contact.
6. **Given** a valid portal session, **When** its token is presented to any staff endpoint, **Then**
   the request is refused with the same response as an unauthenticated one, and no staff user is
   resolved from it.
7. **Given** a valid staff session, **When** its token is presented to any portal endpoint, **Then**
   the request is refused — a staff token is not a customer.
8. **Given** repeated failed sign-in attempts on one portal account, **When** the configured threshold
   is reached, **Then** further attempts are refused for the configured period and the event is
   recorded in the audit log.
9. **Given** a customer whose record has been deactivated, **When** they use an already-issued portal
   token, **Then** the request is refused within the same propagation window Phase 1 guarantees for
   staff deactivation.
10. **Given** an unknown or non-portal email address, **When** sign-in or credential recovery is
    attempted with it, **Then** the response is indistinguishable from the same attempt with a known
    address.

---

### User Story 2 — A Customer Raises a Ticket Without Phoning Anyone (Priority: P1)

A signed-in customer describes a problem, says what it is about and how urgent it is, and submits it.
A real ticket appears on the agent side — in the queue, in the dashboard, subject to the same
lifecycle, assignment, and SLA machinery as any other — and the customer immediately sees its
reference.

**Why this priority**: it is the first half of PLAN.md's Definition of done, and the only part of the
phase that reduces inbound load rather than merely relocating it.

**Independent Test**: submit a ticket from the portal, then confirm from the agent side that it is an
ordinary ticket with the portal recorded as its source, attached to the submitting customer, and
present in the normal queue.

**Acceptance Scenarios**:

1. **Given** a signed-in customer, **When** they submit a request with a subject and description,
   **Then** a ticket is created against their own customer record, associated with their own contact,
   and its reference is shown to them.
2. **Given** a portal-submitted ticket, **When** an agent opens it, **Then** it behaves exactly like
   any other ticket — assignable, transitionable, subject to SLA policy — and its source identifies
   the portal.
3. **Given** a customer attempting to submit against a different customer record, **When** the request
   is made, **Then** it is refused; the customer record is taken from the session, never from the
   request.
4. **Given** an incomplete submission, **When** it is sent, **Then** the customer is told what is
   missing in their own language, and no ticket is created.
5. **Given** a customer submitting repeatedly in a short period, **When** the configured allowance is
   exceeded, **Then** further submissions are refused without affecting their ability to read existing
   tickets.
6. **Given** a customer with a file they want to send, **When** they reach the submission form, **Then**
   it offers no upload control and states plainly that files can be sent by replying to the request by
   email — rather than leaving the absence to be discovered.

---

### User Story 3 — A Customer Tracks Their Requests Without Asking (Priority: P1)

A customer sees a list of the requests associated with their own contact, each with its reference,
subject, current state, when it was raised, and when it last changed. Open and settled requests are
distinguishable at a glance.

**Why this priority**: "track" is named explicitly in PLAN.md's Definition of done, and status chasing
is the most common reason a customer contacts support about a ticket that is already being handled.

**Independent Test**: on a customer record holding two contacts, with tickets in different statuses
split between them and at least one ticket associated with neither, open the portal as one contact and
confirm exactly that contact's tickets appear — the colleague's and the unassociated one do not.

**Acceptance Scenarios**:

1. **Given** a customer with several tickets associated with their contact, **When** they open the
   portal, **Then** all of them are listed with reference, subject, state, and last-changed time.
2. **Given** a ticket belonging to another customer, **When** its reference or identifier is requested
   directly, **Then** the response is the same as for a ticket that does not exist.
3. **Given** a ticket raised by a colleague on the same customer record, **When** it is listed or
   requested directly, **Then** it is absent and indistinguishable from a ticket that does not exist
   (Clarifications Q2).
4. **Given** a ticket carrying no contact association, **When** the portal is opened by any contact on
   that record, **Then** the ticket does not appear — the association is required for visibility, not
   assumed from its absence.
5. **Given** a customer with no tickets, **When** they open the list, **Then** the portal reads as
   empty rather than broken, and offers the way to raise one.
6. **Given** a ticket in an internal state such as escalated, **When** the customer views it, **Then**
   they see a state meaningful to them and no internal escalation detail.
7. **Given** the interface set to Arabic, **When** the list is rendered, **Then** it reads
   right-to-left with states, dates, and references correctly presented.

---

### User Story 4 — A Customer Reads the Whole Conversation and Nothing Else (Priority: P1)

A customer opens one request and sees its full correspondence in order — what they sent, on whichever
channel they sent it, and what the organisation replied — with nothing internal in it.

**Why this priority**: PLAN.md names "full interaction history" in scope, and this is the surface where
a leak would be most damaging and least recoverable.

**Independent Test**: on a ticket carrying internal notes, tasks, mentions, SLA state, an assignee, and
correspondence on two channels, open the customer view and confirm the correspondence is complete and
everything else absent — verified against the composed response, not the rendered page.

**Acceptance Scenarios**:

1. **Given** a ticket with correspondence on more than one channel, **When** the customer opens it,
   **Then** they see one chronological history across channels.
2. **Given** a ticket carrying internal notes, tasks, or mentions, **When** the customer opens it,
   **Then** none of that content is present in the response at all.
3. **Given** a ticket under an SLA policy, **When** the customer opens it, **Then** no target,
   countdown, or breach state is present.
4. **Given** a ticket that has been merged into another, **When** the customer opens the reference they
   were given, **Then** they reach the surviving conversation rather than a dead end.
5. **Given** an attachment sent as part of correspondence, **When** the customer opens the history,
   **Then** they can retrieve the files belonging to their own ticket and no others.

---

### User Story 5 — A Customer Answers Back Without Opening a Second Ticket (Priority: P2)

A customer replies on an existing request. The reply joins the same conversation, the agent sees it
where they see every other inbound message, and no duplicate ticket is created.

**Why this priority**: without it, PLAN.md's "entirely without agent involvement" fails on the first
follow-up question — a customer who can read a reply but not answer it phones, or raises a second
ticket, and the phase's benefit is lost. It is P2 only because reading is useful before writing is.

**Independent Test**: reply from the portal on an open ticket and confirm the message appears in the
agent's timeline as an inbound message on the portal channel, with no new ticket created.

**Acceptance Scenarios**:

1. **Given** an open ticket, **When** the customer sends a reply, **Then** it appears in the ticket's
   correspondence for both sides with the customer as its sender.
2. **Given** a settled ticket, **When** the customer sends a reply, **Then** the system behaves
   according to one stated rule — reopening within a defined window, or directing them to raise a new
   request — and never silently discards the message.
3. **Given** a reply on a ticket belonging to another customer, **When** it is attempted, **Then** it
   is refused as though the ticket did not exist.
4. **Given** a customer reply, **When** it arrives, **Then** it participates in the same response-clock
   and automation behaviour as an inbound message on any other channel.
5. **Given** a customer wanting to send a file with their reply, **When** they compose it, **Then** the
   reply form offers no upload control and says how to send the file instead (Clarifications Q3).

---

### User Story 6 — A Customer Finds the Answer Before Raising Anything (Priority: P2)

A signed-in customer browses and searches published help content from inside the portal, and is
offered relevant articles while describing a new request — with raising the request always one step
away.

**Why this priority**: PLAN.md names knowledge base access in scope, and deflection is where the portal
pays for itself. P2 because Phase 7 already delivers the content publicly; this is reach, not
capability.

**Independent Test**: search from inside the portal, open a published customer-visible article, and
confirm the results are identical to the public help centre's for the same query and that nothing
internal or unpublished is reachable.

**Acceptance Scenarios**:

1. **Given** a signed-in customer, **When** they search help content, **Then** they see the same
   published, customer-visible results the public help centre would return.
2. **Given** an internal or unpublished article, **When** a signed-in customer searches for or requests
   it directly, **Then** it is unreachable and indistinguishable from absent.
3. **Given** a customer describing a new request, **When** their text matches published content,
   **Then** relevant articles are offered before submission and can be dismissed in one step.
4. **Given** an article published in one language only, **When** it is listed or opened, **Then** its
   language is stated rather than the other language appearing merely absent.

---

### User Story 7 — A Customer Says Whether It Was Actually Fixed (Priority: P2)

After a request is resolved, the customer is invited once to rate the resolution and optionally say
why. The rating is stored against that ticket and is visible to the organisation.

**Why this priority**: PLAN.md's Definition of done ends with "and rate the resolution". P2 because it
depends on a resolved ticket existing, which depends on the earlier stories.

**Independent Test**: resolve a ticket, submit a rating from the portal, confirm it is stored once and
visible on the agent side, and confirm a second submission neither overwrites nor duplicates it.

**Acceptance Scenarios**:

1. **Given** a resolved or closed ticket, **When** the customer opens it, **Then** they are invited to
   rate the resolution.
2. **Given** a ticket that is not yet resolved, **When** the customer opens it, **Then** no rating is
   offered.
3. **Given** a rating already submitted for a ticket, **When** submission is attempted again, **Then**
   the existing response stands and the customer is told it was already recorded.
4. **Given** a customer who ignores the invitation, **When** time passes, **Then** nothing is created,
   no reminder escalates, and the ticket is unaffected.
5. **Given** a submitted rating, **When** staff view the ticket, **Then** the score and any comment are
   visible with the date they were given.
6. **Given** a rated ticket that is subsequently reopened and resolved again, **When** the customer
   returns, **Then** the behaviour follows one stated rule rather than producing two conflicting scores
   for one ticket.

---

### User Story 8 — Someone Can See Who Has Access, and Turn It Off (Priority: P3)

A permitted staff member can see which contacts on a customer record hold portal access and which
invitations are outstanding, revoke an unaccepted invitation, withdraw a live account, release a
lockout, and associate an old ticket with a contact so its owner can see it. Every one of those acts is
attributable in the audit log.

**Why this priority**: the phase is not operable without it — a shared or compromised customer
credential has no remedy otherwise, and Clarifications Q2's fail-closed rule leaves historical tickets
that only a human can associate. It is P3 rather than P1 because the *issuing* half of administration
moved into User Story 1, where invite-only makes it a prerequisite; what remains here is ongoing
management, and the first seven stories are demonstrable before this screen exists.

**Independent Test**: withdraw a customer's portal access while they hold a live session and confirm
their next request is refused; then confirm both the withdrawal and the refusal are attributable.

**Acceptance Scenarios**:

1. **Given** a customer record with several contacts, **When** a permitted staff member views it,
   **Then** they can see which contacts hold portal access, which have invitations outstanding, and
   which are locked out.
2. **Given** a customer with portal access, **When** a permitted staff member withdraws it, **Then**
   the customer's existing sessions stop working within the guaranteed propagation window.
3. **Given** an outstanding invitation, **When** a permitted staff member revokes it, **Then** it can no
   longer be accepted, and the revocation is recorded with its actor.
4. **Given** a locked-out portal account, **When** a permitted staff member releases the lockout,
   **Then** the customer can sign in again and the release is recorded with its actor.
5. **Given** a ticket with no contact association, **When** a permitted staff member associates it with
   a contact on its own customer record, **Then** that contact can see it in the portal and the
   association is recorded with its actor.
6. **Given** a staff member without the portal-administration permission, **When** they attempt any of
   these acts, **Then** the attempt is refused server-side, not merely hidden.
7. **Given** any invitation, grant, withdrawal, revocation, lockout, release, credential reset, or
   ticket-contact association, **When** it happens, **Then** an audit entry records who did it, to which
   customer and contact, and when.

---

### Edge Cases

- **A customer record is deactivated while a portal session is live.** The session must stop working
  within the propagation window Phase 1 guarantees for staff, and the refusal must be
  indistinguishable from an invalid token.
- **Two customer records hold the same email address.** Phase 2's duplicate detection makes this
  possible rather than impossible. Invite-only removes the ambiguity — the invitation names a contact
  row, not an address — but the two resulting accounts must stay independent, and neither must see the
  other's tickets.
- **A provisional customer** — created automatically from an inbound message, never onboarded — is
  invited. Invite-only makes this a deliberate staff act rather than something the sender can do to
  themselves, but the record is still unverified, so whether an invitation may be issued to one at all
  must be settled rather than left to the issuer's judgement.
- **An invitation is sent, then the contact it names is edited or removed** before it is accepted.
- **An invitation is forwarded** by its recipient to somebody else, who accepts it.
- **The same contact is invited twice**, or invited while already holding an account.
- **A contact row holding a live portal account is removed** from the customer record.
- **The customer's record is merged into another** after they hold a credential. Their credential must
  keep working, must open the surviving record, and must carry its contact's ticket associations with
  it.
- **At launch, a newly invited customer has no visible tickets** because none of their history carries a
  contact association. The portal must read as empty rather than broken, and this must be an expected
  state rather than a defect report.
- **A ticket's originating address matches two contacts** on the same record, so the deterministic
  backfill cannot decide. It must decline rather than pick.
- **A ticket the customer can see is merged away.** They hold a reference that is no longer the live
  conversation and must not reach a dead end — and the surviving ticket may be associated with a
  different contact, which must not become a way to see somebody else's conversation.
- **A ticket is in `escalated` status.** That name is internal vocabulary; the customer needs a state,
  not the organisation's escalation posture.
- **The ticket has no assignee, or the assignee is deactivated.** Neither fact is customer-visible, and
  neither may make the view fail to render.
- **Correspondence arrived on a channel the customer has opted out of.** Opt-out governs outbound
  delivery, not the customer's own record of what was said; the history stays complete.
- **An attachment on the ticket was uploaded by an agent for internal purposes.** Internal files must
  not become retrievable merely because they sit near a visible ticket.
- **A customer needs to send a file.** The portal accepts none (Clarifications Q3), so the alternative
  route has to be stated where they look for the missing control, not buried in help content.
- **The customer requests a file by identifier from another ticket.** Same answer as a file that does
  not exist.
- **Credential recovery is used repeatedly** against one address, or across many addresses. Neither
  must reveal which addresses exist, and neither must become a mail-flooding tool.
- **A rating arrives on a ticket that was reopened** between the invitation and the submission.
- **The knowledge base is empty**, or nothing matches the customer's text. Both must read as "nothing
  here" rather than as a failure, and neither must block submission.
- **The customer's interface is Arabic and the only relevant article is English** (or the reverse).
- **A portal session is idle for a long period**, then used. Expiry must be a stated behaviour with a
  path back in, not an unexplained failure.
- **The same customer signs in from two devices.** Both work, and withdrawal ends both.

## Requirements _(mandatory)_

### Functional Requirements

#### Portal identity and credentials

- **FR-001**: The system MUST provide a customer-facing sign-in that authenticates a customer
  independently of the staff sign-in, and MUST NOT create, require, or imply a staff user record for
  any customer.
- **FR-002**: A customer MUST obtain a portal credential only by accepting an invitation issued by a
  permitted staff member to an existing email contact on an existing customer record
  (Clarifications Q1).
- **FR-002a**: The system MUST NOT expose any self-registration route, and MUST NOT create a portal
  account from an unrecognised or self-asserted email address under any circumstances.
- **FR-002b**: An invitation MUST name exactly one email contact on exactly one customer record, and
  MUST be single-use — accepting it creates one portal account and consumes it.
- **FR-002c**: An invitation MUST expire after a configured period, MUST be revocable by a permitted
  staff member before acceptance, and MUST be refused after expiry, acceptance, or revocation with a
  response identical to that for an invitation which never existed.
- **FR-002d**: An invitation MUST be delivered only to the address recorded on the contact it names,
  and MUST NOT be redirectable to an address supplied when it is issued or accepted.
- **FR-002e**: Issuing, delivering, accepting, expiring, and revoking an invitation MUST each be
  recorded in the audit log, attributable to the staff member who issued or revoked it.
- **FR-002f**: The system MUST state whether a provisional customer record may be invited, and MUST
  enforce that rule server-side rather than leaving it to the issuer's judgement.
- **FR-003**: A portal credential MUST resolve to exactly one email contact on exactly one customer
  record, and the system MUST refuse to issue or use one that is ambiguous between two contacts or two
  records.
- **FR-003a**: Where two customer records hold the same email address, the resulting portal accounts
  MUST remain independent, and neither MUST be able to reach the other's records.
- **FR-003b**: Removing or reassigning the contact a portal account is keyed to MUST end that account's
  access rather than leave it resolving to nothing.
- **FR-004**: Where a credential includes a secret chosen by the customer, it MUST be stored using the
  same adaptive hashing standard Phase 1 mandates for staff, and MUST NOT be recoverable.
- **FR-005**: Repeated failed portal sign-in attempts MUST trigger a lockout on the same configurable
  basis Phase 1 established for staff, tracked separately from staff lockouts.
- **FR-006**: The portal MUST NOT disclose whether an email address is known to the system — sign-in
  failure, credential recovery, and registration (where it exists) MUST be indistinguishable for known
  and unknown addresses.
- **FR-007**: A customer MUST be able to end their own session, and MUST be able to change or reset
  their own credential where one exists.
- **FR-008**: Portal sign-in, sign-out, failed attempts, lockouts, credential resets, and access grants
  or withdrawals MUST all be recorded in the audit log, attributable to the customer or the staff
  member who caused them.
- **FR-009**: A customer whose record is deactivated, or whose portal access has been withdrawn, MUST
  be refused within the propagation window Phase 1 guarantees for staff deactivation, with the same
  response as an invalid session.
- **FR-010**: Portal authentication and credential-recovery endpoints MUST be rate limited on their own
  allowances, such that exhausting one cannot deny service to any other portal or public surface.
- **FR-011**: The chat widget's per-conversation token (Phase 5, D14) MUST NOT be accepted as a portal
  credential, and MUST NOT be upgradable into one.

#### Realm separation (NON-NEGOTIABLE)

- **FR-012**: A portal session token MUST be distinguishable from a staff token by construction, such
  that presenting one where the other is expected fails in the verification step rather than in a
  handler.
- **FR-013**: Staff-authenticated middleware MUST refuse a portal token, and portal-authenticated
  middleware MUST refuse a staff token; both refusals MUST be identical to the refusal of an absent
  token.
- **FR-014**: A portal request MUST NOT be able to acquire any staff permission grant, and MUST NOT be
  evaluated against the staff permission catalog.
- **FR-015**: Every portal endpoint MUST derive both the customer record and the contact it operates on
  from the authenticated session only, and MUST ignore any customer or contact identifier supplied by
  the caller.
- **FR-016**: Every portal read MUST be scoped to the session's own contact at the point the data is
  fetched, and MUST NOT rely on filtering after retrieval or on hiding in the interface.
- **FR-017**: A request for a record the session's contact cannot see MUST produce the same response as
  a request for a record that does not exist — whether it belongs to another customer, to a colleague on
  the same customer record, or to nobody.
- **FR-018**: The complete set of portal endpoints MUST be enumerable in one place, as Phase 5 required
  of the unauthenticated surface, so the whole customer-reachable surface can be reviewed at once.

#### Ticket submission

- **FR-019**: A signed-in customer MUST be able to submit a new request with, at minimum, a subject and
  a description, and MUST receive its reference on success.
- **FR-020**: A portal submission MUST create an ordinary ticket subject to Phase 3's lifecycle, Phase
  4's assignment and dashboard behaviour, and Phase 6's SLA and automation behaviour — with no parallel
  ticket type.
- **FR-021**: A portal-submitted ticket MUST record that it originated from the portal, distinguishably
  from every existing source.
- **FR-022**: The portal MUST NOT accept file uploads — not on submission, not on a reply, and not on a
  satisfaction comment (Clarifications Q3). No portal endpoint accepts a file.
- **FR-022a**: Wherever a customer would reasonably look for an upload control, the portal MUST state
  that files are sent by replying to the request on a channel that accepts them, rather than presenting
  a disabled control or no explanation.
- **FR-022b**: Declining uploads MUST NOT reduce what a customer can retrieve: files that form part of
  their own correspondence remain retrievable (FR-033).
- **FR-023**: Where the customer may choose a category or urgency, the values offered MUST come from
  Phase 3's existing taxonomy, and an out-of-range value MUST be refused rather than coerced.
- **FR-024**: Validation failures MUST be reported in the customer's active language and MUST NOT
  create a partial ticket.
- **FR-025**: Portal submission MUST be rate limited independently of portal reading.

#### Tracking, history, and reply

- **FR-026**: A customer's portal MUST list only the tickets associated with the signing-in contact, and
  MUST NOT list a ticket raised by another contact on the same customer record (Clarifications Q2).
- **FR-026a**: A ticket MUST be able to record which contact it came from, referencing a contact on its
  own customer record.
- **FR-026b**: A portal submission MUST set that association to the session's own contact, taken from
  the session and never from the request.
- **FR-026c**: A ticket created from an inbound message MUST set the association to the contact whose
  address or number the identity resolution matched, where exactly one matched.
- **FR-026d**: A ticket created from a public web form MUST set the association to the contact matching
  the address the submitter gave, where exactly one matches.
- **FR-026e**: A ticket created by a staff member MUST allow the association to be set, and MUST remain
  creatable without one — an agent raising a ticket on a phone call may not know which contact it is.
- **FR-026f**: A ticket with no contact association MUST NOT be visible in the portal to any contact on
  its customer record. Visibility requires the association; its absence MUST NOT be read as "visible to
  all".
- **FR-026g**: The system MAY associate an existing ticket automatically only where its originating
  inbound message came from an address or number matching exactly one contact on its customer record.
  Where none or more than one matches, it MUST leave the ticket unassociated rather than choose.
- **FR-026h**: A permitted staff member MUST be able to associate a ticket with a contact on its own
  customer record, and MUST NOT be able to associate it with a contact on any other record.
- **FR-026i**: Staff surfaces showing a ticket MUST show which contact it is associated with, so an
  agent can tell who is able to see it in the portal.
- **FR-026j**: Merging tickets MUST leave the surviving ticket with exactly one contact association, and
  MUST NOT make a conversation visible to a contact who could not see it before the merge.
- **FR-027**: Each listed ticket MUST show its reference, subject, a customer-meaningful state, when it
  was raised, and when it last changed.
- **FR-028**: Internal status vocabulary MUST be presented to a customer as a state meaningful to them,
  and MUST NOT expose internal escalation or handling posture.
- **FR-029**: A customer MUST be able to open one of their tickets and read its full correspondence in
  chronological order across every channel it used.
- **FR-030**: The customer ticket view MUST be composed from an explicitly defined set of fields; adding
  a field to any internal ticket surface MUST NOT cause that field to appear here.
- **FR-031**: The customer ticket view MUST NOT contain internal notes, tasks, mentions, assignee
  identity, SLA targets or breach state, automation runs, assignment history, merge or
  duplicate-override records, or the provisional flag — absent from the response, not hidden in the
  interface.
- **FR-032**: A customer holding the reference of a ticket that has been merged MUST reach the surviving
  conversation where their contact is associated with it, and MUST receive the same response as for a
  ticket that does not exist where it is not.
- **FR-033**: A customer MUST be able to retrieve attachments forming part of the correspondence on a
  ticket their contact is associated with, and MUST NOT be able to retrieve any other file, including
  internal files attached near a visible ticket and files on a colleague's ticket.
- **FR-034**: A customer MUST be able to reply on an existing ticket, and the reply MUST join that
  ticket's correspondence as an inbound message rather than creating a new ticket.
- **FR-035**: A portal reply MUST participate in the same response-clock and automation behaviour as an
  inbound message on any other channel.
- **FR-036**: The system MUST apply one stated rule to a reply on a settled ticket — reopening it within
  a defined window, or directing the customer to raise a new request — and MUST NOT discard the message
  silently under either rule.
- **FR-037**: A customer's own opt-out from an outbound channel MUST NOT reduce the completeness of the
  history they can read in the portal.

#### Knowledge base access

- **FR-038**: A signed-in customer MUST be able to search and browse published, customer-visible
  articles from within the portal.
- **FR-039**: Portal knowledge results MUST be identical to what Phase 7's public help centre returns
  for the same query and language — the portal MUST NOT widen audience or lifecycle visibility.
- **FR-040**: A draft, archived, or internal article MUST be unreachable from the portal and
  indistinguishable from one that does not exist.
- **FR-041**: While a customer is describing a new request, the system MUST offer relevant published
  articles based on what they have written.
- **FR-042**: A customer offered an article before submission MUST be able to continue and submit the
  request in the same number of steps as if nothing had been offered.
- **FR-043**: Where an article exists in one language only, that language MUST be stated wherever the
  article is listed or opened.
- **FR-044**: An empty knowledge base, or a query matching nothing, MUST read as "nothing here" and MUST
  NOT block or delay submission.
- **FR-045**: Portal knowledge search MUST be rate limited separately from portal reading, on the same
  principle Phase 7 applied publicly.
- **FR-046**: The authenticated portal MUST NOT introduce a second body of customer-facing content or a
  second content-reading capability; it reuses Phase 7's published, customer-visible set.

#### Satisfaction feedback

- **FR-047**: A customer MUST be able to rate the resolution of a ticket that has reached a resolved or
  closed state, and MUST NOT be offered a rating before then.
- **FR-048**: A rating MUST consist of a score on a fixed, stated scale, and MAY carry an optional
  free-text comment.
- **FR-049**: At most one rating MUST exist per ticket, and a second submission MUST leave the first
  standing and say so.
- **FR-050**: A rating MUST record which ticket it belongs to, its score, any comment, and when it was
  given.
- **FR-051**: Ignoring a rating invitation MUST create nothing and MUST NOT alter the ticket's state, its
  SLA record, or any automation outcome.
- **FR-052**: The rating MUST be about the resolution of a request, not about an article — this phase
  introduces exactly one rating mechanism, as Phase 7 required.
- **FR-053**: A submitted rating and its comment MUST be visible to staff on the ticket, with the date it
  was given.
- **FR-054**: The system MUST apply one stated rule where a rated ticket is reopened and resolved again,
  and MUST NOT hold two conflicting scores for one ticket.
- **FR-055**: A rating MUST be attributable to the contact that gave it, and MUST NOT be submittable on
  a ticket the session's contact is not associated with.

#### Staff administration of portal access

- **FR-056**: Staff holding a dedicated portal-administration permission MUST be able to see, per
  contact on a customer record, whether it holds portal access, has an invitation outstanding, or is
  locked out — and MUST be able to invite, revoke an outstanding invitation, and withdraw a live account.
- **FR-057**: The same permitted staff MUST be able to release a portal lockout and initiate a credential
  reset without learning the customer's secret.
- **FR-057a**: The same permitted staff MUST be able to associate an existing ticket with a contact on
  its own customer record (FR-026h), so a ticket that predates the portal can become visible to the
  person who raised it.
- **FR-058**: Portal administration MUST be governed by its own permission key, distinct from
  `customers:update`, so managing access is grantable without granting customer editing.
- **FR-059**: Every portal-administration act MUST be enforced server-side and MUST be refused for a
  caller lacking the permission, regardless of what the interface offers.
- **FR-060**: Withdrawing access MUST invalidate the customer's existing sessions within the guaranteed
  propagation window, on every device they hold one on.
- **FR-060a**: Withdrawing one contact's access MUST NOT affect any other contact's access on the same
  customer record.

#### Cross-cutting

- **FR-061**: Every portal screen MUST render correctly in Arabic (RTL) and English (LTR), with all text
  drawn from locale files and no hardcoded strings.
- **FR-062**: Every portal screen MUST meet WCAG 2.1 AA in both languages, including keyboard operation,
  contrast, and screen-reader announcement of validation errors.
- **FR-063**: The portal MUST render outside the authenticated staff application shell, as Phase 7's help
  centre does, so no staff navigation, permission-derived menu, or internal vocabulary is reachable from
  it.
- **FR-064**: A customer's language choice MUST persist for their session and MUST govern both the
  interface and the content they are offered.
- **FR-065**: The portal MUST NOT expose the internal identifier of any customer, ticket, user, or article
  where a reference or slug already serves — following Phase 3's ticket reference and Phase 7's
  slug-not-id rule.

### PLAN.md Traceability

PLAN.md **Scope** bullets for Phase 8 map as follows:

| PLAN.md scope bullet                   | Requirements                | Verified by                                             |
| -------------------------------------- | --------------------------- | ------------------------------------------------------- |
| Customer login and ticket submission   | FR-001–FR-025               | User Story 1, User Story 2, SC-001–SC-006, SC-025–SC-027 |
| Request tracking and full history view | FR-026–FR-037               | User Story 3, User Story 4, User Story 5, SC-007–SC-012, SC-028–SC-030 |
| FAQ / knowledge base access            | FR-038–FR-046               | User Story 6, SC-013–SC-015                             |
| Post-resolution satisfaction feedback  | FR-047–FR-055               | User Story 7, SC-016–SC-018                             |
| _(enabling, not a scope bullet)_       | FR-056–FR-060a, FR-061–FR-065 | User Story 8, SC-020, SC-023, SC-031                  |

PLAN.md **Definition of done** — _"A customer can log in, raise and track a ticket, browse help content,
and rate the resolution — entirely without agent involvement"_ — maps as follows:

| Definition of done clause            | Verified by                                       |
| ------------------------------------ | ------------------------------------------------- |
| "A customer can log in"              | FR-001–FR-011, User Story 1, SC-001, SC-025       |
| "raise ... a ticket"                 | FR-019–FR-025, User Story 2, SC-005               |
| "and track"                          | FR-026–FR-033, User Story 3, User Story 4, SC-007, SC-028 |
| "browse help content"                | FR-038–FR-046, User Story 6, SC-013               |
| "rate the resolution"                | FR-047–FR-055, User Story 7, SC-016               |
| "entirely without agent involvement" | FR-019, FR-034, FR-047, SC-019                    |

**Carried forward from earlier phases.** Phase 2 Clarifications Q3 deferred virus scanning to this phase
(Question 3), and is answered by admitting no inbound files (FR-022). Phase 5 kept the message timeline
correspondence-only so a customer view could be built on it (FR-029, FR-031) and asked this phase to
decide the fate of the chat widget's conversation token (FR-011). Phase 7 delivered the public help
centre and asked whether the authenticated portal reuses it (FR-046), and reserved satisfaction feedback
for this phase with exactly one rating mechanism (FR-052).

**Carried into later phases.** Clarifications Q2 gives a ticket a contact association (FR-026a), which
Phase 10's reporting can group by and must not confuse with the customer record — a company's ticket
count is not the sum of its contacts' portal views. Q3's decision means the virus-scanning deferral is
still open: it is now a precondition for accepting portal uploads rather than a Phase 2 leftover
(see Out of Scope). Q1's invite-only model leaves bulk invitation and self-registration as deliberate
later additions, not oversights.

### Key Entities

- **Portal Account**: A customer's means of signing in — the credential, its state (active, withdrawn,
  locked out), and its link to exactly **one email contact on one customer record**. It is not a staff
  user and must never appear anywhere staff users appear. Two contacts on one company record are two
  independent accounts.
- **Portal Invitation**: A single-use, expiring, revocable offer of portal access, issued by a named
  staff member to a named contact. It is the only way an account comes into existence, and it is spent
  when accepted.
- **Portal Session**: A time-bounded proof that a request comes from one contact on one customer record,
  carrying its realm explicitly so it cannot be mistaken for a staff session.
- **Ticket Requesting Contact**: The association saying which contact a ticket came from. New to this
  phase, and the thing portal visibility is computed from — a ticket without one is visible to nobody in
  the portal.
- **Portal Ticket View**: Not a stored record — the explicitly composed projection of a ticket a customer
  may see, defined by what it includes rather than by what it hides.
- **Portal Reply**: An inbound message on the portal channel, joining an existing ticket's correspondence
  rather than starting a conversation.
- **Satisfaction Response**: One score, an optional comment, a date, and the ticket it judges. At most one
  per ticket, created only by the contact that ticket is associated with.
- **Portal Access Event**: The audit record of an invitation, acceptance, revocation, grant, withdrawal,
  lockout, release, sign-in, credential reset, or ticket-contact association — attributable to the
  customer or the staff member who caused it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A customer who has never used the portal can accept an invitation, set up their credential,
  and reach their own requests in under five minutes, without staff help beyond the invitation itself.
- **SC-002**: A portal token presented to every staff endpoint is refused by all of them, and a staff
  token presented to every portal endpoint is refused by all of them — verified across the full endpoint
  set, not a sample.
- **SC-003**: No portal response contains a record the session's contact cannot see, verified by
  attempting every portal read with another customer's identifiers **and** with a colleague's on the same
  customer record.
- **SC-004**: Withdrawing a customer's portal access stops their live session within the same window Phase
  1 guarantees for staff deactivation.
- **SC-005**: A customer can raise a request end to end with no agent action, and an agent sees it in the
  normal queue with no special handling.
- **SC-006**: Portal sign-in reveals nothing about whether an address is registered — responses are
  indistinguishable for known and unknown addresses.
- **SC-007**: A customer can determine the current state of every request associated with their contact
  without contacting anyone.
- **SC-008**: The customer ticket view contains no internal note, task, mention, assignee, SLA target,
  breach state, automation run, or merge record — asserted against the response body for a ticket carrying
  all of them.
- **SC-009**: A customer holding the reference of a merged ticket reaches the surviving conversation.
- **SC-010**: A customer can retrieve every attachment belonging to their own correspondence and no file
  outside it.
- **SC-011**: A customer reply reaches the agent's timeline as an inbound message, and no reply creates a
  duplicate ticket.
- **SC-012**: Correspondence history stays complete for a customer who has opted out of an outbound
  channel.
- **SC-013**: A customer can find and read a published customer-visible article from inside the portal,
  and cannot reach anything unpublished or internal.
- **SC-014**: For a request whose text plainly matches published content, an article is offered before
  submission — and submission still completes in the same number of steps.
- **SC-015**: Search and article display work in Arabic: an Arabic query finds an Arabic article, and a
  one-language article states its language wherever it appears.
- **SC-016**: A customer can rate a resolved request in under 30 seconds, and exactly one rating exists per
  ticket however many times submission is attempted.
- **SC-017**: A submitted score and comment are visible to staff on the ticket with their date.
- **SC-018**: Ignoring a rating invitation changes nothing — no record, no reminder, no effect on the
  ticket, its SLA record, or any automation outcome.
- **SC-019**: A customer completes sign-in, submission, tracking, history reading, help browsing, and
  rating with zero agent actions — PLAN.md's Definition of done, demonstrated as one journey.
- **SC-020**: Every portal screen passes bilingual (Arabic RTL / English LTR) and WCAG 2.1 AA checks before
  the phase is accepted.
- **SC-021**: A customer with no tickets, and a customer whose search matches nothing, both see a surface
  that reads as empty rather than broken.
- **SC-022**: Exhausting any portal rate-limit allowance leaves every other portal and public surface
  serving normally.
- **SC-023**: Every portal access event — sign-in, failure, lockout, grant, withdrawal, reset — is present
  in the audit log and attributable.
- **SC-024**: No portal URL or response exposes an internal database identifier where a reference or slug
  exists.
- **SC-025**: There is no sequence of requests by which an uninvited person obtains a portal account —
  demonstrated against the full portal endpoint set, not only the sign-in screen.
- **SC-026**: An invitation cannot be used twice, after expiry, or after revocation, and all four
  refusals — used, expired, revoked, never existed — are indistinguishable from each other.
- **SC-027**: An invitation reaches only the address on the contact it names, whatever address is supplied
  when it is issued or accepted.
- **SC-028**: Two contacts on one company customer record, each signed in, see disjoint sets of requests,
  and neither can reach the other's by reference, by identifier, or through an attachment.
- **SC-029**: A ticket with no contact association is invisible in the portal to every contact on its
  customer record, and becomes visible only when a permitted staff member associates it.
- **SC-030**: No portal endpoint accepts a file upload, verified across the full endpoint set — and every
  place a customer would look for one states how to send a file instead.
- **SC-031**: Withdrawing one contact's portal access ends their sessions on every device and leaves every
  other contact on the same customer record unaffected.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for `/speckit-clarify`.

- **A portal reply is in scope.** PLAN.md names submission, tracking, and full history but not replying.
  Reading a reply without being able to answer it sends the customer to the phone, which defeats
  "entirely without agent involvement", so User Story 5 includes it. It is an inbound-only channel — the
  portal writes into the existing correspondence structure and needs no outbound transport — which is why
  it does not reopen Phase 5's channel design. If scope must be cut, this is the first candidate.
- **Satisfaction feedback is collected in the portal, not by a tokenised link in an email.** One surface,
  one rating mechanism, no new token type. A survey link usable without a portal account is a reasonable
  later addition and is listed Out of Scope.
- **Portal identity is keyed to an email contact.** The customer record holds contacts as values rather
  than as people, and email is the only contact kind that can carry an invitation and a recovery flow.
  Phone-based sign-in is out of scope.
- **A provisional customer record may be invited, but only by explicit staff act** — which invite-only
  already guarantees (FR-002f states the rule must be enforced rather than left to judgement). If the
  organisation would rather forbid it outright, that is a one-line change to FR-002f and a candidate for
  `/speckit-clarify`.
- **The deterministic backfill in FR-026g runs once, as part of this phase's delivery**, rather than
  becoming a standing job. Tickets it cannot decide stay unassociated and wait for FR-057a.
- **Bulk invitation is not built.** Invitations are issued one contact at a time. An organisation
  onboarding hundreds of customers will feel this, and it is the first thing to add if they do.
- **Staff-side reporting on satisfaction is Phase 10's.** This phase stores the responses and shows them on
  the ticket; aggregate scores, trends, and dashboards belong to the reporting phase.
- **Session lifetime and refresh follow Phase 1's existing token behaviour**, with values configured
  separately for the portal realm rather than shared with staff.
- **The customer-facing state vocabulary is a presentation mapping, not a new lifecycle.** Phase 3's six
  statuses remain the only lifecycle; the portal maps them to states a customer can act on.
- **Portal access is per contact, not per customer record** (Clarifications Q2) — which is why FR-026a
  adds an association the data model does not currently have.
- **No self-service editing of customer data.** A customer may read their requests, not maintain their own
  profile, contacts, or address; Phase 2 owns customer data and its audit trail. This includes their own
  contact row: a customer cannot change the email their account is keyed to, since that would let them
  move their own identity.
- **The portal is a surface of the existing application, not a separate deployment**, reusing the
  established stack, i18n scaffolding, and public shell pattern Phase 7 introduced.

## Out of Scope

- **AI features on the portal** — chatbot, automatic summarisation, suggested replies (Phase 9). The
  article suggestion in FR-041 is Phase 7's existing relevance matching, not a model.
- **Satisfaction reporting, aggregation, and trend analysis** (Phase 10). Responses are stored and shown
  per ticket here.
- **A tokenised email survey usable without a portal account** — a reasonable extension once one rating
  mechanism exists.
- **Customer self-service editing of their own profile, contacts, or address** (Phase 2 owns customer
  data).
- **Customer visibility of SLA targets, countdowns, or breach state** — deliberately excluded, and Phase 6
  stated it would be.
- **Customer visibility of internal notes, tasks, mentions, or assignee identity** — excluded by FR-031 and
  by the commitments Phases 2, 4, and 5 made.
- **Phone or SMS-based portal sign-in**, and any credential keyed to a contact kind other than email.
- **Self-registration** (Clarifications Q1). A later addition on top of invitations, never a replacement
  for them.
- **Bulk or self-serve invitation** — issuing invitations to many contacts at once, or a customer inviting
  a colleague themselves.
- **File uploads from the portal** (Clarifications Q3). The condition for lifting this is explicit and
  belongs to whichever phase takes it on: **an upload is accepted only once a scanning step gates
  retrieval**, resolving the deferral Phase 2 recorded and this phase declined to inherit by proxy.
  Until then, files travel inward on Phase 5's channels only.
- **Aggregate visibility for a company** — an account that can see every request under one customer
  record. Clarifications Q2 chose per-contact visibility; a supervisory company account is a coherent
  future feature and a different one.
- **A second body of customer-facing content**, a portal-only article set, or article ratings (Phase 7
  reserved the single rating mechanism to this phase, and it rates resolutions).
- **Roles or permissions within the portal** — every portal account has identical capabilities over its
  own contact's records; there is no customer-side administrator, delegate, or read-only role.
- **Payments, invoices, contracts, or any commercial surface** — nothing in PLAN.md Phase 8 puts them here.
- **A native mobile application.** The portal is responsive; a packaged app is not in this phase.
