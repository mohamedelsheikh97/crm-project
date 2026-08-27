---
description: "Task list for Phase 2 — Customer Management"
---

# Tasks: Phase 2 — Customer Management

**Input**: Design documents from `/specs/003-phase-2-customer-management/`

**PLAN.md Reference**: Phase 2 — Customer Management

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Branch**: `003-phase-2-customer-management`, cut from `main` @ `7a4aa0e` (Phase 1 merged and pushed).

**Tests**: **YES — required.** Phase 1 established Vitest, supertest, and `@vue/test-utils`. The
permission matrix is generated from the catalog, so it extends to this phase automatically. Test
tasks are not optional here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US6]`, mapping to the user stories in spec.md
- Every task states its exact file path

---

## READ THIS FIRST — Non-negotiable rules for the implementing model

These are the failure modes most likely to sink this phase. Violating any of them means the task is
not done, even if the code runs and the tests pass.

1. **Phone normalisation happens in exactly ONE place** — `backend/src/lib/phone.ts` — used by
   contact writes, by search, and by duplicate detection. Three callers each normalising slightly
   differently is precisely how SC-002 rots (research.md D1). **This is the Definition of done**: if
   `+20 100 123 4567` and `01001234567` are not recognised as the same number, the phase is not done
   however well everything else works.
2. **ONE duplicate detector, both code paths.** `duplicate.service.ts` is called by create **and** by
   update. FR-017 and FR-021 are the same rule at two moments and must not drift. The update path is
   a second path the creation tests do not exercise — the spec's checklist flagged it as easy to
   overlook, so it gets its own tests.
3. **Never display the normalised phone.** Users see `value_raw`, exactly as typed. Showing
   `+201001234567` where the record says `+20 100 123 4567` looks like a bug. Normalisation is a
   matching concern only.
4. **Attachment filenames are generated, never the user's.** `original_name` is display and
   `Content-Disposition` only. It is attacker-controlled input, and `../..` in one is how it becomes
   a path.
5. **Write the file BEFORE committing the row.** On commit failure, delete the file. An orphan file
   is harmless and sweepable; a committed row pointing at a file that was never written is a broken
   download (FR-034).
6. **Attachment type comes from sniffed CONTENT**, never the extension or the client's
   `Content-Type`. Both are claims (FR-032).
7. **The storage directory is NEVER served statically.** Every download streams through an
   authenticated, permission-checked endpoint (FR-033). Static serving makes a file reachable by
   anyone who obtains its address, which is the same defect as not checking at all.
8. **`duplicates` is a SIBLING of `error`, not inside it.** Phase 0's `details[]` is
   `{field, message}` pairs; abusing it to carry a customer summary breaks a field with a defined
   meaning (research.md D5).
9. **A protected route needs THREE things**: a catalog entry in `backend/src/auth/permissions.ts`, a
   `requirePermission` on the route, and a grant decision in the seeder. Miss any and the matrix test
   fails the build. **That failure is the feature.**
10. **State-changing audit writes go inside the action's transaction**, as Phase 1 established. There
    is no path where a customer change succeeds unrecorded.
11. **Logical Tailwind utilities only.** `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`,
    `start-*`, `end-*`. **Never** `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`.
12. **No hardcoded user-visible strings**, and `ar.json` / `en.json` keep identical key sets —
    including validation messages, empty states, dialog text, and the upload limits shown on screen.
13. **ESM import extensions.** Backend relative imports carry `.js` even though the source is `.ts`.
14. **Do not build what was ruled out.** No customer delete path (Q1). No note-visibility column
    (Q2). No virus scanning or scan-state column (Q3). No record merging, no bulk import, no
    structured address, no per-agent ownership.
15. **`version` is required on every `PATCH`**; stale is `409 CONFLICT`, never a silent overwrite.

**Canonical values** (do not invent alternatives):

| Thing | Value |
|---|---|
| New permission modules | `customers`, `notes`, `attachments` |
| Duplicate error code | `DUPLICATE_CUSTOMER` (HTTP `409`) |
| Export audit action | `data.exported` — the key Phase 1 defined |
| Customer audit prefix | `customer.*` (e.g. `customer.duplicate.overridden`) |
| Normalisation module | `backend/src/lib/phone.ts` |
| Default phone region | `DEFAULT_PHONE_REGION`, default `EG` |
| Attachment size limit | `ATTACHMENT_MAX_BYTES`, default `10485760` (10 MB) |
| Attachment storage | `ATTACHMENT_STORAGE_PATH`, default `./storage/attachments` |
| Page size default / max | `25` / `100` (clamped, not rejected) |
| Customer routes | `/api/customers` (top level, **not** under `/api/admin`) |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, configuration, and the permission entries every later phase enforces.

- [X] T001 Install backend dependencies at the repository root:
      `libphonenumber-js` (1.13.x), `multer` (2.x), `@types/multer`, `file-type` (22.x). Add to
      `backend/package.json` dependencies (`@types/multer` to devDependencies). Each is fixed by
      research.md D1–D2 — do not substitute. **Verify**: `npm ls libphonenumber-js multer file-type`
      resolves and the root `package-lock.json` remains the only lockfile.

- [X] T002 [P] Add the four new variables to `.env.example` with commentary matching the existing
      style: `ATTACHMENT_STORAGE_PATH=./storage/attachments`, `ATTACHMENT_MAX_BYTES=10485760`,
      `ATTACHMENT_ALLOWED_TYPES=...` (the list in data-model.md), `DEFAULT_PHONE_REGION=EG`. Note in
      the comment block that the storage path must never sit under a route that is served statically.

- [X] T003 Extend the zod schema in `backend/src/config/env.ts` with those four: path as a non-empty
      string, `ATTACHMENT_MAX_BYTES` a positive integer, `ATTACHMENT_ALLOWED_TYPES` a comma-separated
      list parsed into a string array, `DEFAULT_PHONE_REGION` a two-letter uppercase code. All
      optional with the defaults above so an existing `.env` keeps working. This file remains the
      only place `process.env` is read.

- [X] T004 [P] Add a named volume for attachment storage to `docker-compose.yml` at the repository root, mounted at the
      configured path, so uploads survive a container restart. Add `storage/` to `.gitignore` — an
      uploaded customer file must never be committed.

- [X] T005 Add the nine new entries to `backend/src/auth/permissions.ts` using the existing `define`
      helper: `customers` × (`view`, `create`, `update`, `deactivate`, `export`), `notes` ×
      (`create`, `manage`), `attachments` × (`upload`, `delete`). **The matrix test will now fail**
      until each has a grant and a route — that is the mechanism working, not a problem to route
      around.

- [X] T006 Create `backend/src/db/seeders/20260827000001-customer-permissions.cjs` (**CommonJS**)
      adding the default grants from data-model.md: Agent gains `customers:view|create|update`,
      `notes:create`, `attachments:upload`; Supervisor additionally gains `customers:deactivate`,
      `customers:export`, `notes:manage`, `attachments:delete`; Administrator gains every catalog
      key. **Reconciling, never deleting** — it must not wipe an Administrator's deliberate changes.
      Follow the pattern in the Phase 1 role-permissions seeder.

- [X] T007 Add the new permission probes to `backend/tests/authorization.matrix.test.ts` — one entry
      per new key in the `PROBES` map, pointing at the route that will enforce it. The routes do not
      exist yet, so these fail until their phase lands; that is the intended sequence.

**Checkpoint**: `npm test` runs; the matrix test fails on the nine new keys, which is expected and
correct at this point.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, the two mechanism libraries, and the plumbing every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### The load-bearing library

- [X] T008 Create `backend/src/lib/phone.ts` — **the single normalisation site** (rule 1,
      research.md D1). Export `normalisePhone(raw: string): string` returning E.164 via
      `libphonenumber-js` parsed against `env.DEFAULT_PHONE_REGION`, falling back to digits-only when
      the number will not parse (an unparseable number is still stored and still searchable);
      `normaliseEmail(raw: string): string` returning trimmed lowercase; and
      `normaliseContact(kind, raw)` dispatching between them. Pure functions, no model access, no
      business rules — which is why this lives in `lib/` and not `services/`.

- [X] T009 [P] Create `backend/tests/customers/phone.test.ts` (quickstart **B2**) — a table of real
      formats asserting which pairs normalise to the same value: `+20 100 123 4567` vs
      `01001234567` vs `0100-123-4567` vs `+201001234567`; an international number that must **not**
      collide with a local one sharing a digit tail; an extension; and unparseable input that must
      still produce a stable, searchable value. **This test is where the Definition of done either
      works or does not.**

### Migrations

- [X] T010 Create `backend/src/db/migrations/20260827000001-create-customers.cjs` (**CommonJS**)
      creating `customers` per data-model.md: `id`, `display_name`, `company`, `address` (TEXT),
      `is_active` (default true), `created_by_user_id` (nullable FK → `users.id`), `version`
      (default 0), timestamps. Indexes on `is_active`, `display_name`, `company`. `down` drops the
      table.

- [X] T011 Create `backend/src/db/migrations/20260827000002-create-customer-contacts.cjs` creating
      `customer_contacts`: `id`, `customer_id` (FK, cascade), `kind` ENUM('phone','email'),
      `value_raw`, `value_normalised`, `is_primary`, timestamps. **Index `value_normalised`** — every
      duplicate check and contact search is a lookup against it — plus `customer_id` and composite
      `(customer_id, kind)`. **Deliberately NOT unique**: FR-023 requires a shared number to be
      enterable after an explicit decision.

- [X] T012 [P] Create `backend/src/db/migrations/20260827000003-create-customer-notes.cjs` creating
      `customer_notes`: `id`, `customer_id` (FK, cascade), `author_user_id` (FK), `body` (TEXT),
      `edited_at` (nullable), timestamps. Composite index `(customer_id, created_at)`. **No
      visibility column** (rule 14).

- [X] T013 [P] Create `backend/src/db/migrations/20260827000004-create-customer-attachments.cjs`
      creating `customer_attachments`: `id`, `customer_id` (FK, cascade), `uploaded_by_user_id` (FK),
      `original_name`, `storage_key` (**unique**), `content_type`, `size_bytes`, `created_at` only —
      an attachment is written once, so there is no `updated_at`. Composite index
      `(customer_id, created_at)`. **No scan-state column** (rule 14).

- [X] T014 [P] Create `backend/src/db/migrations/20260827000005-create-duplicate-overrides.cjs`
      creating `customer_duplicate_overrides`: `id`, `customer_id` (FK), `matched_customer_id` (FK),
      `decided_by_user_id` (FK), `matched_on` ENUM, `matched_value`, `created_at`. Indexes on both
      customer columns.

- [X] T015 Run `npm run db:migrate`, then `npm run db:migrate:undo` five times, then re-apply.
      **Verify**: all five tables appear and every `down` works. Phase 1 found three migration bugs
      this way — assuming `down` works is how they hid.

### Models

- [X] T016 [P] Create `backend/src/models/customer.model.ts` with `version: true` for optimistic
      locking (FR-045), mirroring the pattern `user.model.ts` established. **No destroy path** — no
      delete method, no endpoint, nothing (rule 14).

- [X] T017 [P] Create `backend/src/models/customer-contact.model.ts`. A setter on `value_raw` must
      **not** rewrite what the user typed; `value_normalised` is set explicitly by the service using
      `lib/phone.ts` (rules 1 and 3).

- [X] T018 [P] Create `backend/src/models/customer-note.model.ts`.

- [X] T019 [P] Create `backend/src/models/customer-attachment.model.ts` with `timestamps: true,
      updatedAt: false`.

- [X] T020 [P] Create `backend/src/models/duplicate-override.model.ts`.

- [X] T021 Update `backend/src/models/index.ts` with all five models and their associations, declared
      in one place as Phase 1 did.

### File storage mechanism

- [X] T022 Create `backend/src/lib/file-storage.ts` implementing research.md D2. Export
      `store(buffer, extension): Promise<{ storageKey, absolutePath }>` which generates a UUID-based
      key — **never the user's filename** (rule 4) — and writes under `env.ATTACHMENT_STORAGE_PATH`;
      `readStream(storageKey)`; `remove(storageKey)`; and `resolvePath(storageKey)` which **rejects
      any key that is not a plain generated identifier**, so a crafted key cannot escape the
      directory. Creates the directory on first use. Pure mechanism, no model access.

- [X] T023 Create `backend/src/middleware/upload.ts` wrapping `multer` with memory storage and
      `limits.fileSize` set from `env.ATTACHMENT_MAX_BYTES`, so an oversized upload is refused
      **before anything reaches disk** (FR-031). Translate multer's limit error into the project's
      `413` response rather than letting it surface raw.

### Duplicate detection

- [X] T024 Create `backend/src/services/duplicate.service.ts` — **the single detector** (rule 2).
      Export `findDuplicates({ contacts, excludeCustomerId })` returning every match as
      `{ matchedOn, matchedValue, customer }`. It normalises through `lib/phone.ts`, queries
      `customer_contacts.value_normalised`, **includes deactivated customers** (FR-019), returns
      **all** matches rather than the first (FR-022), and excludes the customer being edited.

- [X] T025 Add a `duplicateCustomer(matches)` factory to `backend/src/errors/app-error.ts` producing
      a `409` with code `DUPLICATE_CUSTOMER` and carrying the matches. Extend the error handler in
      `backend/src/middleware/error-handler.ts` to serialise them as a **sibling** of `error`, never
      inside `details` (rule 8). Every other response shape is unchanged.

### Routing and frontend plumbing

- [X] T026 Create `backend/src/routes/customers/index.ts` applying `authenticate` and
      `requirePasswordChange` once for the group, and register it in `backend/src/routes/index.ts`
      under `/customers` — **top level, not under `/admin`** (customers are everyday Agent work).

- [X] T027 [P] Create `frontend/src/services/customers.service.ts` with typed `list`, `get`,
      `create`, `update`, `deactivate`, `reactivate`, and `checkDuplicates`, delegating to `http.ts`.
      The `create`/`update` error path must surface the `duplicates` sibling so callers can act on it.

- [X] T028 [P] Create `frontend/src/stores/customers.store.ts` holding the current search term,
      filters, page, and loading state. No token handling.

- [X] T029 Add `/customers` routes to `frontend/src/router/index.ts` per
      [contracts/customer-ui.md](./contracts/customer-ui.md), each with `meta.titleKey` and
      `meta.permission`. Add a Customers entry to `frontend/src/layouts/DefaultLayout.vue`, shown
      when the user holds `customers:view`.

**Checkpoint**: migrations reversible, phone normalisation proven by T009, and both mechanism
libraries exist. User stories can begin.

---

## Phase 3: User Story 1 — Agent Finds a Customer (Priority: P1) 🎯 MVP

**Goal**: One search box finds a customer by name, phone, email, or company — including a phone typed
differently from how it was stored.

**Independent Test**: quickstart **V1** and **B7**. Seed customers, search by each of the four fields,
confirm partial matching works and a non-match offers to create.

**Maps to**: FR-010–FR-016 · SC-001, SC-002, SC-010 · PLAN.md Definition of done part 1

- [X] T030 [P] [US1] Create `backend/tests/customers/search.test.ts` (**B7**): one term finds by
      name, company, phone, and email; partial name matching; phone found regardless of formatting on
      either side; **an Arabic name found by partial search** (B8 overlaps here); deactivated
      excluded by default and included on request; `pageSize=10000` clamped to 100.

- [X] T031 [US1] Create `backend/src/services/customer.service.ts` with `list({ search, company,
      isActive, page, pageSize })` implementing research.md D3: normalise the term through
      `lib/phone.ts` and match phone/email **exactly** against the indexed `value_normalised`, and
      name/company by substring. Merge and rank exact contact matches above substring name matches.
      Clamp `pageSize` to 100. Exclude inactive by default (FR-008). Also `getById` returning the
      full record with contacts.

- [X] T032 [US1] Create `backend/src/controllers/customers/customers.controller.ts` with `list` and
      `get`. HTTP concerns only. Return `matchedOn` per row so the interface can show **why** a record
      matched — searching a number and getting unexplained names is disorienting.

- [X] T033 [US1] Create `backend/src/routes/customers/customers.routes.ts` with
      `GET /` and `GET /:id` behind `requirePermission('customers:view')`, registered in the group
      router. **Verify**: an Agent gets `200`, and the matrix probe for `customers:view` now passes.

- [ ] T034 [US1] Create `frontend/src/views/customers/CustomerListView.vue` per the UI contract: a
      **single** search box (no field selector) holding focus on load, debounced updates, rows showing
      name, company, primary phone, primary email, and an inactive marker, plus an indication of which
      detail matched. **Phone values display `raw`, never `normalised`** (rule 3). Reuses Phase 1's
      `DataTable` and `TablePagination`.

- [ ] T035 [US1] In `frontend/src/views/customers/CustomerListView.vue`, implement the empty state carrying the search term and offering to create that
      customer (FR-016). "No results" as a dead end forces the Agent to retype what they just typed.

- [ ] T036 [P] [US1] Add US1 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`: search
      placeholder, column headers, match-reason labels, inactive marker, filters, empty state.
      Identical key sets.

- [ ] T037 [US1] Execute quickstart **V1** and record the result, including a phone typed differently
      from how it was stored.

**Checkpoint**: PLAN.md Definition-of-done part 1 satisfied.

---

## Phase 4: User Story 2 — Creates a Customer, Duplicates Flagged (Priority: P1)

**Goal**: Creating a customer whose phone or email already exists shows the existing record and asks,
before anything is created — and proceeding deliberately is possible and recorded.

**Independent Test**: quickstart **V2**, **B3**, **B5**. Create, then attempt duplicates by phone, by
email, by a differently-formatted phone, and against a deactivated customer.

**Maps to**: FR-003, FR-017–FR-023 · SC-003, SC-004, SC-005 · **PLAN.md Definition of done part 3 —
the clause this phase exists for**

- [X] T038 [P] [US2] Create `backend/tests/customers/duplicate-create.test.ts` (**B3**): same phone,
      same email, **differently-formatted same phone**, and a match against a **deactivated**
      customer are each flagged with `409 DUPLICATE_CUSTOMER`; **all** matches returned when several
      exist; `duplicates` is a sibling of `error` and `details` is untouched.

- [X] T039 [P] [US2] Create `backend/tests/customers/duplicate-override.test.ts` (**B5**): an
      acknowledged save succeeds, writes one override row **per match shown**, and the decision is
      retrievable from the audit log afterwards (SC-005).

- [X] T040 [P] [US2] Create `backend/tests/customers/contact-required.test.ts` (**B6**): creating
      with no contact method is refused with a message on the right field (FR-003).

- [X] T041 [US2] Add `create(input, actor, context)` to `backend/src/services/customer.service.ts`:
      validate name and at least one contact (FR-003), normalise each contact through `lib/phone.ts`,
      call `duplicateService.findDuplicates`, and throw `duplicateCustomer(matches)` unless
      `acknowledgeDuplicates` is set. On an acknowledged save, write the customer, its contacts, one
      `customer_duplicate_overrides` row per match, and the audit entries — **all in one transaction**
      (rule 10).

- [X] T042 [US2] Add `create` and `checkDuplicates` handlers to
      `backend/src/controllers/customers/customers.controller.ts`, and `POST /` plus
      `POST /check-duplicates` behind `customers:create` in the routes file. Document in a comment
      that `check-duplicates` is an **aid for live feedback, not the barrier** — a match can appear
      between a check and a save (research.md D5).

- [ ] T043 [US2] Create `frontend/src/views/customers/CustomerFormView.vue`: name required, a
      repeatable contact-method group (FR-004), at least one contact stated **before** submission, one
      primary per kind. **The form must not reformat what the user typed** (rule 3). Server
      `details[]` maps onto fields; focus moves to the first invalid field on failure.

- [ ] T044 [US2] Create `frontend/src/components/customers/DuplicateDialog.vue` per the UI contract.
      States which detail matched and what it matched; shows **every** match; labels a deactivated
      match as such; three actions in order — **Open the existing customer** (visually primary),
      **Change the details**, **Create anyway** (secondary). **"Create anyway" must not be the default
      focus and must not be reachable by pressing Enter** — someone dismissing dialogs on autopilot
      should not create a duplicate by reflex.

- [ ] T045 [US2] Wire the `409 DUPLICATE_CUSTOMER` response from
      `frontend/src/services/customers.service.ts` into `frontend/src/views/customers/CustomerFormView.vue`: open the dialog, and on acknowledgement resubmit with `acknowledgeDuplicates: true`.

- [ ] T046 [P] [US2] Add US2 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`: form labels, contact-kind labels, the
      duplicate dialog's heading, per-match wording, all three action labels, and every validation
      message. Identical key sets.

- [ ] T047 [US2] Execute quickstart **V2** and record the result. Confirm specifically that a
      differently-formatted phone **is** flagged, that "Open the existing customer" is primary, and
      that **Enter does not create a duplicate**.

**Checkpoint**: PLAN.md Definition-of-done part 3 satisfied — the clause PLAN.md singles out.

---

## Phase 5: User Story 3 — Maintains a Customer Record (Priority: P1)

**Goal**: Edit details, manage contact methods, deactivate and reactivate — with the same duplicate
check on edit as on creation.

**Independent Test**: quickstart **V3**, **B4**, **B14**. Edit each field, add and remove contacts,
edit a phone into one another customer holds, and deactivate.

**Maps to**: FR-002, FR-007, FR-008, FR-021, FR-045 · SC-006, SC-014 · PLAN.md Definition of done
part 2

- [X] T048 [P] [US3] Create `backend/tests/customers/duplicate-edit.test.ts` (**B4**) — **the test
      the spec's checklist flagged as easy to overlook**. Editing a customer's contact into one
      another customer holds must be refused identically to creation, and must call the **same**
      detector. Also assert a customer is never flagged against itself.

- [X] T049 [P] [US3] Create `backend/tests/customers/deactivation.test.ts`: a deactivated customer
      disappears from default search, remains fetchable by id, still matches the duplicate check
      (FR-019), and reactivation restores them. Assert `DELETE /api/customers/:id` returns **404** at
      every path (**B17**, rule 14).

- [X] T050 [P] [US3] Create `backend/tests/customers/optimistic-locking.test.ts` (**B14**): a stale
      `version` returns `409 CONFLICT` and the first write survives.

- [X] T051 [US3] Add `update(id, input, actor, context)` to `backend/src/services/customer.service.ts`: require `version`
      and throw `staleRecord()` on mismatch; replace the contact set wholesale when supplied; refuse
      removing the last contact (FR-003); and **call the same `duplicateService.findDuplicates`**
      with `excludeCustomerId` set (rule 2, FR-021). Audit inside the transaction.

- [X] T052 [US3] Add `setActive(id, active, actor, context)` to `backend/src/services/customer.service.ts` writing
      `customer.deactivated` / `customer.reactivated` audit entries. **Add no delete method.**

- [X] T053 [US3] Add `update`, `deactivate`, and `reactivate` handlers to
      `backend/src/controllers/customers/customers.controller.ts` and routes to
      `backend/src/routes/customers/customers.routes.ts`:
      `PATCH /:id` behind `customers:update`, `POST /:id/deactivate` and `POST /:id/reactivate` both
      behind `customers:deactivate` — changing active state is one capability, not two.

- [ ] T054 [US3] Extend `frontend/src/views/customers/CustomerFormView.vue` for edit mode: load the record, carry `version`, and
      show the **same** `DuplicateDialog` with wording reflecting an existing record being changed
      rather than created.

- [ ] T055 [US3] Add deactivate and reactivate to `frontend/src/views/customers/CustomerListView.vue`, using
      Phase 1's `ConfirmDialog` naming the customer, shown only with `customers:deactivate`.

- [ ] T056 [P] [US3] Add US3 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`: edit-mode titles, deactivate/reactivate
      labels and confirmation text, the conflict message, and the last-contact refusal.

- [ ] T057 [US3] Execute quickstart **V3** and record the result, including editing a phone into one
      another customer already holds.

**Checkpoint**: all three parts of PLAN.md's Definition of done are satisfied.

---

## Phase 6: User Story 4 — Notes Build a Customer's History (Priority: P2)

**Goal**: Dated, attributed notes accumulate on a customer, with edits visible as edits.

**Independent Test**: quickstart **V4**. Add notes, confirm ordering and attribution, edit your own,
and confirm someone else's is refused without `notes:manage`.

**Maps to**: FR-024–FR-028 · Constitution Principle II (server-side enforcement)

- [X] T058 [P] [US4] Create `backend/tests/customers/notes.test.ts`: newest-first paged listing;
      `editedAt` set only on edit; the author may edit their own with `notes:create`; **another
      user's note is refused without `notes:manage`** and permitted with it (FR-027); every note is
      visible to anyone who may view the customer (Q2 — assert there is no hidden-note behaviour).

- [X] T059 [US4] Create `backend/src/services/customer-note.service.ts` with `list`, `create`,
      `update`, and `remove`. Authorisation nuance lives here: editing another user's note requires
      `notes:manage`, checked through `authorization.service` — **never a role comparison in a
      controller** (Phase 1 rule, still in force). Audit inside the transaction; set `edited_at` on
      update.

- [X] T060 [US4] Create `backend/src/controllers/customers/notes.controller.ts` and
      `backend/src/routes/customers/notes.routes.ts`: `GET` behind `customers:view`, `POST` behind
      `notes:create`, `PATCH` and `DELETE` behind `notes:create` with the ownership rule applied in
      the service.

- [X] T061 [P] [US4] Create `frontend/src/services/customer-notes.service.ts`.

- [X] T062 [US4] Create `frontend/src/components/customers/NoteList.vue`: newest first, paged, each
      showing author, time, and an **edited** marker when `editedAt` is set. Edit and delete appear on
      a user's own notes, and on others' only with `notes:manage` — omitted, not shown-disabled
      without explanation.

- [X] T063 [P] [US4] Add US4 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, including the edited marker and the
      empty state.

- [X] T064 [US4] Execute quickstart **V4** and record the result, including calling the edit endpoint
      directly as a user without `notes:manage`.

---

## Phase 7: User Story 5 — Files Attach to a Customer (Priority: P2)

**Goal**: Attach and download files safely. **The riskiest story in the phase.**

**Independent Test**: quickstart **V5**, **B9**–**B11**. Upload permitted types, refuse oversized and
disallowed, refuse a file whose extension lies, and refuse a download to a user without permission.

**Maps to**: FR-029–FR-036 · SC-008 · Constitution Principle II

- [X] T065 [P] [US5] Create `backend/tests/customers/attachment-security.test.ts` (**B9**) — the
      security test of this phase. Oversized refused naming the limit; disallowed type refused; **a
      PNG renamed `.pdf` refused on sniffed content** (FR-032); a crafted `storage_key` containing
      path separators refused by `resolvePath`.

- [X] T066 [P] [US5] Create `backend/tests/customers/attachment-access.test.ts` (**B10**, SC-008): a
      user without `customers:view` is refused the download while holding a valid attachment id, and
      the storage directory is not reachable by any route.

- [X] T067 [P] [US5] Create `backend/tests/customers/attachment-ordering.test.ts` (**B11**, FR-034):
      a failure during the row commit leaves **no** attachment row pointing at a missing file. Force
      it the way Phase 1 forced the audit rollback — make the insert fail and assert the state.

- [X] T068 [US5] Create `backend/src/services/attachment.service.ts`: `list`, `upload`, `getForDownload`,
      and `remove`. `upload` sniffs the type with `file-type`, checks it against
      `env.ATTACHMENT_ALLOWED_TYPES`, calls `fileStorage.store` for a generated key, then commits the
      row and audit entry — **file first, row second, delete the file if the commit fails** (rule 5).
      `remove` deletes the row in a transaction with its audit entry and removes the file after
      commit, logging at `error` if that fails.

- [X] T069 [US5] Create `backend/src/controllers/customers/attachments.controller.ts`. `download`
      streams via `fileStorage.readStream` with `Content-Disposition: attachment` carrying
      `original_name` and the **stored sniffed** content type. Never expose `storage_key` in any
      response.

- [X] T070 [US5] Create `backend/src/routes/customers/attachments.routes.ts`: `GET /` and
      `GET /:attachmentId/download` behind `customers:view`, `POST /` behind `attachments:upload` with
      the upload middleware, `DELETE /:attachmentId` behind `attachments:delete`. **Confirm by
      inspection that no static file middleware is mounted anywhere near the storage path** (rule 7).

- [X] T071 [P] [US5] Create `frontend/src/services/customer-attachments.service.ts` including a
      download helper that goes through the authenticated endpoint, never a direct path.

- [X] T072 [US5] Create `frontend/src/components/customers/AttachmentList.vue`: name, size, type,
      uploader, time; download as a real link to the endpoint; upload showing the size limit and
      permitted types **before** an attempt; upload progress, since a 10 MB file on a slow connection
      is otherwise indistinguishable from a hung page; refusals stating which rule was broken; delete
      via `ConfirmDialog` naming the file, shown only with `attachments:delete`.

- [X] T073 [P] [US5] Add US5 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, including the size and type limits shown
      on the control and each refusal reason.

- [X] T074 [US5] Execute quickstart **V5** and record the result, including the renamed-file test and
      the direct-link access check.

---

## Phase 8: User Story 6 — Supervisor Reviews and Exports (Priority: P3)

**Goal**: Filter the customer list and export exactly what is filtered, with the export recorded.

**Independent Test**: quickstart **V6**, **B12**. Filter, export, confirm the file matches the filter
and the audit log records the count.

**Maps to**: FR-015, FR-037–FR-040, FR-044 · Constitution Principle II

- [X] T075 [P] [US6] Create `backend/tests/customers/export.test.ts` (**B12**): the export contains
      **exactly** the filtered rows and not the whole table; a `data.exported` audit entry is written
      with the row count; a user without `customers:export` is refused; the output begins with a
      UTF-8 BOM and an Arabic name survives a round-trip through it.

- [X] T076 [US6] Create `backend/src/services/export.service.ts` producing streamed CSV with a UTF-8
      BOM (research.md D9 — without it Excel misreads UTF-8 and Arabic names arrive as mojibake).
      Reuse `customer.service.list`'s filter so an export is always "what I am looking at". Include
      only fields the caller can already see (FR-039). Write the `data.exported` audit entry — **the
      key Phase 1 defined**, not a new one (rule 14, FR-044).

- [X] T077 [US6] Add the `export` handler to `backend/src/controllers/customers/customers.controller.ts`
      and `GET /export` to `backend/src/routes/customers/customers.routes.ts` behind `customers:export`, accepting the
      **same query parameters as the list endpoint**.

- [ ] T078 [US6] Add the export control to `frontend/src/views/customers/CustomerListView.vue`, shown only with
      `customers:export`, stating next to it that it exports the **current filter** — an export that
      silently returns everything is a data-leak-shaped surprise. Disable while producing.

- [ ] T079 [P] [US6] Add US6 i18n keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`,
      including the export-scope note.

- [ ] T080 [US6] Execute quickstart **V6** and record the result, opening the file in a spreadsheet
      to confirm Arabic names render rather than appearing as mojibake.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T081 [US1] Create `frontend/src/views/customers/CustomerProfileView.vue` assembling details,
      `NoteList`, and `AttachmentList` per the UI contract. Deferred to here because it composes
      pieces that only exist once US4 and US5 land.

- [ ] T082 [P] Create `backend/tests/customers/arabic.test.ts` (**B8**): an Arabic name, address, and
      note body store and return **byte-exact**, and the name is findable by partial search. Cheap,
      and it fails loudly if a future migration changes a column's charset.

- [ ] T083 [P] Create `frontend/tests/customers/DuplicateDialog.test.ts`: renders every match; labels
      a deactivated match; **"Create anyway" is not the initially focused control**; Escape emits
      cancel. The keyboard-reflex hazard is worth a test, not just a note.

- [ ] T084 **Layering audit** (Principle III, quickstart **V9**). Confirm and record:
      `grep -rn "from '.*models" backend/src | grep -v "backend/src/services\|backend/src/models"`
      → empty; `grep -rn "fetch(" frontend/src/components frontend/src/views frontend/src/layouts`
      → empty. Then confirm by inspection that **phone normalisation happens in exactly one place**
      and that create and update call the **same** duplicate detector (rules 1 and 2).

- [ ] T085 [P] **Physical-utility audit** (Principle I).
      `grep -rnE "\b(ml|mr|pl|pr)-[0-9a-z]|\btext-(left|right)\b|\b(left|right)-[0-9]" frontend/src`
      → must return nothing.

- [ ] T086 [P] **Scope audit** (rule 14) across `backend/src` and `frontend/src`. Confirm no customer
      delete route or service method exists;
      no note-visibility column; no attachment scan-state column; no merge, bulk import, structured
      address, or per-agent ownership. Confirm `record.deleted` still has **no caller** — Phase 1
      expected Phase 2 to be its first, and Clarification Q1 overturned that.

- [ ] T087 [P] **Normalised-value display audit** (rule 3):
      `grep -rn "normalised" frontend/src --include=*.vue` — confirm no template renders
      `value_normalised` or `normalised` — users see only what they typed.

- [ ] T088 Update the root `README.md`: the four new environment variables, and a note in the
      "where do I add a backend endpoint" section that customer routes sit at `/api/customers` rather
      than under `/api/admin`, with the reason.

- [ ] T089 Run `npm run format` then `npm run lint` at the root; both must exit 0.

- [ ] T090 Run `npm test` and confirm **B1–B17** all pass. Record the counts. **B2, B4, and B9 matter
      most**: B2 is the Definition of done made mechanical, B4 covers the path the spec's checklist
      flagged as easy to overlook, and B9 is the upload attack the type restriction exists to stop.

- [ ] T091 **Full quickstart run from a clean state**: `docker compose down -v`, then Setup end to
      end, then walk **V1**–**V9**. Fix `quickstart.md` if any step is undocumented or out of order.

- [ ] T092 Verify the constitution's per-phase Definition-of-done gate from
      `.specify/memory/constitution.md` explicitly and record each in `quickstart.md`:
      all tasks done; works in Arabic and English; server-side permission checks verified; screens
      pass basic WCAG 2.1 AA checks; PLAN.md's Phase 2 Definition of done satisfied.

- [ ] T093 Update `specs/003-phase-2-customer-management/checklists/requirements.md` if any accepted
      exception changed, and confirm plan.md's Complexity Tracking still describes what was built —
      particularly the accepted linear cost of name search (research.md D3) and the envelope
      extension for duplicates (D5). If either turned out differently, the plan must say so rather
      than remaining aspirational.

- [ ] T094 Record Phase 3 carry-forwards in
      `specs/003-phase-2-customer-management/checklists/requirements.md`: customers are **never deleted**, so a customer reference
      is permanent; the `customers` permission module is the pattern a `tickets` module extends; and
      **`record.deleted` still has no caller** — Phase 3 may be the phase that finally needs it.
      Also record that **Q3's virus-scanning deferral must be revisited before Phase 8**.

- [ ] T095 Commit all remaining work on `003-phase-2-customer-management`. Open a pull request
      against `main`. Do **not** merge until the user confirms the Definition-of-done gate in
      `.specify/memory/constitution.md` is met.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup (T001–T007)** — no dependencies; first. T005 makes the matrix test fail until each
  new key has a route; that is expected through Phases 3–8.
- **Phase 2 Foundational (T008–T029)** — depends on Phase 1. **Blocks all six user stories.** Within
  it: T015 depends on T010–T014; models T016–T021 depend on the migrations; T024 depends on T008 and
  T017; T025 must precede any duplicate-returning endpoint.
- **Phase 3 US1 (T030–T037)** — depends on Phase 2.
- **Phase 4 US2 (T038–T047)** — depends on Phase 2; T041 depends on T024. In practice run after US1
  so there is a list to land on after creating.
- **Phase 5 US3 (T048–T057)** — depends on US2 for the form and the dialog it reuses.
- **Phase 6 US4 (T058–T064)** — depends on Phase 2 only; independent of US1–US3.
- **Phase 7 US5 (T065–T074)** — depends on Phase 2 (T022, T023); independent of US1–US4.
- **Phase 8 US6 (T075–T080)** — depends on US1's list filter (T031).
- **Phase 9 Polish (T081–T095)** — T081 depends on US4 and US5; the rest depend on everything.

### Critical path

T001 → T003 → T008 → T010–T011 → T015 → T017 → T024 → T041 → T044 → T047

That spine ends at the duplicate flow, because that is what PLAN.md's Definition of done singles out.

### Parallel opportunities

| Group | Tasks | Why safe |
|---|---|---|
| Setup config | T002, T004 | Different files |
| Migrations | T012, T013, T014 | Independent tables; T010–T011 must precede |
| Models | T016–T020 | Separate files; T021 must follow |
| US1 tests | T030 | Independent of the implementation it will drive |
| US2 tests | T038, T039, T040 | Separate test files |
| US3 tests | T048, T049, T050 | Separate test files |
| US5 tests | T065, T066, T067 | Separate test files |
| Polish audits | T085, T086, T087 | Read-only inspection of different concerns |

**Locale files are the exception.** T036, T046, T056, T063, T073, and T079 all edit the same two
files. Each is `[P]` relative to its own story's code, **not** relative to the others — two agents
editing `en.json` at once will conflict.

### Cross-story parallelism

Once Phase 2 is done, US4 (notes) and US5 (attachments) are fully independent of US1–US3 and of each
other. US5 is the cleanest split for a second worker: it touches no customer-core file.

---

## Implementation Strategy

### MVP first

1. **Phase 1 Setup** — dependencies and permission entries.
2. **Phase 2 Foundational** — schema, phone normalisation, file storage, duplicate detector.
   **Blocking.**
3. **Phase 3 US1** — an Agent can find a customer.
4. **Phase 4 US2** — an Agent can create one, with duplicates flagged.
5. **STOP and validate V1 and V2.** That is two of PLAN.md's three Definition-of-done parts,
   including the one it singles out.

### Incremental delivery

1. Setup + Foundational → mechanism ready
2. + US1 → find a customer (**part 1**)
3. + US2 → create with duplicates flagged (**part 3** — the clause this phase exists for)
4. + US3 → update (**part 2**; Phase 2 is now functionally done)
5. + US4 → notes
6. + US5 → attachments
7. + US6 → filtered export
8. + Polish → audits, profile screen, docs, full quickstart

### Suggested MVP scope

**Phases 1–4 (T001–T047).** A searchable customer database that refuses to create silent duplicates —
the prerequisite for Phase 3, whose tickets attach to exactly these records.

---

## Notes

- **T009 and T048 are the two tests to protect.** T009 proves phone normalisation, which is the
  Definition of done. T048 covers duplicate detection on **edit** — a second code path the creation
  tests never touch, and the one the spec's quality checklist flagged as easy to overlook.
- **The matrix test will fail from T005 until every new permission has a route.** That is the
  designed sequence, not a problem: it is what stops a permission being granted that nothing enforces.
- **Three clarification decisions are binding**: no customer deletion (Q1), no note visibility (Q2),
  no virus scanning (Q3). Q3 is the one accepted security deferral in this phase and **must be
  revisited before Phase 8**, whose customer portal would let files arrive from outside the
  organisation.
- **Phase 1's browser checks V6–V8 are still unrun**, and this phase adds four more screens to the
  same shell. The gap widens with every phase that does not close it.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
- Avoid: adding dependencies not named in research.md, building anything in rule 14, and speculative
  abstraction for phases that do not exist yet.
