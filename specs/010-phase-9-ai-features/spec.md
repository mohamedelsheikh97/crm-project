# Feature Specification: Phase 9 — AI Features

**Feature Branch**: `010-phase-9-ai-features`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Add AI-assisted features on top of the existing ticket workflow: automatic
thread summarization, suggested reply drafting, automatic categorization, similar-ticket solution
suggestions, and a chatbot on the customer portal and chat channel that creates a ticket when it cannot
resolve the issue itself."

**PLAN.md Reference**: Phase 9 — AI Features

**Depends on**: Phase 3 — Ticket Management (Core) (the ticket, its taxonomy, and its lifecycle),
Phase 5 — Communication Channels (the correspondence timeline that is summarised, the reply path a
draft is written into, and the chat channel the bot answers on),
Phase 7 — Knowledge Base (the published content that grounds every answer the bot gives),
Phase 8 — Customer Portal (the authenticated customer surface the bot is offered on)

## Overview

Phase 9 is the first phase whose output the system **cannot check**.

Everything built so far is deterministic. A permission either allows or refuses. An SLA target is a
timestamp arithmetic problem. Phase 7's search returns the rows whose tokens match, and a test asserts
exactly which ones. When those features are wrong, they are wrong the same way every time, and a test
written once catches it forever.

An AI-drafted summary is not like that. It is _plausible_ or _implausible_, _useful_ or _not worth
reading_ — and the same input can produce different output on two consecutive calls. That single
property drives most of what follows, and four consequences deserve stating before any requirement.

**Nothing the AI produces may reach a customer without a human deciding to send it — except in the one
place where the whole point is that no human is there.** A suggested reply is a draft in a composer: an
agent reads it, edits it, and sends it under their own name and authority, exactly as Phase 5 already
requires for every outbound message. The chatbot is the deliberate exception, and it is bounded rather
than trusted: it may answer only from published knowledge base content, it may not act on a ticket, and
the moment it cannot answer it stops talking and creates a ticket for a person. These are different risk
postures for a reason, and the spec keeps them apart rather than describing "AI replies" as one feature.

**This is the first phase that may send customer data out of the system.** Until now exactly one
capability moved data across the boundary — Phase 2's `customers:export`, which is permissioned,
audited, and initiated by a named human who is accountable for the file. AI assistance inverts all
three: it is automatic, continuous, and triggered by the arrival of a customer's own words. A ticket
thread contains names, contact details, account references, complaints, and whatever a customer chose to
paste into an email. Clarifications Q1 draws the line **per surface rather than per system**: staff-facing
features may use an external provider, and the chatbot — the one place a stranger types free text with no
colleague reading it first — may not leave infrastructure the organisation controls.

**The system begins asserting things it cannot substantiate.** Phase 7 was careful that a search result
is a pointer to an article a human wrote and a supervisor published — the organisation's words, under
the organisation's name. A generated answer has no author. It can be fluent, confident, and wrong, and a
customer has no way to tell. Every AI surface therefore has to be legible _as_ AI output, has to carry
its grounding where it has any, and has to fail by saying nothing rather than by inventing something.

**And cost becomes a runtime property of ordinary work.** Every feature so far costs a database query.
This one costs money per invocation, on a bill that arrives monthly and grows with ticket volume — which
means an unbounded retry loop, an automation rule firing per inbound message, or a single customer
holding a chat session open are now financial events as well as technical ones. Phase 5 built per-scope
rate limiting for a related reason; this phase needs the accounting to go with it.

Phase 9 changes no existing behaviour. Every surface here is **additive**: a ticket that is never
summarised, a reply nobody asks the system to draft, and a customer who ignores the bot all behave
exactly as they did at the end of Phase 8. If the AI capability is switched off or unavailable, the
product is Phase 8.

## Clarifications

### Session 2026-09-01

**Q1 — May ticket and customer content be transmitted to a third-party AI provider, or must processing
happen on infrastructure the organisation controls?**

**Decision: split by surface.** Staff-facing features — summarisation, reply drafting, and
similar-ticket suggestion — MAY use an external provider. The customer-facing chatbot MUST NOT; it runs
only on infrastructure the organisation controls.

The split follows the risk rather than the convenience. The chatbot is the one surface where an
unauthenticated or lightly-authenticated stranger types free text, at volume, with no colleague
reviewing it — and it is where a customer pastes a card number or a national ID into what looks like a
support box. Staff-facing features process content an employee is already accountable for and has
already read. The cost is two processing paths instead of one, and FR-008a exists because the way that
goes wrong is a feature quietly pointed at the wrong one.

**Q2 — Does an AI-derived category get applied to the ticket automatically, or only proposed?**

**Decision: proposed only.** Classification never writes `tickets.category`. A human accepts the
proposal, and the acceptance is the write.

Phase 6's automation conditions and SLA policy selection both key on category. Applying a category
automatically would let a probabilistic guess select the SLA policy a ticket is measured against and
fire automation rules built for a human's decision — and the resulting breach or misroute would look
like a Phase 6 bug. Proposing costs the unattended acceleration, which is the honest price.

**Q3 — How long are AI inputs and outputs retained, and may an agent see what was sent?**

**Decision: metadata only.** The invocation record holds what ran, for which ticket, at whose request,
when, whether it succeeded, and what it consumed. It never holds the submitted content or the generated
text.

This is the decision most likely to be regretted on the day of an incident, and it is taken anyway: a
retained prompt-and-response log is a second copy of customer correspondence, with its own lifetime, its
own access rules, and its own deletion obligation, sitting outside every control Phases 2, 5 and 8 built
around the first copy. FR-065a reconciles this with FR-043 — a chatbot conversation is retained, because
it is what the organisation *said to a customer*, not because it is an AI artefact.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — An Agent Picks Up a Long Ticket Without Reading All of It (Priority: P1)

An agent opens a ticket that has been running for two weeks. It has thirty messages across email and
chat, three internal notes, and it has changed hands twice. Today it is theirs. Before Phase 9 the only
way to know what is going on is to read the whole thread from the top; the summary gives them the state
of it in a short read, and the thread is still there when they want the detail.

**Why this priority**: This is the half of PLAN.md's Definition of done that an agent experiences on
every reassignment, escalation, and handover, and it is the lowest-risk AI surface in the phase — it is
read-only, internal, and never seen by a customer. It also delivers value entirely on its own: shipped
alone, with nothing else in this phase, it is a usable product improvement.

**Independent Test**: Open a ticket with a long multi-channel thread, request a summary, and confirm a
readable account of the request, what has been tried, and what is outstanding appears — labelled as
AI-generated, alongside the full thread rather than replacing it.

**Acceptance Scenarios**:

1. **Given** a ticket with a long correspondence history, **When** an agent views it, **Then** they can
   obtain a summary covering the customer's request, what has been done, and what is still open.
2. **Given** a summary has been produced, **When** the agent reads it, **Then** it is visibly marked as
   AI-generated and the full thread remains available in the same view.
3. **Given** a ticket with two messages, **When** an agent requests a summary, **Then** the system either
   declines as unnecessary or returns something no longer than the thread itself.
4. **Given** the AI capability is unavailable, **When** an agent requests a summary, **Then** the ticket
   view continues to work and the failure is stated plainly rather than shown as an empty summary.
5. **Given** a thread conducted in Arabic, **When** a summary is produced, **Then** it is in Arabic.
6. **Given** new messages arrive after a summary was produced, **When** the agent returns to the ticket,
   **Then** it is evident the summary is older than the thread.

---

### User Story 2 — An Agent Sends Their Own Reply, Faster (Priority: P1)

An agent has read the ticket and knows roughly what to say. Instead of typing it from nothing, they ask
for a draft, read it, change the parts that are wrong, and send it. What goes to the customer is what the
agent approved — the draft is a starting point, never an outbox.

**Why this priority**: This is the other half of PLAN.md's Definition of done, and the phase's largest
time saving. It is P1 with User Story 1 because a summary that cannot be acted on is half a workflow.

**Independent Test**: On a ticket with an unanswered customer message, request a draft reply, confirm it
lands in the composer as editable text that is not sent, edit it, send it, and confirm the sent message is
the edited text attributed to the agent.

**Acceptance Scenarios**:

1. **Given** a ticket with an unanswered inbound message, **When** an agent requests a draft, **Then**
   editable draft text appears in the reply composer and nothing is sent.
2. **Given** a draft has been generated, **When** the agent navigates away without sending, **Then** no
   message exists on the ticket and the customer has received nothing.
3. **Given** a draft the agent has edited, **When** they send it, **Then** the message recorded and
   delivered is the edited text, attributed to the agent, indistinguishable in authority from one they
   typed themselves.
4. **Given** a draft references knowledge base content, **When** the agent reads it, **Then** the articles
   it drew on are identified so the agent can verify them before sending.
5. **Given** an agent holds no authority to send customer messages, **When** they view the ticket,
   **Then** they are not offered reply drafting.
6. **Given** a ticket whose correspondence is in Arabic, **When** a draft is requested, **Then** the draft
   is in Arabic.

---

### User Story 3 — A Customer Gets an Answer at Two in the Morning, or a Ticket (Priority: P1)

A customer on the portal (or the chat widget) asks a question. The bot answers it from published help
content if it can. If it cannot — because the question is specific to their account, or the content does
not cover it, or the customer says the answer did not help — it stops, tells them it is passing this to a
person, and creates a ticket carrying the conversation so far, so nobody has to repeat themselves.

**Why this priority**: This is the explicit second half of PLAN.md's Definition of done ("the chatbot
successfully escalates to a ticket when it's stuck"), and it is the only part of the phase a customer ever
sees. It is also the highest-risk surface here, which is an argument for specifying it precisely, not for
deferring it.

**Independent Test**: Ask the bot a question answered by a published article and confirm a grounded answer
citing it; then ask something it cannot answer and confirm a ticket is created containing the conversation,
with the customer told a person will follow up.

**Acceptance Scenarios**:

1. **Given** a published article answering the question, **When** a customer asks it, **Then** the bot
   answers from that article and identifies it.
2. **Given** no published content covers the question, **When** a customer asks it, **Then** the bot says
   it cannot answer rather than inventing one, and offers to raise a ticket.
3. **Given** the bot cannot resolve the issue, **When** it escalates, **Then** a ticket exists carrying the
   conversation, attributed to that customer, visible to them wherever their other tickets are.
4. **Given** a customer asks to speak to a person at any point, **When** they do, **Then** the bot escalates
   immediately without further attempts to answer.
5. **Given** a customer asks about their own account, order, or ticket, **When** the bot responds, **Then**
   it does not answer from customer-specific data it has not been authorised to read, and escalates instead.
6. **Given** an escalated conversation, **When** an agent opens the resulting ticket, **Then** it is evident
   which part is bot conversation and which is a person speaking.
7. **Given** the AI capability is unavailable, **When** a customer opens the chat surface, **Then** they can
   still raise a ticket by the Phase 8 route and are not left at a dead end.
8. **Given** a customer writes in Arabic, **When** the bot answers, **Then** it answers in Arabic.

---

### User Story 4 — A New Ticket Arrives Already Sorted (Priority: P2)

A ticket arrives by email with no category. Rather than a human reading it from scratch to triage it, the
system offers the category the content suggests, and the agent accepts it with one action — or ignores it.
The ticket's category is still something a person chose; the reading was done for them.

**Why this priority**: Real value, but strictly an accelerator — Phase 3 already requires a category and
Phase 6 already routes on one, so nothing is broken without it. It is P2 rather than P1 because it is the
surface where a silent wrong answer would travel furthest: category feeds Phase 6's automation conditions
and SLA policy selection. Clarifications Q2 is what stops it travelling at all.

**Independent Test**: Submit tickets whose content clearly belongs to each category and confirm a proposal
appears, is visibly a proposal rather than a value, is recorded, and changes the ticket only when a human
accepts it.

**Acceptance Scenarios**:

1. **Given** an incoming ticket whose content clearly indicates a category, **When** it is created,
   **Then** a proposal for that category is offered and visibly marked as AI-derived.
2. **Given** a pending proposal, **When** nobody acts on it, **Then** the ticket's category is unchanged
   and every downstream behaviour treats it as the category it already had.
3. **Given** a pending proposal, **When** an agent accepts it, **Then** the category changes and the change
   is recorded as that agent's decision.
4. **Given** a pending proposal, **When** an agent dismisses it, **Then** it is not offered again for that
   ticket.
5. **Given** content the system cannot confidently classify, **When** it is processed, **Then** no proposal
   is made rather than a weak one.
6. **Given** a human has already categorised a ticket deliberately, **When** classification runs, **Then**
   no proposal is offered against their decision.

---

### User Story 5 — An Agent Sees How This Was Solved Last Time (Priority: P2)

An agent working a ticket is shown a small number of resolved tickets that look like this one, with what
resolved them. Often the answer to a new problem is a problem someone already solved.

**Why this priority**: Directly valuable and low-risk — it points at real tickets that real people
resolved, so there is nothing generated to be wrong about. P2 because it is an aid rather than a workflow:
the agent can always search.

**Independent Test**: With several resolved tickets on a known theme, open a new ticket on that theme and
confirm the similar ones are offered with their resolutions, and that each respects the viewer's existing
ticket visibility.

**Acceptance Scenarios**:

1. **Given** resolved tickets covering a similar problem, **When** an agent views a new one, **Then** a
   small number of similar tickets are offered with how each was resolved.
2. **Given** a suggested similar ticket, **When** the agent opens it, **Then** they reach the real ticket,
   subject to the visibility rules that already govern it.
3. **Given** an agent who may not view a ticket, **When** similar tickets are computed, **Then** that
   ticket is not offered to them, not even as a title.
4. **Given** nothing similar exists, **When** the panel is shown, **Then** it says so rather than offering
   weak matches.

---

### User Story 6 — Someone Can See What the AI Did, Switch It Off, and Account For It (Priority: P2)

An administrator can see which AI features are on, turn any of them off, see what they have been doing,
and know what they are costing. When something goes wrong — a bad answer to a customer, an unexpected
bill, a question about what was sent to whom — there is a record.

**Why this priority**: P2 rather than P3 because "switch it off" is the only control that works when a
generated answer turns out to be harmful, and because it is the phase's answer to the accountability
question every other principle in the constitution asks. Without it, the chatbot in User Story 3 cannot be
responsibly enabled.

**Independent Test**: Switch each AI feature off independently and confirm the corresponding surface
disappears while the rest of the product is unaffected; review the record of AI activity and confirm each
invocation is attributable.

**Acceptance Scenarios**:

1. **Given** an administrator, **When** they switch an AI feature off, **Then** that surface stops being
   offered and everything else continues to work.
2. **Given** AI features have been used, **When** an administrator reviews the record, **Then** they can
   see what ran, when, on which ticket, and at whose request.
3. **Given** the chatbot has answered customers, **When** an administrator reviews those conversations,
   **Then** they can read what was said in the organisation's name.
4. **Given** a configured spending or volume ceiling is reached, **When** further AI work is requested,
   **Then** it is refused in a way that degrades the AI surfaces and leaves core ticket work untouched.
5. **Given** a user without administrative authority, **When** they attempt to change AI configuration,
   **Then** they are refused server-side.

---

### Edge Cases

- **A ticket thread longer than the AI can consider at once.** Summarisation must produce something useful
  for the longest threads in the system, not fail on them.
- **A thread mixing Arabic and English**, which is normal here — a customer writing Arabic and an agent
  replying in English. Which language the output uses must be a stated rule, not an accident.
- **A customer pastes credentials, a full card number, or a national ID into a chat message.** This is the
  case where "send the thread for processing" becomes a disclosure incident.
- **A customer tries to talk the bot into behaving differently** — into revealing its instructions, making
  commitments about refunds or delivery dates, or speaking about another customer.
- **The AI service is slow rather than down.** A ten-second wait on ticket open is a broken ticket view; a
  summary that never arrives must not hold up the page.
- **The AI service returns something unusable** — empty, truncated, in the wrong language, or not in the
  requested shape.
- **A generated answer is fluent and wrong**, and an agent sends it without reading it properly.
- **The same summary requested twice returns different text**, and two agents disagree about what the
  system said.
- **A customer asks the bot the same question repeatedly** — deliberately or through a scripted client —
  turning an unmetered surface into a bill.
- **The bot is asked about a ticket belonging to someone else at the same company**, which Phase 8
  established is not theirs to see.
- **An automation rule sets a category while a proposal is pending** — the proposal is now stale advice
  about a ticket that has moved.
- **A proposal is accepted long after it was made**, on a ticket whose content has since changed.
- **The chatbot's controlled-infrastructure processing is unavailable** while the external provider serving
  staff features is healthy. FR-008b forbids the obvious fallback.
- **A similar-ticket suggestion surfaces a ticket the viewer may not open**, leaking its existence through
  a title.
- **A chatbot conversation is escalated twice**, or the customer keeps talking after escalation.
- **The AI feature is switched off while a chat conversation is in progress.**
- **A summary is requested on a ticket the requester may not view.**
- **Content in a thread that a customer later asked to have removed** is still present in AI output.

## Requirements _(mandatory)_

### Functional Requirements

#### The AI capability boundary

- **FR-001**: The system MUST treat AI assistance as an **optional capability**. With it disabled or
  unavailable, every Phase 0–8 behaviour MUST continue to work unchanged, and no ticket, message,
  customer, or portal operation may fail because an AI surface could not be served.
- **FR-002**: Each AI feature in this phase — summarisation, reply drafting, categorisation,
  similar-ticket suggestion, and the chatbot — MUST be independently switchable by a permitted
  administrator, and switching one off MUST NOT disable the others.
- **FR-003**: Every AI surface MUST fail **quietly in the product and loudly in the record**: a failure
  MUST leave the surrounding screen working, MUST NOT present an empty or partial result as a successful
  one, and MUST be recorded where an administrator can see it.
- **FR-004**: No AI surface may block a user-facing operation. Producing AI output MUST NOT delay opening
  a ticket, sending a message, creating a ticket, or loading the portal beyond the response times those
  operations already meet.
- **FR-005**: The system MUST bound what it spends: it MUST enforce configurable ceilings on AI usage,
  MUST refuse further AI work when a ceiling is reached rather than continuing to spend, and MUST make the
  refusal visible to an administrator.
- **FR-005a**: AI invocation MUST be rate-limited per requesting principal, with the customer-facing
  chatbot limited independently of staff-facing features, so that exhausting one cannot deny the other.
- **FR-006**: The system MUST NOT retry a failed AI invocation indefinitely; retries MUST be bounded and
  MUST count against the same ceilings as first attempts.

#### Data leaving the system

- **FR-007**: The system MUST state, in configuration an administrator can inspect, **where ticket and
  customer content is sent** for AI processing and what the recipient is permitted to do with it.
- **FR-008**: Staff-facing features — summarisation, reply drafting, and similar-ticket suggestion — MAY
  transmit the ticket content they need to an external AI provider (Clarifications Q1). The
  customer-facing chatbot MUST NOT: its processing MUST occur only on infrastructure the organisation
  controls, and no content a customer types into it may leave that boundary.
- **FR-008a**: Which processing location a feature uses MUST be **structural rather than configuration**:
  it MUST NOT be possible to point the chatbot at an external provider by editing a setting, and any
  attempt to do so MUST fail closed rather than silently succeed.
- **FR-008b**: The system MUST refuse to operate the chatbot at all if controlled-infrastructure
  processing is unavailable, rather than falling back to an external provider (FR-042 then applies: the
  customer keeps the Phase 8 route to a ticket).
- **FR-009**: Under either processing location, the system MUST send **only the content the feature
  needs** — the thread being summarised, the question being asked — and MUST NOT send unrelated customer
  records, other tickets, or the wider database.
- **FR-010**: The system MUST NOT transmit stored credentials, password hashes, session tokens, or API
  secrets to any AI processing, under any feature.
- **FR-011**: The system MUST record every transmission of customer content for AI processing in the audit
  log, sufficient to answer "which feature ran, against which ticket or conversation, when, at whose
  request, and to which processing location". Per Clarifications Q3 the record identifies the content by
  reference and MUST NOT contain a copy of it.
- **FR-012**: Content the customer supplied MUST NOT be used to train or improve any model outside this
  system's control unless that is explicitly configured and recorded.
- **FR-013**: File attachments MUST NOT be transmitted for AI processing in this phase; AI features
  operate on message text and ticket fields only.

#### Provenance and honesty

- **FR-014**: Every AI-generated artefact — summary, draft, proposed category, chatbot message — MUST be
  visibly identifiable as AI-generated wherever it is displayed, to staff and to customers alike.
- **FR-015**: The system MUST NOT present AI output as the statement of a named person. A summary is the
  system's, not the assignee's; a draft becomes the agent's only when they send it.
- **FR-016**: Where AI output is grounded in knowledge base content, the system MUST identify the articles
  it drew on, and those MUST be articles the reader is entitled to see.
- **FR-017**: AI output that cannot be grounded MUST be presented as unverified, and the chatbot MUST
  decline rather than answer (FR-034).
- **FR-018**: The system MUST record when an AI artefact was produced, so a reader can tell a summary is
  older than the thread it describes.

#### Thread summarisation

- **FR-019**: An agent viewing a ticket they may view MUST be able to obtain a summary of its
  correspondence covering the customer's request, what has been done, and what remains outstanding.
- **FR-020**: Summarisation MUST respect ticket visibility: a user who may not view a ticket MUST NOT be
  able to obtain a summary of it, and the refusal MUST match the refusal for viewing it.
- **FR-021**: A summary MUST cover the full correspondence thread regardless of its length, and MUST NOT
  silently omit part of a long thread without saying so.
- **FR-022**: A summary MUST NOT replace or hide the underlying thread.
- **FR-023**: The system MUST state whether internal notes are included in a summary, and MUST enforce that
  rule — a summary that includes internal notes MUST NOT be visible on any customer-facing surface.
- **FR-024**: A summary MUST be produced in the language the correspondence is predominantly in, and the
  reader MUST be able to obtain it in the other supported language.

#### Suggested reply drafting

- **FR-025**: An agent who may send customer messages on a ticket MUST be able to request a draft reply,
  which MUST appear as editable text in the reply composer.
- **FR-026**: A draft MUST NOT be sent, queued, or recorded as a message by the act of generating it. It
  becomes a message only when the agent sends it.
- **FR-027**: A sent message that began as a draft MUST be attributed to the sending agent and MUST be
  indistinguishable in authority and delivery from one they typed.
- **FR-028**: Reply drafting MUST be offered only to users holding the authority to send customer messages,
  enforced server-side.
- **FR-029**: A draft MUST be grounded in the ticket's own correspondence and, where relevant, published
  knowledge base content, and MUST identify the articles used.
- **FR-030**: A draft MUST be produced in the language of the customer's correspondence.
- **FR-031**: A draft MUST NOT commit the organisation to anything it cannot verify — refunds,
  compensation, delivery dates, or contractual terms — and the system MUST state this boundary.
- **FR-032**: The system MUST record that a draft was generated and whether it was sent, edited, or
  discarded, so the feature's usefulness can be judged.

#### The chatbot

- **FR-033**: The system MUST offer a conversational assistant on the customer portal and the chat channel,
  which MUST answer only from **published, customer-visible** knowledge base content.
- **FR-034**: The chatbot MUST decline to answer when published content does not cover the question, MUST
  say so plainly, and MUST NOT compose an answer from anything else.
- **FR-035**: The chatbot MUST NOT read, reference, or reveal any customer's ticket, account, or record
  data. Questions requiring it MUST be escalated (FR-036).
- **FR-036**: The chatbot MUST create a ticket when it cannot resolve the issue, when the customer asks for
  a person, or when the customer indicates the answer did not help.
- **FR-036a**: A ticket created by escalation MUST carry the conversation that preceded it, MUST be
  attributed to the customer who was speaking, and MUST appear to them alongside their other requests.
- **FR-036b**: An escalated conversation MUST make clear on the resulting ticket which content is the bot's
  and which is a person's.
- **FR-036c**: Escalation MUST be idempotent: continuing to talk after escalating MUST NOT create a second
  ticket for the same conversation.
- **FR-037**: The chatbot MUST NOT change any ticket's status, priority, category, or assignment, and MUST
  NOT take any action on a record beyond creating the escalation ticket.
- **FR-038**: The chatbot MUST NOT make commitments on the organisation's behalf (FR-031 applies
  identically), and MUST NOT disclose its own instructions or configuration.
- **FR-039**: The chatbot MUST be resistant to instruction-injection through customer input: content a
  customer supplies MUST be treated as a question to answer, never as instructions to follow.
- **FR-040**: The chatbot MUST be rate-limited per customer, and MUST remain unable to exhaust the AI
  allowance used by staff-facing features (FR-005a).
- **FR-041**: Where a customer is signed in to the portal, the conversation MUST be attributable to their
  portal identity under the Phase 8 rules; the assistant MUST NOT be a route to acting as anyone else.
- **FR-042**: With the chatbot disabled or unavailable, a customer MUST still be able to raise a ticket by
  the routes Phase 8 provides.
- **FR-043**: Chatbot conversations MUST be retrievable by a permitted administrator, because they are
  statements made in the organisation's name.

#### Automatic categorisation

- **FR-044**: The system MUST derive a suggested category for an incoming ticket from its content, using
  the existing Phase 3 category set and introducing no new categories.
- **FR-045**: A derived category MUST be **proposed, never applied** (Clarifications Q2). The system MUST
  NOT write a ticket's category as a result of classification; the ticket keeps the category it already
  has until a human decides otherwise.
- **FR-045a**: Accepting a proposal MUST be an explicit human act, MUST be recorded as that person's
  decision, and MUST be indistinguishable in authority from a category they chose unaided.
- **FR-045b**: Because no category is ever machine-written, Phase 6 automation conditions and SLA policy
  selection MUST never evaluate against a value no person chose. This is a property of the phase, and
  MUST be verifiable rather than merely intended (SC-012).
- **FR-046**: A pending proposal MUST be visibly distinguishable from the ticket's actual category
  wherever it is displayed, and MUST NOT be presented in a way that suggests the ticket has already been
  categorised.
- **FR-047**: A human MUST be able to dismiss a proposal as well as accept it, and a dismissed proposal
  MUST NOT be re-proposed for the same ticket.
- **FR-048**: Where the content does not support a confident classification, the system MUST make **no
  proposal** rather than proposing a low-confidence guess. An absent proposal is a valid outcome.
- **FR-049**: A proposal MUST NOT be offered on a ticket a human has already categorised deliberately,
  and MUST never be presented as a correction to a person's decision.
- **FR-050**: The system MUST record every proposal, whether it was accepted, dismissed, or ignored, and
  which category the ticket ended up with, so accuracy can be measured (SC-010, SC-011).

#### Similar-ticket suggestions

- **FR-051**: An agent viewing a ticket MUST be offered a small number of resolved tickets addressing a
  similar problem, together with how each was resolved.
- **FR-052**: Similar-ticket suggestions MUST respect the viewer's existing ticket visibility: a ticket the
  viewer may not open MUST NOT be offered, referenced, or named.
- **FR-053**: Suggestions MUST be computed at the time of viewing and MUST NOT be stored as a property of
  the ticket, so that a suggestion cannot outlive the ticket it points at.
- **FR-054**: Where nothing sufficiently similar exists, the system MUST say so rather than offer weak
  matches.
- **FR-055**: Following a suggestion MUST lead to the real ticket, subject to the access rules already
  governing it.

#### Bilingual behaviour

- **FR-056**: Every AI surface MUST work in Arabic and English, in both RTL and LTR layouts, under
  Constitution Principle I.
- **FR-057**: AI-generated content MUST be produced in the language of the material it derives from, and
  MUST NOT silently translate a customer's words into the reader's interface language.
- **FR-058**: All interface text introduced by this phase — labels, disclosures, error and empty states —
  MUST be externalised into the existing locale files, with no hardcoded strings.
- **FR-059**: The AI-generated disclosure required by FR-014 MUST be translated, not shown in English on an
  Arabic surface.

#### Authority, audit, and administration

- **FR-060**: Configuring AI features MUST require an administrative permission distinct from the
  permissions governing tickets, knowledge base content, and channels, enforced server-side.
- **FR-061**: Using an AI feature MUST require the authority to perform the underlying action: drafting a
  reply requires the authority to send one, summarising requires the authority to view the ticket.
- **FR-062**: The system MUST record AI configuration changes, feature enablement and disablement, and
  ceiling changes in the audit log, attributable to the administrator who made them.
- **FR-063**: The system MUST make AI activity observable to an administrator: what ran, on what, when, at
  whose request, whether it succeeded, and what it consumed.
- **FR-064**: The system MUST NOT expose AI configuration secrets through any endpoint or interface.
- **FR-065**: The system MUST retain **metadata only** for AI invocations (Clarifications Q3): which
  feature, which ticket or conversation, who requested it, when, success or failure, and what it
  consumed. It MUST NOT store the content submitted for processing or the generated text returned.
- **FR-065a**: This does not override FR-043. A chatbot conversation is retained because it is what the
  organisation said to a customer — the same reason Phase 5 retains outbound messages — and is governed
  by FR-043 rather than by this section. The distinction MUST be explicit wherever both are recorded, so
  that a later reader does not mistake one for the other.
- **FR-065b**: Because inputs and outputs are not retained, a summary MUST be produced on demand and MUST
  NOT be stored as a property of the ticket. Where any short-lived caching exists, it MUST carry the time
  it was produced (FR-018) and MUST NOT outlive the thread it describes.
- **FR-065c**: A generated artefact a user has not yet acted on — an unsent draft, an undismissed
  proposal — MUST NOT survive beyond the working session that produced it.

### PLAN.md Traceability

PLAN.md **Scope** bullets for Phase 9 map as follows:

| PLAN.md scope bullet                    | Requirements                 | Verified by                 |
| --------------------------------------- | ---------------------------- | --------------------------- |
| Ticket thread summarization             | FR-019–FR-024                | User Story 1, SC-001–SC-003 |
| Suggested-reply drafting for agents     | FR-025–FR-032                | User Story 2, SC-004–SC-007 |
| Automatic ticket categorization/tagging | FR-044–FR-050 (incl. FR-045a–b) | User Story 4, SC-010–SC-012 |
| Similar-ticket solution suggestions     | FR-051–FR-055                | User Story 5, SC-013–SC-014 |
| AI chatbot on portal/chat, handing off  | FR-033–FR-043                | User Story 3, SC-015–SC-020 |
| _(enabling, not a scope bullet)_        | FR-001–FR-018 (incl. FR-008a–b), FR-056–FR-065c | User Story 6, SC-021–SC-028 |

PLAN.md **Definition of done** — _"An agent sees a usable AI-drafted summary/reply on a real ticket, and
the chatbot successfully escalates to a ticket when it's stuck"_ — maps as follows:

| Definition of done clause                   | Verified by                                  |
| ------------------------------------------- | -------------------------------------------- |
| "An agent sees a usable AI-drafted summary" | FR-019–FR-024, User Story 1, SC-001, SC-002  |
| "…/reply on a real ticket"                  | FR-025–FR-032, User Story 2, SC-004, SC-005  |
| "the chatbot successfully escalates"        | FR-036–FR-036c, User Story 3, SC-017, SC-018 |
| "…to a ticket when it's stuck"              | FR-034, FR-036, User Story 3, SC-016, SC-017 |

**Carried forward from earlier phases.** The constitution's Open Items list names _"AI provider selection
(needed before Phase 9)"_ — that decision is now due and is raised as FR-008. Phase 5 built per-scope rate
limiting that FR-005a extends to a new kind of cost. Phase 7 established that a suggestion is computed on
read and never stored (its research D5), and FR-053 applies the same rule to similar tickets for the same
reason. Phase 7 also reserved proactive article suggestion as an automation action; this phase adds a
different capability and must not duplicate it. Phase 8 established the portal identity realm that FR-041
binds the chatbot to, and left the chat widget's conversation token as an open thread this phase's
assistant sits on top of.

**Carried into later phases.** Phase 10's reporting will want AI accuracy and deflection rates, which
FR-050 and FR-063 make measurable; the records this phase keeps are the data that phase will read — and
Clarifications Q3 bounds them to metadata, so Phase 10 will be reporting on counts and outcomes, never on
content. Clarifications Q2 leaves unattended triage as a deliberate later addition rather than an
oversight: the classifier exists and is measured, so a future phase can revisit applying it once SC-010
has real numbers behind it.

**A constitution amendment is required before implementation.** The Technology Standards table fixes the
stack and names no AI provider, and its own Governance section requires an explicit amendment rather than
a unilateral introduction within a phase. Clarifications Q1 needs two entries — an external provider for
staff-facing features and a controlled-infrastructure processor for the chatbot — and the amendment should
also close the "AI provider selection" Open Item, which this spec now answers. This is a `/speckit-plan`
gate, not a spec deliverable.

### Key Entities

- **AI Invocation Record**: One occurrence of the system asking for AI output — which feature, which ticket
  or conversation, who requested it, when, which processing location served it, whether it succeeded, and
  what it consumed. The basis of both the audit answer and the cost answer. Metadata only: it points at
  the content, and never holds a copy of it (FR-065).
- **Ticket Summary**: A generated account of a ticket's correspondence at a point in time. Explicitly
  dated, explicitly AI-attributed, never a substitute for the thread, and never a customer-facing artefact.
- **Reply Draft**: Proposed text offered to an agent in a composer. It has no delivery state, no recipient,
  and no existence on the ticket until the agent sends it — at which point it stops being a draft and
  becomes an ordinary Phase 5 message authored by that agent.
- **Category Proposal**: An offered classification, pending until a person accepts or dismisses it. It is
  never the ticket's category — it sits beside the field rather than in it — and it carries what became of
  it, so the classifier's accuracy is measurable without it ever having decided anything.
- **Assistant Conversation**: An exchange between a customer and the chatbot, belonging to a portal identity
  or an anonymous chat visitor, retrievable by an administrator because it is speech in the organisation's
  name, and convertible exactly once into a ticket.
- **AI Feature Configuration**: Which features are on, what ceilings apply, and where processing happens.
  Administrator-owned, audited on change, and never exposing its secrets.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An agent handed an unfamiliar ticket with 20 or more messages can state the customer's
  request and the current outstanding item within 60 seconds of opening it, without reading the thread.
- **SC-002**: For 90% of tickets with 10 or more messages, an agent rates the summary as accurate enough to
  act on without reading the full thread.
- **SC-003**: A summary is available within 10 seconds of being requested, or the request reports failure —
  no request leaves the reader waiting indefinitely.
- **SC-004**: Agents complete a reply to a customer at least 30% faster using a draft than typing from
  nothing, measured on comparable tickets.
- **SC-005**: 100% of messages sent to customers are the text a human approved; no message reaches a
  customer without a person sending it, verified by the absence of any path that sends generated text
  directly.
- **SC-006**: At least 50% of generated drafts are sent, with or without editing — a lower rate means the
  drafts are not worth reading.
- **SC-007**: Every generated draft that cites knowledge base content names articles that exist, are
  published, and are visible to the agent, with zero fabricated references.
- **SC-010**: At least 80% of category proposals are accepted by the human who reviews them — a lower rate
  means the proposal is costing more attention than it saves.
- **SC-011**: Every proposal is measurable after the fact: for any period, an administrator can report how
  many were made, accepted, dismissed, and ignored.
- **SC-012**: Zero tickets have their category changed by anything other than a human action, verified by a
  test asserting that no classification path writes the field.
- **SC-013**: On tickets whose theme has been resolved before, relevant prior tickets are offered in at
  least 70% of cases.
- **SC-014**: Zero similar-ticket suggestions reveal a ticket the viewer may not open, verified by a test
  that enumerates the surface against a viewer lacking visibility.
- **SC-015**: At least 30% of customer questions asked of the chatbot are resolved without a ticket being
  created.
- **SC-016**: Zero chatbot answers cite knowledge base content that is unpublished, internal, or
  nonexistent.
- **SC-017**: 100% of conversations the chatbot cannot resolve end in a ticket carrying the conversation —
  no customer reaches a dead end.
- **SC-018**: A customer asking for a person reaches an escalation within one exchange, 100% of the time.
- **SC-019**: Zero chatbot responses disclose any customer's ticket, account, or record data, verified
  against an adversarial set of prompts including direct requests and injection attempts.
- **SC-020**: Zero chatbot responses commit the organisation to a refund, a date, or a contractual term,
  verified against the same adversarial set.
- **SC-021**: Disabling any AI feature removes its surface within one page load and leaves every other
  feature working, verified per feature.
- **SC-022**: With AI processing entirely unavailable, the complete Phase 0–8 test suite passes unchanged.
- **SC-023**: No AI operation delays a ticket view, a message send, or a portal page beyond the response
  time it met at the end of Phase 8.
- **SC-024**: 100% of transmissions of customer content for AI processing are recorded and attributable.
- **SC-024a**: Zero content typed by a customer into the chatbot leaves controlled infrastructure, verified
  by a test that fails if the chatbot path can reach an external processor.
- **SC-024b**: Zero stored AI invocation records contain submitted content or generated text, verified by
  inspection of what the record holds.
- **SC-025**: Zero credentials, tokens, or secrets appear in anything transmitted for AI processing,
  verified by inspection of what each feature sends.
- **SC-026**: Every AI-generated artefact displayed anywhere carries an AI disclosure, in the reader's
  language, verified across both locales.
- **SC-027**: Reaching a configured ceiling degrades only AI surfaces; core ticket, message, and portal
  operations continue at 100% availability.
- **SC-028**: Every AI surface renders correctly in Arabic RTL and English LTR and passes WCAG 2.1 AA
  checks in both.

## Assumptions

- **AI assistance is an accelerator, not a decision-maker.** No AI output in this phase changes a ticket's
  lifecycle state, assignment, priority, category, or SLA. After Clarifications Q2 this is now absolute:
  every field on every ticket is written by a person, and classification only ever offers.
- **The knowledge base is the only grounding corpus.** Answers are grounded in Phase 7 content, not in past
  ticket correspondence, which contains customer-specific material that has never been reviewed for
  publication. Similar-ticket suggestions point an _agent_ at prior tickets; they never feed a
  customer-facing answer.
- **Existing taxonomy is fixed.** Categorisation uses the four Phase 3 categories (`general`, `technical`,
  `billing`, `complaint`). Despite the PLAN.md bullet's wording ("categorization/tagging"), no free-form
  tagging vocabulary is introduced — there is no tag entity in the system today, and inventing one is a
  data-model change belonging to its own phase.
- **The chat channel remains the Phase 5 simulator-backed channel.** This phase adds an assistant on top of
  it; it does not replace the channel or introduce a third-party chat provider.
- **Quality is judged by humans.** SC-002, SC-006, and SC-010 require human review of a sample; there is no
  automated correctness oracle for generated text, and pretending otherwise would produce tests that pass
  while the feature is useless.
- **Non-determinism is accepted and bounded.** The same input may produce different output. Tests assert
  structural properties — grounding, attribution, refusal, scoping, language — not exact text.
- **English and Arabic only**, matching every prior phase.
- **Attachments are out of reach of AI processing** (FR-013). Extracting text from documents or images is a
  separate capability with its own risks.
- **Cost ceilings are configuration, not billing integration.** The system enforces limits it is told
  about; it does not read an invoice or query a provider's billing API.

## Out of Scope

- **Voice, speech-to-text, and sentiment analysis.** None appear in PLAN.md Phase 9.
- **Free-form tag vocabularies and taxonomy learning.** See Assumptions.
- **Translation of customer correspondence** into the agent's language. FR-057 explicitly forbids silent
  translation; offering it deliberately is a separate feature.
- **AI-authored knowledge base articles.** Phase 7 made publication the sole quality gate for content
  written by an accountable human; generating articles would route around it.
- **AI-driven assignment or routing decisions.** Phase 6 owns routing, and its strategies are deliberately
  explainable.
- **Model training, fine-tuning, or evaluation infrastructure.**
- **Extracting text from attachments** for any AI purpose (FR-013).
- **A customer-facing AI surface anywhere other than the portal and chat channel** — in particular, no
  automatic AI answering of inbound email.
- **Retention or deletion tooling for customer data generally.** Clarifications Q3 keeps this phase out of
  that problem by storing no content at all; it does not solve it for the content Phases 2, 5 and 8 already
  hold.
- **Unattended triage.** Clarifications Q2 makes every category a human decision. Applying a proposal
  automatically is a later decision to take on evidence, not a gap in this one.
