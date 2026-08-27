# Feature Specification: Phase 2 — Customer Management

**Feature Branch**: `003-phase-2-customer-management`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "Phase 2 — Customer Management"

**PLAN.md Reference**: Phase 2 — Customer Management

**Depends on**: Phase 1 — Security & Administration Foundations (`002-phase-1-security-administration`)

## Overview

Phase 1 established who may act. Phase 2 gives them something to act on: the customer record that
every later module attaches to. Tickets hang off a customer in Phase 3, conversations in Phase 5, the
portal in Phase 8.

That makes record **identity** the load-bearing concern. PLAN.md's Definition of done singles it out:
duplicates must be *flagged rather than silently created*. A customer accidentally entered twice does
not stay a tidy local problem — by Phase 3 their support history is split across two records, and no
later phase can cleanly reunite it. The duplicate check in this phase is cheap; the cleanup it
prevents is not.

Phase 2 is also the first phase with **real business records to export**, so it is where the
`data.exported` audit action Phase 1 defined finally acquires a caller. `record.deleted` does **not**:
customers are deactivated, never deleted (Clarifications Q1), so that key stays without a caller until
a phase genuinely deletes something.

## Clarifications

### Session 2026-08-27

Three scope questions were raised during `/speckit-specify`, all where PLAN.md's wording admits
materially different readings. All three are resolved; no `[NEEDS CLARIFICATION]` markers remain.

- **Q1 — May a customer be permanently deleted?** **Decision: deactivation only.** This matches
  PLAN.md's scope wording exactly, and it lets Phase 3 onward assume a customer reference is
  permanent — a much simpler world than one where a referenced record can vanish. `record.deleted`
  stays without a caller until a phase genuinely deletes something. See FR-009.
- **Q2 — Do any notes need restricted visibility?** **Decision: all notes are visible to anyone who
  can view the customer.** One note list, one query, and no visibility dimension threaded through
  every later surface that renders notes — including Phase 8's customer portal. See FR-028.
- **Q3 — Should uploads be virus-scanned?** **Decision: type and size restrictions only.** FR-032
  already judges type by file content rather than filename, which closes the naive attack, and
  scanning would add an external dependency plus a "pending scan" state every download path must
  handle. Recorded as a **deliberate, revisitable deferral** rather than an oversight. See FR-036.

All three decisions **narrow** scope. Q3 in particular is a security trade-off accepted with open
eyes: it should be revisited if this system ever accepts files from outside the organisation, which
Phase 8's customer portal would introduce.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Agent Finds a Customer (Priority: P1)

An Agent takes a call. Before anything else they need to know who they are talking to, so they search
by whatever the caller offered — a name, a phone number, an email, a company — and land on the right
record. If nobody matches, they can say so confidently rather than guessing.

**Why this priority**: Finding comes before creating and before editing. It is the single most
frequent action in a support system, and every other story in this phase begins with it. It is also
independently useful the moment customer records exist at all.

**Independent Test**: Seed a set of customers, then search by each of the four fields and confirm the
right record is found, that a partial value works, and that a non-match reports plainly rather than
returning a misleading near-match.

**Acceptance Scenarios**:

1. **Given** customers exist, **When** an Agent searches a full or partial name, **Then** matching
   customers are listed, most relevant first.
2. **Given** customers exist, **When** an Agent searches a phone number, **Then** the match is found
   regardless of how the number was formatted when it was stored — spaces, dashes, or a country
   prefix must not prevent it.
3. **Given** customers exist, **When** an Agent searches an email or a company name, **Then**
   matching customers are listed.
4. **Given** no customer matches, **When** the search completes, **Then** the Agent is told plainly
   that nothing matched and offered a way to create the customer.
5. **Given** many customers match, **When** results are shown, **Then** they are paged rather than
   returned in full, and the total is visible.
6. **Given** a user whose role does not permit viewing customers, **When** they attempt to search,
   **Then** the server refuses the request — not merely hiding the screen.

---

### User Story 2 — Agent Creates a Customer, Duplicates Flagged (Priority: P1)

An Agent enters a new customer. Before the record is created, the system checks whether that phone or
email already belongs to someone and, if so, shows the existing record and asks what they meant. The
Agent can open the existing customer instead, or state that this genuinely is a different person and
proceed.

**Why this priority**: This is PLAN.md's Definition of done verbatim — "duplicates flagged rather
than silently created". Everything downstream inherits whatever identity decisions are made here.

**Independent Test**: Create a customer, then attempt a second with the same phone, the same email,
and a differently-formatted version of the same phone. Confirm each is flagged with the existing
record shown, and that proceeding deliberately is still possible and recorded.

**Acceptance Scenarios**:

1. **Given** an Agent is creating a customer, **When** they supply a name and at least one contact
   method, **Then** the record is created and immediately findable by search.
2. **Given** a customer already holds a phone number, **When** an Agent creates another with the same
   number, **Then** the system flags the potential duplicate and shows the existing record **before**
   creating anything.
3. **Given** a customer already holds an email, **When** an Agent creates another with the same
   email, **Then** the same flag appears.
4. **Given** a duplicate is flagged, **When** the Agent confirms it is genuinely a different person,
   **Then** the record is created and the override is recorded as a deliberate decision.
5. **Given** a duplicate is flagged, **When** the Agent opens the existing customer instead, **Then**
   no new record is created.
6. **Given** a phone number is stored as `+20 100 123 4567`, **When** an Agent enters `01001234567`,
   **Then** it is recognised as the same number and flagged — formatting must not defeat the check.
7. **Given** an Agent supplies neither a phone nor an email, **When** they submit, **Then** the form
   explains that at least one contact method is required, because a customer nobody can contact is
   not usable.

---

### User Story 3 — Agent Maintains a Customer Record (Priority: P1)

An Agent corrects a misspelled name, adds a second phone number, updates an address after a move, and
retires a record for a customer who no longer exists. The history stays intact throughout.

**Why this priority**: The second half of PLAN.md's Definition of done ("find, create, **and
update**"). A record that cannot be corrected decays into noise within weeks.

**Independent Test**: Edit each field on a customer, add and remove a contact method, deactivate the
record, and confirm it disappears from default search while remaining reachable and referenced.

**Acceptance Scenarios**:

1. **Given** a customer exists, **When** an Agent edits their details and saves, **Then** the changes
   persist and are visible in search immediately.
2. **Given** two people edit the same customer, **When** the second saves over a version the first
   already changed, **Then** the second is told the record changed rather than silently overwriting.
3. **Given** a customer exists, **When** an Agent adds an additional phone number or email, **Then**
   both are held and both find the customer in search.
4. **Given** a customer is no longer active, **When** a permitted user deactivates the record,
   **Then** it no longer appears in default search results but remains reachable and still satisfies
   any existing reference to it.
5. **Given** a deactivated customer, **When** a permitted user reactivates them, **Then** they return
   to normal search results.
6. **Given** an edit changes a phone or email to one another customer already holds, **When** the
   Agent saves, **Then** the duplicate is flagged exactly as it is at creation.
7. **Given** any change to a customer, **When** it is saved, **Then** an audit entry records who
   changed what and when.

---

### User Story 4 — Notes Build a Customer's History (Priority: P2)

An Agent records what happened on a call — what the customer asked, what was agreed — so the next
person to speak to them is not starting cold. Notes accumulate in order and identify their author.

**Why this priority**: PLAN.md scopes notes to this phase and they deliver value immediately. P2
rather than P1 because the Definition of done is satisfied by finding, creating, and updating; notes
enrich those records rather than constituting them.

**Independent Test**: Add several notes to a customer, confirm they appear newest first with author
and timestamp, and confirm a note cannot be silently rewritten to say something else.

**Acceptance Scenarios**:

1. **Given** an Agent is viewing a customer, **When** they add a note, **Then** it appears on the
   profile with their name and the time.
2. **Given** a customer has several notes, **When** the profile is opened, **Then** notes are ordered
   most recent first.
3. **Given** an Agent wrote a note, **When** they edit it within the permitted window, **Then** the
   note shows that it was edited rather than appearing untouched.
4. **Given** a note written by someone else, **When** an Agent attempts to edit it, **Then** the
   server refuses unless their role permits managing others' notes.
5. **Given** a customer has many notes, **When** the profile is opened, **Then** notes are paged
   rather than all loaded at once.

---

### User Story 5 — Files Attach to a Customer (Priority: P2)

An Agent attaches a document a customer sent — a signed form, a photo of a faulty item — so it lives
with the record rather than in someone's inbox. Colleagues can download it; unsafe files are refused.

**Why this priority**: PLAN.md scopes attachments alongside notes. P2 for the same reason, and it
carries more risk than any other story here — uploads are the phase's largest new attack surface.

**Independent Test**: Upload permitted file types, confirm they download intact, and confirm an
oversized file and a disallowed type are each refused with a clear reason.

**Acceptance Scenarios**:

1. **Given** an Agent is viewing a customer, **When** they attach a permitted file, **Then** it
   appears on the profile with its name, size, uploader, and upload time.
2. **Given** an attachment exists, **When** a permitted user downloads it, **Then** they receive the
   original file unchanged.
3. **Given** a file exceeds the size limit, **When** upload is attempted, **Then** it is refused with
   a message naming the limit.
4. **Given** a file type is not permitted, **When** upload is attempted, **Then** it is refused,
   **and** the decision is based on the file's actual content rather than its name alone.
5. **Given** a user whose role does not permit viewing customers, **When** they request an attachment
   by direct link, **Then** the server refuses — an attachment must not be reachable by anyone who
   guesses its address.
6. **Given** an attachment is removed, **When** the removal completes, **Then** it is recorded in the
   audit log and the stored file is no longer retrievable.

---

### User Story 6 — Supervisor Reviews and Exports (Priority: P3)

A Supervisor filters the customer list — by company, by activity, by when records were created — and
exports the result to work with elsewhere. The export is recorded, because customer data leaving the
system is exactly the kind of event the audit log exists for.

**Why this priority**: Filtering and export are genuinely useful but sit outside the Definition of
done. P3 also lets the `data.exported` audit action Phase 1 defined acquire its first real caller in
a low-risk setting.

**Independent Test**: Filter the customer list by each supported field, export the result, confirm
the file contains exactly the filtered rows, and confirm the audit log records the export with a
count.

**Acceptance Scenarios**:

1. **Given** customers exist, **When** a Supervisor filters by company or active state, **Then** only
   matching customers are listed.
2. **Given** a filtered list, **When** a permitted user exports it, **Then** the export contains
   exactly the rows the filter produced — not the whole table.
3. **Given** an export completes, **When** the audit log is checked, **Then** an entry records who
   exported, when, and how many records.
4. **Given** a user whose role does not permit export, **When** they attempt it, **Then** the server
   refuses.
5. **Given** an export is requested, **When** the file is produced, **Then** it contains no field the
   requesting user could not already see on screen.

---

### Edge Cases

- **The same person reached two ways.** One customer with two phone numbers, both matching different
  existing records — the duplicate check must surface every match, not just the first.
- **Phone formatting.** `+20 100 123 4567`, `01001234567`, and `0100-123-4567` must be treated as the
  same number for duplicate detection and for search.
- **Deliberate duplicate overrides.** Sometimes two people genuinely share a household phone. The
  override must be possible, recorded, and not silently repeated on every later edit.
- **A deactivated customer matching a new entry.** The duplicate check must consider deactivated
  records, or a retired customer is re-created as a second record.
- **Editing into a duplicate.** Changing an existing customer's phone to one another customer holds
  is the same problem as creating one, and must be caught the same way.
- **Concurrent edits.** Two Agents saving the same customer must not silently lose one another's
  changes.
- **A customer referenced by later phases.** Once tickets attach in Phase 3, a customer cannot simply
  vanish. This phase must settle deletion semantics now rather than leaving Phase 3 to discover them.
- **Very large customer lists.** Search, listing, and export must stay usable as the table grows;
  none may load everything at once.
- **An attachment whose extension lies about its content.** A file named `.pdf` containing something
  else must be judged on content.
- **Storage unavailable during upload.** The customer record must not end up referencing a file that
  was never stored.
- **A note about the wrong customer.** Notes are attributed and timestamped; correcting one must
  leave evidence that it was changed.
- **Search terms with unusual characters.** Names in Arabic script, apostrophes, and hyphens must
  search correctly and must not be interpretable as anything but text.

## Requirements _(mandatory)_

### Functional Requirements

#### Customer records

- **FR-001**: System MUST hold a customer record with, at minimum, a display name, an optional
  company, one or more contact methods, an optional address, an active state, and creation and
  update timestamps.
- **FR-002**: Users with the appropriate permission MUST be able to create, view, list, edit, and
  deactivate customer records.
- **FR-003**: Every customer MUST carry at least one contact method — a phone number or an email
  address. A record nobody can contact is not usable.
- **FR-004**: A customer MUST be able to hold **multiple** phone numbers and email addresses, with
  one of each designated primary.
- **FR-005**: Phone numbers MUST be stored in a normalised form for comparison while preserving what
  the user typed for display, so formatting differences never defeat matching.
- **FR-006**: Email addresses MUST be compared case-insensitively.
- **FR-007**: Deactivation MUST be used instead of deletion for customer records, so later phases'
  references remain valid and history is not lost.
- **FR-008**: Deactivated customers MUST be excluded from default search and list results, and MUST
  remain reachable when explicitly requested.
- **FR-009**: A customer record MUST NOT be permanently deletable in this phase. Deactivation is the
  only removal, so every later phase may treat a customer reference as permanent. No erasure endpoint
  or interface control exists (Clarifications Q1).

#### Search and filtering

- **FR-010**: Users MUST be able to search customers by name, phone number, email, and company in a
  single search, without choosing a field first.
- **FR-011**: Search MUST match partial values, so a caller offering part of a name or number is
  enough.
- **FR-012**: Phone search MUST match regardless of formatting, using the same normalisation as
  FR-005.
- **FR-013**: Search MUST correctly handle non-Latin script, including Arabic names.
- **FR-014**: Search results MUST be paged, with the total count available, and MUST NOT require
  loading every match.
- **FR-015**: Users MUST be able to filter the customer list by company and by active state.
- **FR-016**: When no customer matches, the interface MUST say so plainly and offer to create one,
  rather than showing an empty table or an unrelated near-match.

#### Duplicate detection

- **FR-017**: Before creating a customer, the system MUST check whether the supplied phone or email
  already belongs to an existing customer.
- **FR-018**: When a potential duplicate is found, the system MUST present the existing record and
  require an explicit decision **before** creating anything.
- **FR-019**: The duplicate check MUST consider deactivated customers, or a retired customer is
  silently re-created.
- **FR-020**: The user MUST be able to proceed deliberately when the match is genuinely a different
  person, and that override MUST be recorded.
- **FR-021**: The duplicate check MUST apply to **edits** as well as creation — changing a contact
  method into one another customer holds is the same problem.
- **FR-022**: When several existing customers match, **all** matches MUST be shown, not just the
  first.
- **FR-023**: Duplicate detection MUST NOT silently block creation. It flags and asks; it never
  refuses outright, because a legitimate shared number must remain enterable.

#### Notes

- **FR-024**: Users with the appropriate permission MUST be able to add notes to a customer, each
  recording its author and the time written.
- **FR-025**: Notes MUST be listed most recent first and MUST be paged.
- **FR-026**: A note that has been edited MUST show that it was edited, rather than appearing
  untouched.
- **FR-027**: A user MUST NOT be able to edit or remove another user's note unless their role
  permits managing others' notes.
- **FR-028**: Every note on a customer MUST be visible to any user permitted to view that customer.
  There is no restricted, private, or supervisor-only note kind in this phase (Clarifications Q2).

#### Attachments

- **FR-029**: Users with the appropriate permission MUST be able to attach files to a customer,
  recording the file name, size, uploader, and upload time.
- **FR-030**: Permitted users MUST be able to download an attachment and receive the original file
  unchanged.
- **FR-031**: System MUST enforce a maximum file size and refuse anything larger, naming the limit.
- **FR-032**: System MUST restrict uploads to an allowed set of file types, and MUST determine type
  from the file's **content**, not its name alone.
- **FR-033**: Every attachment request MUST be permission-checked server-side. An attachment MUST NOT
  be retrievable by anyone who obtains or guesses its address.
- **FR-034**: A failed or interrupted upload MUST NOT leave a customer referencing a file that was
  never stored.
- **FR-035**: Removing an attachment MUST record an audit entry and MUST make the stored file
  unretrievable.
- **FR-036**: Uploaded files are **not** virus-scanned in this phase. Protection rests on the type
  restriction in FR-032 — judged by file content, not filename — and the size limit in FR-031. This is
  a deliberate deferral, not an omission (Clarifications Q3), and MUST be revisited before any phase
  accepts files from outside the organisation.

#### Export

- **FR-037**: Users with the appropriate permission MUST be able to export the filtered customer list.
- **FR-038**: An export MUST contain exactly the rows the active filter produced.
- **FR-039**: An export MUST NOT contain any field the requesting user could not already see.
- **FR-040**: Every export MUST record an audit entry naming who exported and how many records.

#### Permissions, audit, and cross-cutting

- **FR-041**: Every customer action MUST be governed by a permission enforced **server-side**, using
  the model Phase 1 established. Hiding an interface control MUST NOT be the only barrier.
- **FR-042**: The permission model MUST distinguish viewing customers from editing them, and both
  from exporting.
- **FR-043**: Customer creation, update, deactivation, reactivation, note changes, attachment upload
  and removal, deliberate duplicate overrides, and exports MUST each produce an audit entry.
- **FR-044**: Exports MUST use the `data.exported` audit action Phase 1 defined for exactly this
  purpose, rather than inventing a new key. `record.deleted` MUST NOT be used in this phase, because
  nothing here is permanently deleted (FR-009).
- **FR-045**: Concurrent edits MUST NOT silently lose a change; the later writer MUST be told the
  record changed.
- **FR-046**: Every user-visible string introduced by this phase MUST come from the Arabic and
  English locale files, which MUST hold identical key sets.
- **FR-047**: Every screen introduced by this phase MUST render correctly in both text directions,
  using root-level direction rather than per-component flipping.
- **FR-048**: Every interactive control MUST be reachable and operable by keyboard alone, with a
  visible focus indicator meeting contrast requirements in both directions.
- **FR-049**: Validation errors MUST be announced to assistive technology, not conveyed by colour or
  position alone.
- **FR-050**: All customer lists, note lists, and search results MUST be paged or otherwise bounded.
- **FR-051**: The layered separation established in Phase 0 and carried through Phase 1 MUST be
  preserved: business decisions live in the service layer, and no interface component communicates
  with the backend except through the established service layer.
- **FR-052**: Customer-facing text MUST accept and correctly store non-Latin characters, including
  Arabic names, addresses, and note bodies.

### PLAN.md Traceability

| PLAN.md Phase 2 Scope bullet | Covered by |
| --- | --- |
| Customer CRUD (create, view, edit, deactivate) | FR-001–FR-009 |
| Contact details (phone, email, address) | FR-003–FR-006 |
| Notes and file attachments on a customer profile | FR-024–FR-036 |
| Search/filter by name, phone, email, company | FR-010–FR-016 |
| Duplicate detection on matching phone/email at creation | FR-017–FR-023 |

Cross-cutting constitutional requirements are covered by FR-041–FR-044 (permissions and audit),
FR-046–FR-049 (bilingual, RTL, accessibility), and FR-051 (layering).

PLAN.md **Definition of done** for Phase 2 maps as follows:

| Definition of done clause | Verified by |
| --- | --- |
| "An Agent can find … a customer record" | User Story 1, SC-001, SC-002 |
| "create, and update a customer record" | User Stories 2 and 3, SC-003, SC-006 |
| "with duplicates flagged rather than silently created" | User Story 2, SC-004, SC-005 |

**Carried forward from Phase 1.** Phase 1 defined the `data.exported` and `record.deleted` audit
actions with no callers, because no phase before this one had business records to export or delete.
FR-044 requires this phase to use `data.exported` rather than invent its own shape. `record.deleted`
remains uncalled — deactivation is the only removal here (Clarifications Q1) — and is carried forward
again for whichever phase first deletes something permanently.

### Key Entities

- **Customer**: The person or organisation being supported. Holds a display name, an optional company,
  an optional address, an active state, and timestamps. The anchor every later module attaches to.
- **Contact Method**: A phone number or email address belonging to a customer. A customer may hold
  several; one of each kind is primary. A phone carries both what the user typed and a normalised
  form used for matching.
- **Customer Note**: A dated, attributed piece of text on a customer, recording what happened. Carries
  its author, when it was written, and whether it has since been edited.
- **Attachment**: A file belonging to a customer, holding its original name, size, content type,
  uploader, and upload time — plus a reference to wherever the file itself is stored.
- **Duplicate Override**: A record that a user was shown a potential duplicate and deliberately chose
  to proceed, capturing who decided, when, and which record they were warned about.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An Agent can locate an existing customer from a name, phone, email, or company in under
  15 seconds, without choosing which field to search first.
- **SC-002**: Searching a phone number finds the customer regardless of how either the stored or the
  searched value was formatted — 100% of formatting variations of the same number match.
- **SC-003**: An Agent can create a complete customer record in under two minutes.
- **SC-004**: Every attempt to create a customer whose phone or email already exists is flagged before
  the record is created — zero silent duplicates, verified across formatting variations and against
  deactivated records.
- **SC-005**: When a flagged duplicate is genuinely a different person, the Agent can still proceed,
  and the decision is retrievable from the audit log afterwards.
- **SC-006**: An Agent can correct a customer's details and see the change reflected in search
  immediately.
- **SC-007**: For every combination of role and customer action, invoking the action directly —
  bypassing the interface entirely — produces the same allow-or-refuse outcome the interface
  presents. Zero combinations differ.
- **SC-008**: No attachment is retrievable by a user who lacks permission to view its customer, by any
  route including a direct link.
- **SC-009**: Every action listed in FR-043 produces a retrievable audit entry — 100% coverage,
  verified action by action.
- **SC-010**: Customer search returns results without perceptible delay at a realistic data volume,
  and no list operation loads the entire table.
- **SC-011**: Every screen introduced by this phase is fully operable by keyboard alone, in both
  Arabic and English, with a visible focus indicator throughout.
- **SC-012**: The Arabic and English locale files hold identical key sets, and no screen displays an
  untranslated key or hardcoded string in either language.
- **SC-013**: Arabic names, addresses, and note text are stored and redisplayed exactly as entered.
- **SC-014**: Deactivating a customer removes them from default results while leaving every existing
  reference to them valid.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for `/speckit-clarify`.

- **Customers are people or organisations recorded by staff.** This phase has no customer self-service
  — PLAN.md places the customer portal in Phase 8, so nobody outside the organisation reaches these
  records here.
- **A customer is not owned by a particular Agent.** Any user permitted to view customers sees all of
  them. Assignment and territory scoping are not implied by PLAN.md and are not in scope.
- **No department or tenant scoping.** PLAN.md places multi-tenancy in Phase 12, so customer
  visibility is global within the organisation.
- **Permission granularity follows Phase 1's `module:action` model**, adding a `customers` module. The
  three roles are unchanged; only their grants extend.
- **Default grants**: Agents may view, create, and update customers, and add notes and attachments.
  Supervisors additionally deactivate and export. Administrators inherit everything.
- **Attachment limits**: 10 MB per file, restricted to common document and image types. These are
  starting values, configurable in the same way Phase 1's policy values are.
- **Note editing window**: a note's author may edit it; edits are marked. No fixed time limit is
  imposed, since a correction is more valuable than a frozen typo.
- **Export format is a spreadsheet-compatible file.** No format is mandated by PLAN.md, and staff
  exporting customer lists overwhelmingly work in spreadsheets.
- **Address is a single free-text field**, not structured into street, city, and postcode. PLAN.md says
  only "address", structured addresses invite validation rules no requirement asks for, and Arabic
  and English addresses do not share a structure.
- **Duplicate detection matches phone and email only** — not name or company, which produce far too
  many false positives to be useful.
- **Test coverage follows Phase 1's pattern.** The permission matrix extends to the new module
  automatically, and SC-007 is verified the same generated way rather than by hand.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **Tickets, cases, or any support workflow.** Phase 3 opens that; this phase delivers the record they
  attach to.
- **Customer-facing self-service.** The portal is Phase 8. Customers do not see or edit their own
  records here.
- **Permanent deletion or erasure of a customer record.** Deactivation is the only removal by
  decision (Clarifications Q1), so later phases may treat a customer reference as permanent.
- **Restricted or private notes.** Every note is visible to anyone who can view the customer
  (Clarifications Q2).
- **Virus scanning of uploads.** Type-by-content and size limits only (Clarifications Q3). **Revisit
  before Phase 8's customer portal**, which would let files arrive from outside the organisation.
- **Merging two customer records into one.** Duplicate *detection* is in scope; duplicate *resolution*
  is a distinct capability with its own history-reconciliation problem, and PLAN.md asks only that
  duplicates be flagged.
- **Bulk import of customers.** Export is scoped; import is not, and it carries its own duplicate and
  validation design.
- **Communication with customers** — email, SMS, or any channel. Phase 5 introduces channels.
- **Customer segmentation, tagging, or marketing lists.**
- **Structured or validated postal addresses**, and geocoding.
- **Per-Agent ownership, territories, or assignment rules.**
- **Department or tenant scoping of customer visibility** (Phase 12).
