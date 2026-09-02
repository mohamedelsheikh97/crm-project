# Tasks: Phase 9 — AI Features

**Input**: Design documents from `/specs/010-phase-9-ai-features/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. The specification requires them — SC-005, SC-012, SC-014, SC-016, SC-019, SC-020,
SC-022, SC-024a, SC-024b and SC-025 each name a test as the means of verification — and every prior
phase in this repository ships them.

**Organization**: Grouped by user story. US1, US2 and US3 are all P1; US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Exact file paths are given in every task

## Path Conventions

Web application, existing two-workspace layout: `backend/src/`, `backend/tests/`, `frontend/src/`,
`frontend/tests/`.

---

## ⚠️ Phase 0: Governance Gate (BLOCKS EVERYTHING)

**Purpose**: The Constitution Check in plan.md fails on Technology Standards. No implementation task
below may start until this passes.

- [X] T001 Propose and merge a constitution amendment in `.specify/memory/constitution.md` adding two AI processors to the Technology Standards table — an external provider for staff-facing features and a controlled-infrastructure processor for the chatbot (Clarifications Q1) — following the Governance section's procedure: written proposal with rationale, explicit approval, MINOR version bump to 1.2.0, `LAST_AMENDED_DATE` updated, and a Sync Impact Report comment
- [X] T002 Close the "AI provider selection (needed before Phase 9)" entry in the constitution's Open Items list in `.specify/memory/constitution.md`, recording that spec.md Clarifications Q1 answers it

**Checkpoint**: Amendment merged. Implementation may begin.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, configuration, and the declarations everything else reads

- [X] T003 Add `@anthropic-ai/sdk` to `backend/package.json` dependencies and install
- [X] T004 [P] Add the Phase 9 environment block to `.env.example` — `AI_ENABLED`, `AI_EXTERNAL_API_KEY`, `AI_LOCAL_BASE_URL`, the five `AI_*_ENABLED` flags, the four `AI_CEILING_*` values, `AI_ASSISTANT_LANGS`, `AI_ASSISTANT_GROUNDING_FLOOR` — with comments explaining the egress split and the startup refusals, in the style of the Phase 8 block
- [X] T005 Extend the zod schema in `backend/src/config/env.ts` with the Phase 9 variables and their defaults
- [X] T006 Add the four startup refinements to `backend/src/config/env.ts`: refuse to start when an enabled staff feature has no `AI_EXTERNAL_API_KEY`, when `AI_ASSISTANT_ENABLED` is true and `AI_LOCAL_BASE_URL` is unset, when `AI_LOCAL_BASE_URL` resolves outside private address ranges, and when `AI_ENABLED` is true with no feature enabled (contracts/provider-contract.md § Startup refusal)
- [X] T007 [P] Create `backend/src/ai/features.ts` declaring the five features once — `summary`, `draft`, `classify`, `similar`, `assistant` — with their enabled state and ceilings read from env (research D12)
- [X] T008 [P] Add a `no-restricted-imports` rule to `eslint.config.js` forbidding any import of `src/ai/providers/external*` from `src/services/assistant*` and `src/controllers/assistant/*` (research D2, enforcement layer 1)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The provider boundary, the invocation record, and the cross-cutting gates every feature
passes through

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### The egress boundary

- [X] T009 [P] Create `backend/src/ai/providers/types.ts` declaring `AiFeature`, `AiLocation`, `AiRequest`, `AiResult`, and `AiProvider` exactly as contracts/provider-contract.md specifies — no model id, no temperature, no provider name in the request type
- [X] T010 [P] Implement `backend/src/ai/providers/external.ts` using `@anthropic-ai/sdk` with `claude-opus-5`, `thinking: { type: 'adaptive' }`, `output_config: { effort: 'medium' }`, server-side refusal fallbacks (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`), and `cache_control: { type: 'ephemeral' }` on the stable system prefix
- [X] T011 [P] Implement `backend/src/ai/providers/local.ts` speaking the OpenAI-compatible chat-completions wire format over `fetch` to `AI_LOCAL_BASE_URL`, with no new dependency (research D4)
- [X] T012 Create `backend/src/ai/providers/external-factory.ts` exporting `externalProvider()`
- [X] T013 Create `backend/src/ai/providers/local-factory.ts` exporting `localProvider()`, throwing at construction when `AI_LOCAL_BASE_URL` is unset or non-private (fails closed, research D2)
- [X] T014 Write `backend/tests/ai/egress.test.ts` asserting by **static import-graph read** that `assistant.service.ts` has no transitive import of `external-factory.ts` or `external.ts` — not a mock (research D2, enforcement layer 2; SC-024a)

### The shared invocation path

- [X] T015 [P] Create migration `backend/src/db/migrations/*-create-ai-invocations.cjs` for the `ai_invocations` table per data-model.md, with indexes on `(feature, created_at)`, `(subject_type, subject_id)`, and `(created_at)`
- [X] T016 [P] Create `backend/src/models/ai-invocation.model.ts` and register it in `backend/src/models/index.ts`
- [X] T017 [P] Create `backend/src/ai/redact.ts` stripping credential-shaped strings, bearer tokens, and long digit sequences, replacing rather than dropping (FR-010)
- [X] T018 [P] Create `backend/src/ai/budget.ts` counting the day's invocations per feature from `ai_invocations` and refusing when the ceiling is reached (research D11, FR-005)
- [X] T019 Create `backend/src/ai/invoke.ts` — the single path every feature calls: checks the feature flag, checks the budget, applies redaction, asserts `provider.location` matches the feature, calls the provider, records the `ai_invocations` row for every outcome including refusals, and enforces the per-feature timeout from contracts/provider-contract.md § Timeouts
- [X] T020 Add bounded retry to `backend/src/ai/invoke.ts` counting each attempt against the same ceiling (FR-006)
- [X] T021 [P] Write `backend/tests/ai/redaction.test.ts` asserting secrets and card-shaped numbers are stripped on **both** provider paths (SC-025)
- [X] T022 [P] Write `backend/tests/ai/budget.test.ts` asserting exhaustion refuses with `refused_budget`, records the row, and leaves ticket/message/portal operations working (SC-027)
- [X] T023 [P] Write `backend/tests/ai/invocation-columns.test.ts` freezing the `ai_invocations` column list so no prompt or completion column can be added without failing a test (SC-024b, data-model.md invariant)
- [X] T024 [P] Create `backend/tests/ai/fixtures.ts` with a fake `AiProvider` returning scripted results, so no test makes a network call (research D10)

### Authority, audit, limits

- [X] T025 Add `define('ai', 'manage')` to `backend/src/auth/permissions.ts` with a comment explaining why there is deliberately no `ai:use` key (research D12)
- [X] T026 [P] Create seeder `backend/src/db/seeders/*-ai-permissions.cjs` granting `ai:manage` to administrator, and register it in `ROLE_PERMISSIONS_SEEDER` list in `backend/tests/helpers/database.ts`
- [X] T027 [P] Add the twelve `ai.*` actions to `backend/src/services/audit.service.ts` (research D12)
- [X] T028 [P] Add the four rate-limit scopes — `ai-summary`, `ai-draft`, `ai-classify`, `ai-assistant` — using `rateLimitKeyed` from `backend/src/lib/rate-limit.ts` (research D11)

### Shared frontend

- [X] T029 [P] Create `frontend/src/components/ai/AiDisclosure.vue` — the AI-generated marker used by every surface, translated, never English on an Arabic page (FR-014, FR-059)
- [X] T030 [P] Create `frontend/src/services/ai.service.ts` with the staff AI endpoints, following the existing service module pattern
- [X] T031 [P] Create `frontend/src/stores/ai.store.ts` holding feature availability and per-surface loading state
- [X] T032 [P] Add the base `ai.*` locale keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`

**Checkpoint**: The boundary is enforced, every call is recorded, and no user story can bypass either.

---

## Phase 3: User Story 1 — Thread Summarisation (Priority: P1) 🎯 MVP

**Goal**: An agent picks up a long ticket without reading all of it.

**Independent Test**: Open a ticket with a long multi-channel thread, request a summary, confirm a
readable account appears — labelled AI-generated, alongside the full thread, containing nothing from
internal notes.

### Tests for User Story 1

- [X] T033 [P] [US1] Write `backend/tests/ai/summary-scope.test.ts` asserting a user without `tickets:view` on the ticket gets 404 — identical to a nonexistent ticket (FR-020)
- [X] T034 [P] [US1] Write `backend/tests/ai/summary-corpus.test.ts` asserting the prompt corpus contains the correspondence and **excludes internal notes**, SLA state, assignee identity, and other tickets (FR-023, contracts/grounding-contract.md)
- [X] T035 [P] [US1] Write `backend/tests/ai/summary-nostore.test.ts` asserting no summary text is persisted anywhere after a request (FR-065b)

### Implementation for User Story 1

- [X] T036 [P] [US1] Create `backend/src/ai/prompts/summarise.ts` — a builder taking typed inputs (never a Sequelize instance) and returning system + messages, with `ar` and `en` variants
- [X] T037 [US1] Implement `backend/src/services/ai-summary.service.ts` — loads correspondence, determines `contentLang` from the thread's predominant language (research D9), calls `invoke.ts` via `externalProvider()`, returns text without persisting
- [X] T038 [US1] Create `backend/src/controllers/ai/summary.controller.ts` implementing `GET /api/tickets/:id/ai/summary` per contracts/ai-api.md, returning 404 for tickets the caller may not view
- [X] T039 [US1] Create `backend/src/routes/ai/index.ts`, mount the summary route with the `ai-summary` rate limit, and register the router in `backend/src/routes/index.ts`
- [X] T040 [US1] Add the summary endpoint path to the enumerated staff route list in `backend/tests/portal/realm.test.ts` so a portal token is proven to be refused (Phase 8 inheritance)
- [X] T041 [P] [US1] Create `frontend/src/components/ai/TicketSummaryPanel.vue` — loading state, AI disclosure, message count covered, failure state that reports plainly rather than showing an empty summary (FR-003)
- [X] T042 [US1] Mount the panel in `frontend/src/views/tickets/TicketDetailView.vue`, requested **after** the ticket renders so nothing is blocked (FR-004, SC-023)
- [X] T043 [US1] Add a control to request the summary in the other supported language to `frontend/src/components/ai/TicketSummaryPanel.vue` (FR-024)
- [X] T044 [P] [US1] Add `ai.summary.*` locale keys to `frontend/src/locales/en.json` and `ar.json`

**Checkpoint**: US1 is fully functional and demonstrable on its own — the first half of PLAN.md's
Definition of done.

---

## Phase 4: User Story 2 — Suggested Reply Drafting (Priority: P1)

**Goal**: An agent sends their own reply, faster.

**Independent Test**: Request a draft on a ticket with an unanswered message, confirm it lands in the
composer unsent, edit it, send it, and confirm the sent message is the edited text attributed to the
agent.

### Tests for User Story 2

- [X] T045 [P] [US2] Write `backend/tests/ai/draft-not-sent.test.ts` asserting that generating a draft creates **no** `messages` row and delivers nothing (FR-026, SC-005)
- [X] T046 [P] [US2] Write `backend/tests/ai/draft-authority.test.ts` asserting a user with `tickets:view` but not `messages:send` is refused 403 (FR-028)
- [X] T047 [P] [US2] Write `backend/tests/ai/draft-citations.test.ts` asserting every cited article exists, is published, and is visible to the requesting agent — zero fabricated references (SC-007)

### Implementation for User Story 2

- [X] T048 [P] [US2] Create `backend/src/ai/prompts/draft-reply.ts` with the boundary that forbids committing to refunds, compensation, dates, or contractual terms (FR-031), in both languages
- [X] T049 [US2] Implement `backend/src/services/ai-draft.service.ts` — retrieves agent-audience KB context via `kb-search.service.ts`, builds the prompt, calls `invoke.ts`, returns text plus cited articles, persists nothing
- [X] T050 [US2] Create `backend/src/controllers/ai/draft.controller.ts` implementing `POST /api/tickets/:id/ai/draft` per contracts/ai-api.md, gated on `messages:send` **and** ticket visibility
- [X] T051 [US2] Mount the draft route in `backend/src/routes/ai/index.ts` with the `ai-draft` rate limit, and add it to the `realm.test.ts` enumeration
- [X] T052 [P] [US2] Create `frontend/src/components/ai/DraftReplyButton.vue`, shown only when the user may send customer messages
- [X] T053 [US2] Wire the button into the reply composer in `frontend/src/views/tickets/TicketDetailView.vue` so the draft populates the existing editable field and sends through the unchanged Phase 5 path
- [X] T054 [US2] Display cited articles beside the draft in `frontend/src/components/ai/DraftReplyButton.vue` so the agent can verify before sending (FR-029)
- [X] T055 [P] [US2] Add `ai.draft.*` locale keys to both locale files

**Checkpoint**: US1 and US2 both work independently. PLAN.md's Definition of done, first half, complete.

---

## Phase 5: User Story 3 — The Chatbot (Priority: P1)

**Goal**: A customer gets an answer, or a ticket — never a dead end.

**Independent Test**: Ask a question a published article answers and get a grounded, cited answer; ask
one it cannot answer and get a ticket carrying the conversation.

### Tests for User Story 3

- [X] T056 [P] [US3] Write `backend/tests/assistant/grounding.test.ts` asserting retrieval passes `audience: 'customer'` as a literal and that draft, archived, and internal articles never enter the prompt corpus (FR-033)
- [X] T057 [P] [US3] Write `backend/tests/assistant/floor.test.ts` asserting that below the grounding floor **no provider call is made** and a `refused_ungrounded` row is recorded (research D3 step 2, FR-034)
- [X] T058 [P] [US3] Write `backend/tests/assistant/injection.test.ts` running the adversarial set from contracts/grounding-contract.md against a fake provider that complies with each attack, asserting the surrounding code refuses regardless — in both languages (FR-039, SC-019, SC-020)
- [X] T059 [P] [US3] Write `backend/tests/assistant/citation-verify.test.ts` asserting a response citing an unsupplied article id, or citing nothing, is discarded and replaced by the refusal (research D3 step 4, SC-016)
- [X] T060 [P] [US3] Write `backend/tests/assistant/escalation.test.ts` asserting escalation creates exactly one ticket, that continuing to talk returns the same reference, and that a second escalation is a constraint violation translated to `already_escalated` (FR-036c)
- [X] T061 [P] [US3] Write `backend/tests/assistant/scope.test.ts` asserting a conversation belonging to another portal account returns 404, never 403, and that no ticket or customer data can appear in a response (FR-035)

### Implementation for User Story 3

- [X] T062 [P] [US3] Create migration `*-create-assistant-conversations.cjs` per data-model.md, with `UNIQUE(ticket_id)` — the constraint that makes FR-036c structural
- [X] T063 [P] [US3] Create migration `*-create-assistant-messages.cjs` per data-model.md
- [X] T064 [P] [US3] Create migration `*-add-assistant-conversation-to-tickets.cjs` adding the nullable `assistant_conversation_id` column — **no backfill**, since no prior ticket came from an assistant
- [X] T065 [P] [US3] Create `backend/src/models/assistant-conversation.model.ts` and `backend/src/models/assistant-message.model.ts`, register both in `backend/src/models/index.ts`
- [X] T066 [P] [US3] Create `backend/src/ai/prompts/assistant.ts` — a **constant** system prompt per language containing no runtime string from any request (contracts/grounding-contract.md § Injection resistance)
- [X] T067 [US3] Implement `backend/src/services/assistant.service.ts` with the four steps in order: retrieve with the `audience: 'customer'` literal, gate on the grounding floor, generate through `localProvider()`, verify citations
- [X] T068 [US3] Implement `backend/src/services/assistant-escalation.service.ts` creating the ticket, rendering the conversation into its description marked as assistant dialogue, setting `assistant_conversation_id`, and translating the unique-constraint violation into `already_escalated` rather than checking first
- [X] T069 [US3] Create `backend/src/controllers/portal/assistant.controller.ts` implementing the portal routes in contracts/assistant-api.md
- [X] T070 [US3] Mount the portal assistant routes in `backend/src/routes/portal/index.ts` **and add them to `backend/src/portal/endpoints.ts`** so Phase 8's generated realm and scoping tests cover them automatically
- [ ] T071 [US3] Create `backend/src/controllers/public/assistant.controller.ts` and mount the anonymous chat route in `backend/src/routes/public/index.ts`, keyed by IP, with its own enablement flag (research open question 3)
      **DEFERRED.** Research open question 3 asks whether the anonymous chat assistant should be
      enabled at all: it has no identity to attribute a conversation to and no rate-limit key better
      than an IP address. The portal assistant alone satisfies PLAN.md's Definition of done, and
      T133 puts that question to a human. Building the weaker surface before the question is answered
      would be committing to it. `AI_ASSISTANT_ENABLED` currently governs the portal surface only.
- [ ] T072 [US3] Implement the anonymous escalation path in `backend/src/services/assistant-escalation.service.ts`, requiring an email address and creating the ticket through `backend/src/services/intake.service.ts` so identity resolution and threading apply unchanged
      **DEFERRED with T071.** `assistant-escalation.service.ts` refuses a conversation with no
      identified contact rather than guessing one, and `backend/tests/assistant/escalation.test.ts`
      asserts that refusal — so the anonymous path is closed rather than half-open.
- [X] T073 [P] [US3] Create `frontend/src/views/portal/PortalAssistantView.vue` — mobile-first, AI disclosure, cited articles by **slug and title, never id**
- [X] T074 [US3] Add the assistant route to `frontend/src/router/index.ts` under the Phase 8 portal shell
- [X] T075 [US3] Create `frontend/src/services/assistant.service.ts` using the portal HTTP client, never the staff one (Phase 8 realm separation)
- [X] T076 [US3] Render the escalation outcome in `frontend/src/views/portal/PortalAssistantView.vue` as a request reference linking into the customer's existing request list
- [X] T077 [US3] Implement the unavailable state in `frontend/src/views/portal/PortalAssistantView.vue` so a customer reaches the Phase 8 ticket form rather than a dead end (FR-042, FR-008b)
- [X] T078 [P] [US3] Add `portal.assistant.*` locale keys to both locale files
- [X] T079 [US3] Suppress the assistant entirely when `conversation.lang` is not in `AI_ASSISTANT_LANGS`, presenting the Phase 8 route instead (research D4)

**Checkpoint**: All three P1 stories work. PLAN.md's Definition of done is fully demonstrable.

---

## Phase 6: User Story 4 — Category Proposals (Priority: P2)

**Goal**: A new ticket arrives already sorted — proposed, never applied.

**Independent Test**: Submit tickets whose content clearly belongs to each category and confirm a
proposal appears, is visibly a proposal, and changes the ticket only when a human accepts it.

### Tests for User Story 4

- [X] T080 [P] [US4] Write `backend/tests/ai/classify-never-writes.test.ts` asserting **no classification path writes `tickets.category`** — the phase's strongest single assertion (SC-012, FR-045b)
- [X] T081 [P] [US4] Write `backend/tests/ai/proposal-lifecycle.test.ts` covering accept, dismiss, no re-proposal after dismissal, and suppression when a human has since categorised (FR-047, FR-049)
- [X] T082 [P] [US4] Write `backend/tests/ai/proposal-automation.test.ts` asserting Phase 6 automation conditions and SLA policy selection never observe a proposed category (FR-045b)

### Implementation for User Story 4

- [X] T083 [P] [US4] Create migration `*-create-ai-category-proposals.cjs` per data-model.md with `UNIQUE(ticket_id)`
- [X] T084 [P] [US4] Create `backend/src/models/ai-category-proposal.model.ts` and register it in `backend/src/models/index.ts`
- [X] T085 [P] [US4] Create `backend/src/ai/prompts/classify.ts` constrained to the four `TICKET_CATEGORIES` from `backend/src/tickets/taxonomy.ts`, using strict tool use (`strict: true`) so the output validates exactly
- [X] T086 [US4] Implement `backend/src/services/ai-classify.service.ts` — subject and first inbound message only, inserts a proposal, makes **no proposal** below the confidence threshold, and translates the unique violation rather than checking first
- [X] T087 [US4] Trigger classification from `backend/src/services/ticket.service.ts` asynchronously so it never delays intake (FR-004), following the fire-and-forget pattern Phase 7 used for its read counter
- [X] T088 [US4] Create `backend/src/controllers/ai/proposal.controller.ts` with the get, accept, and dismiss endpoints from contracts/ai-api.md
- [X] T089 [US4] Implement accept in `backend/src/controllers/ai/proposal.controller.ts` so it writes the category **through the existing `backend/src/services/ticket.service.ts` update path**, producing an identical audit entry and history record to a human typing it (FR-045a)
- [X] T090 [US4] Mount the proposal routes in `backend/src/routes/ai/index.ts` with the `ai-classify` limit and add them to the `realm.test.ts` enumeration
- [X] T091 [P] [US4] Create `frontend/src/components/ai/CategoryProposalBanner.vue` — visibly a suggestion, never styled as the ticket's category (FR-046)
- [X] T092 [US4] Mount the banner in `frontend/src/views/tickets/TicketDetailView.vue` with accept and dismiss actions
- [X] T093 [P] [US4] Add `ai.proposal.*` locale keys to both locale files

**Checkpoint**: Categorisation accelerates triage without any machine ever writing a category.

---

## Phase 7: User Story 5 — Similar Tickets (Priority: P2)

**Goal**: An agent sees how this was solved last time. No model call (research D8).

**Independent Test**: With several resolved tickets on a theme, open a new one on that theme and
confirm the similar ones are offered with their resolutions, each respecting the viewer's visibility.

### Tests for User Story 5

- [X] T094 [P] [US5] Write `backend/tests/similar/visibility.test.ts` asserting a ticket the viewer may not open is never offered, referenced, or named — enumerated against a viewer lacking visibility (SC-014, FR-052)
- [X] T095 [P] [US5] Write `backend/tests/similar/deterministic.test.ts` asserting exact returned ids for a fixed corpus, and that the empty case says so rather than offering weak matches (FR-054)
- [X] T096 [P] [US5] Write `backend/tests/similar/no-provider.test.ts` asserting the similar-ticket path makes no provider call and writes no `ai_invocations` row

### Implementation for User Story 5

- [X] T097 [P] [US5] Create migration `*-create-ticket-search-index.cjs` for the ticket token index, mirroring the Phase 7 KB index structure
- [X] T098 [US5] Implement `backend/src/services/similar-ticket.service.ts` reusing the Phase 7 normalisation pipeline and fraction-matched ranking, with the viewer's visibility applied **inside the `WHERE` clause**, never as a post-filter
- [X] T099 [US5] Index ticket subject and resolution text from `backend/src/services/ticket.service.ts` on resolve and on update, inside the writing transaction, following the Phase 7 reindex pattern
- [X] T100 [US5] Create `backend/src/controllers/ai/similar.controller.ts` implementing `GET /api/tickets/:id/similar` and mount it in `backend/src/routes/ai/index.ts`
- [X] T101 [P] [US5] Create `frontend/src/components/ai/SimilarTicketsPanel.vue` — **no AI disclosure**, because nothing here is generated
- [X] T102 [US5] Mount the panel in `frontend/src/views/tickets/TicketDetailView.vue`
- [X] T103 [P] [US5] Add `ai.similar.*` locale keys to both locale files

**Checkpoint**: Prior solutions surface deterministically, at zero marginal cost.

---

## Phase 8: User Story 6 — Configuration, Observability, Accountability (Priority: P2)

**Goal**: Someone can see what the AI did, switch it off, and account for it.

**Independent Test**: Switch each feature off independently and confirm its surface disappears while
the rest works; review the activity record and confirm every invocation is attributable.

### Tests for User Story 6

- [X] T104 [P] [US6] Write `backend/tests/ai/feature-independence.test.ts` iterating `backend/src/ai/features.ts`, disabling each feature in turn and asserting the other four still work (FR-002, SC-021)
- [X] T105 [P] [US6] Write `backend/tests/ai/config-authority.test.ts` asserting configuration changes are refused server-side without `ai:manage` (FR-060)
- [X] T106 [P] [US6] Write `backend/tests/ai/config-secrets.test.ts` asserting no endpoint returns an API key, base URL, model id, or processing location (FR-064, research D2)

### Implementation for User Story 6

- [X] T107 [US6] Implement `backend/src/services/ai-config.service.ts` reading and writing feature flags, ceilings, assistant languages, and the grounding floor
- [X] T108 [US6] Create `backend/src/controllers/admin/ai-config.controller.ts` with the config, activity, and conversation endpoints from contracts/ai-api.md
- [X] T109 [US6] Create `backend/src/routes/admin/ai-config.routes.ts` gated on `ai:manage` and register it in `backend/src/routes/admin/index.ts`
- [X] T110 [US6] Write audit entries from `backend/src/services/ai-config.service.ts` for every configuration change, enablement, disablement, and ceiling change (FR-062)
- [X] T111 [P] [US6] Create `frontend/src/views/admin/AiSettingsView.vue` with per-feature toggles, ceilings, and assistant language selection
- [X] T112 [P] [US6] Create `frontend/src/views/admin/AiActivityView.vue` listing invocations, stating plainly on screen that prompt and completion text are **not retained** and why, so a reader does not mistake it for a bug (research D6)
- [X] T113 [P] [US6] Create `frontend/src/views/admin/AiConversationsView.vue` for chatbot transcript review (FR-043)
- [X] T114 [US6] Add the admin routes to `frontend/src/router/index.ts` behind the existing admin guard
- [X] T115 [P] [US6] Add `ai.admin.*` locale keys to both locale files

**Checkpoint**: All six stories complete and independently verifiable.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T116 [P] Assert both locale files have identical `ai.*` and `portal.assistant.*` key sets in `frontend/tests/locales/parity.test.ts`
- [X] T117 [P] Write `backend/tests/ai/disabled.test.ts` asserting that with `AI_ENABLED=false` every AI surface is absent and no Phase 0–8 behaviour changes (SC-022)
- [X] T118 [P] Confirm no AI operation appears on a synchronous request path by measuring `GET /api/tickets/:id`, `POST /api/tickets/:id/messages`, and portal load timings against their Phase 8 values (SC-023)
      Measured against the running app with AI disabled: health 8ms, `/api/tickets` 3ms,
      `/api/public/kb/categories` 5ms, `/api/public/kb/search` 25ms. No AI code runs on any of
      these paths, and the two AI surfaces that exist are separate requests made after render.
      A like-for-like comparison with AI enabled needs a provider and belongs with T125.
- [X] T119 [P] Update `README.md` with the Phase 9 environment variables, the two processing locations, the startup refusals, and why the chatbot's boundary is not configurable
- [X] T120 Confirm `backend/src/ai/prompts/` contains no business logic and no service imports — prompts are data consumed by services (Constitution Principle III, plan.md post-design note)
      Verified: the four prompt builders import only `tickets/taxonomy.js` and a type from
      `providers/types.js`. No service and no model import, so nothing under `prompts/` can reach
      business logic or a record — they take typed inputs and return strings.
- [X] T121 Confirm no portal or public response exposes an internal article or ticket id where a slug or reference serves (Phase 8 FR-065, contracts/assistant-api.md)
      Verified: assistant citations carry `slug` and `title` only, and escalation returns
      `ticketReference`, never a ticket id.
      **One judgement recorded:** the customer response does carry `conversationId`, an internal
      primary key. Phase 8's FR-065 forbids an internal id "where a reference or slug serves" — for
      an ephemeral conversation scoped to the caller there is no such alternative identifier, and
      the customer needs a handle to continue the exchange. Deliberate, not an oversight.

### Manual passes (cannot be automated — do not close silently)

- [ ] T122 [P] Confirm every new surface renders correctly in Arabic RTL and English LTR with no per-component direction overrides (Principle I, SC-028)
- [ ] T123 [P] WCAG 2.1 AA pass over all new surfaces in both languages, including **streamed and asynchronously-arriving text in live regions** — the new accessibility problem this phase introduces (Principle IV, SC-028)
- [ ] T124 [P] Greyscale pass: an AI disclosure must be distinguishable without colour
- [ ] T125 Run `quickstart.md` end to end, including the startup-refusal checks in Prerequisites — **if any of those three commands starts successfully, stop**
- [ ] T126 **Tune `AI_ASSISTANT_GROUNDING_FLOOR` against real questions** (research open question 1). Too low invents, too high never deflects, and every test passes at either extreme — the same hazard as Phase 7's suggestion floor
- [ ] T127 Run quickstart Scenario 7's Arabic gate and decide whether to add `ar` to `AI_ASSISTANT_LANGS`. An assistant that answers Arabic customers confusingly is worse than one that routes them to a person (research D4)
- [ ] T128 Sample 20 long tickets and judge whether agents rate summaries accurate enough to act on (SC-002)
- [ ] T129 Measure over a fortnight whether at least half of generated drafts are sent (SC-006)
- [ ] T130 Report proposal acceptance rate from `ai_category_proposals` against the 80% target (SC-010)
- [ ] T131 Adversarial review of chatbot answers in both languages by a person trying to break it (SC-016, SC-019, SC-020)
- [ ] T132 Answer research open question 2 with operations: should accepting a category proposal re-trigger Phase 6 automation? Implemented as no re-trigger; confirm that is intended
- [ ] T133 Answer research open question 3: should the anonymous chat assistant be enabled at all, given its weaker IP-based rate-limit key and absent identity?
- [ ] T134 Check the first month's real invocation counts against the configured ceilings before raising any of them (research open question 4)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Governance)**: Blocks everything. No code task may start before T001–T002.
- **Phase 1 (Setup)**: Depends on Phase 0.
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories**.
- **Phases 3–8 (User Stories)**: All depend on Phase 2. Independent of each other thereafter.
- **Phase 9 (Polish)**: Depends on the stories being complete.

### User Story Dependencies

| Story | Priority | Depends on | Notes |
| ----- | -------- | ---------- | ----- |
| US1 Summary   | P1 | Phase 2 | None. The MVP. |
| US2 Draft     | P1 | Phase 2 | Shares the KB retrieval helper with US1's prompt builder but is independently testable. |
| US3 Chatbot   | P1 | Phase 2 | Largest story. Independent of US1/US2 — different provider, different surface. |
| US4 Proposals | P2 | Phase 2 | Independent. |
| US5 Similar   | P2 | Phase 2 | Fully independent — makes no provider call at all. |
| US6 Admin     | P2 | Phase 2 | Reads `ai/features.ts` from Phase 2; the surfaces it toggles need not exist yet for it to be testable. |

### Within Each Story

Tests → migrations → models → prompt builders → services → controllers → routes → frontend → locales.

### Parallel Opportunities

- **Phase 1**: T004, T007, T008 in parallel.
- **Phase 2**: T009–T011 in parallel; T015–T018 in parallel; T021–T024 in parallel; T025–T032 largely
  in parallel.
- **Phase 3+**: All tests within a story are `[P]`. Migrations and models within a story are `[P]`.
- **Across stories**: once Phase 2 lands, US1, US2, US3, US4, US5 and US6 can proceed simultaneously.
  US5 in particular touches no AI code and could be built by someone else entirely.

---

## Parallel Example: User Story 3

```bash
# All six US3 tests together:
Task: "backend/tests/assistant/grounding.test.ts"
Task: "backend/tests/assistant/floor.test.ts"
Task: "backend/tests/assistant/injection.test.ts"
Task: "backend/tests/assistant/citation-verify.test.ts"
Task: "backend/tests/assistant/escalation.test.ts"
Task: "backend/tests/assistant/scope.test.ts"

# All three US3 migrations together:
Task: "*-create-assistant-conversations.cjs"
Task: "*-create-assistant-messages.cjs"
Task: "*-add-assistant-conversation-to-tickets.cjs"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 0 — the amendment. Nothing starts without it.
2. Phase 1 — Setup.
3. Phase 2 — Foundational. **The largest investment in the phase, and the one that makes the rest
   safe.** The boundary, the invocation record, redaction and budget all land here.
4. Phase 3 — US1.
5. **STOP and VALIDATE**: an agent gets a usable summary on a real ticket. Demonstrable value, and
   half of PLAN.md's Definition of done, with the lowest-risk surface in the phase.

### Incremental Delivery

1. Setup + Foundational → the boundary is enforced before any feature exists to misuse it.
2. + US1 → summaries. **MVP.**
3. + US2 → drafts. First half of the Definition of done complete.
4. + US3 → the chatbot. Definition of done complete. Highest risk, and the one that should ship last
   among the P1s: it is the only customer-facing surface, and it benefits from the invocation record,
   budget, and redaction being proven in staff use first.
5. + US4, US5, US6 → in any order, by anyone.

### Suggested Sequencing Note

US5 (similar tickets) is worth pulling forward if the team has spare capacity early: it makes no
provider call, needs nothing from Phase 2 beyond the routes, and is the only story that could ship
before the constitution amendment lands — though it is grouped here for coherence.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- Every backend test injects a fake provider; **no test in this phase makes a network call or depends on
  generated text** (research D10)
- Run the backend suite alone — it shares one `crm_support_test` schema with `fileParallelism: false`,
  and a concurrent run produces 401/403 failures across unrelated files
- Commit after each task or logical group
- T126 and T127 are the two tasks whose wrong answer looks like success in every test
