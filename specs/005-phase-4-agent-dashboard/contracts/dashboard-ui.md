# Contract: Dashboard UI

**Feature**: `005-phase-4-agent-dashboard` | **Date**: 2026-08-29

Screens, states, and the cross-cutting obligations that apply to all of them. Follows the Phase 1–3
pattern: `<script setup>` only, Pinia for anything crossing a component boundary, and **no component
calls `fetch` directly** — every request goes through a service module (Principle III).

---

## Routes

| Path | View | Permission | Title key |
| --- | --- | --- | --- |
| `/dashboard` | `DashboardView.vue` | `dashboard:view` | `route.dashboard.title` |
| `/admin/templates` | `admin/TemplatesView.vue` | `templates:manage` | `route.templates.title` |

`/dashboard` becomes the natural landing screen for an agent after sign-in. The Phase 3 ticket list
stays where it is — it answers "find any ticket", the dashboard answers "what is mine".

Templates sit under `/admin` because managing them is administration; **using** them needs no route,
only the picker inside the note composer.

---

## `DashboardView`

Three regions, laid out so all three are visible without scrolling on a normal screen:

1. **Queue** — `QueueFilters` + `QueueTable`.
2. **My tasks** — outstanding tasks, overdue ones marked.
3. **Notifications** — recent unread; the bell in the layout is the always-visible entry point.

### Queue

Columns: reference, subject, customer, status, priority, waiting time, due date (FR-002).

- Sort controls for priority, status, age, due date; both directions (FR-005).
- Filters for status, priority, and overdue, combinable, with active filters visible (FR-007).
- Sorting and filtering call the server; the client never re-sorts a page (FR-008).
- Paged (FR-009).
- Overdue rows carry a **badge with text plus an icon**, not a colour (FR-021, FR-084).
- A supervisor with `dashboard:view_any` gets a user selector, and whose queue is shown is stated on
  screen (FR-011). Without it, no selector is rendered **and** the server refuses `userId` anyway —
  hiding the control is never the only restriction (FR-073).
- **No assign or claim control exists here.** Phase 3 fixed assignment as Supervisor-only, and this
  dashboard is read-only with respect to it (FR-012). This is a deliberate absence, not an omission.

**States**: loading (skeleton rows) · empty queue (`dashboard.queue.empty`) · empty **after
filtering** (`dashboard.queue.noMatches`, with a clear-filters action) · error with retry. The two
empty states are different messages — "you have nothing to do" and "your filter hid everything" are
not the same news (spec US1 scenarios 5–6).

### Tasks region

Outstanding tasks with title, due date, and link chip (FR-057). Overdue marked by text and icon
(FR-058). Inline create; complete and reopen in place. No owner field is rendered anywhere — tasks are
personal (Clarifications Q3).

---

## Ticket screen additions

The Phase 3 `TicketDetailView` gains three things, and the ticket must remain fully workable if any
of them fails to load.

### `CustomerContextPanel`

Beside the ticket, never behind a click (FR-013). Identity, primary contacts, other tickets with
status, recent customer notes — every item a link to the underlying record (FR-017).

- Deactivated customer: marked in the panel, ticket still workable (FR-016).
- Caller lacks `customers:view`: the panel is **absent** and nothing else changes (FR-018).
- In RTL the panel moves to the other side by document direction, not by a flipped stylesheet
  (FR-081).

### `TicketNoteThread` + `TicketNoteComposer` + `MentionPicker`

- Notes oldest first, paged, each with author and time; edited notes show that they were edited
  (FR-033).
- The composer's mention trigger opens `MentionPicker`, which searches
  `GET /api/tickets/:id/mentionable-users` — so it can only offer users the note would be accepted
  for (FR-036, FR-037).
- The picker is **fully keyboard-operable**: open on trigger, arrow keys to move, Enter to select,
  Escape to dismiss, with `aria-activedescendant` and a visible focus indicator in both directions
  (FR-082).
- `@[user:12]` tokens render as the current display name from the note's `mentions` array,
  visually distinguished from surrounding text (FR-041). A deactivated mentioned user still renders,
  marked (FR-035).
- `MENTION_NOT_VISIBLE` and `MENTION_LIMIT` are shown against the composer and **announced to
  assistive technology**, not conveyed by colour or position (spec FR-083 pattern, Principle IV).

### `DueDateControl`

Set, change, or clear a due date; hidden without `tickets:set_due_date` and refused server-side
regardless (FR-025, FR-073). A past date is accepted without a warning dialog (FR-024). Dates are
formatted for the active locale; the **overdue decision comes from the server's `isOverdue`**, never
from a client-side comparison (FR-020).

---

## Notifications

### `NotificationBell` (in `DefaultLayout`)

Present on every screen (FR-048). Shows the unread count; the count is conveyed as a number, not by
colour alone (FR-084). Opens `NotificationList`.

### `NotificationList`

- Newest first, paged (FR-050), with "mark all read" (FR-049).
- Each item's text is composed from `notification.type.*` locale keys with the actor name and ticket
  reference as parameters. **The server sends no sentence** — see
  [notifications.md](./notifications.md).
- Opening an item navigates to its subject and marks it read (FR-049). A notification whose ticket was
  merged navigates to the survivor, resolved server-side (FR-052).
- Fully keyboard-operable, with a focus indicator in both directions (FR-082).

### `useNotificationStream`

Connects on sign-in, reconnects with backoff, refreshes on `401`, and calls `?since=` on every
connect to fill any gap. **The dashboard must be fully usable when the stream never connects**
(FR-054, SC-010) — the composable's failure state is silent to the user and visible in the console,
not an error banner over a working screen.

**Arrival announcement** (FR-083): a new notification is announced through a **polite live region**.
It must not move focus — an agent typing a note is not interrupted by a ping. This is the single most
likely accessibility regression in the phase and is called out for that reason.

---

## Templates

`TemplatePicker` opens from the note composer: search by title or body, preview, then **insert** into
the composer or **copy** to the clipboard (FR-066, FR-067). Inserted text is ordinary editable
content in the composer — never locked, never a token the user cannot change (FR-068).

The version matching the active language is inserted. When a template exists in only one language,
that version is offered **with its language identified** rather than substituted silently (FR-070),
which is what `availableLanguages` in the contract is for.

`admin/TemplatesView` (create, edit, retire) is rendered only with `templates:manage`, and the server
refuses regardless (FR-069). A retired template disappears from the picker and changes nothing
already written (FR-071).

---

## Cross-cutting obligations

These apply to every component above and are verified per component, not once for the phase.

| Obligation | Requirement |
| --- | --- |
| **No hardcoded strings.** Every label, empty state, error, and notification sentence comes from `ar.json` / `en.json`, and the two files hold identical key sets. | FR-080, SC-017 |
| **Direction by root, not by component.** No component flips itself; the dashboard layout, the context panel's side, and the notification list follow document direction. | FR-081 |
| **Keyboard everywhere.** Mention picker, template picker, due-date control, notification list, queue sort and filter controls — all operable by keyboard alone with a visible focus indicator meeting contrast in both directions. | FR-082 |
| **Announce without stealing focus.** Arriving notifications use a polite live region. | FR-083 |
| **Never colour alone.** Overdue, escalated, and unread each carry text or an icon as well. | FR-021, FR-058, FR-084 |
| **Everything bounded.** Queue, notes, tasks, notifications, and the template picker are all paged or capped. | FR-085 |
| **No component fetches.** All requests go through `services/*.service.ts`; cross-component state lives in Pinia. | FR-086 |

## Component tests

Following `frontend/tests/tickets/` from Phase 3:

- `QueueTable` — priority order matches the declared ranking; NULL due dates group at one end in both
  directions; overdue badge renders text, not only colour.
- `QueueFilters` — the two empty states render distinctly; clearing filters is reachable.
- `NotificationList` — every type composes from locale keys in both languages; opening marks read;
  the live region is polite and does not move focus.
- `MentionPicker` — keyboard navigation and selection; a refused mention surfaces its error
  accessibly.
- `TemplatePicker` — language selection, single-language identification, and that inserted text
  stays editable.
- `CustomerContextPanel` — absent without `customers:view` while the ticket stays workable;
  deactivated customer marked.
