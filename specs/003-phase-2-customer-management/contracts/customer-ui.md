# UI Contract: Customer Screens (Phase 2)

**Feature**: `003-phase-2-customer-management` | **Date**: 2026-08-27

Phase 1 built the reusable pieces — `DataTable`, `TablePagination`, `FormField`, `EmptyState`,
`ConfirmDialog` — and fixed their keyboard and announcement behaviour in
[admin-ui.md](../../002-phase-1-security-administration/contracts/admin-ui.md). Everything there
still applies and is not restated: logical Tailwind utilities only, no hardcoded strings, no `fetch`
outside `services/`, Composition API throughout.

This contract covers what is genuinely new: search that a person uses while a customer is on the
phone, and a duplicate-resolution flow that has to be clear enough that nobody clicks past it.

---

## Routes

```text
/customers                 CustomerListView     customers:view
/customers/new             CustomerFormView     customers:create
/customers/:id             CustomerProfileView  customers:view
/customers/:id/edit        CustomerFormView     customers:update
```

Customers live at the top level, not under `/admin` — they are everyday work for an Agent, not
administration. The header gains a Customers entry, shown when the user holds `customers:view`.

`meta.titleKey` on every route, never a literal. The guard is a convenience; every endpoint behind
these screens enforces the same permission independently.

---

## Search

The screen an Agent uses with someone on the phone. Speed of *use* matters more than features.

- **One search box**, not a field selector. The caller offers a name, a number, or an email and the
  Agent types it (FR-010). Making them first choose "search by phone" is a step they should not have
  to take.
- The box holds focus on load, so typing works immediately.
- Results update as they type, **debounced** — a request per keystroke is wasteful and arrives out of
  order.
- A result row shows enough to identify the person without opening it: name, company, primary phone,
  primary email, and an inactive marker.
- A row matched on a contact detail indicates **which** detail matched. Searching a phone number and
  getting a list of names, with no indication of why any of them are there, is disorienting.
- Phone numbers display as `raw` — what someone typed — never the normalised form. Normalisation is
  a matching concern, and showing `+201001234567` where the record says `+20 100 123 4567` looks like
  a bug.

**Empty state** carries the search term and offers to create that customer (FR-016). "No results" as
a dead end forces the Agent to retype what they just typed into a create form.

**Deactivated customers** are excluded by default with a filter to include them, and appear visibly
marked when shown (FR-008).

---

## Duplicate resolution

The flow PLAN.md's Definition of done rests on. It must be **impossible to click past without
noticing**, and equally must not block a legitimate save.

**Trigger**: saving returns `409 DUPLICATE_CUSTOMER` with the matching records. The interface may
also call the check endpoint while the user types, to warn earlier — but the dialog on save is the
barrier, because a match can appear between a check and a save.

**The dialog**:

- `role="dialog"`, `aria-modal="true"`, focus trapped, <kbd>Escape</kbd> dismisses, focus returns to
  the trigger — the same contract Phase 1's `ConfirmDialog` already satisfies and is tested for.
- States plainly **which detail matched** and **what it matched**: "This phone number already belongs
  to Ahmed Hassan."
- Shows **every** match, not the first (FR-022), each with enough detail to tell two people apart.
- A deactivated match is labelled as such — otherwise it looks like a stranger's record.
- **Three actions**, in this order:
  1. **Open the existing customer** — the most likely correct action, so it comes first and is the
     visually primary choice.
  2. **Change the details** — dismisses back to the form with focus on the offending field.
  3. **Create anyway** — available but visually secondary, and its label says what it means: "This is
     a different person — create anyway".
- The third action must **not** be the default focus and must not be reachable by pressing Enter from
  the form. Someone dismissing dialogs on autopilot should not create a duplicate by reflex.

**On edit**, the same dialog appears with wording reflecting that an existing record is being changed
rather than created (FR-021).

**After acknowledging**, the save proceeds and the decision is recorded. The interface does not
re-prompt for the same match on a subsequent edit of the same record — being asked repeatedly about a
decision already made trains people to click through.

---

## Customer profile

One screen, three regions: details, notes, attachments.

**Details** — name, company, address, and every contact method with its kind and primary marker.
Contact values display as typed. An Edit control appears when the user holds `customers:update`.

**Notes**:

- Newest first, paged (FR-025).
- Each shows author, time, and — when `editedAt` is set — that it was edited. A silently rewritten
  note is worse than no note.
- The add-note control is present when the user holds `notes:create`.
- Edit and delete appear on a user's **own** notes; on someone else's they appear only with
  `notes:manage` (FR-027). Omitted, not shown-disabled without explanation.

**Attachments**:

- Name, size, type, uploader, upload time.
- Download is a real link to the authenticated endpoint — never a direct path into storage.
- Upload shows the size limit and permitted types **before** a failed attempt, not only after.
- Upload shows progress; a 10 MB file on a slow connection is otherwise indistinguishable from a
  hung page.
- A refusal states which rule was broken — too large, or type not permitted — using the server's
  reason.
- Delete uses `ConfirmDialog` naming the file, and appears only with `attachments:delete`.

---

## Customer form

- Name is required. Contact methods are a repeatable group — add and remove rows, each with a kind
  and a value (FR-004).
- **At least one contact method is required** (FR-003), and the form says so before submission
  rather than only refusing after.
- Removing the last contact method is prevented in the interface and refused by the server.
- One primary per kind, chosen by the user; if only one exists it is primary automatically.
- Phone fields accept any formatting. **The form must not reformat what the user typed** — matching
  is the server's concern, and silently rewriting someone's input is the wrong place to solve it.
- The server's `details[]` maps onto fields by name, so a validation error lands beside its control.
- On failure, focus moves to the first invalid field.

---

## Export

- Offered on the list screen only when the user holds `customers:export`.
- Exports **what is currently filtered**, and says so next to the control — an export that silently
  returns everything is a data-leak-shaped surprise.
- The control disables while the export is being produced.
- The download is a real file response; a large export must not block the interface.

---

## Accessibility acceptance

Per Constitution Principle IV, verified per screen:

- Every control reachable and operable with <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd>,
  <kbd>Enter</kbd>, <kbd>Space</kbd>, and <kbd>Escape</kbd> in a dialog.
- Search results update announced to assistive technology — a list that changes silently under a
  screen reader is unusable.
- The duplicate dialog announces on open and is not dismissible by accident.
- Visible focus indicator meeting WCAG AA contrast, in **both** directions.
- Focus order follows RTL visual order in Arabic.
- Validation errors announced, not conveyed by colour alone.

## i18n acceptance

- Every string from a locale key: table headers, filters, empty states, dialog text, validation
  messages, the size and type limits shown on the upload control, and the export scope note.
- `ar.json` and `en.json` hold identical key sets — enforced by the test Phase 1 added.
- **Arabic customer names, addresses, and note bodies display exactly as entered** (FR-052, SC-013).
  This is content, not chrome: it must render correctly regardless of which language the interface is
  in, since an Arabic name appears in an English interface routinely.
- Phone numbers are not localised — digits display as stored.
