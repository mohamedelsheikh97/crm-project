# Amendment Proposal: Technology Standards — AI Processing

**Proposed**: 2026-09-02 | **For**: Phase 9 — AI Features | **Task**: T001

Submitted under the Governance section's Amendment procedure. Step 1 (propose in writing, citing the
section being changed and the rationale) is this document. **Step 2 — explicit approval — is
outstanding, and no Phase 9 implementation task may begin until it is given.**

---

## 1. Section being changed

`.specify/memory/constitution.md` → **Technology Standards**, and its **Open Items** list.

## 2. Rationale

The Technology Standards table fixes the stack and states that *"deviations require explicit amendment
to this constitution and MUST NOT be introduced unilaterally within a phase spec."* It names no AI
processing.

The Open Items list already anticipated this, carrying **"AI provider selection (needed before Phase
9)"** since v1.0.0. That item is now due.

Phase 9's spec (Clarifications Q1) resolved the question by **splitting egress per surface** rather
than per system, so the table needs two entries, not one.

## 3. Proposed change

### 3a. Add two rows to the Technology Standards table

| Layer                     | Technology                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| AI — staff-facing         | Anthropic Claude API (`claude-opus-5`) via `@anthropic-ai/sdk`           |
| AI — customer-facing      | Self-hosted OpenAI-compatible inference server on controlled infrastructure |

### 3b. Add a paragraph beneath the table

> **AI processing boundary.** Staff-facing AI features — ticket summarisation, reply drafting, and
> similar-ticket suggestion — MAY transmit ticket content to the external provider named above. The
> customer-facing assistant MUST NOT: its processing occurs only on infrastructure the organisation
> controls. This boundary MUST be structural in code rather than configurable at runtime, and MUST fail
> closed. Changing which surface uses which processor is an amendment to this constitution, not a
> deployment decision.

### 3c. Remove the resolved Open Item

Delete `- AI provider selection (needed before Phase 9)`, now answered by Phase 9 spec Clarifications Q1.

### 3d. Version

`1.1.0` → **`1.2.0`** (MINOR: materially expanded guidance, no principle removed or redefined).
`LAST_AMENDED_DATE` → `2026-09-02`. A Sync Impact Report comment is added at the top of the file in the
existing style.

## 4. Migration note (procedure step 3)

**None required.** No completed phase is affected. Phases 0–8 contain no AI processing, and Phase 9 is
additive — with the capability disabled the product is Phase 8, which SC-022 asserts by running the
Phase 0–8 suite unchanged.

## 5. What approving this commits the project to

Stated plainly, because these are the consequences and not all of them are reversible cheaply:

1. **Customer content leaves the system.** Ticket threads — names, contact details, complaints,
   whatever a customer pasted into an email — are transmitted to Anthropic for staff-facing features.
   This is the first continuous, automatic egress in the project's history; Phase 2's
   `customers:export` was the only prior one, and it is human-initiated and audited per use.
2. **A data-processing agreement becomes necessary.** FR-007 requires the organisation to be able to
   state where content goes and what the recipient may do with it. That is a commercial and legal
   step outside this repository.
3. **Infrastructure the project did not previously need.** The assistant requires a self-hosted
   inference server as a sibling service, with its own capacity, monitoring, and upgrade path.
4. **A recurring per-use cost**, growing with ticket volume. Phase 9's ceilings bound it, but nothing
   in the plan predicts it — research open question 4 flags the first month's real numbers as
   something to check.
5. **The Arabic question stays open.** Self-hosted open-weights models are materially weaker in Arabic
   than in English, and that lands on the customer-facing surface. Research D4 makes Arabic enablement
   a measured gate; approving this amendment does not commit to shipping an Arabic assistant.

## 6. Alternatives, and why they were not proposed

| Alternative                          | Why not                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| One external provider for everything | Violates Clarifications Q1. The chatbot is where a stranger types free text at volume with nobody reviewing it.                |
| One self-hosted model for everything | Gives agents materially worse summaries and drafts for no privacy gain — staff content is already employee-visible.            |
| Defer Phase 9                        | Legitimate. Phases 9 and 10 may be reordered under the constitution's own sequencing rules, so Phase 10 could be built first.  |
| Amend nothing, add the provider anyway | Explicitly forbidden: *"MUST NOT be introduced unilaterally within a phase spec."*                                            |

---

## Decision required

**Approve** → the amendment is applied to `.specify/memory/constitution.md`, T001 and T002 are marked
complete, and Phase 9 implementation begins at T003.

**Decline or defer** → Phase 9 stops here. The spec, plan, research, contracts and 134 tasks remain
valid and wait. Phase 10 — Reports & Management is available to start instead; the constitution permits
reordering Phases 9 and 10.
