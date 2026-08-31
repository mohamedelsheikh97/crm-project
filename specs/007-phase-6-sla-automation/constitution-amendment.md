# Proposed Constitution Amendment — Phase 6

**Status**: PROPOSED, not applied. Task T143.

**Raised by**: Phase 6 — SLA & Automation
**Date**: 2026-08-31
**Affects**: `.specify/memory/constitution.md`, "Technology Standards → Open Items"

---

## Why this is a proposal and not an edit

The constitution's own amendment procedure requires a written proposal citing the section being
changed and the rationale, **and explicit approval before any Spec Kit phase the amendment would
affect**. Phase 6 is that phase, and it is now implemented — so this document exists to be approved
rather than to be assumed. Nothing in the repository has been changed by writing it.

## 1. Strike the resolved Open Item

**Section**: Technology Standards → Open Items

**Current text**:

> - SLA response/resolution time targets (needed before Phase 6)

**Proposed**: remove this line.

**Rationale**: it is resolved. Phase 6's `/speckit-specify` Clarifications Q1 answered both halves of
it, and the answers are implemented and tested:

- **The convention**: SLA durations are **working time against a configurable business calendar**,
  not elapsed wall-clock time. The calendar is a database row an administrator edits
  (`business_calendars`), defaulting to Sunday–Thursday, 09:00–17:00, `Africa/Cairo`.
- **The targets**: four seeded policies, one per priority — urgent 60/240, high 240/480, normal
  480/1440, low 480/2400 **working minutes** — editable like any other policy
  (`20260831000003-default-sla-policies.cjs`).

**Migration note**: none. No completed phase changes. Phase 4's manually set due dates are preserved
as human overrides by `tickets.due_source` defaulting to `'manual'` on backfill, which is spec
FR-024c.

**One caveat the approver should see rather than discover.** The seeded default is an *assumption*,
not a discovered fact. Confirming Sunday–Thursday 09:00–17:00 Africa/Cairo against the
organisation's actual working week is task T141 and remains open; the amendment records what the
system now does, not that anybody has verified it is what the organisation wants.

## 2. Record the messaging-provider Open Item that was never added

**Section**: Technology Standards → Open Items

**Proposed**: add

> - Messaging provider selection per channel — email, WhatsApp, SMS (deferred behind an adapter in
>   Phase 5; a real provider is needed before production use)

**Rationale**: Phase 5's plan flagged this and explicitly did not perform the amendment. The gap was
never recorded because no phase before Phase 5 reached outside the network. Phase 6 adds a second
consumer of it — alerts travel over the same transports — which makes the omission more consequential
than it was: an installation running on the simulator now silently fails to escalate *to anybody
outside the application*, on top of failing to reply to customers.

**Migration note**: none. Recording an open decision changes no code.

## 3. Nothing else changes

No principle is added, removed, or redefined. Both changes are to the Open Items list.

**Suggested version bump**: PATCH (1.1.0 → 1.1.1). The constitution's own rule reserves MINOR for a
new principle or materially expanded guidance; striking a resolved item and recording an existing
one is neither.

---

## Approval

- [ ] Approved by: ____________________  Date: __________
- [ ] `LAST_AMENDED_DATE` updated
- [ ] `CONSTITUTION_VERSION` incremented to 1.1.1
- [ ] Sync Impact Report block prepended to `constitution.md`
