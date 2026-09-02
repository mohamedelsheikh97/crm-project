# Implementation Plan: Phase 9 — AI Features

**Branch**: `010-phase-9-ai-features` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-phase-9-ai-features/spec.md`

**PLAN.md Reference**: Phase 9 — AI Features

**Builds on**: Phase 8 — Customer Portal, merged to `main` at `414303a`

## Summary

Phase 9 adds five AI surfaces on top of a finished ticket system. Four of them are ordinary work. One
is not, and the plan is shaped around it.

**Clarifications Q1 splits the phase into two integrations, not one.** Staff-facing features —
summarisation, reply drafting, similar tickets — may call an external provider. The chatbot may not:
it runs only on infrastructure the organisation controls. That is one feature set with a frontier
model behind it, and one feature set with whatever can be self-hosted behind it — and the second one
is the customer-facing surface with the adversarial input. **The strongest safety requirements in the
spec land on the weakest model in the phase.** D3 is the answer: the chatbot's guarantees are moved
out of the model and into the code around it, so that FR-034, FR-035 and FR-039 hold whatever the
model does.

**Clarifications Q2 removes the hardest part of categorisation.** Nothing writes `tickets.category`.
The classifier produces a row in a proposals table that a human accepts, and acceptance goes through
the Phase 3 update path that already exists. No new write path to a field Phase 6 routes on.

**Clarifications Q3 removes a table.** Nothing stores prompts or completions, so there is no
retention design, no second copy of correspondence, and no deletion obligation to build. Summaries
are computed on read and thrown away — the pattern Phase 7 already established for suggestions and
Phase 8 reused for scoping.

Everything is additive. The phase adds tables and endpoints, and modifies existing code in three
narrow places: the ticket detail response gains optional panels, the reply composer gains a button,
and the portal gains a route. With `AI_ENABLED=false` the product is Phase 8, and SC-022 asserts it by
running the Phase 0–8 suite unchanged.

Three decisions worth flagging before the detail:

**The provider boundary is a directory, not a setting** (D2). FR-008a demands that pointing the
chatbot at an external provider be impossible rather than inadvisable. Two adapter modules, two
factory functions, and a chatbot service that can only import the local one — so the wrong wiring is
a TypeScript error at build time, not a misconfiguration discovered in an incident.

**Retrieval does the work; the model phrases the answer** (D3). Phase 7's `kb-search.service.ts`
already returns published, customer-visible articles with `audience: 'customer'` as a caller-supplied
literal. The chatbot passes the same literal, and the model never sees an article the retrieval layer
did not hand it. "Answer only from published KB content" therefore stops being an instruction the
model may ignore and becomes a property of what is in its context.

**Similar tickets need no AI at all** (D8). Phase 7 built a normalised token index and a scoring
function for exactly this shape of problem. Reusing it against ticket subjects and resolutions costs
one query, respects visibility in the `WHERE` clause, returns deterministic results a test can assert
exactly, and adds no cost per view. Spending a model call here would be worse on every axis.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js 22+, Vue 3.5 (`<script setup>`)

**Primary Dependencies**: Express, Sequelize, MySQL 8.4, Pinia, vue-i18n, Tailwind. **New:**
`@anthropic-ai/sdk` (staff-facing features only). No new dependency for the chatbot's model client —
it speaks HTTP to a locally-hosted OpenAI-compatible inference server (D4), which `fetch` already
covers.

**Storage**: MySQL. 4 new tables (`ai_invocations`, `ai_category_proposals`,
`assistant_conversations`, `assistant_messages`), 1 new nullable column on `tickets`, 0 existing
columns altered.

**Testing**: Vitest, `fileParallelism: false` for backend, real MySQL schema per file. AI calls are
faked at the adapter boundary in every test — no test spends money or depends on a model's output
(D10).

**Target Platform**: Linux server; the self-hosted inference server is a sibling container.

**Project Type**: Web application (existing `backend/` + `frontend/` workspaces).

**Performance Goals**: No AI operation on a synchronous request path (FR-004, SC-023). Summary
available within 10s or reports failure (SC-003). Chatbot first token within 3s.

**Constraints**: Ticket view, message send, and portal page response times must not regress from their
Phase 8 values. Chatbot processing must not leave controlled infrastructure (FR-008, SC-024a). No
prompt or completion content persisted (FR-065, SC-024b).

**Scale/Scope**: 5 AI surfaces, 4 new tables, 1 permission key, ~12 audit actions, 4 rate-limit
scopes, 2 provider adapters, ~7 new backend services, 1 new portal route, 3 modified screens.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle                          | Status                | Note                                                                                                                              |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| I. Bilingual-First & RTL           | PASS with obligations | FR-056–FR-059. Every new surface is bilingual; AI **output** language is FR-057's rule, distinct from interface language. D9.       |
| II. Security by Default            | PASS with obligations | New permission key, server-side gates, audit on every invocation and config change. The novel risk is egress (D2) and injection (D3). |
| III. Layered Architecture          | PASS                  | `routes → controllers → services → models` throughout. Provider adapters sit below services, mirroring `channels/`.                 |
| IV. Accessibility                  | PASS with obligations | WCAG 2.1 AA on all new surfaces; streaming output needs live-region handling (D9).                                                  |
| V. Phase-Gated Delivery            | PASS                  | `/speckit-specify` → `/speckit-plan` (here) → `/speckit-tasks` → `/speckit-implement`. Traceability in spec.                        |
| **Technology Standards (fixed stack)** | **BLOCKED — amendment required** | The table names no AI provider. Clarifications Q1 needs two entries. See Complexity Tracking.                          |

**The Technology Standards row is a real gate, not a formality.** The constitution's Governance section
requires an amendment proposed in writing with rationale, approved before the phase it affects, and a
version bump. It also lists "AI provider selection (needed before Phase 9)" as an Open Item due now.
`/speckit-tasks` must not run until the amendment is approved; T001 in the eventual task list is
"obtain the amendment", and nothing else can start.

### Post-design re-evaluation

Re-checked after Phase 1. No new violations. Three notes:

- **Principle III held under pressure.** The temptation was a "prompt layer" spanning controllers and
  services. The design keeps prompts in `backend/src/ai/prompts/` — data consumed by services, not a
  layer of its own — so no business logic escapes the service tier.
- **Principle II is stronger than the spec required.** D2 makes the egress boundary a compile-time
  property, and D3 makes grounding a property of context construction. Both were "MUST" requirements
  that could have been satisfied by careful coding; neither is now.
- **Principle I revealed a real problem.** Self-hosted open-weights models are materially weaker in
  Arabic than in English (D4), and the chatbot is the surface where that lands on customers. D4's
  answer is a quality gate before enablement per language, not a hope.

## Project Structure

### Documentation (this feature)

```text
specs/010-phase-9-ai-features/
├── plan.md              # This file
├── research.md          # Phase 0 output — 12 decisions
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ai-api.md            # Staff + admin endpoints
│   ├── assistant-api.md     # Portal/chat assistant endpoints
│   ├── provider-contract.md # The adapter interface and the egress boundary
│   └── grounding-contract.md# What may enter a prompt, and what may not
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # NOT created by /speckit-plan
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── ai/                              # NEW — the boundary, not a layer
│   │   ├── providers/
│   │   │   ├── types.ts                 # AiProvider interface, shared by both
│   │   │   ├── external.ts              # Anthropic SDK. Staff features ONLY.
│   │   │   ├── local.ts                 # HTTP to controlled inference server
│   │   │   ├── external-factory.ts      # importable ONLY by staff services
│   │   │   └── local-factory.ts         # importable ONLY by assistant services
│   │   ├── prompts/                     # Prompt text as data, bilingual
│   │   │   ├── summarise.ts
│   │   │   ├── draft-reply.ts
│   │   │   ├── classify.ts
│   │   │   └── assistant.ts
│   │   ├── redact.ts                    # Secret-shaped content stripping (FR-010)
│   │   ├── budget.ts                    # Ceilings + refusal (FR-005)
│   │   └── features.ts                  # The five feature flags, one declaration
│   ├── controllers/
│   │   ├── ai/                          # summary, draft, similar, proposals
│   │   ├── assistant/                   # portal + chat assistant
│   │   └── admin/ai-config.controller.ts
│   ├── models/
│   │   ├── ai-invocation.model.ts
│   │   ├── ai-category-proposal.model.ts
│   │   ├── assistant-conversation.model.ts
│   │   └── assistant-message.model.ts
│   ├── routes/
│   │   ├── ai/index.ts
│   │   ├── assistant/index.ts
│   │   └── admin/ai-config.routes.ts
│   ├── services/
│   │   ├── ai-summary.service.ts
│   │   ├── ai-draft.service.ts
│   │   ├── ai-classify.service.ts
│   │   ├── similar-ticket.service.ts    # No model call — Phase 7 index (D8)
│   │   ├── assistant.service.ts
│   │   ├── assistant-escalation.service.ts
│   │   └── ai-config.service.ts
│   └── db/migrations/                   # 6 new
└── tests/
    ├── ai/                              # egress, redaction, budget, invocation log
    ├── assistant/                       # grounding, injection, escalation, scoping
    └── similar/                         # deterministic, visibility-scoped

frontend/
├── src/
│   ├── components/ai/
│   │   ├── AiDisclosure.vue             # FR-014, used by every surface
│   │   ├── TicketSummaryPanel.vue
│   │   ├── DraftReplyButton.vue
│   │   ├── SimilarTicketsPanel.vue
│   │   └── CategoryProposalBanner.vue
│   ├── views/portal/PortalAssistantView.vue
│   ├── views/admin/AiSettingsView.vue
│   ├── services/ai.service.ts
│   ├── services/assistant.service.ts
│   └── stores/ai.store.ts
└── tests/ai/
```

**Structure Decision**: The existing two-workspace layout is unchanged. The one new top-level backend
directory is `src/ai/`, and it exists for the same reason `src/channels/` does: it is a boundary to
the outside world, with adapters behind an interface, and putting it in `services/` would bury the
egress decision among ordinary business logic. `src/portal/` (Phase 8) is the precedent for the small
`prompts/`, `redact.ts`, `budget.ts`, `features.ts` modules — pure declarations a service imports.

## Complexity Tracking

| Violation                                              | Why Needed                                                                                                                         | Simpler Alternative Rejected Because                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Technology Standards amendment: two AI processors**  | Clarifications Q1 permits an external provider for staff features and forbids it for the chatbot. Both must be named in the fixed stack. | One processor cannot satisfy Q1: a single external one violates the chatbot's boundary, and a single self-hosted one gives agents materially worse summaries and drafts for no privacy gain — staff content is already employee-visible. |
| **Two provider adapters instead of one abstraction**   | FR-008a requires the boundary to be structural. Two factories that different services import is what makes the wrong wiring uncompilable. | One adapter with a `location` parameter puts the boundary in a runtime value — exactly the "one settings edit away" failure FR-008a names.                                    |
| **A fourth table (`assistant_messages`) for conversations** | FR-043 requires conversations retrievable; FR-036a requires them carried onto an escalated ticket.                                | Reusing `messages` was tried on paper and rejected in D6: it would put pre-ticket, non-correspondence content into the timeline Phase 5 keeps correspondence-only and Phase 8 built the customer view on. |

### Non-violations worth recording

- **`@anthropic-ai/sdk` is a new dependency, not a stack deviation.** The Technology Standards table
  governs frameworks and infrastructure; a provider client is the same category as the IMAP and SMS
  clients Phase 5 added without amendment. The *provider choice* needs the amendment; the npm package
  does not.
- **No vector database, no embeddings service.** D8 and D3 both reuse Phase 7's token index. A vector
  store would be a new piece of infrastructure serving two features that measurably do not need one.
- **No queue.** FR-004 requires AI work off the request path, and D7 achieves it with the
  fire-and-forget pattern Phase 7 already uses for its read counter plus client-side polling. A job
  queue is real infrastructure with real operational weight, and this phase's async needs are one
  request deep.

## Phase closeout

The phase is done when:

1. All `/speckit-tasks` tasks are complete.
2. Every new surface works in Arabic (RTL) and English (LTR) — including AI **output** language
   (FR-057), which is not the same check.
3. Server-side permission gates verified, not just UI hiding: `ai:manage` for configuration, and
   FR-061's rule that using a feature requires the underlying authority.
4. WCAG 2.1 AA on all new screens in both languages, including streamed content in live regions.
5. PLAN.md's Definition of done demonstrated on a real ticket and a real escalation.
6. **The constitution amendment is merged**, with the "AI provider selection" Open Item closed.
7. `AI_ENABLED=false` runs the full Phase 0–8 suite green (SC-022).

## Outstanding from earlier phases

- **Phase 8's `pending` mapping** (research open question 1) is still open and unrelated to this phase,
  but the assistant's status language will reuse `portal/customer-status.ts` — so whichever word is
  chosen there now appears in one more place.
- **Phase 2's virus scanning**, deferred through Phases 8 and now 9. FR-013 keeps attachments out of AI
  processing entirely, so this phase adds no new pressure — but it remains the precondition for portal
  uploads.
- **Phase 5's chat widget conversation token.** The assistant sits on the chat channel and inherits
  whatever that token becomes; D5 records how the anonymous case is handled meanwhile.
