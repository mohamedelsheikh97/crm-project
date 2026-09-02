# Feature Specification: Integrations

**Feature Branch**: `012-phase-11-integrations`

**Created**: 2026-09-02

**Status**: Draft

**Input**: PLAN.md **Phase 11 — Integrations** (SRS reference FR-11.1–FR-11.4). Specify prompt:
"Expose a documented, versioned REST API covering customer, ticket, and reporting data, add ERP
synchronization for customer/order data, and implement webhook notifications for ticket and customer
lifecycle events."

---

## Context

Every phase so far has been about what happens **inside** this system. This one is about what
happens when something outside it starts depending on the system — and that changes the cost of
being wrong.

Three properties that were cheap to change up to now become expensive here:

1. **A published interface is a promise.** Until now, a shape could be corrected in the same commit
   that broke it. Once an external system reads it, the shape is a contract with somebody who cannot
   be redeployed on our schedule, may not be reachable, and may not know a change happened until
   their integration fails at 3am. Versioning is the mechanism for changing our minds later; without
   it, this phase makes every internal shape permanent by accident.

2. **A push is unlike a pull.** Every prior surface answered a request. A webhook makes an outbound
   request to an address somebody else configured, which introduces a whole class of failure the
   system has never had: an unreachable receiver, a slow one, a receiver that succeeds twice, and an
   address that points somewhere it should not.

3. **A second writer.** ERP synchronisation is the first time anything other than a person or this
   system's own automation writes to a customer record. The dangerous case is not a failed sync — a
   failure is visible. It is a *successful* one that overwrites what an agent typed.

**What this phase must not do:** become a second definition of the system's rules. An API endpoint
that assembles a ticket by querying tables directly would have its own idea of what a merged ticket
is, what an SLA breach is, and what a customer may see — and it would drift from the screens. Phase
10 established the pattern for exactly this problem (`reporting/sources.ts` as a single reviewable
boundary), and this phase inherits it: the API is a new *presentation* of existing services, never a
new implementation of them.

---

## Clarifications

### Session 2026-09-02

**Q1 — What is the ERP, and how does this system talk to it?**

**Decision: one declared adapter contract plus a simulator. The ERP product is not named in this
phase.**

The constitution has carried "ERP system identity and integration protocol (needed before Phase 11)"
as an open item since v1.0.0, and it is now due. It cannot be closed by choosing on the
organisation's behalf: which ERP they run is a fact about them, not a design decision, and guessing
it would produce field mappings and authentication code for a system that may not exist here.

What *can* be settled is the shape of the boundary — and settling that is most of the work. Phase 5
faced the same situation with communication channels: real providers were unavailable, so it defined
a channel contract and shipped simulators behind it, and every channel requirement became testable
immediately. Every one of FR-040 to FR-051 — external identifiers, per-field ownership, the
human-edit protection, resumability, the preview — is a property of the *synchronisation*, not of
any particular ERP. They can all be specified, built and tested against the contract.

The consequence is stated rather than hidden: PLAN.md's Definition of done for the ERP portion is
proven against a simulator, so "an external system can pull data and receive a webhook" is genuinely
met while "customer records stay in step with the ERP" is met *for any ERP implementing the
contract*. Wiring a named product later implements one interface and touches nothing else. That is
the whole reason FR-040 insists the boundary be a single place in the code.

**This does not close the constitution's open item.** It narrows it: the protocol is now "whatever
satisfies the declared contract", and the identity remains outstanding. The open item stays, reworded.

---

**Q2 — How does a machine client authenticate, given the fixed stack names JWT issued at human
login?**

**Decision: a client identifier and secret, issued by an administrator, hashed at rest, rotatable
with an overlap, revocable immediately.**

The Technology Standards table names "JWT (issued at login, verified per request via middleware)". A
machine client never logs in, so the table does not cover this case — and its own rule says a
deviation requires an amendment rather than a decision inside a phase spec. An amendment proposal
accompanies this spec.

The alternative that needs no amendment is the one to avoid. A long-lived service-account JWT reuses
the existing middleware exactly, which is genuinely attractive — until FR-019. A JWT is valid until
it expires by design; revoking one before then requires a revocation list checked on every request,
at which point it is a database lookup per request with extra steps, and the "no amendment needed"
argument has evaporated. Choosing it would mean picking the option that looks compliant over the one
that is correct.

OAuth2 client credentials were the closest contender and remain a compatible future addition: the
token endpoint sits in front of the same stored secret. It is not chosen now because it adds a token
endpoint, expiry handling and a token store to a phase that already introduces an outbound delivery
pipeline and a second writer to customer records, and it buys nothing this phase's requirements ask
for. Mutual TLS is stronger and was rejected on operational cost: certificate issuance, distribution
and renewal become somebody's recurring job, and it is the option integrators most often cannot
accommodate.

Two properties of the chosen mechanism matter more than the mechanism itself, and both are already
requirements: the secret is verifiable but not retrievable (FR-017), and rotation has an overlap so
that rotating is not an outage (FR-018). A credential nobody can rotate without downtime is a
credential nobody rotates.

---

**Q3 — Does a notification carry the record, or only a reference to it?**

**Decision: identifiers and event metadata only. No record content.**

The tempting answer is the full record: the receiver needs no second call, which is faster and works
even if the receiver cannot call back out. Two things rule it out.

First, authority. A notification is delivered to an address a person typed into a form. If that
address is wrong, or is later taken over, a payload carrying customer names and ticket bodies is a
data disclosure, while a payload carrying an identifier is an inconvenience. Sending identifiers
means authority is checked *at read time*, against the credential doing the reading, by the same
services that check it for everyone else — which is exactly FR-010's requirement that this phase not
become a second definition of who may see what. Phase 10 spent considerable effort ensuring
aggregates disclose nothing about individuals; pushing record content to a configured URL would
route around that on the one surface nobody is watching.

Second, truth. Delivery is at-least-once and unordered (FR-031, FR-032). A snapshot in a payload can
therefore arrive after the record has changed again, and a receiver has no way to tell whether the
snapshot it holds is current. An identifier is never stale: reading it yields the record as it is
now. That is the same reasoning Phase 10 applied when it stored figure *keys* in a dashboard
arrangement rather than figures.

Making it configurable per subscription was rejected. It would mean two payload shapes to document,
version and test, and it would turn the riskier option into a checkbox — where the failure is not
that someone chooses it deliberately but that someone chooses it without weighing it.

The cost is real and accepted: every event costs the receiver one read. FR-009's "changed since"
retrieval is what keeps that from being one read per event during a catch-up after an outage.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - An external system reads customer, ticket and reporting data (Priority: P1)

An integrator at another company has been given credentials for this system. Working only from the
published documentation, they authenticate, list the customers their credentials cover, page through
tickets changed since a timestamp they supply, and read a reporting figure. Every response tells them
which version of the interface produced it. When they ask for something their credentials do not
cover, the refusal says so plainly rather than returning an empty list they would read as "no data".

**Why this priority**: It is the first half of the phase's Definition of done, and nothing else in
the phase is reachable without it — a webhook is a notification *that something is available to
read*, and an ERP sync is a specialised reader and writer. Delivered alone, an external system can
already pull data, which is a working integration.

**Independent Test**: Issue a credential, then use only the published documentation to authenticate
and retrieve a customer, a ticket and a reporting figure. Confirm that a request outside the
credential's authority is refused rather than silently narrowed, and that every response names the
interface version.

**Acceptance Scenarios**:

1. **Given** valid credentials covering customer data, **When** the client requests a list of
   customers, **Then** it receives a paged response naming the interface version, with stable
   ordering so paging cannot skip or repeat a record.
2. **Given** valid credentials covering ticket data, **When** the client requests tickets changed
   since a supplied timestamp, **Then** it receives only tickets changed at or after that moment,
   and a cursor to continue from.
3. **Given** credentials covering customer data but **not** reporting data, **When** the client
   requests a reporting figure, **Then** the request is refused with a stated reason — not answered
   with an empty result.
4. **Given** a reporting figure whose sample is below the disclosure floor, **When** it is returned
   over the interface, **Then** it carries the same withheld-rate and counts treatment the screens
   apply, rather than a bare number.
5. **Given** a request for a record that does not exist, **When** the client sends it, **Then** the
   refusal does not reveal whether the identifier exists but is out of the client's reach.
6. **Given** a client exceeding its request allowance, **When** it sends another request, **Then**
   it is refused with a stated retry-after, and the refusal is distinguishable from a permission
   failure.

---

### User Story 2 - An external system is notified when a ticket or customer changes (Priority: P2)

An administrator registers an address for a subscribing system and selects the events it wants:
ticket created, ticket resolved, customer created. When an agent resolves a ticket, the subscribing
system receives a notification within seconds, signed so it can prove the notification came from
this system and was not altered. The notification carries enough to identify what changed and an
identifier the receiver can use to fetch the rest.

**Why this priority**: It is the second half of the Definition of done. It also removes the reason
integrators poll: a system that must ask "has anything changed?" every minute is the main source of
load an API of this kind ever sees.

**Independent Test**: Register a subscription against a test receiver, resolve a ticket through the
normal agent screen, and confirm the receiver gets exactly one notification, that its signature
verifies, and that a tampered copy fails verification.

**Acceptance Scenarios**:

1. **Given** a subscription to ticket-resolved, **When** an agent resolves a ticket, **Then** the
   subscribed address receives a notification within seconds, carrying the event type, when it
   occurred, and an identifier for the ticket.
2. **Given** a received notification, **When** the receiver verifies its signature using the shared
   secret, **Then** verification succeeds; **and When** any byte of the payload is altered, **Then**
   verification fails.
3. **Given** a receiver that is unreachable, **When** an event occurs, **Then** delivery is retried
   on a widening interval, and the originating action — the agent's resolve — is unaffected and did
   not wait for it.
4. **Given** a receiver that recovers after an outage, **When** it comes back, **Then** it receives
   the events it missed rather than losing them.
5. **Given** a receiver that has exhausted every retry, **When** the last attempt fails, **Then** the
   event is retained and visible to an administrator rather than discarded silently.
6. **Given** the same event delivered more than once because a receiver's acknowledgement was lost,
   **When** the receiver inspects it, **Then** it can tell it is the same event by a stable
   identifier the payload carries.
7. **Given** an administrator registering an address that resolves to an internal or private
   network location, **When** they save it, **Then** it is refused with a stated reason.

---

### User Story 3 - An administrator manages the credentials external systems hold (Priority: P3)

An administrator creates a credential for a named external system, chooses exactly what it may
reach, and hands the secret over once. Later they rotate it without interrupting the integration,
see when it was last used and what it has been reaching, and revoke it immediately when the
relationship ends.

**Why this priority**: Story 1 needs *a* credential; this is what makes credentials survivable for
years. Rotation and revocation are the operations that matter after the integration is live, and a
credential that cannot be rotated without downtime is one nobody rotates.

**Independent Test**: Create a credential, confirm the secret is shown once and never again, rotate
it while an integration is using the old secret and confirm no request fails during the overlap, then
revoke it and confirm the next request is refused.

**Acceptance Scenarios**:

1. **Given** a new credential, **When** it is created, **Then** the secret is displayed once, and
   thereafter the system can confirm a presented secret but cannot reveal the stored one.
2. **Given** a live credential, **When** the administrator rotates it, **Then** both the old and new
   secrets are accepted for a stated overlap period, so the integration can be updated without a
   failed request.
3. **Given** a credential in use, **When** it is revoked, **Then** the next request using it is
   refused, and the refusal states that the credential is no longer valid.
4. **Given** a credential, **When** an administrator views it, **Then** they see when it was last
   used and what it may reach — never the secret.
5. **Given** any change to a credential — creation, rotation, scope change, revocation — **When** it
   is made, **Then** it is recorded as an audited event attributable to the administrator who made
   it.
6. **Given** an attempt to grant a credential more authority than the granting administrator holds,
   **When** it is saved, **Then** it is refused.

---

### User Story 4 - Customer records stay in step with the ERP (Priority: P4)

The organisation's ERP already holds customer records. An administrator runs a synchronisation and
sees, before anything is written, exactly what would change: which customers would be created, which
fields would be updated, and which changes would overwrite something a person edited here. They
approve it, the sync runs, and every customer carries the identifier that links it to its ERP
counterpart.

**Why this priority**: It is the first time a second writer touches customer records, so it needs
Stories 1–3's plumbing to exist and be trusted first. It is also the story with the most damaging
quiet failure — a successful sync that silently replaced an agent's correction.

**Independent Test**: With a set of ERP records that includes one new customer, one changed field,
and one field a person edited here more recently, run the preview and confirm all three are
classified correctly; approve, and confirm the human edit was not overwritten without being reported.

**Acceptance Scenarios**:

1. **Given** an ERP record with no counterpart here, **When** a sync runs, **Then** a customer is
   created and linked by a stored external identifier.
2. **Given** an ERP record whose counterpart exists, **When** a field differs, **Then** the field is
   updated according to a stated per-field rule about which system owns it.
3. **Given** a field a person edited here after the ERP's own last change, **When** a sync runs,
   **Then** the human edit is **not** silently overwritten: it is either preserved or replaced with
   the change recorded and visible.
4. **Given** a sync that fails part way, **When** it is retried, **Then** it resumes without
   duplicating what it already applied.
5. **Given** any sync run, **When** it finishes, **Then** an administrator can see what it changed,
   what it skipped, and why — and the record survives long enough to answer a question raised weeks
   later.
6. **Given** a preview, **When** the administrator reads it, **Then** nothing has been written yet.

---

### User Story 5 - An agent sees the customer's order history from the ERP (Priority: P5)

An agent opens a customer and sees the orders that customer has placed, drawn from the ERP, so they
can answer "where is my order?" without leaving the ticket. The screen states where the data came
from and when it was last refreshed. When the ERP is unreachable, the screen says so rather than
showing an empty list that reads as "this customer has never ordered anything".

**Why this priority**: It is the operational payoff of Story 4 and the reason ERP integration is
worth doing at all — but it depends on the sync being trustworthy first, and the system is fully
usable without it.

**Independent Test**: Open a customer with known ERP orders and confirm they appear with a stated
source and refresh time; make the ERP unreachable and confirm the screen distinguishes "cannot
reach" from "no orders".

**Acceptance Scenarios**:

1. **Given** a customer linked to an ERP counterpart with orders, **When** an agent opens the
   customer, **Then** the orders are listed with their date, reference and status.
2. **Given** the ERP is unreachable, **When** an agent opens the customer, **Then** the screen states
   that order data could not be retrieved — visibly distinct from a customer with no orders.
3. **Given** a customer with no ERP counterpart, **When** an agent opens them, **Then** the order
   section states that this customer is not linked to the ERP, rather than appearing broken.
4. **Given** order data on screen, **When** an agent reads it, **Then** it states its source and when
   it was last refreshed.
5. **Given** an agent without authority over the customer, **When** they attempt to view the orders,
   **Then** they are refused on the same basis as the rest of that customer's record.

---

### User Story 6 - An administrator can see and act on failed deliveries and syncs (Priority: P6)

An administrator opens an integrations overview and sees which subscriptions are healthy, which
notifications failed and why, and which sync runs had problems. They can re-send a specific failed
notification after the receiver is fixed, and they can see at a glance whether an integration has
quietly stopped working.

**Why this priority**: Integrations fail silently by nature — nobody notices a webhook that stopped
arriving until a business process has been wrong for a week. This story turns that from an incident
into a screen. It is last because Stories 2 and 4 must exist to have failures worth showing.

**Independent Test**: Cause a delivery to fail every retry, confirm it appears in the overview with
its reason, fix the receiver, re-send it, and confirm it succeeds and is marked so.

**Acceptance Scenarios**:

1. **Given** notifications that exhausted their retries, **When** an administrator opens the
   overview, **Then** each is listed with the event, the address, the failure reason and the time.
2. **Given** a failed notification and a now-working receiver, **When** the administrator re-sends
   it, **Then** it is delivered and recorded as re-sent by that administrator.
3. **Given** a subscription whose recent deliveries have all failed, **When** the overview is read,
   **Then** the subscription is shown as unhealthy rather than requiring the reader to infer it.
4. **Given** a sync run with skipped records, **When** the administrator opens it, **Then** each skip
   states its reason.
5. **Given** the overview, **When** anyone without integration administration authority attempts to
   open it, **Then** they are refused.

---

### Edge Cases

**The published interface**

- A client requests a version that has been withdrawn: refused with a statement of which versions
  are current, never silently served a different version's shape.
- A client omits the version entirely: refused rather than defaulting to the newest, because a
  default means an integration breaks on our release schedule rather than theirs.
- A field is added to a response: not a breaking change, and existing clients must tolerate it. A
  field removed or retyped is breaking and requires a new version.
- A client pages through a list while records are being created: ordering must be stable enough that
  paging does not skip or repeat a record.
- A client asks for changes since a timestamp in the future, or malformed: refused with a stated
  reason.
- A record is deleted or merged between a client's list call and its fetch: the fetch must say what
  happened rather than returning a bare not-found.
- A merged ticket is requested: the response must present the same truth the screens do, not a
  duplicate of the surviving ticket.

**Notifications**

- The receiver returns a redirect: not followed, because a redirect can point anywhere.
- The receiver is slow: the attempt times out rather than holding a connection open indefinitely.
- The receiver returns a permanent refusal (as opposed to a temporary failure): retrying is pointless
  and the subscription should be marked rather than retried for hours.
- A burst of events for the same record: each is delivered; the receiver can order them by the
  occurrence time each payload carries.
- Delivery order differs from occurrence order: possible and documented, because guaranteeing order
  would mean one slow receiver blocks every later event.
- A subscription's secret is rotated mid-flight: notifications signed with either secret verify
  during the overlap.
- An event occurs for a record the subscriber's credentials do not cover: no notification, because a
  notification is itself a disclosure that the record exists.
- The system is restarted with undelivered events pending: they are still delivered.

**ERP synchronisation**

- The ERP is unreachable when a sync starts: the run fails visibly and changes nothing.
- The ERP returns a record with a missing required field: that record is skipped with a stated
  reason, and the rest of the run continues.
- Two ERP records claim the same external identifier: refused rather than picking one.
- An ERP record's counterpart here was deactivated: the sync must not silently reactivate it.
- A customer here has no ERP counterpart: left alone; this system is not required to be a subset of
  the ERP.
- The same sync is started twice concurrently: the second is refused rather than interleaved.
- An ERP field arrives with a value this system's own validation rejects: skipped with a reason, not
  written past validation.

**Authority**

- A credential's scope is narrowed while a request is in flight: the request completes; the next one
  is judged by the new scope.
- A credential covering reporting data attempts to reach agent performance figures: refused, and
  absent rather than present-and-withheld, matching Phase 10's decision.
- A credential is used from an unexpected source: recorded, because the audit trail is what makes a
  leaked credential investigable.

---

## Requirements _(mandatory)_

### The published interface

- **FR-001**: The system MUST expose a documented interface over customer, ticket and reporting data
  for use by external systems, distinct from the interface the system's own screens use.
- **FR-002**: Every request MUST state which version of the interface it expects, and every response
  MUST state which version produced it. A request that states no version MUST be refused rather than
  served the newest.
- **FR-003**: A change that removes a field, retypes a field, or changes the meaning of a value MUST
  require a new version. Adding a field MUST NOT.
- **FR-004**: When a version is superseded, it MUST remain available for a stated minimum period,
  and the system MUST be able to tell an administrator which clients are still using it.
- **FR-005**: The documentation MUST be derived from the implementation rather than maintained beside
  it, so that a documented shape and the served shape cannot disagree.
- **FR-006**: The documentation MUST be sufficient for an integrator with no access to this codebase
  to make a successful first request, including how to authenticate, how to page, how errors are
  shaped, and what each event notification means.
- **FR-007**: Every refusal MUST use one documented shape carrying a machine-readable code, a human
  message, and per-field detail where applicable — and it MUST be the same shape the internal
  interface already uses, not a second convention.
- **FR-008**: Every list MUST be paged with a stable order and a continuation cursor, such that
  paging through a changing collection neither skips nor repeats a record.
- **FR-009**: Ticket and customer collections MUST support retrieval by "changed since" a supplied
  moment, so a subscriber can reconcile after an outage without reading everything.
- **FR-010**: The interface MUST NOT restate business rules. Every response MUST be assembled by
  calling the same services the system's own screens call, so that a merged ticket, an SLA outcome,
  a suppressed figure and a customer's visible state are identical on both surfaces.
- **FR-011**: The interface MUST be rate-limited per credential, and a refusal for exceeding the
  limit MUST be distinguishable from a refusal for lack of authority, and MUST state when to retry.
- **FR-012**: Reporting data exposed through the interface MUST carry the same provenance and
  disclosure the screens carry: the counts behind a rate, the exclusions, the withheld-rate treatment
  below the disclosure floor, the period and timezone, and the statement that figures reflect current
  record state.
- **FR-013**: The interface MUST NOT expose agent performance figures to a credential lacking the
  distinct authority Phase 10 defined for them, and MUST make them absent rather than
  present-and-withheld.

### Credentials and authority for external systems

- **FR-014**: An external system MUST authenticate on every request using a credential issued to it
  by an administrator: a client identifier plus a secret, presented on each request, with the secret
  stored such that it can be verified but not retrieved. It MUST NOT authenticate by any mechanism
  that cannot be revoked with immediate effect (FR-019).
- **FR-015**: A credential MUST carry an explicit statement of what it may reach, expressed in the
  same permission vocabulary the system already uses for people, so there is one vocabulary rather
  than two.
- **FR-016**: A credential MUST NOT be able to reach anything its stated authority does not cover,
  and that MUST be enforced server-side on every request rather than by the documentation describing
  which endpoints a client should call.
- **FR-017**: A credential's secret MUST be displayed once at creation and stored such that the
  system can verify a presented secret but cannot reveal the stored one.
- **FR-018**: A credential MUST be rotatable such that the old and new secrets are both accepted for
  a stated overlap, so an integration can be updated without a failed request.
- **FR-019**: A credential MUST be revocable with immediate effect.
- **FR-020**: An administrator MUST NOT be able to grant a credential more authority than they
  themselves hold.
- **FR-021**: Creation, rotation, scope change, revocation and use of a credential MUST be audited,
  with each request attributable to the credential that made it.
- **FR-022**: An administrator MUST be able to see when a credential was last used, without being
  able to see its secret.
- **FR-023**: The system MUST NOT accept a credential belonging to a deactivated external system, or
  one granted by an administrator whose own authority has since been withdrawn, without a stated
  rule for which of those revokes access.

### Notifications

- **FR-024**: The system MUST notify subscribed external systems when a ticket or customer reaches a
  stated lifecycle point, at minimum: ticket created, ticket resolved, customer created.
- **FR-025**: A subscription MUST name the events it wants; a subscriber MUST NOT receive events it
  did not ask for.
- **FR-026**: Each notification MUST carry the event type, the moment the event occurred, a stable
  identifier for the event itself, and an identifier for the record that changed.
- **FR-027**: Each notification MUST carry a signature the receiver can verify against a shared
  secret, such that an altered payload fails verification.
- **FR-028**: A notification payload MUST carry identifiers and event metadata only — the event
  type, its occurrence time, its stable identifier, and the identifier and type of the record that
  changed. It MUST NOT carry record content: no ticket subject or body, no customer name, no message
  text, no reporting figure. The receiver retrieves what it needs through the interface, under its
  own authority, at the moment it reads.
- **FR-029**: Delivery MUST NOT delay or block the action that caused the event. An agent resolving a
  ticket MUST NOT wait for a receiver.
- **FR-030**: A failed delivery MUST be retried on a widening interval up to a stated limit, and MUST
  survive a restart of the system.
- **FR-031**: Delivery is at-least-once, and the system MUST state so in its documentation, because a
  receiver that assumes exactly-once will double-process. The stable event identifier is what makes
  the receiver's own deduplication possible.
- **FR-032**: Delivery order MUST NOT be guaranteed, and the system MUST state so, because
  guaranteeing it would let one slow receiver hold up every later event. Each payload's occurrence
  time is what lets a receiver order events itself.
- **FR-033**: An event whose deliveries are all exhausted MUST be retained and surfaced to an
  administrator rather than discarded.
- **FR-034**: A subscription address MUST be refused if it resolves to a private, loopback or
  link-local network location, so that a subscription cannot be used to make this system probe its
  own internal network.
- **FR-035**: A redirect returned by a receiver MUST NOT be followed.
- **FR-036**: A delivery attempt MUST time out, and a receiver that returns a permanent refusal MUST
  NOT be retried indefinitely.
- **FR-037**: An event MUST NOT be delivered to a subscriber whose credential does not cover the
  record it concerns, because the notification itself would disclose that the record exists.
- **FR-038**: A subscription's signing secret MUST be rotatable with an overlap, on the same basis as
  a credential.

### ERP synchronisation

- **FR-039**: The system MUST synchronise customer records with an external ERP through a single
  declared adapter contract, and MUST ship a simulator implementing that contract so every
  synchronisation requirement in this section is exercisable without a real ERP present. Naming a
  specific ERP product and implementing its adapter is explicitly deferred; the contract, not the
  product, is what this phase delivers.
- **FR-039a**: The ERP simulator MUST be selectable by configuration and MUST NOT be reachable when
  a real adapter is configured, so that a deployment cannot silently serve simulated order data to an
  agent who believes it is real. Which adapter is active MUST be visible to an administrator.
- **FR-039b**: The adapter contract MUST be declared in one place and MUST be the only thing the
  synchronisation and order-display code depends on, so that adding a named ERP later implements an
  interface rather than editing the features that use it.
- **FR-040**: Every reference to the external system MUST be concentrated behind one boundary in the
  code, so that the ERP can be replaced, or a second one added, without the change reaching the rest
  of the system.
- **FR-041**: A synchronised customer MUST store the identifier that links it to its ERP counterpart,
  and that link MUST be unique in both directions.
- **FR-042**: For every field a sync can write, the system MUST state which side owns it, and MUST
  apply that rule rather than a general last-writer-wins.
- **FR-043**: A sync MUST NOT silently overwrite a value a person edited in this system. Where the
  stated ownership rule requires the ERP's value to win, the replacement MUST be recorded and visible
  to an administrator.
- **FR-044**: An administrator MUST be able to preview a sync — what would be created, updated and
  skipped — before anything is written.
- **FR-045**: A sync MUST be resumable: a run that fails part way MUST be retryable without
  reapplying what it already applied.
- **FR-046**: A record the sync cannot apply MUST be skipped with a stated reason, and MUST NOT stop
  the rest of the run.
- **FR-047**: A sync MUST NOT bypass this system's own validation. A value the system would reject
  from a person MUST be rejected from the ERP too, with the rejection reported.
- **FR-048**: Two concurrent runs of the same sync MUST NOT interleave; the second MUST be refused.
- **FR-049**: Every sync run MUST be recorded with what it changed, what it skipped and why, retained
  long enough to answer a question raised well after the run.
- **FR-050**: A sync MUST NOT reactivate a customer that was deactivated in this system without that
  being a stated, visible decision.
- **FR-051**: A customer with no ERP counterpart MUST be left alone. This system is not required to
  be a subset of the ERP.

### ERP order data

- **FR-052**: An agent MUST be able to see a customer's orders from the ERP while working on that
  customer, without leaving the system.
- **FR-053**: Order data on screen MUST state its source and when it was last refreshed.
- **FR-054**: When order data cannot be retrieved, the screen MUST say so in a way that is visibly
  distinct from a customer having no orders.
- **FR-055**: A customer not linked to the ERP MUST show a stated absence of a link rather than an
  empty list or an error.
- **FR-056**: Order data MUST be subject to the same authority as the rest of the customer's record;
  it MUST NOT be reachable by anyone who could not already see the customer.
- **FR-057**: Retrieving order data MUST NOT make the customer screen unusable when the ERP is slow.

### Observability and administration

- **FR-058**: An administrator MUST be able to see, for each subscription, whether it is healthy,
  and MUST NOT have to infer that from a list of individual failures.
- **FR-059**: An administrator MUST be able to re-send a specific failed notification, and the
  re-send MUST be recorded as attributable to them.
- **FR-060**: Every failed delivery MUST state its reason in terms an administrator can act on.
- **FR-061**: The integrations administration surface MUST require a distinct authority; holding it
  MUST NOT be implied by general administration of users or settings.
- **FR-062**: Creating, changing or removing a subscription MUST be audited.

### Cross-cutting

- **FR-063**: Every administration screen this phase adds MUST render correctly in Arabic (RTL) and
  English (LTR), with all text externalised into both locale files.
- **FR-064**: Every administration screen this phase adds MUST meet WCAG 2.1 AA in both languages,
  including any status indicator, which MUST NOT convey health by colour alone.
- **FR-065**: This phase MUST NOT expose through the interface anything the system does not already
  record. It adds a new way to read existing data, not new data collection.
- **FR-066**: Secrets — credential secrets, signing secrets, ERP connection details — MUST NOT appear
  in a log, an audit record, an error message, or a stored request trace.
- **FR-067**: The system MUST continue to work with every integration capability switched off, and
  the phases before this one MUST behave exactly as they did without it.

### Key Entities

- **API Client**: A named external system permitted to reach the interface. Holds a display name, an
  explicit statement of what it may reach, one or more secrets with rotation state, an active/revoked
  state, and a last-used moment. Never holds a retrievable secret.
- **Interface Version**: A published shape of the interface, with a state (current, superseded,
  withdrawn) and the date its support ends.
- **Webhook Subscription**: An address, the events it wants, a signing secret with rotation state, and
  a health state derived from recent deliveries. Belongs to an API Client, so a subscription cannot
  outlive the credential's authority.
- **Event**: Something that happened to a ticket or a customer, with a stable identifier, a type, the
  moment it occurred, and a reference to the record. Retained independently of any delivery, so a
  delivery can be retried or re-sent without the event being reconstructed.
- **Delivery Attempt**: One attempt to hand an Event to a Subscription, with its outcome, the reason
  on failure, and its position in the retry sequence.
- **ERP Link**: The correspondence between a customer here and its counterpart in the ERP, unique on
  both sides, plus when it was last reconciled.
- **Sync Run**: One synchronisation, with its outcome, counts of created, updated and skipped
  records, the reason for each skip, and enough state to be resumed.
- **Order**: A purchase recorded in the ERP and shown against a customer here — read, not owned. Holds
  a reference, a date, a status and a total, plus the moment it was retrieved.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An integrator who has never seen this system can make their first successful data
  request within 30 minutes using only the published documentation and a credential.
- **SC-002**: 100% of responses state the interface version that produced them, and no request
  lacking a version is served.
- **SC-003**: A field added to a response breaks no existing client; a field removed or retyped is
  impossible without a new version. Verified by exercising a prior version's expectations against
  the current implementation.
- **SC-004**: An external system can reconcile a full day of changes it missed, using
  "changed since", without reading the entire collection.
- **SC-005**: Paging through 10,000 records while records are being created and modified neither
  skips nor repeats a record.
- **SC-006**: Zero endpoints return a record outside the requesting credential's stated authority,
  verified by exercising every endpoint against a credential that lacks each authority in turn.
- **SC-007**: Every reporting figure returned over the interface carries the same counts, exclusions
  and withheld-rate treatment as the same figure on screen — verified by comparing them directly.
- **SC-008**: A credential's secret cannot be retrieved after creation by any means available through
  the system, including its administration screens, its own interface, and any export.
- **SC-009**: Rotating a credential causes zero failed requests for an integration that updates its
  secret at any point during the stated overlap.
- **SC-010**: Revoking a credential refuses the next request made with it.
- **SC-011**: 99% of notifications reach a healthy receiver within 30 seconds of the event.
- **SC-012**: An agent's action completes in the same time whether or not any subscription exists,
  and whether or not its receiver is reachable.
- **SC-013**: A receiver unreachable for one hour receives every event it missed once it recovers,
  and none is lost.
- **SC-014**: Every notification's signature verifies with the shared secret and fails on any
  single-byte alteration of the payload.
- **SC-015**: No subscription can be registered to a private, loopback or link-local address.
- **SC-016**: An event delivered more than once is identifiable as the same event by a receiver
  using only the payload.
- **SC-017**: A sync preview reports the same set of creations, updates and skips that the
  subsequent run applies.
- **SC-018**: Zero human-entered values are overwritten by a sync without the overwrite being
  recorded and visible.
- **SC-019**: A sync interrupted at any point can be retried to completion without creating a
  duplicate customer or reapplying an update.
- **SC-020**: A sync of 10,000 ERP customer records completes without manual intervention, and its
  record answers "what changed?" without reading the ERP.
- **SC-021**: An agent opening a customer sees order data, or a clear statement of why not, within
  the time the customer screen already takes — and an unreachable ERP does not prevent the rest of
  the screen from working.
- **SC-022**: An administrator can identify a subscription that has stopped working without reading
  individual delivery records.
- **SC-023**: 100% of credential, subscription and sync administration actions appear in the audit
  log attributable to the administrator who made them.
- **SC-024**: No secret appears in any log, audit record, error message or stored trace, verified by
  searching for known test secrets across all of them.
- **SC-025**: Every administration screen this phase adds passes WCAG 2.1 AA checks and renders
  correctly in Arabic and English.
- **SC-026**: With every integration capability switched off, the complete test suite for Phases 0–10
  passes unchanged.

---

## Assumptions

- **The interface is additive.** The system's own screens keep using their existing internal
  interface; this phase does not migrate them onto the published one. Doing so would put the screens
  behind a version contract, which buys nothing and constrains every future change to them.
- **Machine clients act as themselves, not on behalf of a person.** A credential carries its own
  authority rather than impersonating a user, because attributing an ERP sync to whichever
  administrator happened to configure it would make the audit trail misleading.
- **The permission vocabulary is reused.** A credential's authority is expressed in the existing
  permission keys rather than a parallel scope system, so there is one place to reason about who can
  reach what.
- **Read-mostly.** The published interface exposes data for reading. Creating and modifying records
  through it is out of scope for this phase; the ERP sync is the only external writer, and it is
  deliberately narrow. Widening this later is a version addition rather than a redesign.
- **Orders are read, never owned.** The ERP is the system of record for orders. This system displays
  them and does not accept edits to them.
- **The ERP is reachable from this system.** Where it is not — an air-gapped ERP, or one that can
  only push — a file-based exchange would be a different design, and it is not assumed here.
- **Notification receivers are HTTPS endpoints under the subscriber's control.** Delivery to a
  message queue or a cloud event bus is out of scope for this phase.
- **A receiver can call back.** Identifier-only payloads (Clarifications Q3) assume the receiver can
  make an outbound request to this system. A receiver that can only be pushed to would need record
  content in the payload, and that is a different decision made on different grounds — not a
  configuration flag.
- **The ERP simulator is a development and verification tool, not a product feature.** It exists so
  the synchronisation requirements are exercisable; it is not a fallback for a real ERP being
  unreachable, and FR-039a keeps the two from being confused.
- **Retention.** Events, delivery attempts and sync runs are retained on the same basis as audit
  records, because they answer the same kind of question after the fact.
- **Existing phases supply the events.** Ticket and customer lifecycle transitions are already
  recorded by Phases 2, 3 and 6; this phase observes them rather than adding new transition points.
- **Reporting data over the interface is the Phase 10 figures, unchanged.** This phase does not add
  new reports, and it inherits Phase 10's access decisions — including that agent performance
  figures sit behind their own authority.

---

## Dependencies

- **Phases 1–10**, per PLAN.md and the constitution's phase ordering. Specifically: Phase 1's RBAC
  and audit log (credential authority and every audited action), Phase 2's customer records (the ERP
  sync target and the order display surface), Phase 3's tickets and their lifecycle (the events),
  Phase 6's SLA state (exposed, never recomputed), and Phase 10's reporting figures and their
  disclosure rules (exposed, never restated).
- **A constitution amendment, pending approval.** The Technology Standards table names JWT issued at
  human login as the authentication mechanism, and its own rule forbids deviating inside a phase
  spec. Clarifications Q2 chose administrator-issued client credentials for machine clients, so an
  amendment is required. It is proposed in
  [constitution-amendment-proposal.md](./constitution-amendment-proposal.md) and **approval is
  outstanding**; under the Governance section it must be given before any implementation task in this
  phase begins.
- **An open constitution item, narrowed but not closed.** "ERP system identity and integration
  protocol (needed before Phase 11)" has been carried since v1.0.0. Clarifications Q1 settles the
  *protocol* — whatever satisfies the declared adapter contract — and leaves the *identity*
  outstanding, because which ERP the organisation runs is a fact about them rather than a design
  decision. The amendment proposal rewords the item accordingly rather than deleting it.

---

## Out of Scope

- Writing tickets or customers through the published interface (read-only this phase; the ERP sync is
  the sole external writer).
- Inbound integration from arbitrary third parties beyond the ERP — no generic import framework.
- A developer portal, self-service credential issuance, or public sign-up. Credentials are issued by
  an administrator.
- Billing, quotas beyond rate limiting, or usage-based metering.
- Real-time streaming (websockets, server-sent events). Notifications are outbound HTTP.
- Bidirectional order synchronisation, or accepting order edits.
- An adapter for a **named** ERP product, and the field mapping that goes with it. Clarifications Q1
  defers this deliberately: the contract is this phase's deliverable, the product's adapter is a
  later, smaller piece of work against it.
- Record content in notification payloads, and any per-subscription option to enable it
  (Clarifications Q3).
- OAuth2 token issuance and mutual TLS for machine clients. Both remain compatible additions on top
  of the stored credential (Clarifications Q2); neither is built now.
- Multi-tenant partitioning of the interface, which belongs to Phase 12.
