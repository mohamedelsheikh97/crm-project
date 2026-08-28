---
description: 'Task list for Phase 3 — Ticket Management (Core)'
---

# Tasks: Phase 3 — Ticket Management (Core)

**Input**: Design documents from `/specs/004-phase-3-ticket-management/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested, and Principle II makes the authorization and lifecycle matrices non-optional.

**Organization**: Grouped by user story. Stories are ordered P1 first (US1, US2, US3, US5) then P2
(US4, US6) — which is *not* their numeric order, because spec.md assigns US5 (history) P1 and US4
(escalation) P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US6 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Directory structure for the new module. No new dependencies — Phase 3 introduces no
library the previous phases did not already install.

- [ ] T001 Create the module directories `backend/src/tickets/`, `backend/src/routes/tickets/`, `backend/src/controllers/tickets/`, `backend/tests/tickets/`, `frontend/src/views/tickets/`, `frontend/src/components/tickets/`, `frontend/tests/tickets/`
- [ ] T002 [P] Add the `ticket.*` namespace skeleton to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` so later tasks add keys to an existing branch rather than creating it twice

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissions, and the two declarations every story reads.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. In particular T009 — a
forgotten test-helper seeder makes every new test fail with a 403 that looks nothing like its cause,
exactly as happened in Phase 2.

- [ ] T003 Create migration `backend/src/db/migrations/20260828000001-create-tickets.cjs` per data-model.md: all columns, the `reference` generated column, FKs to `customers` and `users` with `ON DELETE RESTRICT`, the self-FK `merged_into_ticket_id`, `version`, and the six indexes including composite `(status, priority)`
- [ ] T004 [P] Create migration `backend/src/db/migrations/20260828000002-create-ticket-history.cjs`: `BIGINT UNSIGNED` PK, cascade FK to `tickets`, `actor_name` snapshot column, no `updated_at`, and both `(ticket_id, created_at)` and `(ticket_id, id)` indexes
- [ ] T005 [P] Create migration `backend/src/db/migrations/20260828000003-create-ticket-links.cjs`: cascade FKs both sides, UNIQUE `(ticket_id, linked_ticket_id)`, index on `linked_ticket_id`
- [ ] T006 Add the ten permission keys from data-model.md to the catalog in `backend/src/auth/permissions.ts`
- [ ] T007 Create seeder `backend/src/db/seeders/20260828000001-ticket-permissions.cjs` granting the keys per role — agent gets `view|create|update|transition|close|link`; supervisor and admin add `assign|reopen|merge|manage_any`
- [ ] T008 Verify each `down` in T003–T005 drops FK constraints before the indexes they depend on, the failure mode Phase 1 hit
- [ ] T009 Register the new seeder in `backend/tests/helpers/database.ts`, keeping the existing note that a later phase must add its own
- [ ] T010 [P] Create the lifecycle declaration in `backend/src/tickets/lifecycle.ts` — the 13 permitted edges of contracts/ticket-lifecycle.md, each with its required permission, as one exported `const`
- [ ] T011 [P] Create the taxonomy declaration in `backend/src/tickets/taxonomy.ts` — four categories, four priorities each carrying a numeric rank
- [ ] T012 [P] Create the `Ticket` model in `backend/src/models/ticket.model.ts`
- [ ] T013 [P] Create the `TicketHistory` model in `backend/src/models/ticket-history.model.ts`
- [ ] T014 [P] Create the `TicketLink` model in `backend/src/models/ticket-link.model.ts`
- [ ] T015 Register the three models and their associations in `backend/src/models/index.ts`
- [ ] T016 Create `backend/src/services/ticket-history.service.ts` with a `record(entry, transaction)` that shares the caller's transaction and snapshots `actor_name`, mirroring `audit.service.ts`
- [ ] T017 Create `backend/src/services/ticket-lifecycle.service.ts` exporting `assertTransitionAllowed(from, to, actor, ticket)` and `availableTransitions(actor, ticket)`, both reading the T010 constant — the merged check first, then the table, then the edge permission, then the conditional close
- [ ] T018 Add `TICKET_CLOSED`, `TICKET_MERGED`, `TRANSITION_NOT_ALLOWED`, and `CUSTOMER_INACTIVE` to the error catalogue in `backend/src/errors/`, with `details` shapes per contracts/ticket-api.md
- [ ] T019 Create `backend/src/routes/tickets/index.ts` and mount it at `/api/tickets` in `backend/src/routes/index.ts`
- [ ] T020 Add `tickets:close` to `CONDITIONAL_PERMISSIONS` in `backend/tests/authorization.matrix.test.ts`, naming the test that covers its ownership rule
- [ ] T021 [P] Create `frontend/src/services/tickets.service.ts` on the shared `http.ts` client
- [ ] T022 [P] Create `frontend/src/stores/tickets.store.ts`
- [ ] T023 Add the three ticket routes to `frontend/src/router/index.ts`, each declaring `meta.permission`

**Checkpoint**: `npm run migrate` and `npm test` both succeed; the authorization matrix now covers 27 permissions.

---

## Phase 3: User Story 1 — Agent Logs a Customer's Problem (Priority: P1) 🎯 MVP

**Goal**: A ticket can be created against a customer with a category and priority, receives a
reference, and appears in a filterable list.

**Independent Test**: Create tickets with each category and priority; confirm each gets a unique
`TKT-` reference, lands in status `new`, and is findable by reference, subject, and filters.

### Tests for User Story 1

- [ ] T024 [P] [US1] Creation tests in `backend/tests/tickets/create.test.ts`: required fields, unknown category or priority rejected with the accepted values named, deactivated customer refused with `CUSTOMER_INACTIVE`, caller-supplied `status` ignored, reference generated and unique
- [ ] T025 [P] [US1] Listing tests in `backend/tests/tickets/list.test.ts`: pagination, `q` matching reference and subject accent- and case-insensitively, repeatable `status`/`priority`/`category`, `assigneeId=unassigned`, `customerId`, priority sort by numeric rank (asserting `urgent` above `normal`), merged excluded by default

### Implementation for User Story 1

- [ ] T026 [US1] Implement `create` and `list` in `backend/src/services/ticket.service.ts`, validating against the T011 taxonomy and writing the `ticket.created` history entry and audit entry in the same transaction
- [ ] T027 [US1] Implement `create`, `list`, and `getById` in `backend/src/controllers/tickets/tickets.controller.ts`, including the non-numeric-id guard that returns 404 rather than 500
- [ ] T028 [US1] Wire the routes in `backend/src/routes/tickets/tickets.routes.ts` with `authorize('tickets:view')` and `authorize('tickets:create')`
- [ ] T029 [P] [US1] Create `frontend/src/components/tickets/TicketStatusBadge.vue` — renders a status key through i18n, with text alongside colour
- [ ] T030 [P] [US1] Create `frontend/src/components/tickets/TicketPriorityBadge.vue`
- [ ] T031 [US1] Create `frontend/src/components/tickets/TicketFilters.vue`, reflecting every filter into the query string
- [ ] T032 [US1] Create `frontend/src/views/tickets/TicketListView.vue` with sortable columns, the two distinct empty states, and RTL-safe pagination
- [ ] T033 [US1] Create `frontend/src/views/tickets/TicketCreateView.vue` with customer selection and taxonomy dropdowns rendered from i18n keys
- [ ] T034 [US1] Add the US1 `ticket.*` keys to both locale files, including all four category and priority labels
- [ ] T035 [P] [US1] Component test in `frontend/tests/tickets/TicketListView.test.ts`: filters reach the query string, the two empty states differ

**Checkpoint**: Tickets can be created and found. This alone is a demonstrable increment.

---

## Phase 4: User Story 2 — Ticket Moves Through Its Lifecycle (Priority: P1)

**Goal**: A ticket moves only along declared edges, with closure and reopening carrying their own
authority.

**Independent Test**: Walk every permitted transition and confirm it succeeds; attempt every
forbidden one and confirm each is refused with the reachable set named.

### Tests for User Story 2

- [ ] T036 [P] [US2] Generated matrix in `backend/tests/ticket-lifecycle.matrix.test.ts`: all 36 ordered pairs × 3 roles read from the T010 constant, plus the three structural assertions from contracts/ticket-lifecycle.md (every status appears as a `from`, every `to` is declared, every permission is a catalog key)
- [ ] T037 [P] [US2] Behavioural tests in `backend/tests/tickets/transitions.test.ts`: version mismatch returns 409, an Agent closes their own resolved ticket, a different Agent cannot, a Supervisor reopens and all history survives, `details.allowed` is filtered by the caller's permissions

### Implementation for User Story 2

- [ ] T038 [US2] Implement `transition` in `backend/src/services/ticket.service.ts` calling `assertTransitionAllowed`, incrementing `version`, and writing history plus audit in one transaction
- [ ] T039 [US2] Implement `GET /:id/transitions` and `POST /:id/transitions` in `backend/src/controllers/tickets/tickets.controller.ts` and register them in `tickets.routes.ts`
- [ ] T040 [US2] Implement `update` in `backend/src/services/ticket.service.ts`: optimistic locking, per-field history entries, and refusal when closed or merged — with `status` rejected as an editable field so the lifecycle cannot be bypassed
- [ ] T041 [US2] Create `frontend/src/components/tickets/TicketTransitionMenu.vue` rendering **only** the server's returned moves, with no local copy of the table
- [ ] T042 [US2] Create `frontend/src/views/tickets/TicketDetailView.vue` with the header, description, edit form, closed notice, and Phase 2's conflict-preserving 409 handling
- [ ] T043 [US2] Add status and transition i18n keys, including the refusal message that names the reachable set
- [ ] T044 [P] [US2] Component test in `frontend/tests/tickets/TicketTransitionMenu.test.ts`: only server-returned moves render

**Checkpoint**: The phase's core mechanism is enforced and proven across all 36 pairs.

---

## Phase 5: User Story 3 — Ticket Is Assigned to an Agent (Priority: P1)

**Goal**: A Supervisor assigns, reassigns, and unassigns; an Agent cannot, including to themselves.

**Independent Test**: Assign, reassign, unassign, filter by assignee, and confirm an Agent's direct
call returns 403.

### Tests for User Story 3

- [ ] T045 [P] [US3] Assignment tests in `backend/tests/tickets/assignment.test.ts`: Supervisor succeeds, Agent gets 403 including self-assignment, unassignment via `userId: null`, an inactive target refused, a target lacking `tickets:view` refused, both previous and new assignee recorded

### Implementation for User Story 3

- [ ] T046 [US3] Implement `assign` in `backend/src/services/ticket.service.ts` with the active-and-capable target checks, writing `ticket.assigned` / `ticket.unassigned` to history and audit
- [ ] T047 [US3] Implement `PUT /:id/assignee` in the controller and register it with `authorize('tickets:assign')`
- [ ] T048 [US3] Add the assignment panel to `TicketDetailView.vue`, hidden entirely for a caller without `tickets:assign`
- [ ] T049 [US3] Add assignment i18n keys and the `unassigned` filter label

**Checkpoint**: Work can be distributed. Phase 4's dashboard will read this and not write it.

---

## Phase 6: User Story 5 — Ticket History Answers "What Has Already Been Tried?" (Priority: P1)

**Goal**: Every change is visible on the ticket, oldest first, attributed and unalterable.

**Independent Test**: Perform every kind of change, then read the history and confirm each appears
with previous and new values in the order it happened.

### Tests for User Story 5

- [ ] T050 [P] [US5] History tests in `backend/tests/tickets/history.test.ts`: oldest-first with `id` as tiebreaker for same-second events, previous and new values present, entries readable by `tickets:view` and not requiring `audit:view`, attribution survives actor deactivation, no write endpoint exists, deny-list redaction applied to `note`

### Implementation for User Story 5

- [ ] T051 [US5] Implement the paginated history read in `backend/src/services/ticket-history.service.ts`, ordered `(created_at, id)` ascending
- [ ] T052 [US5] Implement `GET /:id/history` in the controller with `authorize('tickets:view')`
- [ ] T053 [US5] Create `frontend/src/components/tickets/TicketHistoryTimeline.vue` as an ordered list, rendering key-valued fields through i18n
- [ ] T054 [US5] Wire the timeline into `TicketDetailView.vue`
- [ ] T055 [US5] Add history event i18n keys for every event name in data-model.md
- [ ] T056 [P] [US5] Component test in `frontend/tests/tickets/TicketHistoryTimeline.test.ts`: oldest-first ordering, status values rendered as labels rather than keys

**Checkpoint**: PLAN.md's "its history is fully auditable" is satisfied.

---

## Phase 7: User Story 4 — Ticket Is Escalated (Priority: P2)

**Goal**: Escalation carries a required reason, is visible, and is not a dead end.

**Independent Test**: Escalate with a reason, confirm the reason is visible and the ticket still
reaches Resolved and can come back down.

### Tests for User Story 4

- [ ] T057 [P] [US4] Escalation tests in `backend/tests/tickets/escalation.test.ts`: reason required, reason stored on the ticket and in history, `escalated → resolved` permitted, de-escalation clears `escalation_reason`, escalated tickets filterable

### Implementation for User Story 4

- [ ] T058 [US4] Extend the transition service to require and store `reason` when the target is `escalated`, and to clear it on any transition away
- [ ] T059 [US4] Add the escalation reason prompt and the escalated banner to `TicketDetailView.vue`
- [ ] T060 [US4] Add escalation i18n keys

**Checkpoint**: The manual escalation path PLAN.md scopes here is complete.

---

## Phase 8: User Story 6 — Duplicate Tickets Are Merged and Related Ones Linked (Priority: P2)

**Goal**: A duplicate is absorbed permanently and traceably; a related ticket is linked without
either losing identity.

**Independent Test**: Merge B into A, then A into C, and confirm B resolves to C; link two tickets
and confirm unlinking leaves both otherwise untouched.

### Tests for User Story 6

- [ ] T061 [P] [US6] Merge tests in `backend/tests/tickets/merge.test.ts`: self-merge refused, cycle refused, merging an already-merged ticket refused with its survivor named, **a three-ticket chain resolving transitively to one survivor**, every workable route refusing a merged ticket, both `ticket.merged` and `record.deleted` audited, history spanning the chain with each entry labelled by origin
- [ ] T062 [P] [US6] Link tests in `backend/tests/tickets/links.test.ts`: symmetry, duplicate refused in either direction by the unique index, self-link refused, unlink leaves both tickets otherwise unchanged

### Implementation for User Story 6

- [ ] T063 [US6] Implement `resolveSurvivor()` with a cycle guard in `backend/src/services/ticket.service.ts`
- [ ] T064 [US6] Implement `merge`, emitting `ticket.merged` and `record.deleted` in the same transaction — the first caller `record.deleted` has had since Phase 1 defined it
- [ ] T065 [US6] Add the merged guard to the shared service path so **every** route inherits it, and confirm `TICKET_MERGED` carries `details.survivorId`
- [ ] T066 [US6] Extend the history read to span the merge chain, labelling each entry with the ticket it was recorded against
- [ ] T067 [US6] Implement `POST /:id/merge` with `authorize('tickets:merge')`
- [ ] T068 [US6] Implement link create and delete in `backend/src/services/ticket-link.service.ts`, normalising each pair so the lower id is `ticket_id`
- [ ] T069 [US6] Implement `POST /:id/links` and `DELETE /:id/links/:linkedId` with `authorize('tickets:link')`
- [ ] T070 [US6] Create `frontend/src/components/tickets/TicketMergeDialog.vue` — names both tickets, states the merge is permanent, does not default focus to confirm, traps focus, and sets focus with `{ immediate: true }`
- [ ] T071 [US6] Create `frontend/src/components/tickets/TicketLinkPanel.vue`
- [ ] T072 [US6] Add the merged banner to `TicketDetailView.vue` as the first element in the DOM, disabling every action control
- [ ] T073 [US6] Add the `includeMerged` toggle to `TicketFilters.vue`
- [ ] T074 [US6] Add merge and link i18n keys, including the permanence warning
- [ ] T075 [P] [US6] Component test in `frontend/tests/tickets/TicketMergeDialog.test.ts`: focus is trapped, confirm is not the default focus, focus returns to the trigger on close

**Checkpoint**: All six stories are independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T076 [P] Confirm `frontend/tests/locales/parity.test.ts` passes with every new key present in both files
- [ ] T077 [P] Run lint, format, and typecheck across both workspaces; resolve the known friction points (no physical Tailwind utilities, no `Record<string, unknown>` cast inside a template)
- [ ] T078 Run the full suite and confirm **no existing Phase 0–2 test needed editing** — if one did, investigate what changed rather than adjusting the test
- [ ] T079 Run quickstart.md V1–V7 against the running app
- [ ] T080 Run quickstart.md **V8 (Arabic and RTL) and V9 (accessibility)** in a browser — deferred through three consecutive phases and carrying the accumulated risk of all of them
- [ ] T081 Update the PLAN.md Phase 3 traceability entry and mark the phase's Definition of done

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: blocks every story. T003–T005 → T009 → everything
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after Foundational; T042 creates the detail view that US3–US6 extend
- **US3 (Phase 5)**, **US5 (Phase 6)**, **US4 (Phase 7)**, **US6 (Phase 8)**: after Foundational; each adds to the detail view, so their front-end tasks serialise on that file even though their back-end tasks do not
- **Polish (Phase 9)**: after all desired stories

### Within Each Story

Tests → service → controller → routes → components → view → i18n.

### Parallel Opportunities

- T004–T005, T010–T014, T021–T022 within Foundational
- All `[P]` test tasks at the head of each story
- Back-end work for US3, US5, and US6 is genuinely independent; their front-end tasks are not, because `TicketDetailView.vue` is one file

---

## Parallel Example: Foundational

```bash
Task: "Create migration 20260828000002-create-ticket-history.cjs"
Task: "Create migration 20260828000003-create-ticket-links.cjs"
Task: "Create the lifecycle declaration in backend/src/tickets/lifecycle.ts"
Task: "Create the taxonomy declaration in backend/src/tickets/taxonomy.ts"
Task: "Create the Ticket model in backend/src/models/ticket.model.ts"
```

---

## Implementation Strategy

### MVP

Phases 1–3. A ticket can be created and found — demonstrable on its own, though not yet the phase's
Definition of done.

### Recommended increments

1. **Setup + Foundational** → migrations run, matrices green
2. **US1** → create and list (MVP)
3. **US2** → the lifecycle, the phase's substance
4. **US3 + US5** → assignment and history; together these complete PLAN.md's Definition of done
5. **US4 + US6** → escalation, merge, and links

Stopping after step 4 would deliver a Phase 3 that satisfies PLAN.md's stated Definition of done,
with escalation and merge as the remaining scoped-but-not-gating work.

---

## Notes

- 81 tasks: 2 setup, 21 foundational, 12 US1, 9 US2, 5 US3, 7 US5, 4 US4, 15 US6, 6 polish
- Two tests are generated rather than hand-written (T020's matrix extension, T036's 36-pair matrix); both read the same constants the services read, so neither can drift from the implementation
- Commit after each task or logical group
