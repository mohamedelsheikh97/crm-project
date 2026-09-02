# Quickstart: Validating Phase 11 — Integrations

**Feature**: Phase 11 — Integrations | **Date**: 2026-09-02

Runnable validation for all six user stories, plus the checks that catch this phase's specific
failure modes. Each scenario states what to run and what proves it — not implementation detail,
which belongs in `tasks.md`.

> **Do not start.** Clarifications Q2 requires the Technology Standards amendment in
> [constitution-amendment-proposal.md](./constitution-amendment-proposal.md), and approval is
> outstanding. Under the constitution's Governance section, no implementation task in this phase may
> begin until it is given. This guide describes how to validate the phase once it exists.

---

## Prerequisites

```bash
# From the repository root
npm install
cp .env.example .env          # then set DB_* and the integrations values below
npm run db:migrate
npm run db:seed
```

New environment values:

| Variable                     | For validation | Notes                                          |
| ---------------------------- | -------------- | ---------------------------------------------- |
| `INTEGRATIONS_ENABLED`       | `true`         | The master switch. `false` must give Phase 10   |
| `ERP_PROVIDER`               | `simulator`    | Selects the adapter (contract § 5)              |
| `WEBHOOK_DELIVERY_ENABLED`   | `true`         | Lets the scheduler sweep deliveries             |

You will also need a **receiver** for the webhook scenarios. Anything that logs a request body and
answers `200` works; scenario 3 gives a five-line one.

---

## Scenario 0 — The phase is genuinely optional (FR-067, SC-026)

Do this **first**, because it is the check most likely to be quietly false by the end and hardest to
retrofit.

```bash
INTEGRATIONS_ENABLED=false npm run test --workspace backend
```

**Expected**: the complete Phase 0–10 suite passes unchanged, and `/api/v1/customers` answers `404`
rather than `401` — the interface is absent, not merely refusing.

**Why first**: "it works with the feature off" is easy to believe and easy to break with one
unconditional import. Running it before anything else means the baseline is known.

---

## Scenario 1 — An external system reads data (US1)

### 1a. Issue a credential

Sign in as an administrator, open **Admin → Integrations → API clients**, create one named
`Validation client`, and grant `customers:view` and `tickets:view` — deliberately **not**
`reports:view`.

**Expected**: the secret is displayed once with an explicit warning. Reload the page.

**Expected**: the secret is gone and there is no way to retrieve it — no "reveal" control, nothing in
the API response, nothing in an export (SC-008).

### 1b. Read, using only the contract

```bash
CRED='crmc_xxxx.yyyy'   # what the screen showed you

curl -s -H "Authorization: Bearer $CRED" \
  'http://localhost:3000/api/v1/customers?limit=2' | jq
```

**Expected**: a `data` array, a `paging` object with `next_cursor` and `has_more`, and an
`X-CRM-API-Version: 1` response header. Field names are `snake_case`.

### 1c. The refusal is a refusal, not an empty list

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRED" \
  'http://localhost:3000/api/v1/reports/volume?from=2026-02-01&to=2026-02-28'
```

**Expected**: `403`, and the body names `reports:view`. **Not** `200` with an empty result — the
distinction is the requirement (US1 scenario 3). An empty result reads as "no data" and an integrator
would build on it.

### 1d. No version means no service

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRED" \
  'http://localhost:3000/api/customers'
```

**Expected**: `401`. The unversioned path is the internal interface and does not accept a client
credential. There is no code path where a missing version gets the newest shape (FR-002).

### 1e. Paging is stable under concurrent writes (SC-005)

```bash
npm run test --workspace backend -- tests/api/paging.test.ts
```

**Expected**: a test that pages a collection in small pages while creating and updating records
between pages, and asserts the set of identifiers returned contains no duplicate and no omission.

**Do this by hand as well**, because it is the assertion most likely to pass for the wrong reason:
start paging, create a customer, finish paging. The new customer appears at the **end** or not at all
— never in place of one you had not read yet.

### 1f. Reporting figures survive the trip (SC-007)

Grant `reports:view` to the credential, then compare directly:

```bash
# Through the interface
curl -s -H "Authorization: Bearer $CRED" \
  'http://localhost:3000/api/v1/reports/sla?from=2026-02-01&to=2026-02-28' | jq '.response_compliance'

# On screen: open /reports/sla for the same period as a supervisor
```

**Expected**: identical `value`, `count`, `total` and `excluded`. Where `suppressed` is true, `value`
is `null` — **not `0`** (SC-007). Zero is a claim; null is an absence.

---

## Scenario 2 — Notifications arrive, signed (US2)

### 2a. A receiver

```bash
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.headers['x-crm-signature']);console.log(b);s.writeHead(200).end('ok')})}).listen(4567)" &
```

That listens on `localhost:4567`, which the address guard **will refuse** — that is scenario 2e.
Expose it publicly (a tunnel, or a host on your network) for 2b.

### 2b. Subscribe and fire

Open **Admin → Integrations → Subscriptions**, add the public address, select `ticket.resolved`, and
attach it to the credential from scenario 1. Note the signing secret shown once.

Now resolve a ticket **through the normal agent screen**, not through a test helper — the point is
that the event comes from the ordinary path.

**Expected**, within about a minute: exactly one request at your receiver, carrying `event_id`,
`event_type`, `occurred_at` with milliseconds, and a `subject` with `type`, `id` and `url`.

**Expected**: **no ticket subject, no customer name, no message text** anywhere in the body (FR-028).
This is worth reading rather than assuming.

### 2c. Verify, and verify that tampering fails

Compute HMAC-SHA256 over `<t>.<raw body>` with the signing secret and compare with `v1=`.

**Expected**: it matches. Change one byte of the body and recompute.

**Expected**: it does not (SC-014).

### 2d. The agent never waits (SC-012)

Point a subscription at an address that accepts connections and never responds. Resolve a ticket and
time it.

**Expected**: the same duration as with no subscription at all. If resolving got slower, delivery is
inline and FR-029 is broken.

### 2e. The address guard, in both directions (SC-015)

Try to subscribe to each of `http://127.0.0.1:4567`, `http://10.0.0.5/hook`,
`http://169.254.169.254/latest/meta-data`, and `https://something.internal/hook`.

**Expected**: all four refused with a stated reason.

```bash
npm run test --workspace backend -- tests/webhooks/address-guard.test.ts
```

**Expected**: a test asserting **both** directions over the same host list — that this phase refuses
private addresses *and* that Phase 9's check still refuses public ones. Two opposite rules about
outbound addresses live in this codebase, and a reversal must fail loudly rather than pass one of
them.

### 2f. An outage loses nothing (SC-013)

Stop your receiver. Resolve three tickets. Wait for two retry intervals. Start the receiver.

**Expected**: all three arrive. None was discarded, and the events survived whatever the scheduler
did in between.

### 2g. Exhausted retries are visible, not gone (FR-033)

Point a subscription at an address that always answers `500`. Let it exhaust.

**Expected**: the event appears in **Admin → Integrations → Overview** with its failure reason and
attempt count. It is not deleted.

---

## Scenario 3 — Credential lifecycle (US3)

### 3a. Rotation causes no failed request (SC-009)

Start a loop against the interface with the **old** secret:

```bash
while true; do
  curl -s -o /dev/null -w '%{http_code} ' -H "Authorization: Bearer $CRED" \
    'http://localhost:3000/api/v1/customers?limit=1'
  sleep 1
done
```

Rotate the credential in the administration screen while it runs.

**Expected**: an unbroken run of `200`s. Switch the loop to the new secret mid-overlap.

**Expected**: still `200`s. Not one `401` (SC-009). If you see one, the overlap is not working and
every real integrator's rotation is an outage.

### 3b. Revocation is immediate (SC-010)

Revoke the credential. Send one more request.

**Expected**: `401`, immediately — not on the next cache expiry.

### 3c. Nobody grants beyond their own authority (FR-020)

As a **supervisor** (who lacks `users:create`), attempt to create a credential granting
`users:create`.

**Expected**: refused.

### 3d. The audit trail names the credential (FR-021, SC-023)

```bash
npm run test --workspace backend -- tests/integrations/audit.test.ts
```

**Expected**: creation, rotation, scope change and revocation each recorded and attributable to the
administrator; interface requests attributable to the **client**, not to whoever created it.

### 3e. No secret anywhere (SC-024, FR-066)

```bash
npm run test --workspace backend -- tests/integrations/redaction.test.ts
```

**Expected**: a test that issues a credential and a signing secret with distinctive values, exercises
every surface, then searches request logs, audit rows, error bodies and the administration API for
those strings. Zero hits.

---

## Scenario 4 — ERP synchronisation (US4)

### 4a. Preview writes nothing (FR-044, SC-017)

**Admin → Integrations → ERP sync → Preview**.

**Expected**: a classification of every simulator record — created, updated, skipped, conflict — with
a reason on each non-trivial one. Then check the database.

**Expected**: no customer was created or changed. A preview that writes is not a preview.

### 4b. The human edit is protected (SC-018) — the important one

The simulator contains a customer whose counterpart here has a field a person edited more recently.
Before applying, note that field's value.

Apply the sync.

**Expected**: the human's value is either preserved, or replaced **with the replacement recorded and
visible** in the run's records with the before-and-after. What must not happen is the value silently
changing.

**This is the scenario worth doing by hand every time.** It is the phase's most damaging quiet
failure: everything succeeds, every screen works, and an agent's correction is gone.

### 4c. Preview and apply agree (SC-017)

Compare the preview's counts and per-record outcomes with the run's.

**Expected**: the same set. A preview that disagrees with the run is worse than no preview, because
it was trusted.

### 4d. A skip states its reason (FR-046)

**Expected**: the record missing a required field and the record failing this system's validation both
appear as skipped, each with a reason an administrator can act on. The rest of the run completed.

### 4e. Resumption does not duplicate (SC-019)

Interrupt a run part way — stop the process mid-sync.

Restart and retry.

**Expected**: it completes, and no customer was created twice and no update reapplied.

### 4f. Concurrent runs are refused (FR-048)

Start a sync and start another before the first finishes.

**Expected**: the second refused, not interleaved.

### 4g. Unreachable ERP changes nothing

Put the simulator into its failing mode and start a sync.

**Expected**: the run fails visibly with a reason, and nothing was written.

---

## Scenario 5 — Orders on the customer screen (US5)

### 5a. Orders appear, with their provenance (FR-053)

Open a customer the simulator has orders for.

**Expected**: the orders with date, reference and status; a line stating the source and when it was
retrieved; and — because `ERP_PROVIDER=simulator` — a visible statement that the data is **simulated**
(FR-039a). An agent must not be able to mistake it for real.

### 5b. "Cannot reach" is not "no orders" (SC-021, FR-054)

Put the simulator into failing mode. Reload the customer.

**Expected**: the panel says order data could not be retrieved, **visibly different** from a customer
with no orders. An empty list here would have an agent telling a customer they have never ordered
anything.

**Expected**: the rest of the customer screen works normally. If the whole page failed, orders are
loaded inline and FR-057 is broken.

### 5c. An unlinked customer says so (FR-055)

Open a customer with no ERP link.

**Expected**: a stated absence of a link. Not an empty table, not an error.

### 5d. Authority is the customer's (FR-056)

As an agent without authority over that customer, attempt to reach the orders.

**Expected**: refused on the same basis as the rest of the record.

---

## Scenario 6 — Failures are visible and actionable (US6)

### 6a. Health at a glance (SC-022)

With one healthy subscription and one that has been failing, open **Admin → Integrations → Overview**.

**Expected**: the failing one identifiable **without** reading individual delivery records — a state
with a label, not a colour alone (FR-064).

### 6b. Re-send works and is attributed (FR-059)

Fix the failing receiver. Re-send an abandoned event.

**Expected**: delivered, carrying the **original** `event_id` so the receiver can recognise it; and
recorded as re-sent by that administrator.

### 6c. The overview is gated (FR-061)

As a supervisor without integration authority, open it.

**Expected**: refused. Integration administration is a distinct authority, not implied by general
administration.

---

## Cross-cutting checks

### Bilingual and RTL (FR-063, SC-025)

Switch to Arabic and walk all four administration screens plus the order panel.

**Expected**: no raw keys, no English strings, correct RTL layout, and numbers and dates through
`vue-i18n` rather than `String(n)`. Check the failure states specifically — "could not reach the ERP"
and the health labels are the strings most likely to have been left in English, because they are the
ones a developer sees least.

### Accessibility (FR-064, SC-025)

**Expected**: subscription health has an icon and a text label, never colour alone. The order panel's
failure state is announced to a screen reader rather than only styled. Every control is reachable by
keyboard, including the re-send action.

### The interface is read-only (FR-016, research D16)

```bash
npm run test --workspace backend -- tests/api/read-only.test.ts
```

**Expected**: a test that reads the `v1` router and asserts **no** non-`GET` route is mounted. Widening
the interface should be a visible diff, not a convenience someone adds.

### No rule is restated (FR-010, SC-007)

```bash
npm run test --workspace backend -- tests/api/no-rule-restatement.test.ts
```

**Expected**: an import-graph test asserting no controller under `controllers/v1/` imports a model,
plus a parity test comparing the same record through the service and through the interface. This is
the requirement most likely to be broken quietly, and Phase 10's equivalent test is the pattern.

### Documentation matches reality (FR-005, FR-006)

```bash
curl -s http://localhost:3000/api/v1/openapi.json | jq '.paths | keys'
npm run test --workspace backend -- tests/api/openapi.test.ts
```

**Expected**: every mounted `v1` route present in the document. The reconciliation test is the same
technique as Phase 10's `route-auth.test.ts`, which exists because Phase 9 shipped a real defect the
suite could not see.

**Then do the thing the tests cannot**: hand the document and a fresh credential to somebody who has
not read this repository, and see whether they get a successful request inside 30 minutes (SC-001).
That is the only real test of FR-006, and it cannot be automated.

---

## What this guide cannot validate

Stated plainly, because a quickstart that implies full coverage is worse than one that admits its
edges:

- **A real ERP.** Everything in scenario 4 runs against the simulator. Conformance of a real adapter
  is a later, smaller piece of work against the same contract.
- **Multi-process delivery.** Everything here assumes one application instance. Two would double-fire
  — recorded as a known limit in the plan and made survivable by at-least-once being part of the
  published contract, but not validated here.
- **Real integrator behaviour.** SC-001 and SC-003 are about somebody else's experience of the
  documentation and the version contract. They need a person who has not seen this codebase.
- **Delivery at volume.** SC-011's "99% within 30 seconds" is measured against a handful of events
  here. A subscription fanning out thousands of events needs its own measurement, in the shape of
  Phase 10's `volume-benchmark.ts`.
