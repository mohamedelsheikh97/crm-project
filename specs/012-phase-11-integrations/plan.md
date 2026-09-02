# Implementation Plan: Integrations

**Branch**: `012-phase-11-integrations` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-phase-11-integrations/spec.md`

---

## Summary

Open the system to external consumers along three axes, each with a different failure mode:

- **A published, versioned read interface** at `/api/v1`, in its own identity realm with its own
  credential type. Keyset-paged, rate-limited per credential, documented from the schemas that
  validate it. Its hazard is *permanence* — once something reads a shape, the shape is a promise.
- **Outbound notifications** on ticket and customer lifecycle events, written to a transactional
  outbox inside the transaction that caused them and delivered by the existing scheduler with
  signed, identifier-only payloads. Its hazard is *silence* — a webhook that stopped arriving is
  invisible until a business process has been wrong for a week.
- **ERP synchronisation** behind a single declared adapter contract with a simulator, plus read-only
  order display on the customer screen. Its hazard is *a second writer* — a successful sync that
  overwrote what an agent typed.

The technical approach is almost entirely reuse of patterns this repository has already proven:
`channels/registry.ts`'s environment-selected adapter with a simulator (Phase 5), `lib/scheduler.ts`'s
"missing a tick is harmless" sweeps (Phase 4/6), Phase 8's SHA-256 storage of high-entropy secrets,
and Phase 10's single-boundary module plus import-graph test for stopping a new surface from
restating existing rules. Two things are genuinely new: keyset paging, because the existing offset
paging cannot give FR-008's guarantee, and a presenter layer, because a versioned response shape needs
somewhere to live that is not a controller.

**One gate is outstanding.** Clarifications Q2 deviates from the Technology Standards table, so
[constitution-amendment-proposal.md](./constitution-amendment-proposal.md) must be approved before any
implementation task begins. This plan may be reviewed and `/speckit-tasks` may be generated; nothing
may be built.

---

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js 22 (backend); Vue 3.5 `<script setup>` +
TypeScript strict (frontend). Node 22 matters here: `fetch` and `AbortSignal.timeout` are global, so
webhook delivery adds no HTTP client dependency.

**Primary Dependencies**: Express, Sequelize, MySQL 8.4, zod (already the request-validation layer and
now the documentation source), `node:crypto` (HMAC signing, secret generation, SHA-256). Frontend:
Pinia, vue-i18n, Tailwind. **New**: a zod→JSON-Schema conversion for OpenAPI generation — either a
~100-line mapper written here or `zod-to-json-schema`; a documentation tool, not a stack component.

**Storage**: MySQL. Eight new tables (see [data-model.md](./data-model.md)); no changes to any
existing table's columns except one nullable addition to `customers` for the ERP link, which is
carried on its own table instead — see the data model for why.

**Testing**: Vitest. Backend integration tests against a real MySQL schema through `supertest`, with
`fileParallelism: false` and the shared `crm_support_test` schema. Frontend component tests with
`@vue/test-utils` and jsdom. Static-read tests (import graph, router reconciliation, method
enumeration) following Phase 9 and Phase 10's precedent.

**Target Platform**: Linux server behind a reverse proxy; the published interface is HTTPS-only in
deployment. Receivers are HTTPS endpoints on the public internet.

**Project Type**: Web application — existing `backend/` + `frontend/` workspaces.

**Performance Goals**: Published interface p95 within the internal equivalent plus presentation cost;
600 requests / 5 minutes per credential by default. 99% of notifications delivered within 30 seconds
of the event (SC-011). An agent's action unaffected by any subscription's existence or health
(SC-012). A 10,000-customer ERP sync completing unattended (SC-020).

**Constraints**: The originating action must never wait for a delivery (FR-029) — which is what forces
the outbox rather than an inline call. An unreachable ERP must not degrade the customer screen
(FR-057). No secret in any log, audit record, error or trace (FR-066). Every integration capability
switchable off with the Phase 0–10 suite passing unchanged (FR-067, SC-026).

**Scale/Scope**: Six user stories, 69 functional requirements, 26 success criteria. Eight tables,
roughly 20 `GET` endpoints under `/api/v1`, four administration screens, one adapter contract with one
simulator implementation.

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see the bottom of this
section._

### I. Bilingual-First & RTL (NON-NEGOTIABLE) — PASS, with one point stated explicitly

Four administration screens are added (API clients, subscriptions, ERP sync, integrations overview)
plus an order panel on the existing customer screen. All are `t('key')` throughout, with both locale
files updated in step, and all render in RTL.

**The point worth stating: the published interface's error messages are English-only, and that is not
a Principle I violation.** Principle I governs *UI components* and *text content in templates*. An
API error carries a machine-readable code as its contract and a human message as a debugging
courtesy for a developer reading a log. Localising it would mean an integration's behaviour depending
on a header, and a machine consumer has no language. The distinction is recorded here because "there
are English strings in this phase" is exactly the shape of thing a reviewer should challenge, and the
answer should be on the record rather than improvised.

The order panel is real UI and is fully bilingual, including the "could not reach the ERP" state
(FR-054) and the source-and-freshness line (FR-053).

### II. Security by Default (NON-NEGOTIABLE) — PASS, and this is the phase's centre of gravity

- **A fourth identity realm.** Machine credentials are accepted only under `/api/v1`; staff JWTs are
  refused there. Enforced by separate mounts and separate middleware, not by a conditional (D1).
- **Server-side authority on every request** (FR-016), using the existing permission vocabulary and
  therefore the existing authorization matrix (D5). No parallel scope system to drift.
- **Secrets verifiable but not retrievable** (FR-017), stored as SHA-256 of 32 random bytes. The
  choice of SHA-256 over bcrypt is argued in research D3 rather than assumed, because it is the
  decision most likely to be challenged and the argument turns on the secret's entropy.
- **Immediate revocation** (FR-019) — which is why a stored credential was chosen over a
  service-account JWT, whose validity-until-expiry is a design property (see the amendment proposal,
  section 2).
- **The outbound address guard, inverted from Phase 9's** (D10). One classifier, two call sites with
  opposite required answers and the direction in each name, re-checked at delivery, redirects not
  followed. A test asserts both directions over the same host list so a reversal fails loudly.
- **Identifier-only payloads** (FR-028, Clarifications Q3) keep authority checks at read time, so a
  misconfigured subscription address is an inconvenience rather than a disclosure.
- **Audit coverage** for credential creation, rotation, scope change, revocation and use; subscription
  changes; sync runs; and administrator re-sends (FR-021, FR-059, FR-062).
- **Secret redaction** (FR-066) asserted by a test that searches every log, audit record and error
  body for known test secrets.

No principle II concession is requested.

### III. Layered Architecture (NON-NEGOTIABLE) — PASS, with one addition justified below

Backend keeps `routes → controllers → services → models`. The published interface adds a **presenter**
between services and controllers: a pure mapping from what a service returns to a versioned response
shape, with no query access. It is justified in Complexity Tracking and enforced by an import-graph
test forbidding controllers under `controllers/v1/` from importing a model (D6).

Frontend keeps `<script setup>`, Pinia for cross-component state, and all HTTP in
`frontend/src/services/`. The order panel calls a service function, not `fetch`.

**The ERP adapter contract is the analogue of `reporting/sources.ts`**: one declared boundary that
everything else depends on, so replacing the implementation touches one file (FR-039b, FR-040).

### IV. Accessibility — PASS

The four administration screens meet WCAG 2.1 AA in both languages. Two specifics this phase forces:

- **Subscription health must not be colour alone** (FR-064). A green dot is the obvious design and
  the wrong one; health carries an icon and a text label, following the treatment Phase 10's status
  palette already requires.
- **The order panel's failure state is announced**, not merely styled, so an agent using a screen
  reader learns the ERP is unreachable rather than hearing an empty table.

### V. Phase-Gated Delivery via Spec Kit — PASS on ordering, BLOCKED on one approval

Ordering is satisfied: the constitution places Phase 11 after Phases 1–10, all of which are merged.
Traceability runs from PLAN.md "Phase 11 — Integrations" through this spec's FRs to the tasks
`/speckit-tasks` will generate.

**The approval is not satisfied.** Clarifications Q2 requires the Technology Standards amendment, and
the Governance section says approval must be obtained *before any Spec Kit phase the amendment would
affect*. Planning is unaffected — the plan can be reviewed either way. Implementation is affected, and
this plan states that no task may begin until the proposal is approved. Phase 9 handled the same
situation the same way and it is the precedent being followed.

### Post-design re-check (after Phase 1)

Re-evaluated against [data-model.md](./data-model.md) and [contracts/](./contracts/):

- **I** — no new user-facing string escapes the locale files; the API-error exception is scoped to
  machine-readable responses and is recorded above. **PASS**
- **II** — the data model stores no retrievable secret; `api_client_secrets` holds hashes only,
  `webhook_subscriptions.signing_secret_hash` likewise, and the ERP adapter's connection details come
  from the environment rather than a table an administration screen could echo. **PASS**
- **III** — the contracts describe responses assembled from existing service output; no contract
  requires a field no service produces, which was the specific way FR-010 could have been broken at
  design time. **PASS**
- **IV** — no contract or model forces a colour-only status; `webhook_subscriptions` carries a
  health *enum*, so the label is data rather than a rendering decision. **PASS**
- **V** — unchanged: ordering fine, one approval outstanding. **BLOCKED for implementation.**

No violation is unjustified. Three additions are recorded in Complexity Tracking.

---

## Project Structure

### Documentation (this feature)

```text
specs/012-phase-11-integrations/
├── spec.md                              # /speckit-specify output (69 FRs, 26 SCs, 6 stories)
├── constitution-amendment-proposal.md   # Q2's Technology Standards amendment — APPROVAL PENDING
├── plan.md                              # This file
├── research.md                          # Phase 0 — D1–D17 plus carried open questions
├── data-model.md                        # Phase 1 — eight tables and their invariants
├── quickstart.md                        # Phase 1 — runnable validation of all six stories
├── contracts/
│   ├── published-api.md                 # /api/v1 — versioning, paging, errors, endpoints
│   ├── webhook-contract.md              # payload, signature, retries, what a receiver must do
│   └── erp-adapter-contract.md          # the single boundary an ERP implementation satisfies
└── checklists/
    └── requirements.md                  # 16/16, one gate noted
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── api/                             # THE PUBLISHED INTERFACE — version-scoped
│   │   ├── paging.ts                    # keyset cursor over (updated_at, id) — D2
│   │   ├── openapi.ts                   # document generated from the v1 zod schemas — D15
│   │   └── v1/
│   │       ├── schemas/                 # zod request schemas; also the documentation source
│   │       └── presenters/              # service output → versioned response shape (no queries)
│   ├── erp/
│   │   ├── types.ts                     # THE ADAPTER CONTRACT — the only thing sync depends on
│   │   ├── registry.ts                  # env → adapter, mirroring channels/registry.ts
│   │   └── simulator.ts                 # the shipped implementation of the contract
│   ├── integrations/
│   │   ├── outbox.ts                    # writes an event inside the caller's transaction — D7
│   │   ├── signing.ts                   # HMAC-SHA256 over "<t>.<raw body>" — D9
│   │   └── delivery.ts                  # one attempt: classify, time out, record
│   ├── lib/
│   │   ├── net-address.ts               # ONE classifier; two opposite assertions — D10
│   │   └── scheduler.ts                 # EXTENDED with the delivery sweep
│   ├── controllers/
│   │   ├── v1/                           # thin; MAY NOT import a model (import-graph test)
│   │   └── admin/                        # api-clients, subscriptions, erp-sync, overview
│   ├── routes/
│   │   ├── v1/index.ts                   # mounted at /api/v1 — GET only, own authenticator
│   │   └── admin/index.ts                # EXTENDED with the integrations administration routes
│   ├── middleware/
│   │   └── authenticate-client.ts        # machine credentials; refuses a staff JWT
│   ├── services/
│   │   ├── api-client.service.ts          # issue, rotate, revoke, verify
│   │   ├── webhook-subscription.service.ts
│   │   ├── webhook-delivery.service.ts    # queueing, retry state, re-send
│   │   ├── erp-sync.service.ts            # preview, run, resume, per-field ownership
│   │   └── erp-order.service.ts           # read-through with TTL and timeout — D14
│   ├── models/                            # eight new models, registered in models/index.ts
│   └── db/
│       ├── migrations/                    # eight tables + indexes
│       └── seeders/                       # the integrations permission keys
└── tests/
    ├── api/                               # published interface: paging, versioning, parity, read-only
    ├── webhooks/                          # outbox, signing, retry, SSRF both directions, redaction
    ├── erp/                               # contract conformance, preview, human-edit protection
    └── integrations/                      # credential lifecycle, authority, audit

frontend/
├── src/
│   ├── views/admin/integrations/
│   │   ├── ApiClientListView.vue          # issue, rotate, revoke; secret shown once
│   │   ├── SubscriptionListView.vue       # addresses, events, health
│   │   ├── ErpSyncView.vue                # preview, run, run history, active adapter
│   │   └── IntegrationsOverviewView.vue   # failures, re-send, health at a glance
│   ├── components/customers/
│   │   └── CustomerOrders.vue             # own request, own failure state — D14
│   └── services/integrations.service.ts
└── tests/integrations/
```

**Structure Decision.** The published interface gets its own top-level `src/api/` directory rather
than living among the existing controllers, because it is the only part of this codebase with a
version contract: its files must keep their shape while the services beneath them change, and that
property is easier to respect when it is visible in the path. `src/erp/` and `src/integrations/`
follow the existing precedent of a domain directory per concern (`src/ai/`, `src/channels/`,
`src/reporting/`, `src/sla/`), each with one declared boundary file the rest of the system depends on.

`lib/net-address.ts` is deliberately in `lib/` rather than in either consumer, because it has two
consumers with opposite requirements and putting it in one of them would make the other's import look
like a layering accident.

---

## Complexity Tracking

| Violation                                                | Why Needed                                                                                                                                                                                                                                                    | Simpler Alternative Rejected Because                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A second authentication mechanism** (constitution amendment pending) | A machine client has no login, so the fixed stack's "JWT issued at login" does not describe it. FR-019 requires immediate revocation.                                                                                                                          | A long-lived service-account JWT needs no amendment, but a JWT is valid until expiry by design; revoking one early requires a revocation list checked per request — the same database lookup with extra parts, while looking compliant rather than being correct. |
| **A presenter layer** between services and controllers   | A versioned response shape must hold still while the service beneath it changes. Given nowhere to live it lives in the controller, and the next person adds a query beside it — which is FR-010 broken, and the drift Phase 10's `sources.ts` exists to prevent. | Mapping inline in the controller: works on day one, and is exactly how a controller acquires its first query. Serving service DTOs directly: makes every internal refactor a breaking API change, which is what versioning exists to avoid.                        |
| **Keyset paging alongside the existing offset paging**   | FR-008/SC-005 require paging that neither skips nor repeats under concurrent writes. Offset paging cannot: one insert shifts every later page.                                                                                                                 | Reusing the existing `Paged<T>`: for a screen a re-read is harmless, but for a client synchronising into another database a skipped record is a customer that silently does not exist there.                                                                       |
| **An outbox table rather than an inline call**           | FR-029 forbids the agent's action waiting on a receiver; SC-013 forbids losing an event. Writing the row inside the causing transaction makes "fired for a rolled-back change" and "lost after commit" both impossible.                                        | Calling the receiver inline: couples an agent's click to a third party's uptime. Writing the event after commit: a crash in between loses it silently, which is the failure nobody notices.                                                                        |

**Known limit, inherited and recorded.** Delivery runs on the existing single-instance
`setInterval` scheduler, whose own comment already notes that two processes would double-fire. Here
the duplicate leaves the building, so it is mitigated rather than tolerated: attempts are claimed by
conditional update, and FR-031 makes at-least-once part of the published contract so a receiver is
required to deduplicate. Multi-process operation needs a lock and is out of scope for this phase —
carried as research open question 1.
