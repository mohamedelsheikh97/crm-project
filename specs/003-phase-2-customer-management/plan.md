# Implementation Plan: Phase 2 — Customer Management

**Branch**: `003-phase-2-customer-management` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-phase-2-customer-management/spec.md`

**PLAN.md Reference**: Phase 2 — Customer Management

**Builds on**: Phase 1 — Security & Administration Foundations, merged to `main` at `7a4aa0e`

## Summary

The customer record every later module attaches to: search, create, edit, deactivate, notes,
attachments, filtered export — all behind the permission model Phase 1 built.

Two decisions carry the phase.

**Phone normalisation is the Definition of done.** PLAN.md asks that duplicates be "flagged rather
than silently created", and SC-002 requires `+20 100 123 4567` and `01001234567` to be recognised as
the same number. Everything else in duplicate detection is straightforward; this is the part that
quietly fails. A hand-rolled "strip the non-digits and compare the tail" rule works for the examples
someone thinks to test and mismatches on the ones they do not, so this plan uses a real phone library
and stores both what the user typed and a canonical form.

**Attachments are the largest new attack surface this project has introduced.** Files are stored on
disk under a configured directory, never under a static route, and every download streams through an
endpoint that checks permission first. The stored name is generated, never the user's — a filename is
attacker-controlled input. Writing the file *before* committing the row is what makes FR-034 hold: an
orphan file is harmless and sweepable, a row pointing at a file that was never written is a broken
download.

Search is deliberately unambitious. Phone and email — the fields an agent actually has on a call —
are exact lookups against indexed normalised columns. Name and company use substring matching, which
does not use an index and will not scale forever; research.md D3 records the trigger for revisiting
rather than pretending the problem does not exist.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22.17.1 LTS, both workspaces — unchanged

**Primary Dependencies** (existing unless marked NEW):

- Backend — Express 5, Sequelize 6 + `mysql2`, `jsonwebtoken`, `bcrypt`, `zod`, `pino`,
  `cookie-parser`, `cors`; **NEW**: `libphonenumber-js` (phone normalisation, research.md D1),
  `multer` (multipart upload, D2), `file-type` (content sniffing, D2)
- Frontend — Vue 3.5, Vite 8, Pinia 3, vue-router 4, vue-i18n 11, Tailwind v4
- Testing — Vitest 4, supertest 7, `@vue/test-utils`, `happy-dom`, established in Phase 1

**Storage**: MySQL 8.4, `utf8mb4` / `utf8mb4_0900_ai_ci` — accent- and case-insensitive, which is
what makes Arabic search and case-insensitive email comparison work without special handling.
**Five new tables** ([data-model.md](./data-model.md)). Attachment binaries live on the filesystem
under a configured directory backed by a Docker volume, not in the database (D2)

**Testing**: Vitest across both workspaces. The Phase 1 permission matrix extends to the new module
**automatically** — it is generated from the catalog — so SC-007 is satisfied by adding catalog
entries and probes rather than by writing new assertions

**Target Platform**: Linux/Windows server; evergreen browsers

**Project Type**: Web application — the existing `frontend/` + `backend/` npm workspaces

**Performance Goals**: Search returns without perceptible delay at realistic volume (SC-010).
Phone and email lookups are indexed and stay fast regardless of table size; name and company
substring matching is linear and is the known ceiling (D3). No list operation loads the whole table

**Constraints**:

- Duplicate detection must survive phone formatting differences (SC-002) — the phase's hardest
  correctness requirement
- Duplicate detection applies to **edits** as well as creation (FR-021), which is a second code path
- Deactivation only; no permanent deletion (Clarifications Q1), so `record.deleted` gains no caller
- No restricted or private notes (Q2)
- No virus scanning; type-by-content and size limits only (Q3) — **revisit before Phase 8**
- Every attachment request is permission-checked; files are never statically served (FR-033)
- Arabic text must round-trip exactly through names, addresses, and note bodies (FR-052, SC-013)

**Scale/Scope**: ~16 new backend endpoints, 5 new tables, 9 new permission catalog entries, ~5 new
frontend screens, ~140 new i18n keys per locale

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Evaluated against constitution **v1.1.0**.

### Initial evaluation (pre-research)

| Gate | Status | Evidence |
|---|---|---|
| **I. Bilingual-First & RTL** (NON-NEGOTIABLE) | PASS | FR-046, FR-047, FR-052; SC-011–SC-013. This is the first phase storing substantial user-supplied free text, so Arabic round-tripping is specified explicitly rather than assumed |
| **II. Security by Default** (NON-NEGOTIABLE) | PASS | FR-041 inherits Phase 1's server-side enforcement; FR-033 permission-checks every attachment request; FR-043/FR-044 cover audit. Attachments are new attack surface and are specified accordingly |
| **III. Layered Architecture** (NON-NEGOTIABLE) | PASS | FR-051 carries Phase 0/1 layering forward |
| **IV. Accessibility** | PASS | FR-048, FR-049; SC-011 |
| **V. Phase-Gated Delivery** | PASS | specify → clarify (3 questions resolved inline) → plan, in order |
| **Technology Standards** (fixed stack) | PASS | No substitution. Three additions in areas the table does not cover — phone parsing, multipart upload, content sniffing |
| **Traceability to PLAN.md** | PASS | Every Scope bullet and all three Definition-of-done parts mapped |

No gate fails and none is PARTIAL. Research proceeded.

### Post-design re-evaluation

Re-checked after [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), and [quickstart.md](./quickstart.md).

| Gate | Status | What the design added |
|---|---|---|
| **I. Bilingual-First & RTL** | PASS — strengthened | D4 confirms the database collation already handles Arabic correctly, so no per-query special-casing is needed. The locale-parity test from Phase 1 extends automatically |
| **II. Security by Default** | PASS — strengthened | D2 puts attachments outside any static route, generates stored filenames so a user-supplied name can never become a path, sniffs type from content, and streams every download through a permission check. D5 makes the duplicate override an auditable decision rather than a silent flag |
| **III. Layered Architecture** | PASS | Duplicate detection lives in one service used by both the create and update paths, so FR-021 cannot drift from FR-017. Only services touch models; the admin UI reaches the backend solely through `frontend/src/services/` |
| **IV. Accessibility** | PASS | Reuses the Phase 1 components whose keyboard and announcement behaviour is already tested; the duplicate-resolution dialog follows the same contract |
| **V. Phase-Gated Delivery** | PASS | Artifacts complete; ready for `/speckit-tasks` |
| **Technology Standards** | PASS | Recorded as non-violations below |
| **Traceability** | PASS | quickstart.md maps all three Definition-of-done parts |

**Outcome: gate passes with no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/003-phase-2-customer-management/
├── plan.md                    # This file
├── spec.md                    # Feature specification (+ Clarifications: deletion, notes, scanning)
├── research.md                # Phase 0 output — 10 decisions
├── data-model.md              # Phase 1 output — 5 new tables, permission catalog additions
├── quickstart.md              # Phase 1 output — validation procedure
├── contracts/                 # Phase 1 output
│   ├── customer-api.md        #   customer, note, attachment and export endpoints
│   └── customer-ui.md         #   search, profile, duplicate-resolution patterns
├── checklists/
│   └── requirements.md        # Spec quality checklist (16/16)
└── tasks.md                   # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

Additions to the existing tree. Unchanged files omitted.

```text
crm-project/
├── docker-compose.yml                        # + named volume for attachment storage
├── .env.example                              # + attachment and phone-region variables
│
├── backend/
│   ├── src/
│   │   ├── config/env.ts                     # + attachment limits, storage path, phone region
│   │   ├── auth/permissions.ts               # + 9 customer-module entries
│   │   ├── lib/
│   │   │   ├── phone.ts                      # NEW — normalisation, the phase's load-bearing rule
│   │   │   └── file-storage.ts               # NEW — write-before-commit, generated names
│   │   ├── routes/admin/                     # unchanged from Phase 1
│   │   ├── routes/
│   │   │   └── customers/
│   │   │       ├── index.ts                  # NEW
│   │   │       ├── customers.routes.ts       # NEW
│   │   │       ├── notes.routes.ts           # NEW
│   │   │       └── attachments.routes.ts     # NEW
│   │   ├── controllers/customers/            # NEW — HTTP only
│   │   ├── services/
│   │   │   ├── customer.service.ts           # NEW
│   │   │   ├── duplicate.service.ts          # NEW — ONE detector, both code paths
│   │   │   ├── customer-note.service.ts      # NEW
│   │   │   ├── attachment.service.ts         # NEW
│   │   │   └── export.service.ts             # NEW
│   │   ├── models/
│   │   │   ├── customer.model.ts             # NEW
│   │   │   ├── customer-contact.model.ts     # NEW
│   │   │   ├── customer-note.model.ts        # NEW
│   │   │   ├── customer-attachment.model.ts  # NEW
│   │   │   └── duplicate-override.model.ts   # NEW
│   │   ├── middleware/
│   │   │   └── upload.ts                     # NEW — multer, limits applied before disk
│   │   └── db/migrations/                    # NEW — five tables
│   └── tests/customers/                      # NEW — incl. phone-normalisation and duplicate suites
│
└── frontend/
    ├── src/
    │   ├── router/index.ts                   # + /customers routes
    │   ├── services/
    │   │   ├── customers.service.ts          # NEW
    │   │   ├── customer-notes.service.ts     # NEW
    │   │   └── customer-attachments.service.ts # NEW
    │   ├── stores/customers.store.ts         # NEW
    │   ├── components/customers/             # NEW — DuplicateDialog, NoteList, AttachmentList
    │   ├── views/customers/                  # NEW — List, Form, Profile
    │   └── locales/{ar,en}.json              # + ~140 keys each, identical sets
    └── tests/customers/                      # NEW
```

**Structure Decision**: Customer code sits under `routes/customers/` and `controllers/customers/`,
mirroring how Phase 1 grouped admin code — the layering stays visible from the directory tree.
`lib/phone.ts` and `lib/file-storage.ts` are new: both are pure mechanism with no business rules and
no model access, so putting them in `services/` would misrepresent what they are. Services own the
decisions; these own the plumbing.

## Complexity Tracking

> No Constitution Check gate failed. These are decisions whose cost is real enough to record.

| Decision | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **A phone-parsing library rather than a hand-rolled rule** (research.md D1) | SC-002 and PLAN.md's Definition of done both rest on formatting-independent matching. A library encodes the numbering plans; a regex encodes whatever cases the author thought of | *Strip non-digits and compare the last N digits*: passes the examples in the spec and fails quietly elsewhere — different countries whose national numbers share a tail collide, and extensions break it. The failure mode is a **missed duplicate**, which is invisible until Phase 3 splits someone's history across two records |
| **Attachments on the filesystem, not in the database** (D2) | Streaming 10 MB blobs through MySQL bloats backups and the buffer pool for no benefit. The filesystem is what file storage is for | *Database BLOBs*: transactional with the row for free, which is genuinely attractive against FR-034 — but it makes every backup carry the binaries and turns a download into a large row read. D2 gets the same guarantee by ordering the writes instead. *Object storage now*: correct for a multi-instance deployment, which is Phase 12's concern; adding MinIO to `docker-compose.yml` today works against Phase 0's setup-time target for no capability anyone can use yet |
| **The error envelope gains one sibling key for duplicate matches** (D5) | A `409` that says "duplicate" without saying *which* record forces a second round trip and a second query. Phase 0's `details[]` is `{field, message}` pairs and cannot carry a customer summary | *Cram matches into `details[]`*: abuses a field with a defined meaning, and the frontend would parse messages. *A separate check-duplicates call before every save*: two round trips on the happy path, and a race between the check and the save. The envelope's `error` object is untouched, so every existing consumer keeps working |
| **Substring search on name and company** (D3) | FR-011 requires partial matching and no index serves a leading wildcard. Phone and email — the fields an agent actually holds during a call — are exact and indexed | *`FULLTEXT` from the start*: word-prefix only, so "smi" would not find "Smith", and a three-character minimum token by default. It answers a different question than the one asked. *Defer partial matching*: violates FR-011. **Accepted cost, recorded with a trigger**: name and company search is linear. D3 names the volume at which to revisit and what to move to |

### Non-violations worth recording

- **`libphonenumber-js`, `multer`, and `file-type` are additions, not stack deviations.** The
  constitution's Technology Standards table fixes framework, build, language, styling, state,
  runtime, ORM, database, auth, and i18n. It says nothing about phone parsing, multipart handling, or
  content sniffing — the same kind of gap Phase 0 found for the backend language and Phase 1 for
  testing, resolved in research rather than by amendment.
- **`record.deleted` still has no caller.** Phase 1 defined it expecting Phase 2 to be the first
  phase with business records to delete. Clarification Q1 chose deactivation only, so it stays
  uncalled. The spec's Overview and FR-044 originally said otherwise and were corrected — recorded
  here so a later reader is not misled by the earlier expectation.
- **Notes carry no visibility dimension** (Q2). If a later phase needs supervisor-only notes, that is
  an additive column plus a filter, not a rework — but nothing is built for it now.
- **No virus scanning** (Q3). Type-by-content and size limits only. This is the one accepted security
  deferral in the phase and **must be revisited before Phase 8**, whose customer portal would let
  files arrive from outside the organisation.

## Outstanding from earlier phases

Not blockers, recorded so they are not lost:

- **Phase 1's browser checks V6–V8** (Arabic rendering, keyboard operation, settings shell) were
  never run. Phase 2 adds five more screens to the same shell, so the gap widens with each phase that
  does not close it.
- **Phase 0's V8–V10** (language switch, no-flash reload, keyboard shell) likewise unconfirmed.
- **Phase 0's V13** (CI reports pass/fail) should now be answerable — `main` has been pushed with a
  test stage in the workflow, so the Actions run either exists or does not.
