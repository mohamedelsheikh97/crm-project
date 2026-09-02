# Phase 0 Research: Integrations

**Feature**: Phase 11 — Integrations | **Date**: 2026-09-02

Every decision below was taken against the code as it actually is, not against a generic
architecture. Where an existing pattern in this repository already solves the problem, it is reused
and named; where it does not, that is said plainly, because "we already do this" is the claim most
worth checking.

The spec left three questions to this phase, all resolved in its Clarifications section (adapter
contract plus simulator, administrator-issued machine credentials, identifier-only payloads). No
`NEEDS CLARIFICATION` markers remain. What follows are the design decisions those answers imply.

---

## D1 — Where the published interface lives, and how a version is stated

**Decision.** A fourth realm, mounted at `/api/v1`, in its own router file `routes/v1/index.ts`,
accepting **only** machine credentials. Staff JWTs are refused there; machine credentials are refused
everywhere else.

**Rationale.** `routes/index.ts` already organises this system by identity realm, and its comments
say so: staff routes, `/portal` for customers, `/public` for anonymous. A published interface is a
fourth realm with a fourth credential type, and putting it anywhere inside the staff tree would mean
one middleware chain having to decide which of two credential types it is looking at on every
request. Separate mounts mean the question never arises.

The version sits in the path because that is what integrators expect to find, and because it makes
FR-002 structural rather than a check somebody has to remember: a request without a version does not
reach a versioned handler at all — it lands on `/api/customers`, which requires a staff JWT the client
does not have, and is refused. There is no code path in which a missing version is silently served
the newest shape.

**Alternatives considered.**

- **A version header** (`Accept: application/vnd.crm.v1+json`). More RESTful by some readings, and
  genuinely harder to get wrong for a client that already sets headers. Rejected because it is
  invisible in a log, a browser address bar and a `curl` an integrator pastes into a support ticket —
  and the first thing anyone debugging an integration wants is to see which version was called.
- **Nesting under `/api/integrations/v1`.** Unambiguous, and "integrations" is a word this project
  uses. Rejected because it means nothing to the integrator: they are not calling an integration,
  they are calling the customer endpoint.
- **Reusing `/api` and negotiating.** Rejected outright — it would put the screens' own interface
  behind a version contract, which buys nothing and constrains every future change to them.

**MOUNTED UNDER A PREFIX, NEVER BARE.** This is the third time this project records that lesson.
Phase 9 mounted its AI router with `router.use(aiRoutes)` so it could declare full paths in one file,
and because a bare `use` sees every request, the `authenticate` inside it applied to every route
registered afterwards — putting Phase 7's public knowledge base behind a token. Phase 10's report
router carries the note. This router applies a *different* authenticator, so a bare mount here would
be worse: it would offer machine-credential authentication to every staff route below it.

---

## D2 — Cursor paging, and why the existing paging cannot serve it

**Decision.** Keyset paging over `(updated_at, id)` with an opaque base64 cursor, in a new
`src/api/paging.ts`. The screens keep their existing offset paging unchanged.

**Rationale.** This is the one place where "reuse the existing service" is not enough, and it is worth
being precise about why. `customer.service.ts` and `ticket.service.ts` both expose
`Paged<T> = { items, page, pageSize, total }` — offset paging. FR-008 and SC-005 require that paging
through a changing collection neither skips nor repeats a record, and offset paging cannot provide
that: insert a record on page 1 while a client is reading, and every subsequent page shifts by one, so
one record is read twice and one is never read at all.

For a screen that is a non-issue — a human re-reading a row does not corrupt anything. For a client
synchronising into another system's database, a skipped record is a customer that silently does not
exist over there.

Keyset paging over `(updated_at, id)` gives the guarantee, and it is the same ordering FR-009's
"changed since" needs, so one index serves both. `id` is the tiebreaker because MySQL `DATETIME` is
second-precision and two records updated in the same second would otherwise have no defined order —
the same reasoning `ticket.service.ts` already applies to its own sort.

**The cursor is opaque** (base64 of the two values) so that it is not mistaken for a stable
identifier a client can construct, which is how clients end up depending on internals.

**Alternatives considered.** Offset paging with a snapshot — rejected, it needs a server-side snapshot
per client. `id`-only keyset — rejected, it cannot express "changed since" and would miss updates to
older records entirely.

---

## D3 — How a machine credential is presented and stored

**Decision.** `Authorization: Bearer <clientId>.<secret>` where the secret is 32 random bytes,
base64url-encoded. Stored as SHA-256, one row per active secret. Lookup by `clientId`, then
constant-time comparison of the hash.

**Rationale.** The awkward part is deliberate: **SHA-256, not bcrypt**, and that will look wrong to a
reviewer who has internalised "never SHA a credential". The rule it is reaching for applies to
*passwords* — low-entropy secrets a human chose, where a slow KDF is what makes an offline dictionary
attack impractical. A 32-byte random secret has no dictionary. There is nothing to slow down, and
bcrypt at the cost factor this project uses for passwords (12) would add roughly 100ms of CPU to
**every API request** — turning a deliberate anti-brute-force cost into a self-inflicted throughput
ceiling on the one surface designed for volume.

This project already made exactly this call once: Phase 8's portal invitation tokens are
high-entropy random values stored as SHA-256, for the same reason
(`services/portal-invitation.service.ts`). Consistency here is not laziness; it is the same argument
applied to the same shape of secret.

The client identifier travels alongside the secret so the lookup is by indexed identifier rather than
by scanning hashes, which matters at request volume and also means a wrong secret and an unknown
client can be distinguished internally while returning the same refusal outwardly.

**Alternatives considered.**

- **bcrypt/Argon2.** Rejected on the reasoning above. Recorded here because the decision needs to
  survive a reviewer's first instinct.
- **Secret alone, no identifier.** Requires either a lookup table keyed by the secret's hash (fine)
  or a scan (not). Rejected because prefixing the identifier also lets an administrator recognise a
  leaked credential from its first characters without holding the secret.
- **Opaque bearer token with server-side session.** That is a token store to expire, sweep and
  invalidate; it buys revocation, which the stored credential already has for free.

---

## D4 — Rotation with an overlap

**Decision.** A separate `api_client_secrets` table, many rows per client, each with `expires_at`.
Rotation inserts a new row and sets the outgoing row's `expires_at` to now plus the overlap (default
24 hours). Authentication accepts any unexpired row.

**Rationale.** FR-018 requires rotation to cause no failed request, and the only way to guarantee that
is for both secrets to be valid at once — an integrator cannot atomically redeploy in step with our
update. Rows rather than two columns (`secret_hash`, `previous_secret_hash`) because rows make the
expiry per-secret and make a third overlapping secret a data question rather than a schema change.

The overlap is a **configured default rather than a fixed constant**, for the reason the spec gives
about numbers generally: 24 hours is a guess that fits most deployment cadences and will be wrong for
someone.

---

## D5 — A credential's authority

**Decision.** Reuse the existing permission keys. `api_client_permissions` mirrors
`role_permissions`. Authority is checked per request by the same `requirePermission`-shaped middleware,
reading the client's grants instead of a role's.

**Rationale.** FR-015 asks for one vocabulary, and the alternative — a parallel "scope" system — would
mean every future permission needs adding in two places, with the failure mode being a scope that
looks granted and is not. Phase 10 hit the neighbouring version of this problem: `ai:manage` had no
authorization-matrix probe and that suite had been failing since Phase 9. One vocabulary means one
matrix.

**FR-020 (no granting beyond one's own authority) is checked at grant time**, not at request time.
Checking it per request would mean a client's authority silently changing when the administrator who
created it changed roles — surprising, and hard to explain to the integrator whose integration broke.
Checked at grant time, the grant is a decision with a date and an author in the audit log. The spec's
FR-023 asks for a stated rule about the granting administrator later losing authority; the rule is
that it does **not** revoke the client, because the client's authority is its own. Revoking a person
revokes the person.

---

## D6 — Keeping the interface from restating business rules

**Decision.** Three enforcements, not one:

1. A **presenter layer** at `src/api/v1/presenters/`. A presenter takes what a service already
   returns and maps it to the versioned response shape. It may not query.
2. **Controllers under `controllers/v1/` may not import a model.** Asserted by an import-graph test,
   the technique that caught a real defect in Phase 9 and is now standing in
   `tests/reports/no-rule-restatement.test.ts`.
3. A **parity test** per resource: the same record fetched through the internal service and through
   the published interface must agree on every field they share.

**Rationale.** FR-010 is the requirement in this phase most likely to be broken quietly, and the
checklist says so. It is easy to satisfy on day one and easy to lose the first time an endpoint needs
a field no service returns — at which point the tempting fix is a small query right there in the
controller. That query is then a second definition of what a merged ticket is, and it will disagree
with the screens on the first change to either.

The presenter layer is a genuine addition to this project's layering, so it is justified in the
plan's Complexity Tracking rather than slipped in. Its argument: a versioned response shape is a
*presentation* concern with a lifetime of its own — it must keep its shape while the service beneath
it changes freely — and giving it nowhere to live means it lives in the controller, where the next
person will add a query beside it.

---

## D7 — Capturing events: a transactional outbox

**Decision.** An `integration_events` row is written **in the same transaction** as the change that
caused it. The scheduler sweeps unsent events and creates delivery attempts.

**Rationale.** The two failure modes are asymmetric and both matter.

- Write the event *before* commit and the transaction rolls back: a webhook fires for something that
  did not happen. The receiver creates a record for a ticket that does not exist, and no later event
  ever corrects it.
- Write the event *after* commit, in a separate step, and the process dies in between: the change
  happened and nobody is ever told. FR-030 and SC-013 both forbid losing an event.

Writing it inside the transaction makes both impossible: the event exists exactly when the change
does. Everything after that point is delivery, which is allowed to fail and be retried.

**Events come from the emission points that already exist.** `automation/events.ts` already emits
ticket created and status changed for Phase 6's rules; those emissions are where the outbox row is
written, so this phase observes rather than adding new transition points (FR-065). Customer created
has no such bus and needs a write inside `customer.service.create`'s existing transaction.

**Alternatives considered.** A message broker (Redis, RabbitMQ, SQS) — rejected. It is not in the
constitution's fixed stack, it would be the first infrastructure dependency this project has beyond
MySQL, and a table plus the existing scheduler already provides durability and retry. Database
triggers — rejected: invisible to the application, untestable in this project's suite, and they
cannot know which credential's authority covers the record.

---

## D8 — Delivering, retrying, and the scheduler this project already has

**Decision.** Extend `lib/scheduler.ts`. A tick claims a batch of due attempts, delivers each with
`fetch` and an `AbortSignal` timeout, and records the outcome. Backoff: 1m, 5m, 30m, 2h, 6h, 12h —
six attempts spanning about 21 hours. A `4xx` other than 408/429 is permanent and stops retrying; a
`5xx`, a timeout or a connection failure is transient.

**Rationale.** The scheduler's existing discipline is exactly what this needs, and its own comment
states it: *"every sweep is written so that missing a tick is harmless."* Due-ness lives in a database
column, not in a timer's memory, so a restart loses nothing — which is FR-030's "must survive a
restart" for free rather than as a feature.

`fetch` is global on Node 22; no HTTP client dependency is added. The timeout is not optional: a
receiver that accepts a connection and never responds would otherwise hold a socket for as long as
the OS allows, and enough of them would exhaust the pool.

Distinguishing permanent from transient matters because retrying a `404` six times over 21 hours
tells the administrator nothing they did not know after the first attempt, while filling the failure
list with noise that hides the real problems.

**KNOWN LIMIT, inherited and recorded.** One instance. The existing scheduler's comment already says
two processes would double-fire, and delivery is worse than notifications here because the duplicate
leaves the building. Mitigated rather than solved: attempts are claimed with a conditional update so
two ticks in one process cannot both take the same attempt, and FR-031 makes at-least-once an
explicit part of the contract so a receiver is required to deduplicate. Multi-process operation needs
a lock before it is safe, and that is in Complexity Tracking.

---

## D9 — Signing

**Decision.** `X-CRM-Signature: t=<unix-seconds>,v1=<hex>` where the HMAC-SHA256 is computed over
`<t>.<raw body>` using the subscription's signing secret. Receivers must reject a timestamp outside a
5-minute tolerance. During a secret rotation both signatures are sent as two `v1=` values.

**Rationale.** Signing the body alone lets a captured payload be replayed forever; including the
timestamp inside the signed material is what makes the tolerance enforceable, since a tampered
timestamp invalidates the signature. The scheme is deliberately the widely-deployed one — an
integrator who has verified a Stripe or GitHub webhook will recognise it, and FR-027's requirement is
that verification is possible, which is helped enormously by it being familiar.

Two values during rotation, rather than a sequence of one-secret windows, so a receiver can accept
either while it redeploys — the same overlap logic as D4 and for the same reason.

**Note on ordering.** The signature covers the raw body bytes, so the delivery code must sign the
exact string it sends. Serialising twice — once to sign, once to send — is the standard way this
breaks, and key order is not guaranteed to match.

---

## D10 — The address guard, which is the INVERSE of Phase 9's

**Decision.** One classifier, `lib/net-address.ts`, exposing `classifyHost(host): 'private' |
'public' | 'unresolvable'`. Two call sites with **opposite** required answers, each stating its own in
its name: `assertControlledInfrastructure()` for Phase 9, `assertPubliclyRoutable()` for this phase.
The check runs at subscription save **and again at delivery**, and redirects are not followed.

**Rationale.** This is the trap the spec's checklist flagged, and it deserves the emphasis. Phase 9
refuses to call out to anything that is **not** a private address: the customer-facing AI processor
must be on controlled infrastructure, and a public endpoint there would be sending customer chat
offsite. This phase refuses to call out to anything that **is** a private address: a subscription
pointed at `169.254.169.254` or `127.0.0.1` turns webhook delivery into a way to make this server
probe its own network and report the results to whoever configured it.

Two opposite rules about outbound addresses in one codebase is a genuine hazard for whoever writes
the second, and it is exactly the kind of thing a shared helper called `checkHost()` would get
backwards. Hence: shared *classification*, separate *assertions*, direction in the name, and a test
that asserts both directions on the same host list so a reversal fails loudly.

**Re-checking at delivery is not paranoia.** A hostname that resolved publicly when saved can resolve
to `127.0.0.1` later; that is DNS rebinding, and a save-time-only check does not see it. Not following
redirects (FR-035) closes the other half: a public endpoint that answers `302
http://169.254.169.254/` would otherwise walk the guard straight past itself.

---

## D11 — The ERP adapter contract, and the registry that selects it

**Decision.** `src/erp/types.ts` declares the contract; `src/erp/simulator.ts` implements it;
`src/erp/registry.ts` selects by environment variable, exactly as `channels/registry.ts` does.
Contract surface: `listCustomers({ since, cursor })`, `getOrdersFor(externalCustomerId)`, and
`describe()` returning the adapter's identity for the administration screen.

**Rationale.** Clarifications Q1 chose a contract plus a simulator, and this project has already run
that play successfully: Phase 5 had no real WhatsApp, SMS or email provider available, so
`channels/registry.ts` maps `env.CHANNEL_*_PROVIDER === 'simulator'` to a simulator adapter and
everything else to the real one. Its comment records the division that makes it safe — *"the PROVIDER
comes from the environment because it decides which code runs; ENABLEMENT comes from the database
because an administrator changes it at runtime"* — and that division is what FR-039a needs: an
administrator can switch ERP sync off without a deployment, and cannot re-point it at a different
adapter through a screen.

`describe()` exists because of FR-039a's second half. A deployment serving simulated orders to an
agent who believes they are real is the quiet failure this phase can most easily ship, and the
defence is that the screen says which adapter answered.

---

## D12 — Detecting a human edit without archaeology

**Decision.** The ERP link row stores `last_synced_values` — the values the sync last wrote, as JSON.
A field whose current value differs from what the sync last wrote was changed by somebody else.

**Rationale.** FR-043 is the requirement whose failure is most damaging and least visible: a
successful sync that replaced an agent's correction. Detecting it needs to answer "did a human change
this field since we last wrote it?", and there are three ways to try.

Comparing `customers.updated_at` against the link's `last_reconciled_at` is the obvious one and it is
too coarse — any change to any field marks every field as touched, so either the sync stops updating
anything or it ignores the signal.

Reading the audit log per field is accurate and expensive, and it makes correctness depend on audit
retention: prune the log and the sync starts overwriting.

Storing what we last wrote is a three-way merge, and it is exact for the question actually being
asked. Current equals last-written → nobody touched it, safe to update. Current differs → somebody
did, and FR-043 applies. It needs no history, survives pruning, and the comparison is local to the
row.

**Alternatives considered.** Per-field `updated_by` columns on `customers` — rejected as a schema
change to a Phase 2 table serving one caller. Optimistic version numbers — already present for
concurrent *human* edits, but they answer "did anything change?" not "did a human change this field?".

---

## D13 — Sync resumability

**Decision.** A `sync_runs` row holds the run's state and its position in the ERP's own cursor. Each
record is applied idempotently — upsert keyed on the external identifier — so re-applying is a no-op.
Retry resumes from the stored position.

**Rationale.** FR-045 requires a retry not to duplicate what it applied. Idempotent application makes
that true regardless of where the retry starts, which means the stored position is an optimisation
rather than a correctness requirement — and that is the right way round, because a position that is
merely an optimisation cannot corrupt anything by being slightly wrong.

FR-048's refusal of concurrent runs is a unique partial index on "one run in progress per adapter",
so the second run fails at the database rather than on a check that could race.

---

## D14 — Order display that degrades on its own

**Decision.** Read-through with a 60-second cache and a 5-second hard timeout, rendered in a
component that loads independently of the rest of the customer screen. The response states its source
and the moment it was retrieved.

**Rationale.** FR-057 and SC-021 require an unreachable ERP not to make the customer screen unusable,
and the way that gets broken is loading orders as part of the customer payload — then a slow ERP makes
every customer page slow, and an unreachable one makes the page fail. A separate request that can fail
on its own is what keeps the failure proportionate.

The cache is short on purpose: order status is the thing the customer is phoning about, so a
five-minute-old status is worse than a slightly slower screen. Sixty seconds covers the case that
matters — an agent opening the same customer repeatedly while working a ticket.

FR-054's distinction between "cannot reach" and "no orders" is a real state in the response, not an
empty array. An empty list rendered for an unreachable ERP tells an agent the customer has never
ordered anything, and they will say so to the customer.

---

## D15 — Documentation generated from the implementation

**Decision.** The zod schemas that validate requests are the single source. A generator emits an
OpenAPI 3.1 document, and a test asserts every mounted `v1` route appears in it with every response
shape referenced.

**Rationale.** FR-005 requires the documentation to be derived rather than maintained beside the code,
and the reason is not tidiness: hand-written API documentation is wrong within weeks, and wrong
documentation is worse than none because an integrator trusts it and debugs their own code.

The reconciliation test is Phase 10's technique. `tests/reports/route-auth.test.ts` reads the router's
source and fails if a mounted route is not covered — it exists because Phase 9 shipped a real defect
that the suite could not see. The same shape of test here means a route added without documentation
fails the build rather than shipping undocumented.

**Dependency note.** A schema-to-JSON-Schema conversion needs either a small mapper written here or
`zod-to-json-schema`. Either is a build/documentation tool rather than a stack component, so it is not
a Technology Standards deviation — but it is named in the plan so the choice is visible rather than
arriving in a lockfile.

---

## D16 — Read-only, enforced structurally

**Decision.** The `v1` router registers **only** `GET` routes. A test asserts that no other method
is mounted under it.

**Rationale.** The spec's Assumptions make this phase read-only and the ERP sync the sole external
writer. Stating that in prose leaves it to be eroded one convenient endpoint at a time. A test that
reads the router and fails on a non-`GET` mount makes widening the interface a deliberate act with a
visible diff — which is what "widening it later is an additive version change" requires in order to
be true.

---

## D17 — The tuning numbers, and that they are guesses

The spec deliberately said "stated" rather than fixing values. These are the defaults, each
configurable, each recorded here as a starting point rather than a finding:

| Value                          | Default        | Why this, and what would change it                                                |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| Rate limit per credential      | 600 / 5 min    | Two per second sustained — comfortable for sync, uncomfortable for a polling loop |
| Retry schedule                 | 1m…12h, 6 tries| Spans a night, so an outage during one is recovered by morning                     |
| Delivery timeout               | 10s            | Long enough for a slow receiver, short enough that a hung one frees the worker      |
| Signature timestamp tolerance  | 5 min          | Clock skew in practice, without a usefully long replay window                       |
| Secret rotation overlap        | 24h            | One working day for the integrator to redeploy                                      |
| Event & attempt retention      | 90 days        | Matches the audit basis, since they answer the same kind of question afterwards     |
| Order cache TTL                | 60s            | Repeated opens are cheap; the status an agent quotes is still current               |
| ERP request timeout            | 5s             | Below the point where a customer screen feels broken                                |

Every one of these will be wrong for someone. They are collected in one place for the same reason
Phase 10's suppression floor is: so that tuning is an edit rather than a search.

---

## Open questions carried into implementation

1. **Multi-process delivery.** D8's single-instance limit is inherited from the existing scheduler,
   but delivery makes it more visible because a duplicate leaves the building. A lock is the answer;
   whether it is needed depends on how this is deployed, which nobody has told us.
2. **Which ERP.** Clarifications Q1 settles the protocol and not the identity. Until a product is
   named, the ERP half of the Definition of done is proven against the simulator, and that is stated
   in the spec rather than glossed.
3. **Whether integrators want OAuth2.** D3's stored credential is correct and sufficient; an OAuth2
   token endpoint layered over the same secret is a small, additive piece of work. Worth asking the
   first real integrator rather than guessing.
4. **Per-field ERP ownership.** D12 makes the mechanism exact, but *which* system owns each field is
   an operational decision, not a technical one. The plan declares the table; somebody has to fill it
   in with the organisation.
