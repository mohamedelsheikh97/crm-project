# Phase 2 Research: Customer Management

**Feature**: `003-phase-2-customer-management` | **Date**: 2026-08-27

Resolves every unknown in the plan's Technical Context, plus the four risks the spec's quality
checklist flagged for planning. Decisions here are binding for implementation.

## Observed starting state

| Observation | Implication |
|---|---|
| Database collation is `utf8mb4_0900_ai_ci` — accent- and case-insensitive Unicode | Arabic search and case-insensitive email comparison work without per-query special-casing (D4) |
| MySQL 8.4.11 | `FULLTEXT` available but word-prefix only; no native trigram index (D3) |
| Phase 1 permission catalog is a code constant; grants are seeder rows | A new module is catalog entries plus a seeder line — no migration (D6) |
| The permission matrix test is **generated** from the catalog | SC-007 is satisfied by adding entries and probes, not by writing assertions |
| `AUDIT_ACTIONS` already defines `data.exported`; `record.deleted` has no caller | Export uses the existing key; deletion stays uncalled (Clarifications Q1) |
| `auditService.record(entry, transaction)` requires a transaction for state changes | Every customer mutation follows the Phase 1 pattern unchanged |
| Optimistic locking via a `version` column is established on `users` and proven by test | Reused for customers (FR-045) rather than reinvented |
| No file upload or storage exists anywhere in the project | Genuinely new ground (D2) |
| Admin UI components (`DataTable`, `TablePagination`, `FormField`, `EmptyState`, `ConfirmDialog`) exist and are tested | Customer screens inherit keyboard and RTL behaviour rather than re-deriving it |

---

## D1. Phone normalisation

**Decision**: **`libphonenumber-js`**, with a configurable default region (`DEFAULT_PHONE_REGION`,
default `EG`). Each contact row stores **both** `value_raw` — exactly what the user typed, for
display — and `value_normalised` — E.164 where the number parses, or a digits-only fallback where it
does not. Matching and search use `value_normalised`; humans always see `value_raw`.

**Rationale**: this is the phase's Definition of done. SC-002 requires `+20 100 123 4567` and
`01001234567` to be recognised as the same number, and a library that encodes actual numbering plans
gets that right for numbers nobody thought to write a test for. Storing the raw value alongside is
what keeps the interface honest — normalising for comparison is a matching concern, and rewriting
what someone typed into their record is not.

**Alternatives considered**:

- *Strip non-digits and compare the last 9 digits*: no dependency, and it handles both examples in
  the spec. Rejected because it fails silently in both directions — national numbers from different
  countries sharing a nine-digit tail collide into a false duplicate, and an extension appended to a
  number breaks the match. **The dangerous failure is the missed duplicate**: nothing surfaces at the
  time, and by Phase 3 one person's support history is split across two records with no clean way to
  reunite it.
- *Store only E.164 and discard the typed form*: simpler schema. Rejected because an unparseable
  number would have to be rejected outright, and a support system must be able to record a number
  exactly as a customer gave it.
- *Normalise at query time rather than storing it*: no denormalised column to keep in step, but no
  index either — every duplicate check becomes a full scan of a growing table.

**Consequence to implement**: `value_normalised` is indexed, and normalisation happens in exactly one
place (`backend/src/lib/phone.ts`) used by write, search, and duplicate detection. Three callers
computing "the same" normalisation slightly differently is precisely how this requirement rots.

---

## D2. Attachment storage

**Decision**: files on the **filesystem**, under a configured directory (`ATTACHMENT_STORAGE_PATH`)
backed by a named Docker volume. The database row is the source of truth for metadata and holds a
generated storage key; the binary is never in the database and the directory is **never** exposed
through a static route.

Four rules, each closing a specific hole:

1. **The stored filename is generated** (a UUID plus an extension derived from the sniffed type). The
   user's filename is kept in the database for display and `Content-Disposition` only. A filename is
   attacker-controlled input, and `../../` in one is how it becomes a path.
2. **The file is written before the row is committed.** On failure the file is deleted. An orphan
   file is harmless and sweepable; a committed row pointing at a file that was never written is a
   broken download, which is what FR-034 forbids.
3. **Type is determined from content**, using `file-type` to sniff magic bytes, and the sniffed type
   must be in the allow-list. The client-supplied MIME type and the extension are both treated as
   claims, not facts (FR-032).
4. **Every download streams through an authenticated, permission-checked endpoint** (FR-033).
   Serving the directory statically would make an attachment reachable by anyone who obtains its
   address, which is the same defect as not checking at all.

**Rationale**: attachments are the largest attack surface this project has added. Each rule above
corresponds to a way file upload is routinely got wrong, and none costs much to get right up front.

**Alternatives considered**:

- *Database BLOBs*: transactional with the row for free, which is a real answer to FR-034. Rejected
  because every backup then carries every binary, the buffer pool fills with file data, and a
  download becomes a large row read. Rule 2 buys the same guarantee by ordering the writes.
- *Object storage (S3 or MinIO) now*: the right answer for a multi-instance deployment, which PLAN.md
  places in Phase 12. Rejected today because it adds a service to `docker-compose.yml` and an SDK for
  a capability nobody can yet use, and Phase 0's setup-time target is a live constraint.
  `file-storage.ts` is a narrow interface precisely so this can be swapped without touching a
  service.

**Consequence to implement**: multer with the size limit applied **before** anything reaches disk, so
an oversized upload is refused rather than written and then deleted.

---

## D3. Search

**Decision**: split by field, matching what an agent actually has in hand.

- **Phone**: exact match on the indexed `value_normalised` column, plus suffix match so a number
  entered without a country code still finds one stored with it.
- **Email**: exact and prefix match on the stored lowercase value, indexed.
- **Name and company**: `LIKE '%term%'` — substring, unindexed, linear.

A single search box queries all four and merges the results, ranking exact contact matches above
substring name matches.

**Rationale**: FR-011 requires partial matching and no B-tree index serves a leading wildcard. But
the fields an agent holds during a call — a phone number, an email — are exactly the ones that *can*
be indexed, and those stay fast regardless of table size. The linear part is the fallback path, not
the common one.

**Alternatives considered**:

- *`FULLTEXT` with boolean mode*: indexed, but it answers a different question. `smi*` matches
  word-prefixes, so it finds "Smith" from "smi" but never finds "Smith" from "mith", and
  `innodb_ft_min_token_size` defaults to 3 so two-character searches return nothing. Presenting that
  as "partial matching" would be misleading.
- *A generated trigram column*: MySQL has no native trigram index, so this means maintaining one by
  hand — a large amount of machinery for a table that will not need it for a long time.
- *An external search engine*: correct at real scale and disproportionate now.

**Accepted cost, with a trigger**: name and company search is `O(rows)`. At roughly **50,000
customers** on modest hardware this becomes perceptible, and the migration path is a `FULLTEXT`
index on name and company used *in addition to* substring matching — fast path first, fallback
second — rather than replacing it. Recorded so the limit is a known boundary rather than a surprise.

---

## D4. Arabic text

**Decision**: no special handling. The database is `utf8mb4` with `utf8mb4_0900_ai_ci`, which is
accent-insensitive and case-insensitive over Unicode, so Arabic names, addresses, and note bodies
store, compare, and search correctly through the same code paths as English.

**Rationale**: FR-052 and SC-013 require exact round-tripping and correct search. The collation
already delivers both. The failure this requirement guards against is a Latin-1 column or a
byte-wise collation, and neither is present — this was settled in Phase 0 and is being confirmed
rather than decided.

**Alternatives considered**:

- *A separate normalised search column stripping Arabic diacritics*: `_ai_` already ignores accents,
  and hand-rolled Unicode normalisation on top would be duplicated work with new ways to be wrong.

**Consequence to implement**: a test asserting an Arabic name round-trips byte-exact and is findable
by partial search. Cheap, and it fails loudly if a future migration changes a column's charset.

---

## D5. Duplicate detection and the override

**Decision**: one service, `duplicate.service.ts`, exposing `findDuplicates({ contacts, excludeCustomerId })`.
Both the create and the update path call it — FR-017 and FR-021 are the same rule applied at two
moments, and they must not be able to drift.

The flow:

1. A save that would introduce a duplicate returns **`409` with code `DUPLICATE_CUSTOMER`**, carrying
   the matching customers alongside the standard error envelope.
2. The interface shows the matches and asks. The user either opens an existing record, or resubmits
   with `acknowledgeDuplicates: true`.
3. An acknowledged save proceeds and writes a `customer_duplicate_overrides` row plus an audit entry,
   recording who decided, when, and which records they were warned about.

Deactivated customers are included in the search (FR-019), or a retired customer is silently
recreated.

**Rationale**: FR-023 is explicit that detection flags rather than refuses — a household phone shared
by two people is legitimate. Making the override an auditable row rather than a passing flag is what
makes SC-005 answerable months later.

**Alternatives considered**:

- *A separate `POST /customers/check-duplicates` called before every save*: two round trips on the
  happy path, and a race — a matching customer created between the check and the save slips through.
  The endpoint still exists for live feedback while typing, but it is an aid, **not** the barrier.
- *Refusing outright*: violates FR-023 and would make a legitimate shared number unenterable.
- *Detecting on name similarity too*: far too many false positives. Two people named Mohamed Ali are
  ordinary; two people with one phone number is worth a question.

**Envelope extension**: the `409` body carries `error` unchanged plus a sibling `duplicates` array.
Phase 0's `details[]` is `{field, message}` pairs and cannot carry a customer summary without abusing
a field that has a defined meaning. Adding a sibling key leaves every existing consumer working.

---

## D6. Permission model additions

**Decision**: nine new catalog entries in the existing `module:action` shape.

| Module | Actions |
|---|---|
| `customers` | `view`, `create`, `update`, `deactivate`, `export` |
| `notes` | `create`, `manage` |
| `attachments` | `upload`, `delete` |

`notes:manage` covers editing or removing **another** user's note (FR-027); anyone with
`notes:create` may edit their own.

**Default grants**:

| Role | Adds |
|---|---|
| `agent` | `customers:view`, `customers:create`, `customers:update`, `notes:create`, `attachments:upload` |
| `supervisor` | the above plus `customers:deactivate`, `customers:export`, `notes:manage`, `attachments:delete` |
| `admin` | all |

**Rationale**: FR-042 requires viewing, editing, and exporting to be distinguishable. Export is
separate because it is the action that takes customer data out of the system. Deactivation is
separate from update because it is the closest thing to deletion available.

**Alternatives considered**:

- *One `customers:manage` covering everything*: fewer entries, but an Agent who may correct a typo
  would also be able to export the customer list, which is exactly the distinction FR-042 asks for.
- *Folding notes and attachments under `customers:*`*: fewer modules, but then "may add a note"
  cannot be granted without "may edit the customer".

**Consequence to implement**: the matrix test picks these up automatically and will **fail** until
every one has a grant decision and a route enforcing it. That failure is the mechanism working.

---

## D7. Contact methods as rows

**Decision**: a `customer_contacts` table — one row per phone or email, with a `kind`, the raw and
normalised values, and an `is_primary` flag per kind. Not columns on `customers`.

**Rationale**: FR-004 requires multiple phones and emails per customer. Fixed columns
(`phone_1`, `phone_2`) cap the count arbitrarily and make the duplicate check a widening `OR` across
columns. As rows, duplicate detection is a single indexed lookup against one column regardless of how
many contacts anyone holds.

**Alternatives considered**:

- *A JSON column of contacts*: one table, flexible shape. Rejected because the duplicate check is the
  phase's core requirement and it needs an index — a JSON scan is the one thing this design must
  avoid.
- *Separate `customer_phones` and `customer_emails` tables*: marginally tidier typing, two tables to
  query, and the duplicate check has to union them.

---

## D8. Deactivation and referential integrity

**Decision**: `customers.is_active`, defaulting true. Deactivated customers are excluded from default
list and search results and remain fetchable by direct reference. **No delete path exists**
(Clarifications Q1), so nothing in a later phase can be orphaned.

**Rationale**: FR-007, FR-008, and SC-014. Phase 3 attaches tickets to customers; a permanent delete
would force every later phase to handle a vanishing reference. Choosing this now is what lets Phase 3
treat a customer reference as permanent.

**Alternatives considered**:

- *Hard delete with cascade*: simple until the first phase that needs the history.
- *Hard delete blocked when references exist*: defensible, but it makes deletion's availability
  depend on data the user cannot see, and Q1 removed the question.

---

## D9. Export

**Decision**: CSV with a UTF-8 BOM, generated server-side from the caller's active filter, streamed
rather than assembled in memory. Every export writes a `data.exported` audit entry carrying the row
count. Fields are restricted to what the caller can already see on screen (FR-039).

**Rationale**: FR-037–FR-040. The BOM is not decoration — without it Excel misreads UTF-8 and Arabic
names arrive as mojibake, which would fail SC-013 in the one place a customer's name is most likely
to be read by someone outside the team. Streaming keeps a large export from being bounded by memory.

**Alternatives considered**:

- *XLSX*: nicer formatting and no encoding trap, at the cost of a spreadsheet-writing dependency for
  output that is consumed as data.
- *Client-side generation from the loaded page*: exports only the current page, and the audit entry
  would be a claim by the client rather than a server-side fact.

---

## D10. Testing approach

**Decision**: extend the Phase 1 suite rather than start a new pattern. Specifically:

- **The permission matrix extends automatically.** It is generated from the catalog, so the nine new
  keys need a probe entry each; SC-007 then holds by construction.
- **A dedicated phone-normalisation suite** over a table of real-world formats — local, international,
  spaced, dashed, with and without country code, plus unparseable input — asserting which pairs are
  the same number. This is where D1 either works or does not.
- **A dedicated duplicate suite covering create *and* update.** FR-021 is a second code path that the
  creation tests do not exercise; the spec's checklist flagged it as easy to overlook, so it gets its
  own tests rather than an assumption.
- **An attachment security suite**: oversized refused, disallowed type refused, a file whose
  extension lies about its content refused, and a download refused for a user without permission.
- **An Arabic round-trip test** (D4).

**Rationale**: the machinery exists and works; the value is in aiming it at this phase's specific
failure modes rather than restating coverage that Phase 1 already guarantees.

---

## Resolved-unknowns summary

| Technical Context item | Resolution |
|---|---|
| Phone normalisation | `libphonenumber-js`, store raw + normalised, one normalisation site (D1) |
| Attachment storage | Filesystem, generated names, file-before-row, content sniffing, no static route (D2) |
| Search approach | Indexed exact on phone/email, substring on name/company, trigger recorded (D3) |
| Arabic text | No special handling; the collation already delivers it (D4) |
| Duplicate detection | One service for create and update; `409` + matches; auditable override (D5) |
| Permission additions | Nine catalog entries across three modules (D6) |
| Contact methods | Rows in `customer_contacts`, indexed on the normalised value (D7) |
| Deactivation | `is_active`; no delete path, so references stay valid (D8) |
| Export | Streamed CSV with BOM, audited with a row count (D9) |
| Testing | Extend Phase 1's suite, aimed at this phase's failure modes (D10) |
