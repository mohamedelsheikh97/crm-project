# Contract: Ticket Interface

**Feature**: `004-phase-3-ticket-management` | **Date**: 2026-08-28

Extends the patterns Phases 1 and 2 established. Logical Tailwind utilities only — `ms-*`, `me-*`,
`ps-*`, `pe-*`, `text-start`, `text-end`, `start-*`, `end-*`. A physical utility in this phase is a
review failure, not a preference.

---

## Routes

| Path | View | Guard |
|---|---|---|
| `/tickets` | `TicketListView.vue` | `tickets:view` |
| `/tickets/new` | `TicketCreateView.vue` | `tickets:create` |
| `/tickets/:id` | `TicketDetailView.vue` | `tickets:view` |

Guards use the meta-permission mechanism from Phase 1: the route declares what it needs, and the
guard reads the session. A route that forgets its `meta.permission` is caught by the Phase 1 test
asserting every guarded route declares one.

---

## Components

| Component | Responsibility |
|---|---|
| `TicketStatusBadge.vue` | Renders a status key through i18n, with a colour per status. Never receives a display string |
| `TicketPriorityBadge.vue` | Same, for priority |
| `TicketFilters.vue` | Status, priority, category, assignee, and search; reflected into the query string so a filtered list is shareable and survives a reload |
| `TicketTransitionMenu.vue` | Renders **only** the moves returned by `GET .../transitions` |
| `TicketHistoryTimeline.vue` | Oldest-first timeline |
| `TicketMergeDialog.vue` | Target selection with confirmation |
| `TicketLinkPanel.vue` | Current links, add, remove |

`TicketTransitionMenu` holds **no copy of the lifecycle table.** It renders what the server says is
available. A front-end copy would drift, and the direction it drifts is offering a button that then
fails — the interface promising authority it cannot deliver.

---

## List view

- Columns: reference, subject, customer, status, priority, assignee, updated.
- Sortable on created, updated, and priority; sort state lives in the query string.
- Empty states distinguish **no tickets exist** from **no tickets match these filters**, with the
  second offering to clear the filters. Phase 2 established this distinction for customers; the same
  reasoning applies more strongly here, where filters are the primary interaction.
- Merged tickets are absent by default (FR-044), with an explicit toggle to include them.
- Pagination controls mirror Phase 2's, including the RTL arrow direction question — in an RTL
  layout, "next" points **left**, and the icons are mirrored by the logical layout rather than by a
  conditional in the template.

## Detail view

Sections, in reading order: header (reference, subject, status, priority), customer summary linking
to the customer record, description, assignment, links, history.

- **Merged banner** at the top when `mergedIntoTicketId` is set: a permanent notice naming the
  survivor and linking to it, with every action control disabled (FR-042, FR-046). The banner is the
  first thing in the DOM, so a screen reader meets it before the fields it explains.
- **Closed notice** when the status is `closed`: editing is unavailable, and the notice says why
  rather than leaving controls mysteriously inert (FR-009).
- **Optimistic-locking conflict** surfaces as Phase 2's pattern: the edit is preserved, the conflict
  is explained, and reloading is the user's choice rather than an automatic discard of their typing.

## History timeline

- **Oldest first** (FR-035) — the opposite of the audit log and of customer notes, and deliberately
  so: this is read from the beginning to understand a ticket, not scanned for the most recent event.
- Each entry shows actor, timestamp, and what changed, with field values rendered through i18n when
  they are keys (a status change shows translated status names, not `new` → `open`).
- Entries from an absorbed ticket are labelled with their origin reference, so a spanning history
  stays readable as two stories that joined rather than one that was rewritten.
- The timeline is a `<ol>`, because it is an ordered list of events and that is what it should
  announce as.

## Merge dialog

- Names both tickets by reference and subject before confirming.
- States plainly that the merge is **permanent and cannot be undone**, because it is.
- The confirm control is not the default focus. Destructive confirmation should require a deliberate
  move, not an accidental Enter.
- Focus is trapped while open, returns to the trigger on close, and — per the Phase 2 defect — the
  focus is set with `{ immediate: true }` so a dialog mounted already-open focuses something.

---

## Accessibility

- All controls reachable by keyboard; visible focus rings (FR-058).
- Every icon-only control carries an accessible label — the transition menu, the link remove button,
  and the merge trigger are all icon-only candidates.
- Status is never conveyed by colour alone: a badge carries its text label as well (FR-059).
- Filter changes and result counts announce through the live region Phase 2 introduced.
- Dialogs: `role="dialog"`, `aria-modal="true"`, labelled by their heading.

**A `ref` inside a `v-for` is an array**, as Phase 2 discovered when a focus call silently did
nothing. Any list-rendered focus target in this phase indexes the array.

---

## Bilingual

- Every string is an i18n key in both `en.json` and `ar.json` (FR-056). The Phase 1 test asserting
  key parity between the two files covers the new keys automatically.
- Status, priority, and category labels come from `ticket.status.*`, `ticket.priority.*`,
  `ticket.category.*`. The server sends keys precisely so this is possible.
- Ticket subjects and descriptions are Arabic free text and are the **longest** free text the system
  has accepted so far. They must render correctly in both directions, and a mixed Arabic-and-Latin
  subject — a common real case, since product names stay Latin — must not scramble.
- Dates use the locale formatter established in Phase 1.
- Reference numbers (`TKT-000042`) stay Latin-digit and left-to-right in both locales, wrapped so
  bidirectional reordering cannot rearrange them mid-sentence.
