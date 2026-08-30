---
description: 'Task list for Phase 4 — Agent Dashboard'
---

# Tasks: Phase 4 — Agent Dashboard

**Input**: Design documents from `/specs/005-phase-4-agent-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested, Principle II makes the authorization matrix non-optional, and SC-012 makes the new ownership
matrix non-optional too.

**Organization**: Grouped by user story. Stories run **US1 → US2 → US4 → US3 → US5 → US6**, which is
neither numeric nor strictly priority order. Two deliberate deviations:

- **US4 (notifications) precedes US3 (notes and mentions)**, though both are P2, because US3's
  acceptance scenario 3 requires a mention to notify someone. Building US4 first means US3 calls a
  real pipeline instead of a stub that has to be replaced.
- **US5 and US6 are both P3** and are genuinely independent of each other; either order works.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US6 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Directories and configuration. **No new dependencies** — SSE is a wire format Express 5
writes directly and the scheduler is a `setInterval` (research D1, D4).

- [X] T001 Create the module directories `backend/src/lib/`, `backend/src/routes/dashboard/`, `backend/src/routes/notifications/`, `backend/src/routes/tasks/`, `backend/src/routes/templates/`, `backend/src/controllers/dashboard/`, `backend/src/controllers/notifications/`, `backend/src/controllers/tasks/`, `backend/src/controllers/templates/`, `backend/tests/dashboard/`, `backend/tests/notifications/`, `backend/tests/tasks/`, `backend/tests/templates/`, `backend/tests/ticket-notes/`, `frontend/src/components/dashboard/`, `frontend/src/components/notifications/`, `frontend/src/components/templates/`, `frontend/tests/dashboard/`, `frontend/tests/notifications/`, `frontend/tests/templates/`
- [X] T002 [P] Add the `dashboard.*`, `notification.*`, `task.*`, `template.*`, and `ticketNote.*` namespace skeletons to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, so later tasks add keys to an existing branch rather than creating it twice
- [X] T003 [P] Add `DUE_WARNING_LEAD_MINUTES` (positive integer, default 60) to the schema in `backend/src/config/env.ts` and to `.env.example`, so a bad value fails at startup rather than at the first sweep

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissions, models, and the two generated matrices every story is measured by.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. In particular **T014** —
a forgotten test-helper seeder makes every Phase 4 test fail with a 403 that looks nothing like its
cause, exactly as happened in Phases 2 and 3.

- [X] T004 Create migration `backend/src/db/migrations/20260829000001-add-ticket-due-date.cjs` adding `due_at DATETIME NULL` and `due_warning_sent_for DATETIME NULL` to `tickets`, plus index `idx_tickets_due_at (due_at)` per data-model.md
- [X] T005 [P] Create migration `backend/src/db/migrations/20260829000002-create-notifications.cjs`: `user_id`, `type`, nullable `actor_user_id`, `ticket_id`, `task_id`, `note_id`, `read_at`, FKs `ON DELETE RESTRICT`, and indexes `(user_id, read_at)` and `(user_id, created_at)`. **No message column** (research D2)
- [X] T006 [P] Create migration `backend/src/db/migrations/20260829000003-create-ticket-notes.cjs`: `ticket_id`, `author_user_id`, `body TEXT`, `edited_at` distinct from `updated_at`, index `(ticket_id, created_at)`
- [X] T007 [P] Create migration `backend/src/db/migrations/20260829000004-create-ticket-note-mentions.cjs`: `note_id`, `user_id`, and **UNIQUE `(note_id, user_id)`** — this constraint is FR-039, not an optimisation
- [X] T008 [P] Create migration `backend/src/db/migrations/20260829000005-create-tasks.cjs`: `owner_user_id`, `title`, `due_at`, `remind_at`, `reminded_at`, `completed_at`, nullable `ticket_id` and `customer_id` with a CHECK constraint allowing at most one non-null, and indexes `(owner_user_id, completed_at)`, `(remind_at, reminded_at)`, `(ticket_id)`
- [X] T009 [P] Create migration `backend/src/db/migrations/20260829000006-create-reply-templates.cjs`: nullable `title_en`, `title_ar`, `body_en`, `body_ar`, `retired_at`, `created_by_user_id`, index `(retired_at)`
- [X] T010 Verify each `down` in the six new files under `backend/src/db/migrations/` (T004–T009) drops FK constraints before the indexes they depend on, the failure mode Phase 1 hit and Phase 3 re-checked
- [X] T011 Add the eight permission keys from research D6 to the catalog in `backend/src/auth/permissions.ts`: `dashboard:view`, `dashboard:view_any`, `tickets:set_due_date`, `ticket_notes:create`, `ticket_notes:manage`, `tasks:manage`, `templates:use`, `templates:manage`
- [X] T012 Create seeder `backend/src/db/seeders/20260829000001-dashboard-permissions.cjs` granting per role — agent gets `dashboard:view|tickets:set_due_date|ticket_notes:create|tasks:manage|templates:use`; supervisor adds `dashboard:view_any|ticket_notes:manage|templates:manage`; administrator holds the whole catalog as established
- [X] T013 [P] Create seeder `backend/src/db/seeders/20260829000002-starter-templates.cjs` with a small bilingual starter set, including **one deliberately English-only template** so FR-070's single-language path has a fixture from day one
- [X] T014 Register the GRANT seeder in `backend/tests/helpers/database.ts`, keeping the existing note that a later phase must add its own. **Not** the starter-templates seeder: it attributes templates to the seeded administrator through a RESTRICT foreign key, which makes that account undeletable and breaks the existing last-administrator tests. This helper seeds permissions, not content
- [X] T015 [P] Create the `Notification` model in `backend/src/models/notification.model.ts`
- [X] T016 [P] Create the `TicketNote` model in `backend/src/models/ticket-note.model.ts`, mirroring `customer-note.model.ts` including the `edited_at` rationale comment
- [X] T017 [P] Create the `TicketNoteMention` model in `backend/src/models/ticket-note-mention.model.ts`
- [X] T018 [P] Create the `Task` model in `backend/src/models/task.model.ts`
- [X] T019 [P] Create the `ReplyTemplate` model in `backend/src/models/reply-template.model.ts`
- [X] T020 Add `due_at` and `due_warning_sent_for` to the `Ticket` model in `backend/src/models/ticket.model.ts`
- [X] T021 Register the five new models and their associations in `backend/src/models/index.ts`
- [X] T022 Add `DUE_DATE_SET`, `DUE_DATE_CHANGED`, `DUE_DATE_CLEARED`, and `NOTE_ADDED` to `TICKET_EVENTS` in `backend/src/services/ticket-history.service.ts`
- [X] T023 Mount the four new route groups in `backend/src/routes/index.ts` (`/dashboard`, `/notifications`, `/tasks`, `/templates`), each behind `authenticate`
- [X] T024 [P] Confirm `backend/tests/authorization.matrix.test.ts` picks up the eight new keys without edits, and add a row-count assertion so a key added without a grant fails loudly rather than silently passing
- [X] T025 Create `backend/tests/ownership.matrix.test.ts` — a **generated** matrix over user-scoped record types (notification, task) asserting a second user gets `404`, never `403`, on every route. Write it now so US4 and US5 land against an existing gate (SC-012)

**Checkpoint**: migrations run, both matrices green, models registered — user story work can begin.

---

## Phase 3: User Story 1 — An Agent Triages Their Queue From One Screen (Priority: P1) 🎯 MVP

**Goal**: `/dashboard` shows the signed-in agent their assigned tickets, sortable and filterable
server-side, with due dates and overdue marking.

**Independent Test**: Seed tickets across several agents, statuses, and priorities; sign in as one
agent; the queue shows only their tickets, and every sort and filter changes what is shown without a
page change.

### Tests for User Story 1

- [X] T026 [P] [US1] Queue scoping test in `backend/tests/dashboard/queue.test.ts` — an agent sees only their own; `userId` is refused without `dashboard:view_any` and honoured with it; Closed excluded by default; merged always excluded
- [X] T027 [P] [US1] Queue ordering test in `backend/tests/dashboard/queue-ordering.test.ts` — priority follows the rank in `tickets/taxonomy.ts` (not alphabetical); **NULL due dates group at one end in both directions**; sorting and filtering apply across the whole queue, not the loaded page
- [X] T028 [P] [US1] Due-date test in `backend/tests/dashboard/due-date.test.ts` — a past date is accepted; clearing works; a Closed ticket is never overdue; every set/change/clear writes a history entry with previous and new value; the endpoint is refused without `tickets:set_due_date` even when the caller may view the ticket
- [X] T029 [P] [US1] `QueueTable` component test in `frontend/tests/dashboard/QueueTable.test.ts` — overdue renders text or an icon, not colour alone; NULL due dates group at one end; the two empty states render distinct messages

### Implementation for User Story 1

- [X] T030 [US1] Create `backend/src/services/ticket-due.service.ts` — set, change, clear, the overdue predicate against the server clock, and the history write. A separate service on purpose: it is the seam Phase 6 replaces (FR-028)
- [X] T031 [US1] Create `backend/src/services/dashboard.service.ts` with the queue query per research D7 — `ORDER BY (due_at IS NULL), due_at` for stable NULL grouping, and a `FIELD(...)` rank built **from `tickets/taxonomy.ts`**, never a second hardcoded list
- [X] T032 [US1] Create `backend/src/controllers/dashboard/dashboard.controller.ts` with `zod` validation for the query parameters in contracts/dashboard-api.md
- [X] T033 [US1] Create `backend/src/routes/dashboard/dashboard.routes.ts` and `index.ts`, gating `GET /api/dashboard/queue` on `dashboard:view` and the `userId` branch on `dashboard:view_any`
- [X] T034 [US1] Add `PUT /api/tickets/:id/due-date` to `backend/src/controllers/tickets/tickets.controller.ts` and `backend/src/routes/tickets/tickets.routes.ts`, gated on `tickets:set_due_date`, carrying the Phase 3 optimistic `version`
- [X] T035 [P] [US1] Create `frontend/src/services/dashboard.service.ts` with the queue and due-date calls
- [X] T036 [P] [US1] Create `frontend/src/stores/dashboard.store.ts` holding queue state, filters, and sort
- [X] T037 [US1] Create `frontend/src/components/dashboard/QueueFilters.vue` — status, priority, and overdue filters, combinable, with active filters visible and a clear action reachable from the no-matches state
- [X] T038 [US1] Create `frontend/src/components/dashboard/QueueTable.vue` — the columns in FR-002, sort controls in both directions, paging, and the two distinct empty states
- [X] T039 [P] [US1] Create `frontend/src/components/dashboard/DueDateBadge.vue` — overdue conveyed by text **and** icon, never colour alone
- [X] T040 [P] [US1] Create `frontend/src/components/tickets/DueDateControl.vue` — set, change, clear; hidden without the permission; a past date accepted without a confirmation dialog; `isOverdue` read from the server, never computed client-side
- [X] T041 [US1] Create `frontend/src/views/DashboardView.vue` with the queue region, and the supervisor's whose-queue selector shown only with `dashboard:view_any`
- [X] T042 [US1] Add the `/dashboard` route to `frontend/src/router/index.ts` with `meta.permission = 'dashboard:view'` and a nav entry in `frontend/src/layouts/DefaultLayout.vue`
- [X] T043 [US1] Add all US1 keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` — column headers, filter labels, both empty states, overdue badge text

**Checkpoint**: an agent can open one screen and triage their queue. This is the MVP.

---

## Phase 4: User Story 2 — The Customer Is Visible Beside the Ticket (Priority: P1)

**Goal**: The customer's identity, contacts, other tickets, and recent notes appear beside the open
ticket, and the ticket stays fully workable without the panel.

**Independent Test**: Open a ticket for a customer with several other tickets; the panel shows
identity, contacts, and other tickets, and the ticket remains workable with the panel open.

### Tests for User Story 2

- [X] T044 [P] [US2] Context endpoint test in `backend/tests/dashboard/context.test.ts` — returns identity, bounded other-tickets and recent-notes; `403` without `customers:view`; a deactivated customer returns normally with `isActive: false`
- [X] T045 [P] [US2] `CustomerContextPanel` test in `frontend/tests/dashboard/CustomerContextPanel.test.ts` — absent without `customers:view` while every ticket action still renders; deactivated customer marked

### Implementation for User Story 2

- [X] T046 [US2] Add the context aggregation to `backend/src/services/dashboard.service.ts` — one query set, bounded and most-recent-first, reusing the existing customer and ticket services rather than new queries
- [X] T047 [US2] Add `GET /api/tickets/:id/context` to `backend/src/controllers/tickets/tickets.controller.ts` and `backend/src/routes/tickets/tickets.routes.ts`, requiring both `tickets:view` and `customers:view`
- [X] T048 [P] [US2] Add the context call to `frontend/src/services/tickets.service.ts`
- [X] T049 [US2] Create `frontend/src/components/tickets/CustomerContextPanel.vue` — every item a link to the underlying record, deactivated state marked, side determined by document direction
- [X] T050 [US2] Wire the panel into `frontend/src/views/tickets/TicketDetailView.vue` so it renders beside the ticket, and **its absence blocks no ticket action** (FR-018)
- [X] T051 [US2] Add US2 keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`

**Checkpoint**: PLAN.md's "without navigating away" is satisfied. US1 + US2 together are a demonstrable
dashboard.

---

## Phase 5: User Story 4 — The System Speaks First (Priority: P2)

**Goal**: Notifications persist, reach a connected agent live, survive a dropped connection, and are
private to their recipient.

**Independent Test**: With two sessions open, assign a ticket in one; the other receives the
notification without reloading, and opening it marks it read.

**Sequenced before US3** because US3's mention notification consumes this pipeline.

### Tests for User Story 4

- [X] T052 [P] [US4] Notification core test in `backend/tests/notifications/notifications.test.ts` — persisted before emit; unread count; mark one and mark all; a user is never notified of their own action; bounded paging
- [X] T053 [P] [US4] Merge resolution test in `backend/tests/notifications/merged-subject.test.ts` — a notification whose ticket was merged resolves to the survivor **at read time** (FR-052)
- [X] T054 [P] [US4] Stream test in `backend/tests/notifications/stream.test.ts` — the route requires authentication, returns `text/event-stream` with no-cache headers, and rejects an absent or invalid token exactly as every other protected route does
- [X] T055 [P] [US4] Scheduler due-warning test in `backend/tests/scheduler.test.ts` — `runScheduledSweeps(now)` called directly with a controlled clock: warns once, does **not** re-fire when the same date is re-saved, re-arms when the date genuinely changes, never warns a Closed or merged or unassigned ticket
- [X] T056 [P] [US4] `NotificationList` test in `frontend/tests/notifications/NotificationList.test.ts` — every type composes from locale keys in **both** languages; opening marks read; the live region is polite and does not move focus

### Implementation for User Story 4

- [X] T057 [US4] Create `backend/src/lib/notification-hub.ts` — an in-process `EventEmitter` keyed by recipient id, with one publish and one subscribe path. **It decides nothing**: no filtering, no permission check, no formatting
- [X] T058 [US4] Create `backend/src/services/notification.service.ts` — persist inside the caller's transaction, emit **after commit**, suppress self-notification, and resolve merged ticket subjects on read
- [X] T059 [US4] Create `backend/src/controllers/notifications/notifications.controller.ts` and `backend/src/routes/notifications/` for `GET /api/notifications` (with `unreadOnly`, `since`, paging, and `unreadCount` on every page), `POST /:id/read`, and `POST /read-all` — ownership enforced in the service, another user's record returning `404`
- [X] T060 [US4] Add `GET /api/notifications/stream` to the same route group — held response, `text/event-stream`, a 30-second keep-alive comment, and listener removal on `close`
- [X] T061 [US4] Create `backend/src/lib/scheduler.ts` exporting `runScheduledSweeps(now)` plus a thin interval wrapper, with the due-soon sweep from contracts/notifications.md — the `due_warning_sent_for <> due_at` clause is FR-045 and must not be simplified to a boolean
- [X] T062 [US4] Start the scheduler in `backend/src/server.ts` — **never in `app.ts`**, or every test that imports the app leaks timers
- [X] T063 [US4] Emit `ticket.assigned` from the assignment path in `backend/src/services/ticket.service.ts`, inside the existing transaction
- [X] T064 [P] [US4] Create `frontend/src/services/notifications.service.ts` including the stream reader built on `fetch()` + `ReadableStream` — **not `EventSource`**, which cannot send the `Authorization` header (research D1)
- [X] T065 [P] [US4] Create `frontend/src/stores/notifications.store.ts` holding the list, the unread count, and the last-seen id
- [X] T066 [US4] Create `frontend/src/composables/useNotificationStream.ts` — connect on sign-in, exponential backoff 1s→30s jittered, refresh once on `401` through the existing single-flight path in `http.ts`, and call `?since=<last id>` on every connect to fill the gap
- [X] T067 [US4] Create `frontend/src/components/notifications/NotificationBell.vue` and mount it in `frontend/src/layouts/DefaultLayout.vue` so the unread count is visible from every screen
- [X] T068 [US4] Create `frontend/src/components/notifications/NotificationList.vue` and `NotificationItem.vue` — newest first, paged, mark-all-read, keyboard operable, and a **polite live region that announces arrivals without moving focus** (FR-083)
- [X] T069 [US4] Add `notification.type.ticketAssigned`, `.noteMentioned`, `.taskReminder`, `.ticketDueSoon` with actor and reference parameters to `frontend/src/locales/en.json` and `ar.json` — the server sends no sentence, so a missing key here is a blank notification

**Checkpoint**: the system speaks first. Blocking the stream must leave the dashboard fully usable
(quickstart V5.3).

---

## Phase 6: User Story 3 — Colleagues Talk On the Ticket, Not Around It (Priority: P2)

**Goal**: Internal notes with @mentions on a ticket, notifying the mentioned colleague.

**Independent Test**: Add a note mentioning another user; sign in as that user; they were notified and
the note is legible to any permitted viewer.

### Tests for User Story 3

- [X] T070 [P] [US3] Note test in `backend/tests/ticket-notes/notes.test.ts` — create, list oldest-first and paged, author may edit their own and `edited_at` is set, another user's note needs `ticket_notes:manage`, a note stays readable and attributed after its author is deactivated, Arabic bodies round-trip exactly
- [X] T071 [P] [US3] Mention test in `backend/tests/ticket-notes/mentions.test.ts` — one notification per distinct mention, **duplicates in one body produce one**, self-mention produces none, a user who cannot view the ticket is refused with `MENTION_NOT_VISIBLE`, exceeding the limit returns `MENTION_LIMIT` with the limit in the message
- [X] T072 [P] [US3] `MentionPicker` test in `frontend/tests/dashboard/MentionPicker.test.ts` — open on trigger, arrow-key navigation, Enter to select, Escape to dismiss, and a refused mention surfaced accessibly

### Implementation for User Story 3

- [X] T073 [US3] Create `backend/src/services/ticket-note.service.ts` — parse `@[user:id]` tokens from the body, resolve against active users who may view the ticket, write mention rows (the UNIQUE constraint enforces dedupe), and set `edited_at` on edit
- [X] T074 [US3] Add `GET /api/tickets/:id/mentionable-users` returning only users who **can view this ticket**, so the picker cannot offer someone the note would then be refused for
- [X] T075 [US3] Create `backend/src/controllers/tickets/ticket-notes.controller.ts` and add the note routes to `backend/src/routes/tickets/tickets.routes.ts` — list on `tickets:view`, create on `ticket_notes:create`, edit on `ticket_notes:create` for one's own and `ticket_notes:manage` for another's
- [X] T076 [US3] Write a `NOTE_ADDED` history entry from `backend/src/services/ticket-note.service.ts` through `backend/src/services/ticket-history.service.ts`, recording **that** a note happened without copying the body into `ticket_history` (FR-078)
- [X] T077 [US3] Emit `note.mentioned` from `backend/src/services/ticket-note.service.ts` through `backend/src/services/notification.service.ts` for each distinct mentioned user, inside the note's transaction
- [X] T078 [P] [US3] Create `frontend/src/services/ticket-notes.service.ts`
- [X] T079 [US3] Create `frontend/src/components/tickets/TicketNoteThread.vue` — oldest first, paged, author and time, edited marker, `@[user:12]` tokens rendered from the `mentions` array and visually distinguished
- [X] T080 [US3] Create `frontend/src/components/tickets/TicketNoteComposer.vue` with the mention trigger and accessible error display for `MENTION_NOT_VISIBLE` and `MENTION_LIMIT`
- [X] T081 [US3] Create `frontend/src/components/tickets/MentionPicker.vue` — fully keyboard operable with `aria-activedescendant` and a visible focus indicator in both directions
- [X] T082 [US3] Wire the thread and composer into `frontend/src/views/tickets/TicketDetailView.vue` and add US3 keys to both locale files

**Checkpoint**: colleagues can hold a conversation on the ticket, and being named reaches someone.

---

## Phase 7: User Story 5 — Follow-Ups Do Not Live In Someone's Head (Priority: P3)

**Goal**: Personal tasks against a ticket or customer, with reminders that fire even across a restart.

**Independent Test**: Create a task with a due date and reminder; it appears on the dashboard, the
reminder arrives, and it can be completed.

### Tests for User Story 5

- [X] T083 [P] [US5] Task test in `backend/tests/tasks/tasks.test.ts` — the owner comes from the session and an owner field in the body is **rejected**, at most one of `ticketId`/`customerId`, complete records the time and leaves the outstanding list without deleting, reopen clears it, another user's task returns `404`
- [X] T084 [P] [US5] Reminder test in `backend/tests/tasks/reminders.test.ts` — `runScheduledSweeps(now)` fires a reminder exactly once; **a reminder whose time passed while the process was "down" still fires on the next sweep** (FR-063); changing `remind_at` re-arms; clearing it cancels
- [X] T085 [P] [US5] Ticket-integration test in `backend/tests/tasks/ticket-integration.test.ts` — merging repoints `tasks.ticket_id` at the survivor; closing a ticket returns its outstanding tasks and is **not refused** because one is open

### Implementation for User Story 5

- [X] T086 [US5] Create `backend/src/services/task.service.ts` — owner from the session context only, the one-link invariant enforced alongside the schema CHECK, and `reminded_at` cleared whenever `remind_at` changes
- [X] T087 [US5] Create `backend/src/controllers/tasks/tasks.controller.ts` and `backend/src/routes/tasks/` for list, create, patch, complete, and reopen — all gated on `dashboard:view` / `tasks:manage` **and** scoped to the owner in the service
- [X] T088 [US5] Add the reminder sweep to `backend/src/lib/scheduler.ts` — `remind_at <= now AND reminded_at IS NULL AND completed_at IS NULL`, **with no lower bound**, which is what makes FR-063 true by construction
- [X] T089 [US5] Repoint `tasks.ticket_id` at the survivor in the merge path of `backend/src/services/ticket.service.ts`, inside the existing merge transaction
- [X] T090 [US5] Return outstanding tasks from the close path in `backend/src/services/ticket.service.ts` so the interface can surface them — closing is never refused because a task is open (FR-064)
- [X] T091 [P] [US5] Create `frontend/src/services/tasks.service.ts` and `frontend/src/stores/tasks.store.ts`
- [X] T092 [US5] Create `frontend/src/components/dashboard/TaskList.vue` and `TaskForm.vue` — overdue marked by text and icon, inline create, complete and reopen in place, and **no owner field rendered anywhere**
- [X] T093 [US5] Mount the task region in `frontend/src/views/DashboardView.vue`, surface outstanding tasks on ticket close, and add US5 keys to both locale files

**Checkpoint**: a promise made on Thursday is waiting on Thursday, even if the server restarted.

---

## Phase 8: User Story 6 — The Same Answer Is Not Retyped Fifty Times (Priority: P3)

**Goal**: A shared, bilingual, permissioned template library that inserts into the note composer or
copies to the clipboard.

**Independent Test**: Create a template, insert it into a note from a ticket, and confirm the inserted
text is editable before it is saved.

### Tests for User Story 6

- [X] T094 [P] [US6] Template test in `backend/tests/templates/templates.test.ts` — search matches title and body in either language; creating with neither complete language pair returns `TEMPLATE_LANGUAGE_REQUIRED`; retiring removes it from the picker and changes nothing already written; `templates:use` cannot create, edit, or retire; management writes an audit entry and ordinary note activity does not
- [X] T095 [P] [US6] `TemplatePicker` test in `frontend/tests/templates/TemplatePicker.test.ts` — the active language's version is inserted; a single-language template is offered **with its language identified**; inserted text remains editable

### Implementation for User Story 6

- [X] T096 [US6] Create `backend/src/services/template.service.ts` — search, the `availableLanguages` projection, retirement rather than deletion, and the audit write for management actions
- [X] T097 [US6] Create `backend/src/controllers/templates/templates.controller.ts` and `backend/src/routes/templates/` — list and search on `templates:use`; create, patch, and retire on `templates:manage`; `zod` enforcing at least one complete language pair
- [X] T098 [P] [US6] Create `frontend/src/services/templates.service.ts`
- [X] T099 [US6] Create `frontend/src/components/templates/TemplatePicker.vue` — search, preview, insert into the composer, and copy to clipboard; keyboard operable throughout
- [X] T100 [US6] Create `frontend/src/views/admin/TemplatesView.vue` with create, edit, and retire, and add the `/admin/templates` route to `frontend/src/router/index.ts` with `meta.permission = 'templates:manage'`
- [X] T101 [US6] Wire the picker into `frontend/src/components/tickets/TicketNoteComposer.vue` and add US6 keys to both locale files

**Checkpoint**: all six stories functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T102 [P] Add a locale parity assertion to `frontend/tests/` proving `en.json` and `ar.json` hold **identical key sets** (SC-017), so a one-sided key fails the build rather than surfacing as a blank label in Arabic
- [ ] T103 [P] Keyboard pass over every control introduced by this phase in both directions — queue sort and filter, due-date control, mention picker, template picker, task controls, notification list — confirming a visible focus indicator throughout (FR-082)
- [ ] T104 RTL pass over `DashboardView`, `CustomerContextPanel`, `NotificationList`, and both pickers, confirming direction comes from the document root and no component flips itself (FR-081)
- [ ] T105 [P] Grayscale pass confirming overdue, escalated, and unread remain distinguishable with colour removed (FR-084)
- [ ] T106 Run the full `specs/005-phase-4-agent-dashboard/quickstart.md` V1–V9, including the three checks a test runner cannot make: a reminder that survives a restart (V6), a blocked stream leaving the dashboard usable (V5.3), and an arriving notification announced without stealing focus (V9)
- [X] T107 Record the phase closeout in `specs/005-phase-4-agent-dashboard/plan.md` — confirm PLAN.md's Phase 4 Definition of done is traceable to merged code, and carry the single-process limit from Complexity Tracking forward where Phase 11 will find it

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational; independent of US1, though both land on the dashboard
- **US4 (Phase 5)**: depends on Foundational
- **US3 (Phase 6)**: depends on Foundational, and on **US4** for the mention notification (T077)
- **US5 (Phase 7)**: depends on Foundational, and on **US4** for the reminder notification (T088)
- **US6 (Phase 8)**: depends on Foundational only — fully independent
- **Polish (Phase 9)**: depends on whichever stories shipped

### Within Each User Story

Tests written first and failing → services → controllers and routes → frontend services and stores →
components → views and locale keys.

### Parallel Opportunities

- T005–T009 (five migrations, five files) run together after T004
- T015–T019 (five models) run together
- Every test task marked `[P]` within a story runs together
- **US6 can be built in parallel with everything after Foundational** — it touches no shared file
  except the locale files and the router
- US1 and US2 can run in parallel until they meet in `DashboardView` and `TicketDetailView`

---

## Parallel Example: Foundational

```bash
Task: "Create migration 20260829000002-create-notifications.cjs"
Task: "Create migration 20260829000003-create-ticket-notes.cjs"
Task: "Create migration 20260829000004-create-ticket-note-mentions.cjs"
Task: "Create migration 20260829000005-create-tasks.cjs"
Task: "Create migration 20260829000006-create-reply-templates.cjs"
```

## Parallel Example: User Story 4 tests

```bash
Task: "Notification core test in backend/tests/notifications/notifications.test.ts"
Task: "Merge resolution test in backend/tests/notifications/merged-subject.test.ts"
Task: "Stream test in backend/tests/notifications/stream.test.ts"
Task: "Scheduler due-warning test in backend/tests/scheduler.test.ts"
Task: "NotificationList test in frontend/tests/notifications/NotificationList.test.ts"
```

---

## Implementation Strategy

### MVP

Phases 1–3. An agent opens one screen and triages their queue — half of PLAN.md's Definition of done,
demonstrable on its own.

### Recommended increments

1. **Setup + Foundational** → migrations run, both matrices green
2. **US1** → the queue (MVP)
3. **US2** → customer context; together with US1 this satisfies *"triage from one screen without
   navigating away"*
4. **US4** → notifications; this completes PLAN.md's Definition of done
5. **US3** → notes and mentions, which give mention notifications something to carry
6. **US5 + US6** → tasks, reminders, and templates

Stopping after step 4 delivers a Phase 4 that satisfies PLAN.md's stated Definition of done, with
notes, tasks, and templates as the remaining scoped-but-not-gating work.

---

## Notes

- 107 tasks: 3 setup, 22 foundational, 18 US1, 8 US2, 18 US4, 13 US3, 11 US5, 8 US6, 6 polish
- **T014 is the trap.** Every phase so far has lost time to a forgotten test-helper seeder; it is
  called out in the Foundational warning for that reason
- Two tests are generated rather than hand-written (T024's matrix extension, T025's ownership
  matrix); both read the same declarations the services read, so neither can drift
- Three guarantees have no test-runner equivalent and are covered only by T106: a reminder surviving a
  restart, a blocked stream leaving the dashboard usable, and a notification announced without
  stealing focus
- Commit after each task or logical group
