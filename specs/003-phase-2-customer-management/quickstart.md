# Quickstart: Phase 2 — Customer Management

**Feature**: `003-phase-2-customer-management` | **Date**: 2026-08-27

How to bring Phase 2 up and prove it satisfies PLAN.md's Phase 2 Definition of done:

> An Agent can find, create, and update a customer record, with duplicates flagged rather than
> silently created.

As in Phase 1, most of this is automated. The checks below split into `npm test` and a smaller set of
manual browser checks.

---

## Prerequisites

Unchanged from Phase 1: Node.js 22 LTS, npm 10+, Docker.

---

## Setup

```bash
git checkout 003-phase-2-customer-management
npm install                # picks up libphonenumber-js, multer, file-type

# New environment variables — all optional with defaults, so an existing .env keeps working:
#   ATTACHMENT_STORAGE_PATH=./storage/attachments
#   ATTACHMENT_MAX_BYTES=10485760
#   ATTACHMENT_ALLOWED_TYPES=application/pdf,image/png,image/jpeg,...
#   DEFAULT_PHONE_REGION=EG

docker compose up -d       # wait for healthy; now also mounts the attachment volume
npm run db:migrate         # customers, contacts, notes, attachments, duplicate overrides
npm run db:seed            # adds the nine new permission grants to existing roles
npm run dev
```

**Expected**: existing accounts sign in unchanged. Agents gain customer view/create/update, notes,
and uploads; Supervisors additionally gain deactivate, export, note management, and attachment
deletion.

---

## Automated validation

```bash
npm test
```

| Check | Covers | What it asserts |
|---|---|---|
| **B1 — Permission matrix** | SC-007 | Extends automatically — the matrix is generated from the catalog, so the nine new keys are covered the moment they are added. Still asserts every route carries a permission and every key is enforced |
| **B2 — Phone normalisation** | FR-005, SC-002 | A table of real formats — local, international, spaced, dashed, with and without country code, plus unparseable input — asserting which pairs are the same number. **This is where the Definition of done either works or does not** |
| **B3 — Duplicate detection on create** | FR-017–FR-020, FR-022, SC-004 | Same phone, same email, differently-formatted same phone, and a match against a **deactivated** customer are each flagged; all matches returned, not the first |
| **B4 — Duplicate detection on edit** | FR-021 | Editing a customer's contact into one another customer holds is refused identically. A second code path the creation tests do not exercise |
| **B5 — Duplicate override** | FR-020, SC-005 | An acknowledged save succeeds, writes override rows for every match shown, and is retrievable from the audit log afterwards |
| **B6 — Contact requirement** | FR-003 | Creating with no contact method is refused; removing the last one on edit is refused |
| **B7 — Search** | FR-010–FR-013 | One term finds by name, company, phone, and email; partial matches work; phone formatting does not defeat it; Arabic names are found |
| **B8 — Arabic round-trip** | FR-052, SC-013 | An Arabic name, address, and note body store and return byte-exact |
| **B9 — Attachment limits** | FR-031, FR-032 | Oversized refused naming the limit; disallowed type refused; **a file whose extension lies about its content refused** |
| **B10 — Attachment access control** | FR-033, SC-008 | A user without `customers:view` is refused the download, holding a valid attachment id |
| **B11 — Attachment write ordering** | FR-034 | A failure during the row commit leaves no attachment record pointing at a missing file |
| **B12 — Export** | FR-037–FR-040 | Exports exactly the filtered rows; writes a `data.exported` audit entry with the count; refused without the permission |
| **B13 — Audit coverage** | FR-043 | Every action listed in data-model.md produces a retrievable entry |
| **B14 — Optimistic locking** | FR-045 | A stale `version` returns `409` and the first write survives |
| **B15 — Paging cap** | FR-050 | `pageSize=10000` clamps to 100 |
| **B16 — Locale parity** | FR-046, SC-012 | Extends the Phase 1 test automatically |
| **B17 — No delete path** | Clarifications Q1 | `DELETE /api/customers/:id` returns `404` at every path — the route does not exist |

**B2, B4, and B9 matter most.** B2 is the Definition of done made mechanical. B4 covers the code path
the spec's checklist flagged as easy to overlook. B9 is the file-upload attack the type restriction
exists to stop.

---

## Manual validation

### V1 — Find a customer

_Definition of done, part 1 · User Story 1 · SC-001_

Seed a handful of customers. From the search box, find one by partial name, by phone typed
differently from how it was stored, by email, and by company. Confirm each lands on the right record
in a few seconds, that the row shows **why** it matched, and that a non-match offers to create the
customer rather than showing an empty table.

### V2 — Create a customer, duplicate flagged

_Definition of done, parts 2 and 3 · User Story 2 · SC-003, SC-004_

Create a customer with a phone and an email. Then create a second using **the same phone typed
differently** — for example `+20 100 123 4567` against a stored `01001234567`.

Expect the duplicate dialog, naming which detail matched and showing the existing record. Confirm:

- "Open the existing customer" is the visually primary action.
- "Create anyway" is present but secondary, and **pressing Enter does not trigger it**.
- Choosing to create anyway succeeds, and the decision appears in the audit log.

**This is the check PLAN.md's Definition of done singles out.** If the differently-formatted number
is not flagged, the phase is not done, however well everything else works.

### V3 — Update a customer

_Definition of done, part 2 · User Story 3 · SC-006_

Correct a name, add a second phone, update the address. Confirm changes appear in search
immediately. Then edit a customer's phone to one another customer already holds and confirm the
**same** duplicate dialog appears.

### V4 — Notes

_User Story 4_

Add notes, confirm newest-first ordering with author and time. Edit your own and confirm it is marked
as edited. As a different user without `notes:manage`, confirm the edit control is absent on someone
else's note — and that calling the endpoint directly is refused.

### V5 — Attachments

_User Story 5 · SC-008_

Upload a permitted file and download it; confirm the bytes are unchanged. Then:

```bash
# A file whose extension lies about its content
cp some-image.png fake.pdf
# Expect: refused on content, not accepted on the name
```

Confirm an oversized file is refused naming the limit. Then take a valid attachment download URL,
sign in as a user without `customers:view`, and request it — expect `403`, not the file.

### V6 — Export

_User Story 6_

Filter the list, export, and confirm the file contains exactly the filtered rows. Open it in a
spreadsheet and confirm **Arabic names render correctly** rather than as mojibake — that is what the
UTF-8 BOM is for. Confirm the audit log records the export with a row count.

### V7 — Every customer screen in Arabic

_Constitution Principle I · SC-012, SC-013_

Switch to Arabic and visit list, form, profile, and the duplicate dialog. Confirm every label,
header, filter, empty state, dialog text, and **validation message** is Arabic with the layout
mirrored. Then confirm the converse: an **Arabic customer name displays correctly in the English
interface**, since that combination is routine.

### V8 — Every customer screen by keyboard

_Constitution Principle IV · SC-011_

Reach every control by keyboard alone. In the duplicate dialog confirm focus is trapped, Escape
dismisses, focus returns, and — specifically — that **Enter does not create a duplicate**. Repeat in
Arabic and confirm focus order follows RTL visual order.

### V9 — Layering holds

```bash
npm run lint
grep -rn "from '.*models" backend/src | grep -v "backend/src/services\|backend/src/models"   # empty
grep -rn "fetch(" frontend/src/components frontend/src/views frontend/src/layouts            # empty
grep -rnE "\b(ml|mr|pl|pr)-[0-9a-z]|\btext-(left|right)\b" frontend/src                      # empty
```

Then confirm by inspection that phone normalisation happens in exactly one place, and that both the
create and update paths call the **same** duplicate detector.

---

## Definition-of-done coverage

| PLAN.md Phase 2 clause | Validated by |
| --- | --- |
| "An Agent can find … a customer record" | V1, B7 |
| "create, and update a customer record" | V2, V3, B6, B14 |
| "with duplicates flagged rather than silently created" | V2, V3, B2, B3, B4, B5 |

Constitution per-phase gate:

| Gate clause | Validated by |
| --- | --- |
| All tasks marked done | tasks.md |
| Works in Arabic (RTL) and English (LTR) | V7, B8, B16 |
| Server-side permission checks verified | B1, V4, V5 |
| Screens pass basic WCAG 2.1 AA checks | V8 |
| PLAN.md Definition of done satisfied | the table above |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A differently-formatted phone is not flagged as a duplicate | Normalisation is not being applied on one of the paths. All three — write, search, duplicate check — must use `lib/phone.ts`; a second implementation is how this breaks |
| Search finds nothing for an Arabic name | Check the column collation is `utf8mb4_0900_ai_ci`. A migration that set a different charset would cause exactly this |
| Upload succeeds but download 404s | The row was committed before the file was written. FR-034 requires the opposite order |
| An attachment is reachable without signing in | The storage directory is being served statically. It must never be — downloads stream through the permission-checked endpoint |
| Arabic names are mojibake in an exported file | The UTF-8 BOM is missing; Excel guesses the encoding without it |
| Editing a customer does not flag a duplicate but creating one does | The update path is not calling the duplicate detector. FR-021 is a separate code path — this is exactly the gap B4 exists to catch |
| The permission matrix test fails after adding a route | Intentional. Either the route is missing `requirePermission`, or its key has no grant decision |

---

## Recorded results — Phase 2 implementation run (2026-08-27)

Windows 11, Node v22.17.1, npm 10.9.2, Docker 29.6.2, MySQL 8.4.11.

**224 tests passing across 19 files.** Lint, format, and build all exit 0.

### Automated checks

| Check | Result | Evidence |
| --- | --- | --- |
| B1 — permission matrix | **PASS** | All 60 cells. Extended automatically to the nine new keys; also asserts every admin route carries a permission and every catalog key is probed |
| B2 — phone normalisation | **PASS** | 25 assertions over real formats. Includes the case the naive alternative fails: an Egyptian and a British number sharing a digit tail must **not** collide |
| B3 — duplicates on create | **PASS** | Identical phone, differently-formatted phone, case-varied email, and a match against a **deactivated** customer each flagged; all matches returned, not the first |
| B4 — duplicates on **edit** | **PASS** | The second code path the creation tests never exercise. Also asserts a customer is never flagged against itself |
| B5 — duplicate override | **PASS** | Acknowledged save succeeds, writes one override row **per match shown**, and is retrievable from the audit log |
| B6 — contact requirement | **PASS** | No contact refused on create; removing the last one refused on edit |
| B7 — search | **PASS** | One term finds by name, company, phone, and email; partial matching; formatting-independent phone; Arabic name found; `pageSize=10000` clamped to 100 |
| B8 — Arabic round-trip | **PASS** | Name, address, and company return byte-exact |
| B9 — attachment limits | **PASS** | Oversized refused naming the limit; disallowed type refused; a PNG named `.pdf` stored as `image/png` because **content decides** |
| B10 — attachment access | **PASS** | A user without `customers:view` refused the download while holding a valid attachment id |
| B11 — write ordering | **PASS** | A forced failure during the row commit leaves **no** row pointing at a missing file |
| B12 — export | **PASS** | Exactly the filtered rows; UTF-8 BOM present; `data.exported` audit entry with a row count; refused without the permission |
| B13 — audit coverage | **PASS** | Every customer action key produces a retrievable entry |
| B14 — optimistic locking | **PASS** | Stale `version` returns `409`; the first write survives |
| B15 — paging cap | **PASS** | Clamped, not rejected, on customers and notes |
| B16 — locale parity | **PASS** | 279 keys per locale, identical sets |
| B17 — no delete path | **PASS** | `DELETE /api/customers/:id` returns `404` — the route does not exist |

### Manual checks

| Check | Result |
| --- | --- |
| V1 — find a customer | **Covered by B7** end to end through the API; the browser pass is outstanding |
| V2 — create, duplicate flagged | **Covered by B3/B5**; the dialog's behaviour is covered by 11 component tests including the focus guarantee |
| V3 — update | **Covered by B4/B14** |
| V4 — notes | **Covered by 10 tests** including the cross-author refusal |
| V5 — attachments | **Covered by B9–B11** |
| V6 — export | **Covered by B12**, including the BOM and an Arabic name surviving the CSV |
| V7 — every screen in Arabic | **NOT RUN** — requires a browser |
| V8 — every screen by keyboard | **NOT RUN** — requires a browser |
| V9 — layering holds | **PASS** — see below |

### V9 audit results

- Only `backend/src/services/` imports from `backend/src/models/` — **clean**
- No `fetch(` in `components/`, `views/`, or `layouts/` — **clean**
- Phone normalisation appears in **exactly one file**, `backend/src/lib/phone.ts`
- `findDuplicates` is called from three places, all in `customer.service.ts`: create, update, and
  the live check — **one detector, both paths**
- No physical direction utilities anywhere — **clean**
- No customer delete route or `destroy` call — **clean**
- No scan-state, note-visibility, or `department_id` column — **clean**
- `record.deleted` still has **no caller**, correctly carried forward
- No template renders a normalised phone value — **clean**

### Definition-of-done coverage

| PLAN.md Phase 2 clause | Status |
| --- | --- |
| "An Agent can find … a customer record" | **Met** — B7 |
| "create, and update a customer record" | **Met** — B3, B4, B6, B14 |
| "with duplicates flagged rather than silently created" | **Met** — B2, B3, B4, B5 |

Constitution per-phase gate: clauses 1, 3, and 5 are met. Clauses 2 (both languages) and 4 (WCAG AA)
are **built and partially evidenced** — locale parity and component tests pass, but V7 and V8 have
not been run.

### Outstanding

**V7 and V8 need a browser.** No browser automation was available in this session, so they are not
marked passed. Phase 1's V6–V8 and Phase 0's V8–V10 are likewise still unrun, and this phase adds
three more screens to that same shell — the gap widens with every phase that does not close it.
