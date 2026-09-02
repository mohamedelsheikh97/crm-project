# Amendment Proposal: Technology Standards — Machine Client Authentication

**Proposed**: 2026-09-02 | **For**: Phase 11 — Integrations | **Spec**: Clarifications Q2

Submitted under the Governance section's Amendment procedure. Step 1 — propose in writing, citing the
section being changed and the rationale — is this document. **Step 2, explicit approval, is
outstanding, and no Phase 11 implementation task may begin until it is given.**

---

## 1. Sections being changed

`.specify/memory/constitution.md` → **Technology Standards** (the fixed-stack table and a new
paragraph beneath it), and its **Open Items** list.

## 2. Rationale

The Technology Standards table fixes the stack and states that _"deviations require explicit
amendment to this constitution and MUST NOT be introduced unilaterally within a phase spec."_ Its
authentication row reads:

| Layer          | Technology                                                 |
| -------------- | ---------------------------------------------------------- |
| Authentication | JWT (issued at login, verified per request via middleware) |

**A machine client never logs in.** Phase 11 exposes a published interface to external systems, and
those systems have no login to be issued a token at. The row does not forbid machine authentication;
it simply does not describe it, and the table's own rule means the gap must be closed by amendment
rather than by a decision inside a phase spec.

It is worth being explicit about the option that would have avoided this proposal, because avoiding
the proposal would have been the wrong reason to choose it. A long-lived **service-account JWT**
reuses the existing middleware exactly as the row describes, so no amendment would be needed. But a
JWT is valid until it expires by design, and the phase's FR-019 requires a credential to be revocable
with immediate effect. Honouring that with JWTs means a revocation list consulted on every request —
a database lookup per request, which is what the stored-credential approach does directly and with
less machinery. Choosing service-account JWTs would have been picking the option that _looked_
compliant over the one that is correct, and it would have left a real gap between a stated
requirement and the mechanism serving it.

## 3. Proposed change

### 3a. Replace the authentication row with two rows

| Layer                        | Technology                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Authentication — people      | JWT (issued at login, verified per request via middleware)                                  |
| Authentication — machines    | Administrator-issued client credentials (identifier + secret), hashed at rest, verified per request |

### 3b. Add a paragraph beneath the table

> **Machine client authentication.** An external system authenticating to the published interface
> presents an administrator-issued credential rather than a token obtained by logging in, because it
> has no login. The credential's secret MUST be stored such that it can be verified but not
> retrieved, MUST be rotatable with an overlap during which both the old and new secrets are
> accepted, and MUST be revocable with immediate effect — a mechanism that cannot be revoked before
> it expires does not satisfy this. A machine credential carries its own authority, expressed in the
> same permission vocabulary used for people; it MUST NOT impersonate a user, because attributing an
> automated action to whichever administrator configured it makes the audit trail misleading. A
> machine credential MUST NOT be able to reach anything a person granting it could not reach
> themselves.

### 3c. Reword the ERP open item rather than removing it

Replace:

```
- ERP system identity and integration protocol (needed before Phase 11)
```

with:

```
- ERP system identity — which product the organisation runs (Phase 11 delivers the adapter
  contract and a simulator; the protocol question is settled by that contract, the identity is not)
```

Phase 11's Clarifications Q1 settles the **protocol** — whatever satisfies the declared adapter
contract — and deliberately leaves the **identity** open, because which ERP the organisation runs is
a fact about them, not a design decision this project can make. Deleting the item would record it as
answered when the half that requires an answer from outside the codebase still stands.

### 3d. Version

`1.2.0` → **`1.3.0`** (MINOR: materially expanded guidance; the existing human-authentication rule is
preserved verbatim as its own row, and no principle is removed or redefined).
`LAST_AMENDED_DATE` → the approval date. A Sync Impact Report comment is added at the top of the file
in the existing style.

## 4. Migration note (procedure step 3)

**None required.** No completed phase is affected.

Phases 0–10 contain no machine clients: every authenticated request in them comes from a person's
session, and the human-authentication row is preserved unchanged, so nothing that passes today stops
passing. Phase 11 is additive, and its FR-067 requires the system to work with every integration
capability switched off — with SC-026 asserting that by running the full Phase 0–10 suite unchanged.

## 5. What approval commits to

- Two authentication mechanisms coexisting, with a stated rule for which applies to whom. Adding a
  third — OAuth2 token issuance, mutual TLS — would be a further amendment, though both are
  compatible additions layered over the same stored credential.
- Machine credentials acting as themselves rather than on behalf of a person, which makes the audit
  trail name the external system rather than an administrator.
- The ERP identity remaining an open item into Phase 12 if it is not supplied during Phase 11.

## 6. If approval is withheld

The phase's published interface cannot be authenticated as specified. The fallback is service-account
JWTs plus a revocation list, which needs no amendment and satisfies FR-019 at the cost of the extra
machinery described in section 2 — worse, but not blocking. That would need to be decided before
`/speckit-plan`, because it changes the plan's authentication component rather than just its
implementation.
