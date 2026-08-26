# UI Contract: Administration Area (Phase 1)

**Feature**: `002-phase-1-security-administration` | **Date**: 2026-08-26

Phase 0 shipped the shell — landmarks, routing, i18n, root-level direction. Phase 1 ships the first
real screens inside it, so the patterns fixed here (table, form, empty state, confirmation) become
what Phases 2–12 reuse. Getting them RTL-correct and keyboard-operable once is the point.

Everything in [frontend-shell.md](../../001-phase-0-foundation/contracts/frontend-shell.md) from
Phase 0 still applies and is not restated: logical Tailwind utilities only, no hardcoded strings, no
`fetch` outside `services/`, Composition API throughout.

---

## Routes

```text
/change-password              ChangePasswordView      authenticated, no permission
/admin                        → redirect to /admin/users
/admin/users                  UsersListView           users:view
/admin/users/new              UserFormView            users:create
/admin/users/:id              UserFormView            users:update
/admin/roles                  RolesView               roles:view
/admin/audit                  AuditLogView            audit:view
/admin/settings               SettingsShellView       settings:view
```

All `/admin/*` routes render inside `AdminLayout`, which nests within Phase 0's `DefaultLayout` —
one `<main>` per page, as the Phase 0 landmark contract requires.

**Route titles come from `meta.titleKey`**, never a literal — the Phase 0 routing contract. Every
route above adds a key to both locale files.

**The guard is a convenience, not a control.** `router.beforeEach` redirects when
`usePermissions().can(...)` is false, purely so the user does not land on a screen that will error.
The endpoint behind every screen enforces the same permission independently
([authorization.md](./authorization.md)).

---

## Admin navigation

Rendered in `AdminLayout`, inside Phase 0's `<nav>` landmark, which was left empty in Phase 0
specifically to be populated from this phase.

- Each entry is hidden when `can(permission)` is false (FR-020).
- The entry for the current route carries `aria-current="page"`.
- Labels are i18n keys. The administration area is not offered at all to a user holding none of its
  permissions (FR-042).

---

## Data table pattern

Used by the users list and the audit log. This is the pattern later phases copy, so it is specified
rather than left to each screen.

**Structure** — a real `<table>` with `<caption>` (visually hidden), `<thead>`, `<th scope="col">`.
Not a grid of `<div>`s: screen readers navigate a table by row and column, and that is free only if
the markup is a table.

**Direction** — column order follows the reading direction automatically because the table is
laid out by the root `dir`. No column may be positioned with `text-left`, `text-right`, `ml-*`, or
`pl-*`; use `text-start`, `text-end`, `ms-*`, `ps-*` (Phase 0 styling contract).

**Empty state** — when a filter matches nothing, the table is replaced by a message explaining what
was filtered and offering to clear it. Never a bare empty table, and never the word "No data".

**Loading** — the region carries `aria-busy="true"` while fetching. Rows are not replaced by a
spinner that removes focus context.

**Paging** — previous/next plus current-page indication, as real `<button>`s. The control announces
its position ("page 2 of 9") in text, not by colour or position alone. Page size is capped at 100 by
the server; the interface offers 25/50/100.

**Row actions** — real `<button>`s, never a clickable row. An action the user lacks permission for is
omitted, not rendered disabled without explanation.

---

## Form pattern

Used by the user form and the change-password screen.

- Every input has a `<label>` bound by `for`/`id`. Placeholder text is never the only label.
- Validation errors are rendered next to the field, referenced by `aria-describedby`, with
  `aria-invalid="true"` on the input (FR-047). Colour is never the only signal.
- The server's `details[]` array maps onto fields by name, so a `400 VALIDATION_ERROR` populates the
  right field rather than a generic banner.
- On submit failure, focus moves to the first invalid field so a keyboard or screen-reader user is
  not stranded at the bottom of the form.
- A form-level error region is `role="alert"` so it is announced when it appears.
- Submit buttons disable while in flight and re-enable on completion, to prevent double submission.

---

## Destructive-action pattern

Deactivation, and later phases' deletions.

- A confirmation dialog with `role="dialog"` and `aria-modal="true"`, focus trapped inside, focus
  returned to the trigger on close, dismissible with <kbd>Escape</kbd>.
- The confirm button states the specific consequence — "Deactivate Support Agent" — never "OK".
- A refusal from the server (deactivating the last Administrator, FR-009) is surfaced in the dialog
  with the server's message, not swallowed.

---

## Screen-specific requirements

### Users list

Columns: name, email, role, status, actions. Status distinguishes **active**, **inactive**, and
**locked** — three states, since a locked account is a different situation from a deactivated one
(data-model.md state transitions). Filters: search, role, active state. Actions: edit, deactivate or
reactivate, reset password, unlock when locked.

### User form

Create mode collects email, full name, role, initial password. Edit mode collects full name and
role — **email is not editable**, since it is the login identifier and the audit log references it.
The form warns before the user changes their own role.

### Roles

Three roles as sections or tabs, each showing the permission grid grouped by module with a checkbox
per action. Save is per role and sends the full permission set with the `version`. A grant whose key
is no longer in the catalog is shown as stale and removed on save.

The screen must make FR-018 legible rather than surprising: when a change would leave no role able
to administer the system, the refusal explains *why*, and ideally the control is disabled with an
explanation before submission.

### Audit log

Columns: timestamp, actor, action, target, outcome. Filters: date range, actor, action type,
outcome. Action names are translated from their key — the raw key (`user.role.changed`) is never
shown to a user. Previous/new values are shown in an expandable detail row for permission and role
changes.

There is no edit or delete affordance anywhere on this screen. Append-only is visible in the
interface, not merely enforced behind it.

### Settings shell

Three sections — categories, templates, channel settings — each present, navigable, and displaying
an empty state that says it is populated in a later phase (FR-043). Not an error, not a blank panel,
and not a "coming soon" that looks like a bug.

### Change password

Reached automatically when `mustChangePassword` is true. Until the password is changed, no other
route is reachable — the router redirects, and the backend independently returns
`403 PASSWORD_CHANGE_REQUIRED` for everything else (research.md D10). Shows the policy requirements
up front rather than only after a failed attempt.

---

## Accessibility acceptance

Per Constitution Principle IV, and verified per screen rather than once at the end:

- Every control reachable and operable with <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd>,
  <kbd>Enter</kbd>, <kbd>Space</kbd>, and <kbd>Escape</kbd> where a dialog is open.
- A visible focus indicator meeting WCAG AA contrast, in **both** directions — offset-based rings
  clip differently under RTL, which is why Phase 0's focus contract asks for verification in both.
- Text contrast at least 4.5:1.
- Focus order follows RTL visual order in Arabic.
- Validation errors and asynchronous status changes announced, not only shown.

## i18n acceptance

- Every string on every screen above comes from a locale key. Table headers, filter labels, status
  words, action names, empty states, dialog text, and validation messages included.
- `ar.json` and `en.json` hold identical key sets — now enforced by an automated test rather than a
  manual check (research.md D14).
- Audit action keys and permission keys are translated for display; the machine key is never
  rendered.
- Role names come from `nameKey` returned by the API, not from a client-side map — one source of
  truth.
