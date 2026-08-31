# Feature Specification: Phase 5 — Communication Channels

**Feature Branch**: `006-phase-5-communication-channels`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Implement omnichannel ticket intake: email-to-ticket conversion, WhatsApp Business API messaging, an embeddable live chat widget, SMS send/receive, configurable web-to-ticket forms, and a unified conversation timeline per customer across all channels."

**PLAN.md Reference**: Phase 5 — Communication Channels

**Depends on**: Phase 1 — Security & Administration Foundations (users, roles, permissions, audit),
Phase 2 — Customer Management (the identity an inbound message must resolve to, and its contacts),
Phase 3 — Ticket Management (Core) (what a message becomes, and its lifecycle),
Phase 4 — Agent Dashboard (where an arriving message surfaces, and the note composer and template
library a reply is written in)

## Overview

Phase 4 gave the agent somewhere to stand. Phase 5 changes where the work comes from.

Every ticket in this system so far was typed in by an employee. Someone read a message in their own
mailbox, or took a phone call, and created a record by hand. PLAN.md's Definition of done for this
phase ends that: _"A message from any channel becomes a ticket automatically and shows up correctly
in the agent dashboard and the customer's timeline."_

Three consequences follow, and each one is a genuine first for this codebase.

**The system acquires an outside edge.** Phases 0–4 accepted input from exactly one kind of source:
an authenticated employee holding a verified token. Every guard built so far answers the question
_"is this known user allowed to do this?"_ Phase 5 accepts input from the public internet — a mail
server relaying a message from anyone, a webhook from a messaging provider, a chat widget embedded
on a page the organisation does not control, a form anyone can submit. Constitution Principle II
still governs, but the question changes to _"is this input real, is it safe, and how much of it will
we take?"_ Authentication does not answer that. Sender verification, idempotency, rate limiting, and
loop prevention do.

**Identity stops being known and becomes inferred.** Phases 2–4 always had an actor id. An inbound
message carries an email address, a phone number, or nothing at all. Deciding which Phase 2 customer
it belongs to — or that it belongs to none yet — is the central new problem of this phase, and it is
upstream of everything else: a message attached to the wrong customer is worse than a message nobody
routed, because it silently discloses one customer's correspondence inside another's record.

**Correspondence becomes two-way, and the internal boundary has to hold under pressure.** Phase 4
built internal notes on an explicit promise: colleague-to-colleague, never shown to a customer,
enforced now so it can be relied on when Phase 8 gives customers a window. Phase 5 puts
customer-visible messages on the same ticket, in the same region of the same screen. The two must be
impossible to confuse — not merely labelled differently, but distinguishable at a glance, in both
languages, in greyscale, and to a screen reader. This is the phase where an internal note leaking
into an outbound reply becomes physically possible for the first time.

Phase 5 also inherits two decisions it must not quietly undo. Phase 3 fixed assignment as
Supervisor-only, and Phase 4 honoured that; an arriving message does not get to assign itself to
whoever happens to be free. And Phase 4 deliberately built the quick-reply library with no outbound
channel (Phase 4 Clarifications Q2), on the stated understanding that Phase 5 would add channels as
new insertion targets rather than rebuild the library. This spec is written against both.

## Clarifications

### Session 2026-08-30

Three questions were raised during `/speckit-specify`, each a point where PLAN.md's Phase 5 scope
depends on a decision PLAN.md itself does not make. All three are resolved; no
`[NEEDS CLARIFICATION]` markers remain.

- **Q1 — What is this phase's relationship to the third-party providers?** WhatsApp Business API, an
  SMS gateway, and a mail transport are external services requiring commercial accounts. The
  constitution's Open Items name an AI provider (Phase 9) and an ERP system (Phase 11) as
  unresolved, but name no messaging provider — the gap was never recorded because no earlier phase
  reached outside the network. **Decision: every channel is reached through a provider-agnostic
  adapter, and a built-in simulator is the default transport.** A real adapter for one named
  provider per channel is implemented, and becomes active only where credentials are configured.
  This is the reading that satisfies all six PLAN.md scope bullets without making the phase's
  acceptance depend on a commercial account and, for WhatsApp, a business verification that is
  outside this project's control. See FR-005 and FR-005a–FR-005d.
- **Q2 — What happens when a message arrives from a sender who matches no known customer?**
  **Decision: a provisional customer is created from the sender, flagged as unverified**, and Phase
  2's existing duplicate detection offers a merge into a real customer. The alternative readings
  each break something already built: a ticket with no customer contradicts Phase 3's model and
  every Phase 4 consumer that assumes a ticket has one, and quarantining unknown senders means a
  stranger cannot raise a ticket unattended, which is most of the point of omnichannel intake. See
  FR-014 and FR-014a–FR-014d.
- **Q3 — What does the "unified conversation timeline" contain?** PLAN.md names it as a scope bullet
  but does not say whether it holds customer correspondence only, or every event on the customer's
  record. **Decision: customer correspondence only** — inbound and outbound messages across every
  channel. Phase 4's internal notes and Phase 3's ticket history stay on the ticket, where Phase 4
  put them. See FR-087 and FR-087a.

**Q1 has a consequence worth carrying forward.** The simulator is a development and test transport,
not a product feature, and it is the one thing in this phase that must never be reachable in a
production configuration (FR-005c). The provider choice itself remains open and should be recorded
in the constitution's Open Items, where it belongs alongside the AI and ERP decisions — this phase
makes that choice cheap to make later rather than making it now.

**Q2 has a consequence worth carrying forward.** Because unknown senders create records, the
customer list becomes something the outside world can add rows to for the first time. FR-014c and
FR-020 are what keep that from being an open door, and Phase 10's reporting must be aware that a
provisional customer is not the same thing as a customer somebody onboarded.

**Q3 has a consequence worth carrying forward.** Because the timeline is correspondence only, it is
structurally safe for Phase 8 to build a customer-facing view on: there is no internal content in it
to leak. That property is worth preserving deliberately — a later phase that adds notes or history
to this structure destroys it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — An Email Becomes a Ticket, and the Reply Continues It (Priority: P1)

A customer sends an email to the support address. Without anyone touching it, a ticket exists, with
the subject and body intact, attributed to the right customer, sitting in the queue Phase 4 built.
The customer later replies to the correspondence. That reply lands on the same ticket as the next
message in the conversation — not as a second ticket some agent has to notice and merge.

**Why this priority**: Email is the highest-volume channel in practice and the only one in this
phase's scope that needs no commercial messaging account. It is also where the threading problem
lives in its hardest form. An implementation that gets email right has built the machinery every
other channel reuses.

**Independent Test**: Deliver a message to the intake mailbox from a known customer's address;
confirm a ticket appears with the correct customer, subject, and body. Reply to the resulting
correspondence from the same address; confirm no second ticket is created and the reply appears as
the next message on the first.

**Acceptance Scenarios**:

1. **Given** an intake mailbox and a message from a known customer's address, **When** the message
   is collected, **Then** a ticket exists whose subject and body match the message and whose
   customer is that customer.
2. **Given** a ticket created from email, **When** the customer replies to the correspondence,
   **Then** the reply is appended to that ticket as a new message and no new ticket is created.
3. **Given** an email carrying attachments, **When** it is converted, **Then** the attachments are
   retained against the ticket and are retrievable by an agent who may view that ticket.
4. **Given** an email whose body is HTML, **When** it is converted, **Then** the agent sees readable
   text with no active content, and no markup is rendered as if it were trusted.
5. **Given** the same message delivered twice, **When** both are processed, **Then** exactly one
   ticket and one message exist.
6. **Given** an automated reply (out-of-office, bounce, or delivery report), **When** it is
   received, **Then** it does not create a ticket and does not trigger an outbound response.
7. **Given** a reply that arrives against a closed ticket, **When** it is processed, **Then** it is
   handled by a single declared rule rather than silently discarded.
8. **Given** a message that cannot be attributed or converted, **When** processing fails, **Then**
   it is retained for review with the reason recorded, and is never lost.

---

### User Story 2 — The Message Finds the Right Customer (Priority: P1)

A message arrives carrying an email address or a phone number and nothing else. The system decides
which customer it belongs to using what Phase 2 already knows — the customer's contacts — and is
correct when it is confident and honest when it is not.

**Why this priority**: Every other story in this phase is built on top of this one, and it is the
only place in the phase where being wrong is worse than doing nothing. A misattributed message puts
one customer's words into another customer's record and timeline.

**Independent Test**: Seed customers whose contacts carry known addresses and numbers; deliver
messages from a matching address, a matching number, an unrecognised sender, and an address shared
by two customers; confirm each is resolved or held according to the declared rule and never guessed.

**Acceptance Scenarios**:

1. **Given** a customer with a contact holding the sender's email address, **When** a message
   arrives from it, **Then** the message is attributed to that customer.
2. **Given** a customer with a contact holding the sender's phone number in any accepted format,
   **When** a message arrives from it, **Then** it is attributed to that customer, matching on the
   normalised number rather than the literal string.
3. **Given** a sender matching no customer, **When** a message arrives, **Then** it is handled by
   the declared unknown-sender rule and an agent can see it.
4. **Given** a sender whose address matches more than one customer, **When** a message arrives,
   **Then** the system does not choose between them silently; the ambiguity is surfaced for a person
   to resolve.
5. **Given** a message attributed to an inactive customer, **When** it arrives, **Then** it is still
   captured and the customer's inactive standing is visible to the agent.
6. **Given** an agent viewing a message attributed to the wrong customer, **When** they reattribute
   it, **Then** the correction is recorded in the audit trail with who made it.

---

### User Story 3 — The Agent Answers On the Channel It Arrived On (Priority: P1)

An agent working a ticket writes a reply and sends it. It leaves by the channel the customer used,
from the ticket, without the agent opening a mail client or a phone. The quick-reply library Phase 4
built inserts into that reply exactly as it inserts into a note, and the agent can always see which
of the two they are writing.

**Why this priority**: Intake without a reply path is a strictly worse inbox. It is also the promise
Phase 4 deferred: the template library was built with no outbound channel on the explicit
understanding that this phase would supply one.

**Independent Test**: From a ticket created by an inbound message, compose and send a reply; confirm
it is delivered on the originating channel, recorded on the ticket as outbound, and attributed to
the sending agent.

**Acceptance Scenarios**:

1. **Given** a ticket created from an inbound message, **When** an agent sends a reply, **Then** it
   is delivered on the channel the message arrived on and recorded on the ticket as outbound and
   attributed to that agent.
2. **Given** the reply composer, **When** the agent inserts a quick-reply template, **Then** it
   inserts and remains editable, exactly as it does in the internal note composer.
3. **Given** a ticket carrying both internal notes and customer correspondence, **When** an agent
   views it, **Then** which of the two they are reading is unmistakable, and composing one can never
   send the other.
4. **Given** an agent without permission to correspond with customers, **When** they open a ticket,
   **Then** the reply surface is unavailable to them, refused by the server and not merely hidden.
5. **Given** a reply that the provider rejects or fails to deliver, **When** the failure is known,
   **Then** the agent is told on the ticket and the message is not shown as delivered.
6. **Given** an outbound reply, **When** it is sent, **Then** it is recorded in the audit trail as
   correspondence leaving the organisation.

---

### User Story 4 — One Customer, One Conversation (Priority: P2)

An agent opens a customer and sees everything that has been said to and by them, across every
channel, in one chronological place — rather than reconstructing it from several tickets.

**Why this priority**: It is a named PLAN.md scope bullet and half of the Definition of done, but it
is a view over data the earlier stories produce. It cannot be built first and is not useful until
there is more than one channel.

**Independent Test**: Give one customer correspondence on two channels across two tickets; open the
customer; confirm one ordered timeline showing every message with its channel, direction, and time.

**Acceptance Scenarios**:

1. **Given** a customer with messages on more than one channel, **When** an agent opens their
   timeline, **Then** all of them appear in one chronological sequence.
2. **Given** any entry in the timeline, **When** the agent reads it, **Then** its channel,
   direction, time, and the ticket it belongs to are all identifiable.
3. **Given** a timeline entry, **When** the agent selects it, **Then** they reach the ticket it
   belongs to.
4. **Given** a customer with a long history, **When** the timeline is opened, **Then** it loads in
   bounded pages rather than all at once.
5. **Given** an agent who may not view a ticket, **When** they view that customer's timeline,
   **Then** messages from that ticket are not disclosed to them.

---

### User Story 5 — A Visitor Starts a Chat On the Website (Priority: P2)

Someone on the organisation's public site opens the chat widget and asks a question. An agent
answers from the dashboard while the visitor waits. When the visitor leaves, the conversation does
not evaporate — it is a ticket.

**Why this priority**: Chat is the only synchronous channel in this phase, which makes it the one
that most changes what the agent screen must do. It is P2 rather than P1 because the organisation
can operate without it and cannot operate without email.

**Independent Test**: Open the widget on a test page, start a conversation, answer it from the
dashboard, close the browser, and confirm the exchange survives as a ticket with the full
transcript.

**Acceptance Scenarios**:

1. **Given** the widget embedded on a page, **When** a visitor sends a first message, **Then** a
   ticket exists carrying that message.
2. **Given** an active chat, **When** an agent replies, **Then** the visitor sees the reply without
   reloading, and vice versa.
3. **Given** a chat conversation, **When** it ends by either party leaving, **Then** the full
   transcript is retained on the ticket.
4. **Given** a visitor who identifies themselves with an address or number that matches a customer,
   **When** the chat is converted, **Then** it is attributed by the same rule every other channel
   uses.
5. **Given** no agent available, **When** a visitor starts a chat, **Then** they are told so and the
   conversation is still captured as a ticket rather than dropped.
6. **Given** the widget on a site in either language, **When** it renders, **Then** it is correct in
   that language and reading direction.

---

### User Story 6 — WhatsApp and SMS Reach the Same Queue (Priority: P2)

A customer messages the organisation's WhatsApp number, or sends an SMS. It arrives as a ticket in
the same queue, answered from the same screen, by the same agent, with the constraints each channel
genuinely imposes made visible rather than hidden.

**Why this priority**: Both are named PLAN.md scope bullets and both are dominant channels in the
project's region. They are grouped because they share a shape — a phone number as identity, a
provider webhook as transport, and provider-imposed limits on when an outbound message may be sent.

**Independent Test**: Deliver an inbound message on each channel from a number belonging to a known
customer; confirm a ticket in the queue; reply from the ticket and confirm delivery.

**Acceptance Scenarios**:

1. **Given** an inbound message on either channel, **When** it is received, **Then** a ticket exists
   attributed by phone number under the same identity rule as every other channel.
2. **Given** a WhatsApp conversation outside the provider's permitted free-form reply window,
   **When** an agent tries to reply, **Then** they are told what the channel permits rather than
   being allowed to compose a message that will be rejected.
3. **Given** inbound media on WhatsApp, **When** it is received, **Then** it is retained against the
   ticket like any other attachment.
4. **Given** a customer who opts out by the channel's standard means, **When** they do, **Then**
   further outbound messages to that number are prevented and the opt-out is visible to agents.
5. **Given** the provider redelivers a webhook already processed, **When** it arrives, **Then** no
   duplicate ticket or message is created.
6. **Given** a webhook whose authenticity cannot be verified, **When** it arrives, **Then** it is
   rejected and the attempt recorded.

---

### User Story 7 — A Form On the Website Becomes a Ticket (Priority: P3)

An administrator defines a form — the fields it asks for, in both languages — and publishes it. A
visitor fills it in and a ticket appears carrying the answers as structured content, not as one
paragraph of run-together text.

**Why this priority**: The lowest-volume channel and the one with no live conversation attached to
it, but the only one where the organisation controls exactly what it is told up front.

**Independent Test**: Define a form with several fields, submit it as a visitor, and confirm a
ticket with each answer legibly attributed to its question, in the language the form was submitted
in.

**Acceptance Scenarios**:

1. **Given** a published form, **When** a visitor submits it, **Then** a ticket exists carrying
   every answer with the question it answers.
2. **Given** a form with required fields, **When** a submission omits one, **Then** the visitor is
   told which field and no ticket is created.
3. **Given** a form definition, **When** an administrator edits it, **Then** tickets already created
   from earlier submissions still read correctly against the questions as they were asked.
4. **Given** a form defining a category or priority, **When** a submission arrives, **Then** the
   resulting ticket carries them, within the values Phase 3 declared.
5. **Given** repeated automated submissions, **When** they exceed a declared rate, **Then** they are
   refused without affecting genuine submissions.
6. **Given** a form rendered in either language, **When** a visitor views it, **Then** its labels and
   validation messages are in that language and reading direction.

---

### Edge Cases

- **A reply arrives on a ticket that has been merged into another** (Phase 3 merge semantics). It
  must land on the survivor, not on a redirect nobody is working.
- **A reply arrives on a closed ticket.** Reopen, or create a linked new ticket? One rule, declared
  and applied identically on every channel.
- **Two customers share a phone number or a shared mailbox address.** Attribution is ambiguous, and
  guessing discloses one customer's correspondence to another.
- **A known customer writes from an address the system has never seen.** They are a real customer,
  but the sender matches nothing.
- **An auto-responder answers our outbound reply, and our system answers back.** A mail loop that
  can generate unbounded tickets in minutes.
- **The provider delivers the same webhook three times**, or delivers messages out of order, or
  delivers one whose signature does not verify.
- **The provider is unreachable when an agent sends a reply.** The agent must not be told it was
  delivered.
- **A message exceeds the size limit, or carries an attachment type the system refuses.**
- **A chat visitor closes the tab mid-sentence**, or reopens it an hour later.
- **An outbound message is attempted to a number that has opted out**, or to an inactive customer.
- **A form field is removed after tickets were created from it.**
- **An agent composes in the wrong surface**, or pastes an internal note into an outbound reply. The
  screen must make the error hard rather than warn about it afterwards.
- **Inbound content arrives in a language, script, or direction different from the agent's
  interface.**
- **A message arrives while its customer is being merged** by Phase 2's duplicate handling.

## Requirements _(mandatory)_

### Functional Requirements

#### Channels and messages

- **FR-001**: The system MUST record every customer communication, inbound or outbound, as a message
  belonging to a ticket, carrying at minimum its channel, direction, author or sender, content,
  timestamp, and delivery state.
- **FR-002**: Messages MUST be distinguishable from Phase 4's internal notes everywhere both appear,
  by more than colour alone, in both languages and reading directions.
- **FR-003**: The system MUST support the channels named in PLAN.md: email, WhatsApp, live chat,
  SMS, and web form. A web form submission is inbound-only and has no reply path of its own.
- **FR-004**: Adding a further channel MUST NOT require changing ticket creation, identity
  resolution, the timeline, or the agent's reply surface. Channel-specific behaviour MUST be
  confined to that channel's own adapter.
- **FR-005**: Each channel MUST be configurable and independently enableable, and the system MUST
  behave correctly with any subset enabled.
- **FR-005a**: Every channel MUST be reached through an adapter, and the rest of the system MUST NOT
  know which provider is behind it (Clarifications Q1).
- **FR-005b**: Each channel MUST offer a simulated transport that exercises the full inbound and
  outbound path without contacting an external service, so that every capability in this phase can
  be demonstrated and tested without a commercial account.
- **FR-005c**: The simulated transport MUST NOT be reachable in a production configuration, and the
  system MUST refuse to start rather than run a channel in production against a simulator.
- **FR-005d**: Selecting a real provider for a channel MUST be a configuration change, requiring no
  change to ticket creation, identity resolution, the timeline, or the agent's reply surface.
- **FR-006**: Channel credentials MUST be held as configuration, never in source control, and MUST
  NOT be readable through any interface once stored.
- **FR-007**: The system MUST record, for every inbound message, the provider's own identifier for
  it, so that redelivery can be recognised.
- **FR-008**: Inbound content MUST be treated as untrusted. It MUST NOT be rendered as active
  content, and MUST NOT be interpreted as instructions by any part of the system.
- **FR-009**: Message content MUST be retained as received; agents MUST NOT be shown a lossy
  rewriting of what the customer actually sent.
- **FR-010**: The system MUST enforce a maximum accepted message and attachment size per channel and
  refuse what exceeds it without failing the rest of intake.

#### Identity resolution

- **FR-011**: The system MUST attribute an inbound message to a customer by matching the sender
  against the contact details Phase 2 already holds.
- **FR-012**: Phone number matching MUST be performed on a normalised form, so that the same number
  written in different formats resolves identically.
- **FR-013**: Email matching MUST be case-insensitive on the domain and MUST NOT treat two different
  addresses as equal.
- **FR-014**: When a sender matches exactly one customer, the message MUST be attributed to that
  customer.
- **FR-014a**: When a sender matches no customer, the system MUST create a provisional customer from
  what the sender disclosed and attribute the message to it (Clarifications Q2). A message is never
  left without a customer.
- **FR-014b**: A provisional customer MUST be marked as unverified and MUST be distinguishable from
  a customer a person onboarded, everywhere customers are listed or reported on.
- **FR-014c**: A provisional customer MUST be offered for merge into an existing customer through
  Phase 2's duplicate detection rather than a second mechanism built here.
- **FR-014d**: Merging a provisional customer into a real one MUST carry its correspondence with it,
  under FR-019.
- **FR-015**: When a sender matches more than one customer, the system MUST NOT choose between them.
  The message MUST be captured and the ambiguity surfaced for a person to resolve.
- **FR-016**: A message MUST NOT be attributed to a customer on a partial or fuzzy match. Identity is
  exact or it is unresolved.
- **FR-017**: An agent with the appropriate permission MUST be able to attribute or reattribute a
  message's ticket to the correct customer, and every such change MUST be audited.
- **FR-018**: Attribution to an inactive customer MUST still capture the message, and the customer's
  standing MUST be visible to the agent handling it.
- **FR-019**: Attribution MUST survive Phase 2's customer merge: correspondence attributed to a
  customer that is later merged MUST be reachable from the surviving customer.
- **FR-020**: The system MUST NOT create a customer record from a sender whose messages have only
  ever been refused, rate-limited, or quarantined.

#### Threading and ticket creation

- **FR-021**: An inbound message that continues an existing conversation MUST be appended to that
  conversation's ticket rather than creating a new one.
- **FR-022**: An inbound message that does not continue an existing conversation MUST create a new
  ticket, using the values Phase 3 declared for a newly created ticket.
- **FR-023**: Threading MUST NOT rely on the message subject alone.
- **FR-024**: A message that threads to a merged ticket MUST be appended to the surviving ticket,
  following Phase 3's merge resolution.
- **FR-025**: A message that threads to a closed ticket MUST be handled by one declared rule, applied
  identically on every channel, and the outcome MUST be visible to the agent.
- **FR-026**: A ticket created from a message MUST be attributed to the system as its creator, and
  MUST be distinguishable from one an employee created by hand.
- **FR-027**: Ticket creation from a message MUST NOT assign the ticket to an agent. Assignment
  remains Supervisor-only, as fixed in Phase 3 and honoured in Phase 4.
- **FR-028**: A ticket created from a message MUST appear in the Phase 4 dashboard queue and
  notification stream by the same paths as any other ticket, with no channel-specific surface.
- **FR-029**: The system MUST recognise automated mail — out-of-office replies, bounces, and delivery
  reports — and MUST NOT create a ticket from one or reply to one.
- **FR-030**: The system MUST prevent correspondence loops, bounding how many automated exchanges can
  occur with one sender in a period, and MUST record when it does so.

#### Inbound email

- **FR-031**: The system MUST collect messages from a configured intake mailbox without an employee
  forwarding them.
- **FR-032**: Collection MUST continue from where it left off after a restart, without reprocessing
  what it has already handled and without skipping what arrived while it was down.
- **FR-033**: The sender, recipients, subject, body, and date MUST be preserved on the resulting
  message.
- **FR-034**: Both plain-text and HTML bodies MUST be accepted, and the agent MUST be shown readable
  content with no active content in either case.
- **FR-035**: Attachments MUST be retained against the ticket, subject to the same type and size
  rules Phase 2 established for customer files.
- **FR-036**: Inline images referenced by the body MUST NOT be presented as if they were documents
  the customer deliberately attached.
- **FR-037**: A message that cannot be parsed, attributed, or converted MUST be retained with the
  reason recorded and MUST be visible to an administrator. Nothing is discarded silently.
- **FR-038**: A message retained after failure MUST be reprocessable once the cause is corrected.
- **FR-039**: The system MUST recognise a message it has already processed and MUST NOT create a
  second ticket or message from it.
- **FR-040**: Outbound email MUST carry what is needed for the customer's reply to thread back to the
  same ticket.
- **FR-041**: The intake address MUST NOT expose any capability other than creating and continuing
  tickets.

#### Outbound correspondence

- **FR-042**: An agent MUST be able to send a reply to a customer from the ticket, on the channel the
  conversation is taking place on.
- **FR-043**: Sending a reply MUST require a distinct permission, separate from the permission to
  write an internal note, enforced server-side.
- **FR-044**: The reply surface and the internal note surface MUST be visually and structurally
  distinct, and it MUST NOT be possible to send one believing it is the other.
- **FR-045**: Quick-reply templates from Phase 4 MUST be insertable into a reply, remaining editable
  after insertion, without changing how the library is managed.
- **FR-046**: Every outbound message MUST be recorded on the ticket, attributed to the sending agent,
  with its time and delivery state.
- **FR-047**: Delivery state MUST be shown honestly. A message not confirmed as delivered MUST NOT be
  presented as delivered.
- **FR-048**: A delivery failure MUST be surfaced on the ticket to the agent who sent it.
- **FR-049**: The system MUST retry a failed send where the failure is transient, within declared
  bounds, and MUST NOT retry where the provider has refused permanently.
- **FR-050**: Sending correspondence to a customer MUST be recorded in the audit trail as information
  leaving the organisation.
- **FR-051**: The system MUST refuse to send to a recipient who has opted out on that channel, and
  MUST make the opt-out visible to the agent before they compose.
- **FR-052**: Outbound messages MUST be composable in either language with correct reading direction
  in the composer.

#### WhatsApp

- **FR-053**: The system MUST receive inbound WhatsApp messages and convert them under the same
  identity, threading, and ticket rules as every other channel.
- **FR-054**: Inbound webhooks MUST be authenticated, and a request whose authenticity cannot be
  verified MUST be rejected and recorded.
- **FR-055**: Webhook handling MUST be idempotent; redelivery MUST NOT produce duplicates.
- **FR-056**: Inbound media MUST be retained against the ticket under the same rules as other
  attachments.
- **FR-057**: The system MUST respect the provider's constraint on when a free-form reply may be
  sent, and MUST tell the agent what is permitted rather than allowing a message that will be
  refused.
- **FR-058**: Where the provider requires pre-approved message formats outside that window, the
  system MUST make clear which are available.
- **FR-059**: Delivery and read state reported by the provider MUST be reflected on the message.
- **FR-060**: An opt-out expressed through the channel's standard means MUST be honoured.

#### SMS

- **FR-061**: The system MUST receive inbound SMS and convert it under the same identity, threading,
  and ticket rules as every other channel.
- **FR-062**: An agent MUST be able to send an SMS reply from the ticket.
- **FR-063**: The system MUST make the length limit and any per-message segmentation visible to the
  agent before sending.
- **FR-064**: Inbound webhooks MUST be authenticated and idempotent, as for WhatsApp.
- **FR-065**: Standard opt-out keywords MUST be honoured, the opt-out recorded against the number,
  and further outbound messages to it prevented.
- **FR-066**: Delivery state reported by the gateway MUST be reflected on the message.
- **FR-067**: A number that cannot receive SMS MUST produce a visible failure, not silence.

#### Live chat

- **FR-068**: The system MUST provide a chat widget embeddable on a page the organisation controls,
  without that page needing access to any authenticated interface.
- **FR-069**: A visitor MUST be able to start a conversation without an account.
- **FR-070**: A visitor's first message MUST produce a ticket.
- **FR-071**: Messages MUST pass between visitor and agent while both are present, without either
  reloading.
- **FR-072**: The full transcript MUST be retained on the ticket when the conversation ends, however
  it ends.
- **FR-073**: A visitor who supplies an email address or phone number MUST be attributed by the same
  identity rule as every other channel.
- **FR-074**: When no agent is available, the visitor MUST be told, and the conversation MUST still
  become a ticket.
- **FR-075**: A visitor MUST be able to reach only their own conversation, and MUST NOT be able to
  reach any other conversation, ticket, or customer.
- **FR-076**: The widget MUST render correctly in Arabic and English with the correct reading
  direction, independently of the host page's language.
- **FR-077**: The widget MUST be operable by keyboard alone and usable with a screen reader.
- **FR-078**: Chat intake MUST be rate-limited per visitor so that the widget cannot be used to create
  unbounded tickets.

#### Web forms

- **FR-079**: An administrator MUST be able to define a form: its fields, their types, whether each is
  required, and its labels in both languages.
- **FR-080**: Defining and changing forms MUST require a distinct permission, enforced server-side.
- **FR-081**: A published form MUST be submittable by a visitor without an account.
- **FR-082**: A submission MUST create a ticket carrying every answer together with the question it
  answers.
- **FR-083**: Required-field validation MUST be enforced by the server, not only in the browser, and a
  rejected submission MUST tell the visitor which field failed, in the submission's language.
- **FR-084**: A form MAY set the resulting ticket's category and priority, restricted to the values
  Phase 3 declared.
- **FR-085**: Tickets created from an earlier version of a form MUST remain readable against the
  questions as they were asked at the time.
- **FR-086**: Form submission MUST be rate-limited and protected against automated abuse without
  obstructing genuine submissions.

#### Unified conversation timeline

- **FR-087**: An agent MUST be able to see one chronological sequence of a customer's communication
  across every channel and every ticket.
- **FR-087a**: The timeline MUST contain customer correspondence only (Clarifications Q3). Phase 4
  internal notes and Phase 3 ticket history MUST NOT appear in it, so that the structure carries no
  internal content for Phase 8 to leak.
- **FR-088**: Every entry MUST identify its channel, direction, time, and the ticket it belongs to.
- **FR-089**: An entry MUST lead to the ticket it belongs to.
- **FR-090**: The timeline MUST NOT disclose content from a ticket the viewing agent may not view.
- **FR-091**: The timeline MUST be paged or otherwise bounded.
- **FR-092**: The timeline MUST order entries by when the communication happened, not by when the
  system recorded it.
- **FR-093**: The timeline MUST be reachable from the customer record and from the Phase 4 customer
  context panel, without rebuilding either.

#### Reliability

- **FR-094**: Inbound processing MUST be idempotent on every channel.
- **FR-095**: An inbound message MUST be persisted before any dependent action is taken on it, so a
  failure downstream cannot lose it.
- **FR-096**: Inbound processing MUST survive a restart, resuming without loss or duplication.
- **FR-097**: A provider outage MUST NOT lose an inbound message that was accepted, nor cause an
  outbound message to be reported as delivered when it was not.
- **FR-098**: Messages arriving out of order MUST be presented in the order they were sent, where the
  channel reports it.
- **FR-099**: Every channel MUST be independently rate-limited on intake.
- **FR-100**: A failure in one channel MUST NOT stop the others.
- **FR-101**: The system MUST record enough about each intake attempt for an administrator to
  determine what arrived, what became of it, and why anything failed.

#### Permissions, audit, and cross-cutting

- **FR-102**: Corresponding with a customer, managing channel configuration, and managing form
  definitions MUST each be a distinct permission, enforced server-side on every protected endpoint.
- **FR-103**: Hiding an interface control MUST NOT substitute for server enforcement on any capability
  this phase introduces.
- **FR-104**: Outbound correspondence, channel configuration changes, form definition changes, and
  message reattribution MUST all be audited with the acting user.
- **FR-105**: The public endpoints introduced by this phase — the chat widget, form submission, and
  provider webhooks — MUST be the only unauthenticated surfaces, MUST be individually rate-limited,
  and MUST expose no capability beyond creating and continuing a conversation.
- **FR-106**: No endpoint introduced by this phase may disclose whether a given address or phone
  number belongs to a known customer.
- **FR-107**: Every screen and component introduced by this phase MUST render correctly in Arabic
  (RTL) and English (LTR), with direction applied at the root and no per-component flipping.
- **FR-108**: All text introduced by this phase MUST come from the locale files; hardcoded strings are
  prohibited.
- **FR-109**: Every control introduced by this phase MUST be keyboard-operable with a visible focus
  indicator and meet WCAG 2.1 AA contrast in both languages.
- **FR-110**: Channel, direction, and delivery state MUST be conveyed by more than colour alone.
- **FR-111**: All lists introduced by this phase MUST be paged or otherwise bounded.
- **FR-112**: The layered separation established in Phase 0 and carried through Phases 1–4 MUST be
  preserved: business decisions live in the service layer, provider specifics live behind the channel
  adapter, and no interface component communicates with the backend except through the established
  service layer.

### PLAN.md Traceability

| PLAN.md Phase 5 Scope bullet                                   | Covered by                  |
| -------------------------------------------------------------- | --------------------------- |
| Email intake (SMTP/IMAP) → auto-converts to tickets            | FR-031–FR-041, FR-021–FR-030 |
| WhatsApp Business API integration                              | FR-053–FR-060               |
| Embeddable live chat widget                                    | FR-068–FR-078               |
| SMS send/receive                                               | FR-061–FR-067               |
| Configurable web forms → tickets                               | FR-079–FR-086               |
| Unified per-customer conversation timeline across all channels | FR-087–FR-093               |

Cross-cutting foundations are covered by FR-001–FR-010 including FR-005a–FR-005d (channels,
messages, and the adapter boundary), FR-011–FR-020 including FR-014a–FR-014d (identity and
provisional customers), FR-042–FR-052 (outbound), FR-094–FR-101 (reliability), and FR-102–FR-112
(permissions, audit, bilingual, accessibility, layering).

PLAN.md **Definition of done** for Phase 5 maps as follows:

| Definition of done clause                            | Verified by                                     |
| ---------------------------------------------------- | ----------------------------------------------- |
| "A message from any channel becomes a ticket automatically" | User Stories 1, 5, 6, 7; SC-001, SC-002, SC-003 |
| "and shows up correctly in the agent dashboard"      | User Story 3; FR-028; SC-005                    |
| "and the customer's timeline"                        | User Story 4; SC-007, SC-008                    |

**Carried forward from Phase 4.** The quick-reply library was built with no outbound channel on the
explicit understanding that this phase would add channels as insertion targets rather than rebuild it
(Phase 4 Clarifications Q2); FR-045 honours that. Phase 4's internal notes carry a privacy promise
that this phase is the first able to break; FR-002, FR-044, and Clarifications Q3 exist to keep it.
Phase 4's dashboard queue and notification stream are what an arriving ticket flows into unchanged
(FR-028).

**Carried forward from Phase 3.** Assignment remains Supervisor-only (FR-027). Merge semantics govern
where a reply to a merged ticket lands (FR-024). The declared status set and taxonomy govern what a
channel may set on a ticket it creates (FR-022, FR-084).

**Carried forward from Phase 2.** Customer contacts are the only identity source (FR-011), and
customer merge must not strand correspondence (FR-019).

### Key Entities

- **Channel**: A means by which the organisation and a customer exchange messages — email, WhatsApp,
  live chat, SMS, or web form. Configurable, independently enableable, and the only place a
  provider's particulars are allowed to be known.
- **Message**: One communication on a ticket, inbound or outbound, carrying its channel, direction,
  sender or author, content, attachments, time, and delivery state. Distinct from Phase 4's internal
  note: a note is written to a colleague, a message is exchanged with a customer.
- **Conversation Timeline**: Not a stored record — the ordered view of a customer's messages across
  every ticket and channel. Correspondence only: it holds nothing internal, which is the property
  Phase 8 will depend on (Clarifications Q3).
- **Channel Identity**: An address or number by which a customer is recognised on a channel, and the
  bridge between an inbound message and a Phase 2 customer contact.
- **Provisional Customer**: A customer record created by the system from an unrecognised sender
  rather than by a person, marked unverified until someone confirms or merges it. It exists so that
  no message is ever left without a customer, and it is the first record in this project the outside
  world can cause to be created (Clarifications Q2).
- **Opt-Out**: A recorded refusal by a customer to receive further outbound messages on a channel,
  which the system honours without an agent having to remember it.
- **Form Definition**: An administrator-defined set of bilingual questions a visitor answers to raise
  a ticket, versioned enough that older tickets still read correctly.
- **Chat Session**: A live exchange with a visitor, which exists while both parties are present and
  survives as a transcript on a ticket once they are not.
- **Undeliverable Intake**: An inbound communication that could not be converted, retained with its
  reason so that nothing is lost and the cause can be corrected and retried.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A message sent to the support address becomes a ticket visible in the agent dashboard
  without any employee action.
- **SC-002**: A customer's reply to existing correspondence lands on the original ticket in 100% of
  cases where the reply is generated by replying to the system's own outbound message.
- **SC-003**: Every channel named in PLAN.md's Phase 5 scope can create a ticket, and every channel
  that supports replies can carry an agent's reply to the customer.
- **SC-004**: An inbound message from a sender matching exactly one customer is attributed to that
  customer in 100% of cases; no message is ever attributed to a customer the sender does not match.
- **SC-005**: An agent can read and answer correspondence on any channel from the ticket, without
  leaving the dashboard and without a channel-specific screen.
- **SC-006**: Internal notes are never delivered to a customer, and no reply is ever sent that the
  agent believed was an internal note.
- **SC-007**: A customer's full cross-channel correspondence is visible in one chronological view.
- **SC-008**: An agent can move from any timeline entry to the ticket it belongs to.
- **SC-009**: Duplicate delivery of the same inbound message never produces a second ticket or a
  second message.
- **SC-010**: No inbound message that the system accepted is lost; anything that cannot be converted
  is retained, visible, and retryable.
- **SC-011**: Automated mail never creates a ticket, and no exchange with an automated responder
  exceeds the declared bound.
- **SC-012**: Every capability this phase introduces is refused server-side to a user without the
  permission for it, verified by test rather than by inspection.
- **SC-013**: An unauthenticated request to a public endpoint cannot read, alter, or discover any
  ticket, customer, or message other than the one conversation it owns.
- **SC-014**: Every screen and the embeddable widget are correct in Arabic and English, operable by
  keyboard alone, and legible in greyscale.
- **SC-015**: Every capability in this phase can be demonstrated and tested end to end without a
  commercial messaging account, and swapping a channel to a real provider requires configuration
  only — no change to ticket creation, identity, the timeline, or the reply surface.
- **SC-016**: No inbound message is left without a customer, and a customer the system created from
  an unrecognised sender is distinguishable from one a person onboarded wherever customers appear.

## Assumptions

Reasonable defaults chosen where the description and PLAN.md did not specify. Each is a decision a
later phase may revisit, not an oversight.

- **The organisation operates one support intake address, one WhatsApp number, and one SMS number.**
  Per-department or per-brand routing is Phase 12 work; nothing here forbids it later.
- **Customer contacts from Phase 2 are the only source of identity.** No external directory is
  consulted.
- **Attachment handling reuses the rules Phase 2 established** for customer files — accepted types,
  size limits, and authenticated retrieval — rather than defining a second regime.
- **Conversation content is retained for the life of the ticket**, under the same expectations as
  other ticket data. No channel-specific retention or deletion policy is introduced.
- ~~**A reply to a closed ticket reopens it** where Phase 3's lifecycle permits.~~ **Corrected during
  planning** (research D8, plan.md *Changed during planning*): the lifecycle does not permit it —
  `closed → open` carries `tickets:reopen`, restricted to Supervisors by Phase 3 Clarifications Q2,
  and an inbound message holds no permission. The declared rule FR-025 requires is therefore: **a
  reply to a closed ticket creates a new ticket linked to the closed one**, through Phase 3's
  existing `ticket_links`.
- **Chat is answered by whoever is working the queue.** There is no routing engine, no skills-based
  distribution, and no queue position estimate — those belong with Phase 12's team model.
- **Business hours and response-time commitments are not modelled here.** "No agent available"
  (FR-074) is a live-presence fact, not an SLA calendar, which is Phase 6.
- **Message translation is not performed.** Content is stored and shown as sent; the bilingual
  requirement applies to the interface, not to customer content.
- **Tickets created by hand before this phase remain valid** and simply have no messages.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **A customer-facing portal, login, or self-service ticket view** (Phase 8). The chat widget and web
  forms are anonymous intake surfaces, not an authenticated customer experience.
- **SLA calendars, business hours, response-time targets, automatic escalation, and rule-based routing
  or automation** (Phase 6).
- **Knowledge-base article suggestion or deflection before a conversation starts** (Phase 7).
- **AI-assisted replies, summarisation, sentiment, and language detection** (Phase 9).
- **Voice, telephony, and social media channels beyond those named in PLAN.md's Phase 5 scope.**
- **Per-department or per-brand channel routing, and team-based work distribution** (Phase 12).
- **Channel volume, response-time, and agent performance reporting** (Phase 10).
- **Customer-initiated ticket closure and satisfaction surveys.**
- **Bulk or marketing messaging of any kind.** Every outbound message in this phase answers a
  specific conversation.
- **Assignment changes driven by an arriving message.** Assignment remains Supervisor-only.
- **Rich-text composition, message editing after sending, and message deletion.**
- **Notification preferences per channel, digests, and quiet hours** (still not built).
- **Internal notes and ticket history in the conversation timeline** (Clarifications Q3). The
  timeline is correspondence only, and a later phase adding internal content to it would destroy the
  property that makes it safe for Phase 8.
- **A committed choice of messaging provider** (Clarifications Q1). This phase makes the choice a
  configuration change; it does not make it. The decision belongs in the constitution's Open Items
  alongside the AI and ERP selections.
