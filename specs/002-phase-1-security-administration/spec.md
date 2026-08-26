# Feature Specification: Phase 1 — Security & Administration Foundations

**Feature Branch**: `002-phase-1-security-administration`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "phase 1 Security & Administration Foundations"

**PLAN.md Reference**: Phase 1 — Security & Administration Foundations

**Depends on**: Phase 0 — Project Foundation (`001-phase-0-foundation`)

## Overview

Phase 0 proved a single seeded account could log in. Phase 1 turns that into a real access model:
named people with roles, permissions that are checked on the server for every protected action, an
account-security policy that resists guessing, and a durable record of who did what.

This is the phase every later phase leans on. A permission gap introduced here surfaces in Phase 8
as a data leak, so the bar for "enforced" in this spec is deliberately high: hiding a button is
never sufficient.

Phase 1 also closes a debt Phase 0 recorded explicitly. Phase 0 authenticates users but persists no
audit record, and its plan documented that as a **time-boxed deviation that MUST close in Phase 1**.
The audit log below is that closure, not a new nice-to-have.

## Clarifications

### Session 2026-08-26

Two scope questions were raised during `/speckit-specify`, both where PLAN.md declined to commit.
Both are resolved; no `[NEEDS CLARIFICATION]` markers remain.

- **Q1 — Is multi-factor authentication in scope?** PLAN.md lists MFA as "(Optional per SRS
  priority)". **Decision: skip MFA.** Deferred to a later phase so Phase 1 stays on the three
  capabilities its Definition of done actually names. No MFA-related field is added in anticipation
  — see FR-031 and Out of Scope.
- **Q2 — May Administrators create roles beyond the three PLAN.md names?** **Decision: the role set
  is fixed.** Agent, Supervisor, and Administrator are seeded and permanent; only the permissions
  each holds are editable. This is the smallest build satisfying "granular per-role, per-module
  permissions", and it avoids role CRUD, delete-with-assigned-users handling, and a
  last-admin-capable-role guard that no requirement asks for. See FR-021.

Both decisions **narrow** scope. If either is revisited later, the permission model in FR-012 is
designed to absorb new modules without redesign, so adding roles later is an additive change rather
than a rework.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Administrator Manages User Accounts (Priority: P1)

An Administrator opens the administration area, creates an account for a new support agent, assigns
them the Agent role, and hands them credentials. Later the agent leaves the company and the
Administrator deactivates the account. The former agent can no longer get in, and nothing they
previously did disappears from the record.

**Why this priority**: This is the first half of PLAN.md's Definition of done ("An Administrator can
create users, assign roles"). Without it the system has exactly one hardcoded account and no way to
onboard anyone, which blocks every subsequent phase that needs more than one actor.

**Independent Test**: Sign in as an Administrator, create a user with each of the three roles, sign
in as each of them, then deactivate one and confirm they are refused. Delivers a working
multi-user system on its own.

**Acceptance Scenarios**:

1. **Given** an Administrator is signed in, **When** they create a user with a valid email, name,
   and role, **Then** the account is created and the new user can sign in with the initial
   credentials.
2. **Given** an Administrator creates a user, **When** that user signs in for the first time,
   **Then** they are required to set a new password before reaching any other screen.
3. **Given** an existing user, **When** an Administrator changes their role from Agent to
   Supervisor, **Then** the user gains Supervisor permissions without needing to be recreated.
4. **Given** an active user, **When** an Administrator deactivates the account, **Then** subsequent
   sign-in attempts are refused and any already-issued session stops working within one minute.
5. **Given** an Administrator is signed in, **When** they attempt to deactivate their own account or
   remove their own Administrator role, **Then** the action is refused with an explanation.
6. **Given** exactly one Administrator account exists, **When** anyone attempts to deactivate it or
   change its role, **Then** the action is refused — the system must never be left with no
   Administrator.
7. **Given** an Administrator creates a user with an email that already exists, **When** they
   submit, **Then** the form reports the conflict on the email field and no second account is
   created.
8. **Given** a non-Administrator is signed in, **When** they attempt to reach any user-management
   screen or action, **Then** the request is refused by the server, not merely hidden in the
   interface.

---

### User Story 2 — Permissions Are Enforced Server-Side (Priority: P1)

A Supervisor can see and act on things an Agent cannot. When an Agent tries to reach a
Supervisor-only action directly — by URL, by a saved link, or by calling the interface
programmatically — the server refuses. An Administrator can adjust what a role is allowed to do, and
the change takes effect promptly for everyone holding that role.

**Why this priority**: This is the second half of PLAN.md's Definition of done ("permission checks
are enforced server-side, not just hidden in the UI") and Constitution Principle II's central
requirement. It is P1 alongside User Story 1 because user management without enforcement is
decorative.

**Independent Test**: With one account per role, attempt every module action as each role — through
the interface and by direct request — and confirm the outcomes match the permission matrix. Delivers
a verifiable access model on its own.

**Acceptance Scenarios**:

1. **Given** an Agent is signed in, **When** they request an action their role does not permit,
   **Then** the server refuses it and the attempt is recorded, regardless of how the request was
   made.
2. **Given** an Agent is signed in, **When** the interface renders, **Then** actions their role does
   not permit are hidden or disabled — **and** the server still refuses them if invoked directly.
3. **Given** an Administrator changes a role's permissions, **When** a user holding that role
   performs their next action, **Then** the new permissions apply within one minute without that
   user signing out and back in.
4. **Given** a user's permissions are evaluated, **When** the server decides whether to allow an
   action, **Then** the decision is based on current stored permissions rather than solely on
   claims embedded in a previously issued session token.
5. **Given** an Administrator opens the permission management screen, **When** they view a role,
   **Then** they see every module and every action available for that module and which are granted.
6. **Given** an Administrator attempts to remove the permission that grants access to user and role
   management from the Administrator role, **When** they submit, **Then** the change is refused so
   the system cannot be locked out of its own administration.

---

### User Story 3 — Security-Relevant Actions Are Recorded (Priority: P1)

An Administrator investigating an incident opens the audit log, filters to a date range and a
person, and sees exactly what happened: who signed in and when, which sign-ins failed, who changed
whose role, what was exported, and what was deleted. Nobody — including an Administrator — can edit
or remove entries through the application.

**Why this priority**: PLAN.md names the audit trail directly in the Definition of done, and
Constitution Principle II makes audit logging structural. Phase 0 recorded its absence as a
time-boxed deviation that must close here, so it is P1 rather than a later polish item.

**Independent Test**: Perform one of each recorded action, then open the audit log and confirm each
appears with the correct actor, target, timestamp, and outcome. Delivers a working audit trail on
its own.

**Acceptance Scenarios**:

1. **Given** any user signs in successfully, **When** the sign-in completes, **Then** an audit entry
   records the account, the time, the source address, and the outcome.
2. **Given** a sign-in attempt fails, **When** the failure occurs, **Then** an audit entry records
   the attempted identifier, the time, the source address, and the failure — including attempts
   against accounts that do not exist.
3. **Given** an Administrator changes a user's role or a role's permissions, **When** the change is
   saved, **Then** an audit entry records the actor, the target, and both the previous and new
   values.
4. **Given** a user exports data or deletes a record, **When** the action completes, **Then** an
   audit entry records the actor, what was exported or deleted, and how many records were affected.
5. **Given** audit entries exist, **When** anyone attempts to edit or delete one through any
   application screen or interface, **Then** no such capability exists and the attempt fails.
6. **Given** an Administrator opens the audit log, **When** they filter by date range, actor, action
   type, or outcome, **Then** only matching entries are shown, most recent first.
7. **Given** a non-Administrator is signed in, **When** they attempt to view the audit log, **Then**
   the server refuses the request.
8. **Given** any audit entry is recorded, **When** it is stored or displayed, **Then** it contains no
   password, no session token, and no other credential in any form.

---

### User Story 4 — Account Security Policy Resists Guessing (Priority: P2)

A user setting a password is held to a minimum standard and told clearly when it falls short.
Someone guessing repeatedly at an account gets locked out before they can work through a list, and
an Administrator can release the lock. The lockout reveals nothing about whether the account exists.

**Why this priority**: PLAN.md scopes password policy and lockout to this phase, and Constitution
Principle II requires lockout after repeated failures. It is P2 rather than P1 because User Stories
1–3 constitute the Definition of done; this hardens what they establish and is independently
demonstrable afterwards.

**Independent Test**: Attempt to set weak passwords and confirm each is rejected with a specific
reason; fail sign-in repeatedly and confirm lockout, then confirm Administrator unlock works.

**Acceptance Scenarios**:

1. **Given** a user is setting or changing a password, **When** the new password is shorter than the
   minimum length or fails a policy rule, **Then** it is rejected with a message naming the specific
   rule that failed.
2. **Given** a user is changing their own password, **When** they submit, **Then** they must supply
   their current password correctly or the change is refused.
3. **Given** a user changes their password, **When** they reuse one of their recent previous
   passwords, **Then** the change is refused.
4. **Given** an account receives repeated consecutive failed sign-in attempts, **When** the
   configured threshold is reached, **Then** the account is locked, further attempts are refused
   even with the correct password, and the lockout is recorded in the audit log.
5. **Given** an account is locked, **When** the configured lockout period elapses, **Then** the
   account accepts a correct password again without Administrator involvement.
6. **Given** an account is locked, **When** an Administrator unlocks it, **Then** the account
   accepts a correct password immediately and the unlock is recorded.
7. **Given** an attacker probes with a nonexistent email, **When** they reach the lockout threshold,
   **Then** the responses are indistinguishable from those for a real locked account — no timing or
   wording difference reveals which accounts exist.
8. **Given** a user signs in successfully after some failed attempts, **When** the sign-in succeeds,
   **Then** the consecutive-failure count resets.
9. **Given** an Administrator resets another user's password, **When** that user next signs in,
   **Then** they are required to set a new password before reaching any other screen.

---

### User Story 5 — Administration Area Is Navigable and Bilingual (Priority: P3)

An Administrator reaches a dedicated administration section containing user management, role and
permission management, the audit log, and a system configuration area whose sections are present but
mostly empty — they fill up in later phases. Everything works identically in Arabic and English,
mirrors correctly, and is fully operable from the keyboard.

**Why this priority**: PLAN.md scopes a "system configuration screens shell" to this phase, and the
constitution requires bilingual, accessible screens in every phase. It is P3 because it is the
container for User Stories 1–3 rather than the capability itself — those stories' screens are what
make it useful.

**Independent Test**: Navigate the whole administration area in both languages using only the
keyboard, confirming mirrored layout, translated labels, and a visible focus indicator throughout.

**Acceptance Scenarios**:

1. **Given** an Administrator is signed in, **When** they open the administration area, **Then**
   navigation to user management, role management, the audit log, and system configuration is
   present.
2. **Given** any administration screen is displayed, **When** the language is switched to Arabic,
   **Then** every label, heading, table column, button, and validation message appears in Arabic and
   the layout mirrors, with no page reload.
3. **Given** any administration screen is displayed, **When** a user navigates using only the
   keyboard, **Then** every control is reachable and operable with a clearly visible focus
   indicator, in both text directions.
4. **Given** a form on an administration screen fails validation, **When** the error appears,
   **Then** it is announced to assistive technology rather than indicated by colour alone.
5. **Given** a non-Administrator is signed in, **When** the interface renders, **Then** the
   administration area is not offered in navigation, and direct requests to it are refused by the
   server.
6. **Given** the system configuration area is opened, **When** a section has no content in this
   phase, **Then** it displays a clear empty state explaining it is populated in a later phase,
   rather than an error or a blank screen.

---

### Edge Cases

- **A user's role changes while they are working.** The new permissions must take effect within one
  minute. An action they began under the old role but submit under the new one is evaluated against
  the new permissions.
- **A user is deactivated mid-session.** Their next request must be refused, not honoured until
  their session token happens to expire.
- **The last Administrator.** Deactivation, role change, and permission removal must all be refused
  when they would leave the system with no account able to administer it.
- **A locked account with the correct password.** Must still be refused while locked; a correct
  password does not bypass a lockout.
- **Lockout probing against nonexistent accounts.** Must be indistinguishable from a real locked
  account, preserving the no-enumeration guarantee Phase 0 established at sign-in.
- **Simultaneous edits to the same user or role.** Two Administrators saving conflicting changes must
  not silently lose one; the second must be told the record changed.
- **Audit write fails while the audited action succeeds.** The system must not silently drop the
  record — an unrecorded security event is a failure, and the behaviour must be defined rather than
  incidental.
- **Very large audit log.** Filtering and paging must remain usable as the log grows; the viewer must
  not attempt to load the entire log at once.
- **A permission is granted for a module that does not exist yet.** Later phases add modules; the
  permission model must tolerate modules being added without invalidating stored permissions.
- **The Phase 0 seeded account.** It must become a real Administrator under the new model rather than
  remaining a special case outside it.
- **Password policy applied to existing accounts.** Accounts created before the policy must not be
  locked out of the system; the policy applies at the next password change.

## Requirements _(mandatory)_

### Functional Requirements

#### User accounts

- **FR-001**: System MUST support user accounts that carry, at minimum, an identifier, a display
  name, an email address, an assigned role, and an active/inactive state.
- **FR-002**: Administrators MUST be able to create, view, list, edit, and deactivate user accounts.
- **FR-003**: Email addresses MUST remain unique across accounts, case-insensitively, and the
  uniqueness MUST be guaranteed by the data store rather than by application checks alone.
- **FR-004**: Each user MUST hold exactly one role at a time.
- **FR-005**: Administrators MUST be able to change any user's assigned role.
- **FR-006**: Deactivation MUST be used instead of deletion for user accounts, so that audit history
  and later phases' records continue to reference a valid actor.
- **FR-007**: A deactivated user MUST be refused at sign-in, and any session already issued to them
  MUST stop being honoured within 60 seconds of deactivation.
- **FR-008**: The system MUST refuse any action that would deactivate the acting Administrator's own
  account or remove their own administrative access.
- **FR-009**: The system MUST refuse any action that would leave zero active accounts holding
  administrative access.
- **FR-010**: A newly created user, and any user whose password was reset by an Administrator, MUST
  be required to set a new password before reaching any other screen.

#### Roles and permissions

- **FR-011**: System MUST provide three roles on delivery: **Agent**, **Supervisor**, and
  **Administrator**.
- **FR-012**: System MUST express permissions granularly as a module-and-action pair (for example,
  "customers: view", "customers: delete", "reports: export"), so later phases add modules without
  redesigning the model.
- **FR-013**: Permissions MUST be granted to roles. Per-user permission overrides are out of scope
  for this phase.
- **FR-014**: Administrators MUST be able to view and modify which permissions each role holds.
- **FR-015**: Every protected action MUST have its permission verified on the server before the
  action is performed. Hiding or disabling an interface control MUST NOT be the only barrier.
- **FR-016**: Authorization decisions MUST be evaluated against currently stored permissions, not
  solely against claims captured in a previously issued session token.
- **FR-017**: A change to a role's permissions MUST take effect for all users holding that role
  within 60 seconds, without those users signing out and back in.
- **FR-018**: The system MUST refuse any permission change that would remove the ability to
  administer users, roles, and permissions from every role.
- **FR-019**: A request refused for insufficient permission MUST NOT disclose whether the target
  record exists.
- **FR-020**: The interface MUST hide or disable actions the signed-in user's role does not permit,
  in addition to — never instead of — the server-side check in FR-015.
- **FR-021**: The role set MUST be **fixed** at the three roles in FR-011. Administrators MUST NOT be
  able to create, rename, or delete roles; only the permissions each role holds are editable. Any
  interface or request attempting to add or remove a role MUST be refused.

#### Password policy and account lockout

- **FR-022**: System MUST enforce a minimum password length and reject passwords that fail policy,
  reporting the specific rule that failed.
- **FR-023**: System MUST prevent reuse of a user's recent previous passwords.
- **FR-024**: A user changing their own password MUST supply their current password correctly.
- **FR-025**: Passwords MUST be stored using a recognised adaptive hashing algorithm; plaintext or
  reversible storage is prohibited.
- **FR-026**: System MUST lock an account after a configurable number of consecutive failed sign-in
  attempts, and the threshold and lockout duration MUST be configurable without a code change.
- **FR-027**: While locked, an account MUST be refused even when the correct password is supplied.
- **FR-028**: A locked account MUST become usable again automatically once the lockout period
  elapses, and Administrators MUST additionally be able to unlock it immediately.
- **FR-029**: A successful sign-in MUST reset the consecutive-failure count.
- **FR-030**: Lockout behaviour MUST NOT reveal whether an account exists — responses for locked
  real accounts and for nonexistent accounts MUST be indistinguishable in content and in timing.
- **FR-031**: Multi-factor authentication is **out of scope for this phase** (see Out of Scope). No
  MFA enrolment, challenge, or recovery flow is built, and no MFA-related field is added in
  anticipation of one.

#### Audit log

- **FR-032**: System MUST record an audit entry for every security-relevant event, at minimum:
  successful sign-in, failed sign-in, sign-out, user created, user updated, user deactivated,
  role assigned or changed, role permissions changed, password changed, password reset by an
  Administrator, account locked, account unlocked, data exported, and record deleted.
- **FR-033**: Each audit entry MUST record who acted, what action occurred, what was acted upon,
  when it occurred, the source address, and whether the action succeeded or failed.
- **FR-034**: For changes to roles and permissions, the entry MUST record both the previous and the
  new value.
- **FR-035**: Audit entries MUST be append-only. No application screen or interface may offer editing
  or deletion of an entry.
- **FR-036**: Audit entries MUST NOT contain passwords, password hashes, session tokens, or any other
  credential, in any field.
- **FR-037**: Failed sign-in attempts MUST be recorded even when the supplied identifier matches no
  account, so probing is visible.
- **FR-038**: Only users with administrative access MUST be able to read the audit log.
- **FR-039**: The audit log MUST be filterable by date range, actor, action type, and outcome, and
  MUST present results most recent first.
- **FR-040**: The audit log MUST be paged so that viewing it remains usable as it grows, and MUST NOT
  require loading the entire log to display a page.
- **FR-041**: When an audited action succeeds but its audit entry cannot be written, the system MUST
  surface the failure rather than discard it silently.

#### Administration screens

- **FR-042**: System MUST provide an administration area, reachable only by users with
  administrative access, containing user management, role and permission management, the audit log
  viewer, and system configuration.
- **FR-043**: System MUST provide a system configuration area with sections for categories,
  templates, and channel settings, each present and navigable with a clear empty state in this
  phase, to be populated in later phases.
- **FR-044**: Every user-visible string introduced by this phase MUST come from the Arabic and
  English locale files, which MUST hold identical key sets. Hardcoded display text is prohibited.
- **FR-045**: Every screen introduced by this phase MUST render correctly in both text directions,
  using root-level direction rather than per-component flipping.
- **FR-046**: Every interactive control introduced by this phase MUST be reachable and operable by
  keyboard alone, with a visible focus indicator meeting contrast requirements in both directions.
- **FR-047**: Validation errors MUST be announced to assistive technology, not conveyed by colour or
  position alone.
- **FR-048**: Lists of users and audit entries MUST be paged or otherwise bounded rather than
  rendering unbounded result sets.

#### Migration from Phase 0

- **FR-049**: The account seeded in Phase 0 MUST be migrated into the new model as an ordinary
  Administrator account, holding no privileges outside the role system.
- **FR-050**: Applying the password policy MUST NOT lock existing accounts out; the policy applies
  at the next password change for accounts that predate it.
- **FR-051**: The layered separation established in Phase 0 MUST be preserved: authorization is
  decided in the service layer, not in route handlers or interface components, and no interface
  component communicates with the backend except through the established service layer.

### PLAN.md Traceability

Every requirement above maps to a **Scope** bullet of PLAN.md "Phase 1 — Security & Administration
Foundations":

| PLAN.md Phase 1 Scope bullet                                                | Covered by                        |
| --------------------------------------------------------------------------- | --------------------------------- |
| User accounts with role-based access control (Agent, Supervisor, Administrator) | FR-001–FR-011, FR-049             |
| Permission model: granular per-role, per-module permissions                 | FR-012–FR-021                     |
| Audit log for security-relevant actions                                     | FR-032–FR-041                     |
| System configuration screens shell (categories, templates, channel settings) | FR-042, FR-043                    |
| Password policy + account lockout after repeated failed logins              | FR-022–FR-030, FR-050             |
| (Optional per SRS priority) MFA support                                     | FR-031 — explicitly deferred      |

Cross-cutting constitutional requirements are covered by FR-044–FR-048 (bilingual, RTL,
accessibility) and FR-051 (layered architecture).

PLAN.md **Definition of done** for Phase 1 maps as follows:

| Definition of done clause                                       | Verified by                    |
| ---------------------------------------------------------------- | ------------------------------ |
| "An Administrator can create users, assign roles"               | User Story 1, SC-001, SC-002   |
| "and see an audit trail"                                        | User Story 3, SC-005, SC-006   |
| "permission checks are enforced server-side, not just hidden in the UI" | User Story 2, SC-003, SC-004 |

**Carried forward from Phase 0.** Phase 0's plan recorded the absence of audit logging as a
deliberate, **time-boxed** deviation from Constitution Principle II that MUST close in Phase 1.
FR-032–FR-041 are that closure and are treated as a first-class deliverable of this phase, not as
inherited or assumed-done work.

### Key Entities

- **User**: A person who can sign in. Carries a display name, a unique email identifier, a credential
  secret, an assigned role, an active/inactive state, lockout state, and a marker for whether a
  password change is required at next sign-in. Extends the minimal account established in Phase 0.
- **Role**: A named set of permissions — Agent, Supervisor, Administrator on delivery. Each user
  holds exactly one. Whether the set is extensible is FR-021.
- **Permission**: A module-and-action pair describing one thing that may be done, for example
  "customers: export". Granted to roles, never directly to users in this phase. New modules in later
  phases add permissions without altering the model.
- **Audit Entry**: An append-only record of one security-relevant event, holding the actor, the
  action, the target, the time, the source address, the outcome, and — for permission and role
  changes — the previous and new values. Never contains credentials.
- **Password History Entry**: A record of a user's previously used credential secrets, sufficient to
  refuse reuse and nothing more.
- **System Configuration Section**: A named area of the configuration shell (categories, templates,
  channel settings) that exists and is navigable in this phase and gains content in later phases.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An Administrator can create a working user account and assign its role in under two
  minutes, without assistance.
- **SC-002**: A newly created user can sign in, is required to set their own password, and reaches
  their landing screen on the first attempt.
- **SC-003**: For every combination of role and protected action, invoking the action directly —
  bypassing the interface entirely — produces the same allow-or-refuse outcome as the interface
  presents. Zero combinations differ.
- **SC-004**: A change to a role's permissions takes effect for every user holding that role within
  60 seconds, with no sign-out required.
- **SC-005**: Every one of the security-relevant event types listed in FR-032 produces a retrievable
  audit entry when performed — 100% coverage, verified event by event.
- **SC-006**: An Administrator investigating an incident can locate all actions taken by a named
  person within a named date range in under one minute.
- **SC-007**: An automated or scripted attempt to guess a password is refused after the configured
  number of consecutive failures, and the responses for a locked real account and a nonexistent
  account are indistinguishable.
- **SC-008**: No audit entry, at rest or on screen, contains a password, password hash, or session
  token — verified by inspection across all recorded event types.
- **SC-009**: Every screen introduced by this phase is fully operable using only a keyboard, in both
  Arabic and English, with a visible focus indicator throughout.
- **SC-010**: The Arabic and English locale files hold identical key sets, and no screen displays an
  untranslated key or hardcoded string in either language.
- **SC-011**: Deactivating a user stops their existing session from being honoured within 60 seconds.
- **SC-012**: The system cannot be placed in a state with no account able to administer it, by any
  sequence of actions available in the interface.

## Assumptions

Reasonable defaults chosen where the feature description and PLAN.md did not specify. Each is a
candidate for `/speckit-clarify` to confirm or overturn.

- **One role per user.** PLAN.md says "assign roles" but names a three-role model; a single role per
  user is the simpler reading and matches the Agent/Supervisor/Administrator hierarchy. Multiple
  simultaneous roles are out of scope.
- **Role-only permissions.** Permissions attach to roles, not to individual users. Per-user
  overrides are a common later refinement but are not implied by "per-role, per-module".
- **Password policy defaults**: minimum 12 characters, no reuse of the last 5 passwords, and no
  forced periodic expiry. Expiry is deliberately omitted as current guidance treats it as harmful
  rather than protective.
- **Lockout defaults**: 5 consecutive failed attempts, 15-minute automatic lockout. The constitution
  requires the threshold be configurable and states it is established in this phase; these are the
  values proposed.
- **No email delivery in this phase.** PLAN.md introduces communication channels in Phase 5, so
  Administrators set and reset passwords directly and hand them over out of band. Self-service
  "forgot password" by email is out of scope here.
- **No department scoping.** Phase 0 deferred a department association to a later phase, and PLAN.md
  places multi-tenancy and department awareness in Phase 12. Roles are global in this phase.
- **Permission checks cover this phase's own modules plus the placeholders later phases will fill.**
  The permission model must accept new modules without change; Phase 1 defines permissions only for
  what exists.
- **Session mechanics carry over from Phase 0 unchanged** — the same short-lived access credential
  and longer-lived renewal mechanism, with authorization now evaluated server-side per request.
- **Audit log retention is unbounded in this phase.** No archival or purge policy is defined; if the
  log must be trimmed or exported for retention, that is a later concern and would itself be an
  audited action.
- **"System configuration screens shell" means navigable sections with empty states**, not working
  category, template, or channel-setting management. Those arrive with the phases that own them.
- **A test framework is expected to be established at the start of this phase.** Phase 0 shipped
  without one by explicit decision, and its plan recorded standing one up as a Phase 1
  recommendation. This phase's server-side enforcement requirements (SC-003 in particular) are
  impractical to verify exhaustively by hand.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- Self-service password reset by email, and any email delivery at all (Phase 5 introduces channels).
- Per-user permission overrides that differ from the user's role.
- **Creating, renaming, or deleting roles.** The three-role set is fixed by decision (Clarifications
  Q2, 2026-08-26); only role permissions are editable.
- Department, team, or tenant scoping of roles and permissions (Phase 12).
- **Multi-factor authentication.** PLAN.md marks it optional; deferred by decision (Clarifications
  Q1, 2026-08-26) so this phase stays on the three capabilities its Definition of done names. No
  MFA-related field is added now — a schema built against an unbuilt flow is the speculative
  complexity the constitution prohibits.
- Single sign-on, directory integration, or federated identity (Phase 11 covers integrations).
- Session revocation lists beyond deactivating an account.
- Working category, template, and channel-setting management — only the navigable shell is in scope.
- Any customer, ticket, or business-domain data. Phase 2 opens the customer database.
