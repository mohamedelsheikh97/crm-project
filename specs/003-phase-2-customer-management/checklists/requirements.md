# Specification Quality Checklist: Phase 2 — Customer Management

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validated 2026-08-27: 16/16 items passing.**

Initial validation found 15/16, failing only on three `[NEEDS CLARIFICATION]` markers. All three
were resolved in the same session and the spec updated; re-validation passes all sixteen.

### Resolved during `/speckit-specify`

- **FR-009 — permanent deletion.** **Resolved: deactivation only.** Matches PLAN.md, and lets Phase 3
  onward assume a customer reference is permanent.
- **FR-028 — note visibility.** **Resolved: all notes visible to anyone who can view the customer.**
  No visibility dimension threaded through every later note surface.
- **FR-036 — virus scanning.** **Resolved: type-by-content and size limits only.** A deliberate,
  revisitable deferral rather than an omission — flagged to be reconsidered before Phase 8, whose
  customer portal would let files arrive from outside the organisation.

All three **narrowed** scope; no requirement was weakened to let an item pass. Q1 additionally made
two statements elsewhere in the spec stale — the Overview and FR-044 both claimed `record.deleted`
would acquire a caller here. Both were corrected rather than left to mislead a later phase.

### Content Quality note

Holds to the strict reading, as Phase 1 did. Requirements are phrased as outcomes ("stored in a
normalised form for comparison", "determined from the file's content, not its name alone") rather
than named technologies. "Customer", "Agent", and "Supervisor" are domain vocabulary from PLAN.md and
the Phase 1 role model, not implementation detail.

### Constitution compliance (v1.1.0)

- **I. Bilingual-First & RTL**: FR-046, FR-047, FR-052; SC-011, SC-012, SC-013. Arabic name and
  address handling is called out explicitly rather than assumed, because this is the first phase
  storing substantial free text a customer supplied.
- **II. Security by Default**: FR-041 (server-side enforcement, inheriting Phase 1's model), FR-033
  (attachments permission-checked on every request), FR-043 and FR-044 (audit coverage using the keys
  Phase 1 defined). Attachments are the largest new attack surface this phase introduces and are
  specified accordingly.
- **III. Layered Architecture**: FR-051 carries Phase 0 and Phase 1 layering forward.
- **IV. Accessibility**: FR-048, FR-049; SC-011.
- **V. Phase-Gated Delivery**: this spec is the specify step for Phase 2; PLAN.md Phase 2 is
  referenced throughout and traced in the PLAN.md Traceability section.
- **Technology Standards**: no deviation proposed; the spec names no technologies.
- **Traceability**: every Scope bullet and all three parts of the Definition of done are mapped.

### Risks flagged for `/speckit-plan`

1. **Phone normalisation is load-bearing and underspecified.** FR-005, FR-012 and SC-002 all depend
   on treating `+20 100 123 4567` and `01001234567` as the same number. Egyptian and international
   formats, extensions, and missing country codes each complicate this. The plan must decide the
   normalisation rule deliberately — a weak one silently defeats duplicate detection, which is the
   Definition of done.
2. **Attachment storage location is unresolved.** Storing binaries in the database, on local disk, or
   in object storage have very different operational consequences, and FR-034 (no dangling reference)
   plus FR-035 (unretrievable after removal) constrain the choice. Nothing in Phases 0–1 established a
   file-storage approach, so this is genuinely new ground.
3. **Search performance versus correctness.** FR-011 requires partial matching, FR-013 requires Arabic
   to work, and SC-010 requires no perceptible delay. Naive substring matching across several columns
   degrades quickly, and the obvious index does not help a leading-wildcard search. The plan should
   choose an approach rather than default into one.
4. **Duplicate detection on edit (FR-021) is easy to overlook.** It is specified, but it is a second
   code path that will not be exercised by the creation flow's tests. It needs its own coverage.

---

### Post-implementation re-validation (2026-08-27, `/speckit-implement`)

**Status unchanged: 16/16.** No accepted exception changed, and no new one was needed. All three
clarification decisions held through implementation and are verified by audit:

- **No permanent deletion** (Q1) — no delete route, no `destroy` call on a customer, and
  `DELETE /api/customers/:id` returns `404` because the route does not exist. Phase 3 may treat a
  customer reference as permanent.
- **No note visibility** (Q2) — no column, and a test asserts every note is visible to anyone who may
  view the customer.
- **No virus scanning** (Q3) — no scan-state column and no pending state on any download path.

### Complexity Tracking verified against what was built

All four `plan.md` entries describe the implementation accurately:

1. **A phone library rather than a hand-rolled rule.** Built. The suite includes the case the naive
   alternative fails — an Egyptian and a British number sharing a digit tail must not collide.
   Normalisation appears in exactly one file, confirmed by audit.
2. **Attachments on the filesystem.** Built, with all four rules verified by test: generated
   filenames, content-sniffed types, file-before-row ordering, and no static route.
3. **The envelope gained one sibling key.** Built. A test asserts `details[]` stays empty on a
   `409 DUPLICATE_CUSTOMER`, so the existing field keeps its defined meaning.
4. **Substring search on name and company.** Built as designed, with the accepted linear cost
   unchanged. The volume trigger in research.md D3 stands.

### Carry-forward into the Phase 3 spec (MANDATORY)

- **Customers are never deleted.** A ticket may hold a customer reference without handling a
  vanishing target.
- **`record.deleted` STILL has no caller.** Phase 1 defined it expecting Phase 2 to be its first;
  Q1 overturned that. Phase 3 may be the phase that finally needs it — and if so it must use that
  key rather than inventing one.
- **Adding a protected endpoint takes three steps** — catalog entry, `requirePermission`, grant
  decision. The matrix test fails the build on any omission. Phase 2's `customers` module is the
  pattern a `tickets` module extends.
- **The matrix now models CONDITIONAL permissions.** `notes:manage` is enforced in a service based on
  ownership rather than at the route, so it is declared in `CONDITIONAL_PERMISSIONS` and must name the
  test that covers it. A later phase adding a similar rule should do the same rather than leaving the
  key exempt and untested.
- **Q3's virus-scanning deferral must be revisited before Phase 8**, whose customer portal would let
  files arrive from outside the organisation.

### Risks flagged for Phase 3

- **V7 and V8 were not run** — no browser was available. The screens are built and covered by
  component and locale tests, but nobody has looked at them. Phase 1's V6–V8 and Phase 0's V8–V10 are
  likewise unrun; three phases of screens now sit unverified in the same shell.
- **The suite takes roughly four minutes.** bcrypt at cost 12 plus serial integration tests against
  one database. Acceptable, but Phase 3 adds more. Lowering the bcrypt cost **in the test environment
  only** is the correct lever if it becomes a drag — never in production.
