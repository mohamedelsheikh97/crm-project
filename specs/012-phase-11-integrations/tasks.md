---
description: 'Task list for Phase 11 — Integrations'
---

# Tasks: Integrations

**Input**: Design documents from `/specs/012-phase-11-integrations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Every prior phase in this project generated test tasks, and this phase's success
criteria are written as assertions — SC-005 (paging under concurrent writes), SC-014 (signature
tampering), SC-018 (no human edit overwritten) and SC-024 (no secret anywhere) are not reviewable by
reading code.

**Organization**: Grouped by user story, in the spec's priority order, so each is independently
implementable and testable.

> ## ⚠️ T001 BLOCKS EVERY OTHER TASK
>
> Clarifications Q2 deviates from the constitution's Technology Standards table. The Governance
> section requires approval **before any Spec Kit phase the amendment would affect**. No task below
> T001 may begin until it is granted. This is the same gate Phase 9 carried, and it is first for the
> same reason: discovering it mid-implementation means unwinding work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: Which user story the task serves
- File paths are exact

## Path Conventions

Web application: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`, per
plan.md's Structure Decision.

---

## Phase 1: Setup

**Purpose**: The governance gate, configuration, and the permission keys everything else checks
against.

- [X] T001 **GATE** — Obtain explicit approval of
      [constitution-amendment-proposal.md](./constitution-amendment-proposal.md), then apply it to
      `.specify/memory/constitution.md`: split the authentication row into people and machines, add
      the machine-credential paragraph, reword the ERP open item, bump to v1.3.0 with a Sync Impact
      Report comment. **If approval is withheld, stop and re-plan** — proposal section 6 states the
      fallback, and it changes the plan rather than the implementation.
- [X] T002 Add the integration environment variables to `backend/src/config/env.ts` and
      `.env.example`: `INTEGRATIONS_ENABLED`, `ERP_PROVIDER`, `WEBHOOK_DELIVERY_ENABLED`,
      `WEBHOOK_TIMEOUT_MS`, `API_RATE_LIMIT_PER_WINDOW`, `CREDENTIAL_ROTATION_OVERLAP_HOURS`,
      `INTEGRATION_RETENTION_DAYS`. **Use the existing `envFlag()` helper for every boolean, never
      `z.coerce.boolean()`** — Phase 9 shipped that bug: `Boolean("false") === true`, so a flag set
      to `false` would have read as enabled, and it only failed safe because every flag defaulted off.
- [X] T003 [P] Add the zod→JSON-Schema conversion for OpenAPI generation to `backend/package.json`
      (research D15). Either `zod-to-json-schema` or a local mapper under
      `backend/src/api/json-schema.ts` — a documentation tool, not a stack component, but named here
      so the choice is visible rather than arriving in a lockfile.
- [X] T004 [P] Add the permission keys to `backend/src/auth/permissions.ts`: `integrations:manage`
      (credentials, subscriptions, the overview) and `erp:sync` (running a synchronisation). Comment
      why they are distinct from `settings:view` and from each other — FR-061 requires integration
      administration not to be implied by general administration.
- [X] T005 Create `backend/src/db/seeders/20260904000001-integration-permissions.cjs` granting both
      keys to **administrators only**, following the reconciling-seeder pattern. Not supervisors: a
      credential is a standing grant of data access to an outside party, which is a narrower decision
      than Phase 10's reporting keys.
- [X] T006 Register the seeder in `backend/tests/helpers/database.ts`'s `reseed()`. **Omitting this is
      the trap this project has hit at every phase boundary** — the key exists, no role holds it,
      every test fails on a 403 that looks like a permission bug rather than a missing seeder.
- [X] T007 Add probes for both keys to `backend/tests/authorization.matrix.test.ts`. **Phase 10 found
      that `ai:manage` had no probe and that suite had been failing since Phase 9** — a whole phase
      shipped with a red test nobody read. Add them with the keys, not afterwards.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, models, and the four pieces of shared machinery every story needs.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

### Migrations

- [X] T008 Create `backend/src/db/migrations/20260904000002-create-api-clients.cjs` — `api_clients`,
      `api_client_secrets`, `api_client_permissions` per data-model.md. `UNIQUE(client_id)`,
      `UNIQUE(api_client_id, permission_key)`, index `(api_client_id, expires_at)`, `CASCADE` from
      the client. **No secret column on `api_clients`** — secrets are rows so rotation is data.
- [X] T009 [P] Create
      `backend/src/db/migrations/20260904000003-create-webhook-subscriptions.cjs` — includes
      `signing_secret_hash`, `previous_signing_secret_hash`, `secret_rotated_at`, and `health` as an
      **ENUM**. Health is data so its label can be translated text beside an icon (FR-064); a boolean
      would make colour the only carrier.
- [X] T010 [P] Create `backend/src/db/migrations/20260904000004-create-integration-events.cjs` —
      `UNIQUE(event_key)`, **`occurred_at` as `DATETIME(3)`**. Millisecond precision is load-bearing:
      FR-032 tells receivers to order by occurrence time, and two events for one ticket inside a
      second are ordinary, so second precision makes that instruction unfollowable.
- [X] T011 Create
      `backend/src/db/migrations/20260904000005-create-webhook-delivery-attempts.cjs` — index
      `(state, next_attempt_at)` so the sweep is one index range, and `(subscription_id, created_at)`
      for health derivation.
- [X] T012 [P] Create `backend/src/db/migrations/20260904000006-create-erp-links.cjs` —
      `UNIQUE(customer_id)` **and** `UNIQUE(external_id)`, so two ERP records claiming one identifier
      fail at the database rather than on a check that could race. Includes `last_synced_values` JSON.
- [X] T013 [P] Create `backend/src/db/migrations/20260904000007-create-erp-sync.cjs` —
      `erp_sync_runs` and `erp_sync_records`. Enforce **one `running` row per adapter** with a
      generated column plus a unique index (FR-048), not an application check.
- [X] T014 Create `backend/src/db/migrations/20260904000008-add-keyset-indexes.cjs` — composite
      `(updated_at, id)` on `tickets` and `customers`. **Neither exists**: Phase 10 added
      `tickets(created_at)`, not `updated_at`. Every published list orders by this pair, and without
      the index each page sorts the table. Record that finding in the migration header, as Phase 10's
      index migration did.

### Models

- [X] T015 [P] Create `backend/src/models/api-client.model.ts`,
      `api-client-secret.model.ts`, `api-client-permission.model.ts`.
- [X] T016 [P] Create `backend/src/models/webhook-subscription.model.ts` and
      `webhook-delivery-attempt.model.ts`.
- [X] T017 [P] Create `backend/src/models/integration-event.model.ts`.
- [X] T018 [P] Create `backend/src/models/erp-link.model.ts`, `erp-sync-run.model.ts`,
      `erp-sync-record.model.ts`.
- [X] T019 Register all nine in `backend/src/models/index.ts` with their associations. **Check every
      column declared in a migration is declared on the model**: Phase 9 lost
      `assistant_conversation_id` this way — present in the migration, absent from the model, and
      Sequelize dropped it silently on write with no error anywhere.

### The address guard — research D10

- [X] T020 Create `backend/src/lib/net-address.ts`: `classifyHost(host): 'private' | 'public' |
      'unresolvable'`, plus **two separately named assertions** —
      `assertPubliclyRoutable()` for this phase and `assertControlledInfrastructure()` for Phase 9.
      The direction is in the name because the two requirements are opposite and a shared
      `checkHost()` is precisely the helper somebody calls with the wrong expectation.
- [X] T021 Refactor the private-address check in `backend/src/config/env.ts` (the
      `AI_LOCAL_BASE_URL` validation, around line 380) and
      `backend/src/ai/providers/local-factory.ts`'s `PRIVATE_HOST` regex to call
      `assertControlledInfrastructure`. One classifier, so a fix to the address ranges reaches both.
- [X] T022 [P] Write `backend/tests/webhooks/address-guard.test.ts` asserting **both directions over
      the same host list**: loopback, RFC1918, `169.254.169.254`, `.internal`, `.local` and a public
      host, checked once for "must be public" and once for "must be private". A reversal must fail
      loudly rather than pass one of the two.

### Keyset paging — research D2

- [X] T023 Create `backend/src/api/paging.ts`: opaque base64 cursor encoding `(updated_at, id)`,
      `encode`/`decode`, and a `where` builder. Refuse a cursor whose `since` does not match the
      request's, rather than reinterpreting it.
- [X] T024 [P] Write `backend/tests/api/paging.test.ts`: page a collection in small pages while
      **creating and updating records between pages**, assert no identifier is duplicated or omitted
      (SC-005). Also assert a hand-constructed cursor is refused, so clients cannot come to depend on
      its shape.

### The realm

- [X] T025 Create `backend/src/services/api-client.service.ts` with `verify(bearer)` — split on the
      first dot, look up by `client_id`, accept any unexpired secret row, constant-time compare.
      **SHA-256 of a 32-byte random secret, not bcrypt** — research D3 has the argument, and it turns
      on the secret's entropy rather than on convenience. Update `last_used_at` on success.
- [X] T026 Create `backend/src/middleware/authenticate-client.ts`. Refuses a staff JWT. Missing,
      malformed, unknown and revoked credentials all answer the same `401` body so the refusal cannot
      be used to learn whether an identifier exists.
- [X] T027 Create `backend/src/routes/v1/index.ts` applying `authenticate-client`, and mount it in
      `backend/src/routes/index.ts` as `router.use('/v1', v1Routes)`. **UNDER A PREFIX, NEVER BARE.**
      Phase 9 mounted its AI router bare and its `authenticate` leaked onto every route registered
      after it, putting Phase 7's public knowledge base behind a token. A bare mount here would be
      worse — it would offer machine-credential authentication to the staff routes below.
- [X] T028 [P] Write `backend/tests/api/route-auth.test.ts`: every `v1` route refuses an
      unauthenticated caller with `401`; the list reconciles against the mounted router so a route
      added later without an entry fails; **and the surfaces this phase did not touch still behave** —
      `/api/public/kb/categories` anonymous, `/api/tickets` still `401` on a staff token's absence.
      That last group is the assertion that would have caught the Phase 9 defect on the day.
- [X] T029 [P] Write `backend/tests/api/read-only.test.ts` reading `routes/v1/index.ts` and asserting
      **no non-`GET` route is mounted** (research D16). Widening the interface should be a visible
      diff, not a convenience.

**Checkpoint**: Schema, models, guard, paging and the realm exist. User stories can begin.

---

## Phase 3: User Story 1 — An external system reads data (Priority: P1) 🎯 MVP

**Goal**: An integrator with a credential and the documentation can read customers, tickets and
reporting figures over a versioned, paged, rate-limited interface.

**Independent Test**: Issue a credential; using only the published documentation, retrieve a
customer, a ticket and a reporting figure; confirm a request outside the credential's authority is
refused rather than silently narrowed, and that every response names the version.

### Tests for User Story 1

- [X] T030 [P] [US1] Write `backend/tests/api/versioning.test.ts`: every response carries
      `X-CRM-API-Version`; a client credential presented to the unversioned `/api/customers` is
      refused; a withdrawn version answers `410` listing current versions and never redirects.
- [X] T031 [P] [US1] Write `backend/tests/api/authority.test.ts`: a credential without
      `reports:view` gets **`403`, not `200` with an empty list** (US1 scenario 3); a credential
      without `reports:view_agents` gets **`404` on the agent report** — absent rather than
      present-and-withheld, matching Phase 10's decision on the same figures.
- [X] T032 [P] [US1] Write `backend/tests/api/parity.test.ts`: the same customer and the same ticket
      fetched through the internal service and through `/api/v1` agree on every shared field.
      Includes a merged ticket, which must answer `409` with the survivor's identifier rather than a
      copy of the survivor — a client receiving the copy would count the work twice.
- [X] T033 [P] [US1] Write `backend/tests/api/reporting-envelope.test.ts`: `count`, `total`,
      `excluded` and `reflects_current_state` all survive the trip, and **a suppressed figure carries
      `value: null`, never `0`**. Zero is a claim; null is an absence.
- [X] T034 [P] [US1] Write `backend/tests/api/no-rule-restatement.test.ts` — an import-graph read
      asserting no file under `backend/src/controllers/v1/` imports a model, and that presenters
      contain no query. Model the file on
      `backend/tests/reports/no-rule-restatement.test.ts`, **including its complement assertion**:
      run the patterns against a deliberately violating source so a typo cannot leave the check
      passing vacuously, which is how Phase 9's first egress check failed.
- [X] T035 [P] [US1] Write `backend/tests/api/errors.test.ts`: one envelope shape matching the
      internal one; `404` for both "no such record" and "outside your reach", so identifiers cannot
      be enumerated; `429` distinguishable from `403` with `Retry-After`.

### Implementation for User Story 1

- [X] T036 [US1] Create `backend/src/api/v1/schemas/` — zod schemas for list and detail parameters
      (`limit`, `cursor`, `since`, plus the ticket filters). These are also the OpenAPI source, so
      each field carries a description.
- [X] T037 [P] [US1] Create `backend/src/api/v1/presenters/customer.presenter.ts` — service output
      to the published shape, `snake_case`. No queries.
- [X] T038 [P] [US1] Create `backend/src/api/v1/presenters/ticket.presenter.ts`, including the SLA
      outcome **as recorded** by Phase 6 and the merged-ticket `409` shape. No recomputation.
- [X] T039 [P] [US1] Create `backend/src/api/v1/presenters/figure.presenter.ts` — Phase 10's figure
      envelope in `snake_case`, with every field preserved.
- [X] T040 [US1] Create `backend/src/controllers/v1/customers.controller.ts` — list and detail,
      gated on `customers:view`, calling `customer.service` only.
- [X] T041 [US1] Create `backend/src/controllers/v1/tickets.controller.ts` — list, detail, messages,
      gated on `tickets:view`.
- [X] T042 [US1] Create `backend/src/controllers/v1/reports.controller.ts` — volume, SLA, CSAT gated
      on `reports:view`; agents additionally on `reports:view_agents` and answering `404` when absent.
- [X] T043 [US1] Create `backend/src/controllers/v1/meta.controller.ts` — `whoami`, returning the
      credential's name and permissions. It exists because the first question behind every `403` is
      "what do I actually have?", and the alternative is asking us.
- [X] T044 [US1] Mount all of the above in `backend/src/routes/v1/index.ts` and extend
      `backend/tests/api/route-auth.test.ts`'s list so the reconciliation covers them.
- [X] T045 [US1] Apply per-credential rate limiting using `rateLimitKeyed` from
      `backend/src/lib/rate-limit.ts`, keyed on the client identifier, with
      `X-RateLimit-*` and `Retry-After` headers.
- [X] T046 [US1] Add `changedSince` support to `backend/src/services/customer.service.ts` and
      `ticket.service.ts` list options, and a keyset ordering mode. **Extend, do not fork** — a second
      list implementation is FR-010 broken on day one.
- [X] T047 [US1] Create `backend/src/api/openapi.ts` generating an OpenAPI 3.1 document from the T036
      schemas and the presenter response shapes.
- [X] T048 [US1] Serve the document at `GET /api/v1/openapi.json` from
      `backend/src/routes/v1/index.ts`, unauthenticated — an integrator needs it before they have a
      working credential, and it describes only shapes, never data.
- [X] T049 [P] [US1] Write `backend/tests/api/openapi.test.ts` asserting **every mounted `v1` route
      appears in the document** with its response referenced. Same reconciliation technique as
      Phase 10's `route-auth.test.ts`, which exists because Phase 9 shipped a defect the suite could
      not see.

**Checkpoint**: US1 complete — an external system can pull data. This is half of PLAN.md's Definition
of done and a working integration on its own.

---

## Phase 4: User Story 2 — Lifecycle notifications (Priority: P2)

**Goal**: A subscribed system is told, within seconds and verifiably, when a ticket or customer
reaches a lifecycle point — without the agent's action waiting for it and without losing an event.

**Independent Test**: Register a subscription against a test receiver, resolve a ticket through the
normal agent screen, and confirm exactly one notification arrives, its signature verifies, and a
tampered copy fails verification.

### Tests for User Story 2

- [X] T050 [P] [US2] Write `backend/tests/webhooks/outbox.test.ts`: the event row is written **inside
      the causing transaction** — a rolled-back change leaves no event, and a committed one always
      leaves exactly one. These are the two asymmetric failures research D7 exists to prevent.
- [X] T051 [P] [US2] Write `backend/tests/webhooks/signing.test.ts`: the signature verifies over
      `<t>.<raw body>`; a single-byte alteration fails it (SC-014); a stale timestamp is rejected; and
      during rotation **both** secrets verify.
- [X] T052 [P] [US2] Write `backend/tests/webhooks/payload-content.test.ts` asserting **no record
      content ever reaches a payload** (FR-028) — build the fixture with distinctive subject, body and
      customer-name strings and search every generated payload for them. A search, not a review.
- [ ] T053 [P] [US2] Write `backend/tests/webhooks/retry.test.ts`: the backoff schedule; `5xx` and
      timeouts retried; a non-`408`/`429` `4xx` **not** retried; exhaustion leaves the event
      `abandoned` and retained (FR-033); due-ness survives a simulated restart because it is a column.
- [ ] T054 [P] [US2] Write `backend/tests/webhooks/non-blocking.test.ts`: resolving a ticket takes the
      same time with a subscription pointed at an unresponsive receiver as with none (SC-012).
- [ ] T055 [P] [US2] Write `backend/tests/webhooks/authority.test.ts`: no notification is delivered to
      a subscription whose owning credential does not cover the record (FR-037) — the notification is
      itself a disclosure that the record exists.
- [X] T056 [P] [US2] Write `backend/tests/webhooks/redirect.test.ts`: a `3xx` is recorded as a failure
      with that reason and **not followed** (FR-035), because a public endpoint answering
      `302 http://169.254.169.254/` would otherwise walk the address guard past itself.

### Implementation for User Story 2

- [X] T057 [US2] Create `backend/src/integrations/outbox.ts` — `record(event, transaction)`, which
      **requires** a transaction argument so it cannot be called outside one.
- [X] T058 [US2] Write outbox rows at the existing `ticket.created` and resolved-transition emission
      points that `backend/src/automation/events.ts` already feeds. **Observe, do not add new
      transition points** (FR-065).
- [X] T059 [US2] Write the `customer.created` outbox row inside
      `backend/src/services/customer.service.ts`'s existing create transaction.
- [X] T060 [US2] Create `backend/src/integrations/signing.ts` — HMAC-SHA256 over `<t>.<raw body>`.
      **Sign the exact string that is sent**: serialising twice is the standard way this breaks,
      because key order is not guaranteed to match.
- [X] T061 [US2] Create `backend/src/integrations/delivery.ts` — one attempt: `assertPubliclyRoutable`
      at delivery time (DNS rebinding), `fetch` with `AbortSignal.timeout`, no redirect following,
      classify permanent vs transient, record the outcome and an actionable `failure_reason`.
- [X] T062 [US2] Create `backend/src/services/webhook-delivery.service.ts` — enqueue per matching
      subscription, **claim by conditional update** so two ticks cannot take one attempt, apply the
      backoff, abandon after the last try.
- [X] T063 [US2] Extend `backend/src/lib/scheduler.ts` with the delivery sweep. Follow the file's own
      discipline — **written so that missing a tick is harmless** — and start it from `server.ts`
      only, never `app.ts`, or the timer leaks into every test run.
- [X] T064 [US2] Create `backend/src/services/webhook-subscription.service.ts` — create, rotate the
      signing secret with an overlap, revoke; HTTPS and `assertPubliclyRoutable` at save; the secret
      shown once.
- [X] T065 [US2] Create `backend/src/controllers/admin/subscriptions.controller.ts` and routes under
      `backend/src/routes/admin/index.ts`, gated on `integrations:manage`.
- [ ] T066 [P] [US2] Create `frontend/src/views/admin/integrations/SubscriptionListView.vue` and its
      router entry behind `integrations:manage`.
- [ ] T067 [P] [US2] Add `integrations.subscriptions.*` keys to `frontend/src/locales/en.json` and
      `frontend/src/locales/ar.json`, flat dotted
      keys. Include the address-refusal reasons and the health labels — those are the strings most
      likely to be left in English because a developer sees them least.

**Checkpoint**: US1 + US2 complete — PLAN.md's Definition of done is met.

---

## Phase 5: User Story 3 — Credential management (Priority: P3)

**Goal**: An administrator can issue, rotate and revoke credentials, and see what each has been
reaching, without ever being able to retrieve a secret.

**Independent Test**: Create a credential and confirm the secret is shown once and never again;
rotate it while an integration uses the old secret and confirm no request fails; revoke it and
confirm the next request is refused.

### Tests for User Story 3

- [ ] T068 [P] [US3] Write `backend/tests/integrations/credential-lifecycle.test.ts`: the secret is
      unretrievable after creation through every surface (SC-008); **a request loop across a rotation
      sees zero failures** (SC-009); revocation refuses the very next request (SC-010).
- [ ] T069 [P] [US3] Write `backend/tests/integrations/grant-authority.test.ts`: an administrator
      cannot grant a credential a permission they do not hold (FR-020), checked **at grant time**; and
      the granting administrator later losing authority does **not** revoke the credential (FR-023,
      research D5) — the client's authority is its own.
- [ ] T070 [P] [US3] Write `backend/tests/integrations/audit.test.ts`: creation, rotation, scope
      change and revocation each audited and attributable to the administrator; interface requests
      attributable to the **client**, not to whoever created it.
- [ ] T071 [P] [US3] Write `backend/tests/integrations/redaction.test.ts` (SC-024): issue a credential
      and a signing secret with distinctive values, exercise every surface, then search request logs,
      audit rows, error bodies and the administration API for those strings. Zero hits.
- [X] T072 [US3] Extend `backend/src/services/api-client.service.ts` with `issue`, `rotate` (inserting
      a new secret row and expiring the old at now + overlap), `revoke`, and scope changes — each
      writing its audit record.
- [X] T073 [US3] Create `backend/src/controllers/admin/api-clients.controller.ts` and routes, gated on
      `integrations:manage`. The create response is the **only** place a secret appears.
- [ ] T074 [P] [US3] Create `frontend/src/views/admin/integrations/ApiClientListView.vue` — the secret
      shown once with an explicit warning, a copy control, and no reveal afterwards. Shows
      `last_used_at` and the granted permissions.
- [ ] T075 [P] [US3] Create `frontend/src/services/integrations.service.ts`. All HTTP here; no
      component calls `fetch` (Principle III).
- [ ] T076 [P] [US3] Add `integrations.clients.*` keys to `frontend/src/locales/en.json` and
      `frontend/src/locales/ar.json`, including the shown-once secret warning.

**Checkpoint**: Credentials are survivable for years, not just issuable once.

---

## Phase 6: User Story 4 — ERP customer synchronisation (Priority: P4)

**Goal**: Customer records stay in step with an ERP through one adapter contract, with a preview
before anything is written and no human edit silently overwritten.

**Independent Test**: With simulator records covering a new customer, a changed field and a field
edited here more recently, run the preview and confirm all three are classified correctly; approve,
and confirm the human edit was not overwritten without being reported.

### Tests for User Story 4

- [X] T077 [P] [US4] Write `backend/tests/erp/contract-conformance.test.ts` — a suite exercising the
      `ErpAdapter` contract, run against the simulator and **written to be re-run against a real
      adapter unchanged**. The contract is what is tested, not one implementation of it.
- [X] T078 [P] [US4] Write `backend/tests/erp/preview.test.ts`: a preview writes nothing, and its
      classification matches what the subsequent run applies (SC-017). A preview that disagrees with
      the run is worse than none, because it was trusted.
- [X] T079 [P] [US4] Write `backend/tests/erp/human-edit.test.ts` — **the most important test in this
      phase** (SC-018, FR-043). A field a person edited after the last sync is preserved, or replaced
      with the before-and-after recorded and visible. Never silently changed. This is the failure
      where everything succeeds, every screen works, and an agent's correction is gone.
- [X] T080 [P] [US4] Write `backend/tests/erp/skip-reasons.test.ts`: a record missing a required field
      and a record failing this system's own validation are both skipped **with a stated reason**, and
      the rest of the run completes (FR-046, FR-047).
- [X] T081 [P] [US4] Write `backend/tests/erp/resume.test.ts`: a run interrupted part way is retryable
      to completion with no duplicate customer and no reapplied update (SC-019).
- [X] T082 [P] [US4] Write `backend/tests/erp/concurrency.test.ts`: a second concurrent run for the
      same adapter is refused **at the database** (FR-048), not by a check that could race.
- [X] T083 [P] [US4] Write `backend/tests/erp/unavailable.test.ts`: an unreachable ERP fails the run
      visibly and **changes nothing**. Half a sync against an ERP that then vanished is worse than
      none, because nobody knows how far it got.

### Implementation for User Story 4

- [X] T084 [US4] Create `backend/src/erp/types.ts` — **the adapter contract**, exactly as
      [contracts/erp-adapter-contract.md](./contracts/erp-adapter-contract.md) declares it, plus
      `ErpUnavailableError` and `ErpRecordInvalidError`. The only thing sync and order display depend
      on (FR-039b).
- [X] T085 [US4] Create `backend/src/erp/simulator.ts` covering **all nine cases** the contract's
      section 6 lists, and a failure mode it can be put into on demand — a simulator that always
      succeeds cannot test the three requirements about an unreachable ERP.
- [X] T086 [US4] Create `backend/src/erp/registry.ts` — `env.ERP_PROVIDER` selects the adapter,
      mirroring `channels/registry.ts`. **Provider from the environment because it decides which code
      runs; enablement from the database because an administrator changes it at runtime.** Implement
      `describe()` with `isSimulated`, and refuse to reach the simulator when a real adapter is
      configured (FR-039a).
- [X] T087 [US4] Create `backend/src/erp/field-ownership.ts` — the per-field ownership declaration
      (FR-042). **Ship it with a documented default and a comment that the real answer is an
      operational decision** (research open question 4), so a wrong default is visible rather than
      buried in a service.
- [X] T088 [US4] Create `backend/src/services/erp-sync.service.ts` — preview and apply over one code
      path, idempotent upsert by `external_id`, the `last_synced_values` three-way comparison for
      human-edit detection, conflict recording with before/after, resumption from the stored cursor,
      and `isArchived` reported rather than deactivating (FR-050).
- [X] T089 [US4] Create `backend/src/controllers/admin/erp-sync.controller.ts` and routes gated on
      `erp:sync`; run detail and per-record outcomes gated on `integrations:manage`.
- [ ] T090 [P] [US4] Create `frontend/src/views/admin/integrations/ErpSyncView.vue` — preview, run,
      history, per-record skips with reasons, and **the active adapter shown prominently with a
      simulated warning when `isSimulated`**. An agent trusting simulated data is this phase's easiest
      quiet failure.
- [ ] T091 [P] [US4] Add `integrations.erp.*` keys to `frontend/src/locales/en.json` and
      `frontend/src/locales/ar.json`, including every skip reason
      and the simulated-adapter warning.

**Checkpoint**: Synchronisation works for any ERP implementing the contract, proven against the
simulator.

---

## Phase 7: User Story 5 — Order history on the customer screen (Priority: P5)

**Goal**: An agent sees a customer's ERP orders while working the ticket, with the source and
freshness stated, and a clear distinction between "no orders" and "cannot reach the ERP".

**Independent Test**: Open a customer with known simulator orders and confirm they appear with source
and refresh time; put the simulator into failing mode and confirm the screen distinguishes cannot-reach
from no-orders while the rest of the page still works.

- [ ] T092 [P] [US5] Write `backend/tests/erp/orders.test.ts`: orders returned with source and
      retrieval time; **an unreachable ERP returns a distinct state, not an empty array** (FR-054); an
      unlinked customer returns a stated absence of a link (FR-055); an agent without authority over
      the customer is refused on the same basis as the rest of the record (FR-056).
- [ ] T093 [US5] Create `backend/src/services/erp-order.service.ts` — read-through with a 60-second
      TTL and a 5-second hard timeout (research D14). The cache is short because order status is what
      the customer is phoning about.
- [ ] T094 [US5] Create `backend/src/controllers/customers/orders.controller.ts` and mount
      `GET /api/customers/:id/orders` inside the existing customers router, so it inherits that
      record's authority rather than declaring its own.
- [ ] T095 [P] [US5] Create `frontend/src/components/customers/CustomerOrders.vue` — **its own
      request**, so a slow ERP cannot slow the customer page and an unreachable one cannot fail it
      (FR-057). Three distinct states: orders, no orders, cannot reach. Failure announced to a screen
      reader, not only styled. Amounts and dates through `vue-i18n`.
- [ ] T096 [US5] Wire it into `frontend/src/views/customers/CustomerProfileView.vue`.
- [ ] T097 [P] [US5] Add `customers.orders.*` keys to `frontend/src/locales/en.json` and
      `frontend/src/locales/ar.json`, including the cannot-reach
      and not-linked states.
- [ ] T098 [P] [US5] Write `frontend/tests/integrations/customer-orders.test.ts` asserting all three
      states render distinctly — the empty state and the failure state must not be the same component
      output, which is exactly the bug FR-054 describes.

**Checkpoint**: The operational payoff of US4 is on the screen an agent already uses.

---

## Phase 8: User Story 6 — Failures are visible and actionable (Priority: P6)

**Goal**: An administrator can see which integrations are healthy, why a delivery failed, and re-send
it once the receiver is fixed.

**Independent Test**: Cause a delivery to fail every retry, confirm it appears with its reason, fix
the receiver, re-send it, and confirm it succeeds and is marked as re-sent.

- [ ] T099 [P] [US6] Write `backend/tests/integrations/overview.test.ts`: a failing subscription is
      identifiable **without reading individual delivery records** (SC-022); a skipped sync record
      states its reason; and a supervisor without `integrations:manage` is refused (FR-061).
- [ ] T100 [P] [US6] Write `backend/tests/webhooks/resend.test.ts`: a re-send carries the **original**
      `event_id` so a receiver can recognise it, and is recorded as re-sent by that administrator
      (FR-059).
- [ ] T101 [US6] Implement health derivation in
      `backend/src/services/webhook-subscription.service.ts` from recent attempts, writing the
      `health` enum. Derived and stored, so the screen reads a value rather than computing one per
      render.
- [ ] T102 [US6] Create `backend/src/controllers/admin/integrations-overview.controller.ts` and
      routes — subscription health, abandoned events with reasons, recent sync runs.
- [ ] T103 [US6] Add the re-send endpoint to `webhook-delivery.service.ts` and the controller,
      creating a fresh attempt against the existing event.
- [ ] T104 [P] [US6] Create `frontend/src/views/admin/integrations/IntegrationsOverviewView.vue` —
      health as **icon plus text label, never colour alone** (FR-064), abandoned deliveries with their
      reasons, and a keyboard-reachable re-send.
- [ ] T105 [P] [US6] Add `integrations.overview.*` keys to `frontend/src/locales/en.json` and
      `frontend/src/locales/ar.json`, including the four health labels.

**Checkpoint**: All six stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

### Automatable

- [ ] T106 [P] Extend `frontend/tests/locales.test.ts` with the `integrations.*` and
      `customers.orders.*` namespaces, following the Phase 9 and Phase 10 pattern: assert both files
      hold identical key sets and that the failure-state strings are actually translated rather than
      copied from English.
- [ ] T107 [P] Add the retention prune to `backend/src/lib/scheduler.ts` for
      `integration_events`, `webhook_delivery_attempts`, `erp_sync_runs` and `erp_sync_records` at
      `INTEGRATION_RETENTION_DAYS`, plus a test. A sweep, so missing a tick stays harmless.
- [ ] T108 [P] Write `backend/tests/integrations/disabled.test.ts` (FR-067, SC-026): with
      `INTEGRATIONS_ENABLED=false`, `/api/v1/*` answers `404` rather than `401` — absent, not
      refusing — no delivery sweep runs, and the Phase 0–10 suite passes unchanged.
- [ ] T109 [P] Update `README.md` with the integrations section: the two permission keys, that the
      published interface is read-only and versioned in the path, that payloads carry identifiers
      rather than records and why, that delivery is at-least-once and unordered, the address rule and
      **that it is the inverse of Phase 9's**, and that `ERP_PROVIDER=simulator` means the order data
      an agent sees is not real.
- [ ] T110 [P] Add a "Where do I add… an endpoint to the published interface?" entry to `README.md`:
      schema, presenter, controller that may not import a model, route, the route-auth list, and the
      OpenAPI reconciliation — so the next person satisfies FR-010 by following the path rather than
      by remembering it.
- [ ] T111 Confirm the authorization matrix passes with both new keys probed, and that no reporting
      or ticket permission changed meaning. A full run of
      `backend/tests/authorization.matrix.test.ts`.

### Inherently human

- [ ] T112 Bilingual and RTL pass over all four administration screens and the order panel, in both
      directions. Check the failure states specifically — health labels, address refusals, the
      cannot-reach-the-ERP state — because those are the strings a developer sees least and the ones
      most likely to be left in English.
- [ ] T113 WCAG 2.1 AA pass over the same screens in both languages. Two specifics this phase forces:
      subscription health must not be colour alone, and the order panel's failure must be announced
      rather than only styled.
- [ ] T114 **Hand the OpenAPI document and a fresh credential to somebody who has not read this
      repository** and see whether they make a successful request inside 30 minutes (SC-001). This is
      the only real test of FR-006 and it cannot be automated — the failure mode is documentation that
      is complete and unusable.
- [ ] T115 **Name the ERP with operations, and fill in the field-ownership table** (research open
      question 4). Which system owns `email` versus `taxId` is a business decision, and T087's default
      is a placeholder with a comment saying so. Getting it wrong means either agents' corrections
      being reverted nightly or the ERP being permanently stale.
- [ ] T116 Decide whether multi-process delivery is in scope for this deployment (research open
      question 1). One instance is assumed; two would double-fire. At-least-once makes it survivable
      rather than correct, and a lock is the answer if it is needed.
- [ ] T117 Measure delivery at volume: SC-011's "99% within 30 seconds" is asserted here against a
      handful of events. A subscription fanning out thousands needs its own measurement, in the shape
      of Phase 10's `backend/tests/reporting/volume-benchmark.ts` — including its refusal to run
      against a non-throwaway schema.
- [ ] T118 Run [quickstart.md](./quickstart.md) end to end, **starting with Scenario 0**. The
      feature-disabled check is the one most likely to be quietly false by the end and hardest to
      retrofit.

---

## Dependencies & Execution Order

### Phase Dependencies

- **T001 blocks everything.** It is a governance gate, not a code task.
- **Setup (Phase 1)**: after T001. T003, T004 are `[P]`; T005 needs T004; T006 needs T005; T007 needs
  T004.
- **Foundational (Phase 2)**: after Setup. **Blocks all six stories.**
- **User Stories (Phases 3–8)**: all depend on Foundational only. After that they can run in parallel
  or in priority order.
- **Polish (Phase 9)**: after the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. Fully independent.
- **US2 (P2)**: Foundational only. Independent of US1 — but a receiver following the contract will
  fetch through US1's interface, so shipping US2 without US1 delivers notifications a receiver cannot
  act on. Ship US1 first.
- **US3 (P3)**: Foundational only. US1 needs *a* credential; US3 is what makes credentials
  survivable.
- **US4 (P4)**: Foundational only. Genuinely independent of US1–US3.
- **US5 (P5)**: needs US4's adapter contract (T084) and registry (T086). Not the sync itself — orders
  are read directly.
- **US6 (P6)**: needs US2 for deliveries to observe and US4 for runs to observe. Last for that
  reason.

### Within each story

- Tests before implementation, and **failing first**. A test that passes before the code exists is
  testing nothing.
- Migrations → models → services → controllers → routes → frontend.
- Locale keys can go in parallel with the view that uses them, but both before the story's checkpoint.

### Parallel opportunities

- **Phase 2**: T009, T010, T012, T013 (different migration files); T015–T018 (different model files);
  T022, T024, T028, T029 (different test files). T019 is sequential — one file, and it is the one
  where a forgotten column disappears silently.
- **Phase 3**: T030–T035 all `[P]`; T037–T039 all `[P]`.
- **Phase 4**: T050–T056 all `[P]`.
- **Phase 6**: T077–T083 all `[P]`.
- **Across stories**: once Phase 2 completes, US1, US2, US3 and US4 can be staffed simultaneously.

---

## Parallel Example: User Story 1

```bash
# All six US1 tests together — different files, no shared state:
Task: "Write backend/tests/api/versioning.test.ts"
Task: "Write backend/tests/api/authority.test.ts"
Task: "Write backend/tests/api/parity.test.ts"
Task: "Write backend/tests/api/reporting-envelope.test.ts"
Task: "Write backend/tests/api/no-rule-restatement.test.ts"
Task: "Write backend/tests/api/errors.test.ts"

# Then all three presenters together:
Task: "Create backend/src/api/v1/presenters/customer.presenter.ts"
Task: "Create backend/src/api/v1/presenters/ticket.presenter.ts"
Task: "Create backend/src/api/v1/presenters/figure.presenter.ts"
```

> **One caution about running the backend suite in parallel.** This project shares a single
> `crm_support_test` schema with `fileParallelism: false`. Two concurrent `vitest` runs — or a killed
> run leaving an open transaction — produce phantom `401`/`403` failures across unrelated files, for a
> reason that looks nothing like the cause. The warning is at
> `backend/tests/helpers/database.ts:112`. Parallelise the *writing*, not the *running*.

---

## Implementation Strategy

### MVP (US1 only)

1. T001 — the gate. Without it nothing else may start.
2. Phase 1 Setup, Phase 2 Foundational.
3. Phase 3 US1.
4. **Stop and validate**: quickstart Scenario 0, then Scenario 1.
5. An external system can pull data. That is a working integration and half the Definition of done.

### Incremental delivery

1. Setup + Foundational → the realm exists and refuses everyone.
2. **US1** → an external system reads. *(MVP)*
3. **US2** → it is told when things change. **PLAN.md's Definition of done is now met.**
4. **US3** → credentials survive rotation and revocation. Ship before the first real integrator, not
   after.
5. **US4** → ERP synchronisation, against the contract.
6. **US5** → orders on the customer screen. The reason US4 was worth doing.
7. **US6** → the failures become visible instead of silent.

### Where to stop, if you must

**After US3.** US1–US3 is a complete, defensible integration surface: readable, notifying, and
operable for years. US4–US6 are the ERP half, and Clarifications Q1 already deferred naming the
product — so stopping there leaves nothing half-built, just a contract nobody has implemented yet.

Stopping after US2 is the tempting line because it satisfies the Definition of done. Resist it: a
credential that cannot be rotated without downtime is one nobody rotates, and that becomes somebody
else's problem in a year.

---

## Notes

- 118 tasks. `[P]` means different files and no dependency on incomplete work.
- **T001 is a gate, not a task to be worked around.** If approval is withheld, proposal section 6 has
  the fallback and it changes the plan.
- **T079 is the test to run by hand every time** — the human-edit overwrite is the phase's most
  damaging quiet failure.
- **T034, T022, T029 and T049 are static-read checks, and each needs its complement assertion.** Phase
  9's first egress check passed vacuously on Windows because `path.resolve` returns backslashes and
  the pattern used forward slashes. Prove a check bites by deliberately breaking what it protects,
  then restore.
- Commit per task or per logical group. Stop at any checkpoint and validate the story alone.
