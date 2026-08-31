# Contract: SLA & Automation Interface

**Feature**: `007-phase-6-sla-automation` | **Date**: 2026-08-31

Four new admin screens, three new components on existing screens, and one hard problem this project
has not met before: rendering a duration correctly in Arabic and English, in RTL and LTR, without
composing a sentence in code.

Everything here follows the Phase 0–5 conventions and does not restate them: Vue 3 `<script setup>`,
Tailwind, Pinia for cross-component state, all API calls through a service module, all text from
`ar.json` / `en.json`, direction applied at the document root only.

---

## The duration problem, and its contract

A countdown is a number, a unit, and often a direction word: "3 working hours left", "متأخر بيومين".
Three rules, all non-negotiable:

1. **The server never formats a duration.** It returns `remainingMinutes: 45` and
   `state: 'at_risk'`. A formatted string cannot be right in two languages, and a server that formats
   has decided the reader's language at write time — the mistake Phase 4's notification table was
   designed to avoid.
2. **The client never concatenates.** No `` `${value} ${unit}` ``. Every phrase is a single
   `vue-i18n` message with named interpolation and pluralisation, so word order and plural forms
   belong to the locale file:

   ```json
   "sla.remaining": "{count} working hour left | {count} working hours left",
   "sla.overdueBy": "Overdue by {duration}"
   ```

   Arabic gets its own plural categories in `ar.json`; the component passes a count and never a
   pre-joined string.
3. **Numerals follow the locale.** Formatted through `Intl.NumberFormat` with the active locale, so an
   Arabic interface may render Eastern Arabic numerals if the locale is configured for them, and the
   choice lives in one helper rather than in every component.

**Bidirectional isolation.** A duration embedded in a sentence of the other direction — an English
"4h" inside an Arabic sentence — must be wrapped so it cannot reorder its surroundings. The existing
locale helper gains one function for this, and it is used everywhere a number sits inside translated
prose. This is the one genuinely new i18n hazard of the phase; a countdown that reads "left 3 hours
working" in RTL is the failure to test for.

---

## `SlaState` — the state indicator

Used in the ticket detail header and in every queue row.

| `state` | Icon | Text key | Colour role |
| --- | --- | --- | --- |
| `met` | check | `sla.state.met` | success |
| `on_track` | clock | `sla.state.onTrack` | neutral |
| `at_risk` | clock-alert | `sla.state.atRisk` | warning |
| `breached` | alert-triangle | `sla.state.breached` | danger |

**FR-085 is satisfied by the icon and the text, not by the colour.** The greyscale test is explicit:
render all four states with colour stripped and assert each is still identifiable by its icon name and
its text. Colour is the fastest signal for the sighted majority and the only one that vanishes for
everyone else, so it is never the sole carrier — the rule Phase 5 applied to delivery state and
channel, applied here to a state that is far more colour-tempting.

For a ticket with `sla: null`, the component renders **nothing** — not "no SLA", not a dash. A ticket
with no commitment should not be visually annotated with its absence in every row of the queue.

## `SlaCountdown`

Shows `remainingMinutes` for the nearer unmet target, with the target time on hover and in the
accessible name.

- Paused: renders the captured remainder with a pause affordance and the key `sla.paused`, and does
  **not** count down. A ticket waiting on the customer that appears to be burning its clock is the
  bug Story 6 exists to prevent, and it would be an interface bug even with the backend correct.
- Breached: renders `sla.overdueBy` rather than a negative number.
- Refreshes on the ticket's own poll, never on a local ticker: the state is the server's (FR-011), and
  a client-side countdown would drift into disagreeing with the sweep.

## `DueSourceBadge`

Beside the due date wherever it appears. `policy` → `sla.dueSource.policy`; `manual` →
`sla.dueSource.manual`, with a control to clear the override where the user holds
`tickets:set_due_date` (FR-024b, FR-024d).

**Both states are labelled.** Showing a badge only for overrides would make "computed" the unmarked
default, and a supervisor asking "why is this date what it is?" needs an answer on both.

---

## Screen: SLA Policies — `/admin/sla/policies`

Guard: `sla:manage`. Sits under the existing `SettingsShellView`.

- A table **in matching order**, since the list order *is* the precedence order (contracts/sla-api.md).
  A short explanatory line, `sla.policies.precedenceExplained`, names the rule; the ordering
  demonstrates it.
- Each row: name, what it matches, both targets as durations, active state, and a count of open
  tickets currently governed by it.
- Create and edit in a drawer: name, priority (optional), category (optional), two duration inputs.
- Duration input is **a number and a unit selector** (minutes / hours / days), converting to working
  minutes on submit. A single "minutes" field would have an administrator computing 2400 by hand for a
  five-day target, and getting it wrong.
- Deactivate is a confirming action; there is no delete (FR-019), and the absent control needs no
  explanation beyond the tooltip `sla.policies.noDeleteReason`.

## Screen: Business Calendar — `/admin/sla/calendar`

Guard: `sla:manage`.

- Working days as a seven-checkbox group, **starting on Sunday**, which is both the storage order and
  the correct first day for the default locale.
- Start and end time as two time inputs; a zone selector over `Intl.supportedValuesOf('timeZone')`.
- Exceptions as a dated list with an add form.
- One line of standing reassurance, `sla.calendar.noRetroactiveChange`, stating that editing the
  calendar does not move commitments already made (FR-029). It is the first question an administrator
  will have, and answering it in the interface is cheaper than answering it in support.

## Screen: Assignment — `/admin/assignment`

Guard: `assignment:manage`.

- Strategy as four radio options with a sentence of consequence each, including `off`.
- Ceiling as an optional number with an explicit "no limit" state — not `0`, which reads as "assign
  nobody anything".
- Eligible-agent count shown live beside the strategy. Zero eligible agents is shown as a warning
  where the user is choosing, not discovered later.
- A competency matrix: users down, the four categories across, checkboxes. Small, fixed, and legible
  in both directions — which is why the categories are columns rather than tags.
- Header note `assignment.humanAssignmentWins` (FR-049). Supervisors will otherwise assume enabling a
  strategy overrides their own decisions.

## Screen: Automation Rules — `/admin/automation`

Guard: `automation:manage`. The hardest screen in the phase for accessibility.

**The list**: name, trigger, condition count, action summary, enabled toggle, and drag-or-keyboard
reordering. Reordering **must be operable without a pointer** — each row carries "move up" / "move
down" buttons, not only a drag handle. A drag-only list is inaccessible, and this list controls
execution order (FR-060).

**The builder**, three labelled fieldsets in order:

1. **When** — one trigger from a radio group.
2. **If** — condition rows, each `field` / `operator` / `value` with a remove button, plus "add
   condition". A standing line states `automation.builder.allConditionsMustHold` (FR-059), because
   and/or is exactly what a user will assume wrongly.
3. **Then** — action rows, each `action` plus its parameter controls, plus "add action".

Accessibility contract, stated because a dynamic form is where this quietly fails:

- Each row is a `<fieldset>` with a legend naming its ordinal (`automation.builder.conditionN`), so a
  screen-reader user knows which of five rows they are in.
- Adding a row moves focus to its first control; removing one moves focus to the next row, or to the
  add button if it was the last. Focus is never dropped to the document.
- The field, operator, and value selects are **dependent**: changing the field resets operator and
  value to that field's permitted set, and the change is announced through the existing live region.
  Leaving a stale operator selected is how an invalid rule reaches the validator.
- Validation errors are announced, not only shown (Principle IV, FR-083), reusing the pattern
  established in Phases 1–5 rather than a second mechanism.
- The catalogs come from `GET /api/automation/rules/catalog`, so the screen can never offer a
  combination the validator refuses.

**Dry run**, before enabling: a button, then a panel listing matched tickets and what would be applied,
with `automation.dryRun.noChangesMade` stated plainly. Enabling is a separate, deliberate action — a
rule saved is not a rule running (FR-061), and the interface should make the two feel different.

## Screen: Automation Record — `/admin/automation/runs`

Guard: `automation:view`.

Paged table: time, rule, ticket, outcome, detail. Filters for rule, ticket, and outcome.

Outcomes carry an icon and text, never colour alone: `acted`, `no_match`, `suppressed`, `failed`. The
`no_match` rows matter — User Story 4 scenario 2 requires a non-match to be visibly *not* an error, and
a table that hid them would leave a supervisor unable to tell "did not match" from "never ran".

`detail` is rendered from its i18n key and params, never displayed raw.

---

## Ticket detail additions

- SLA panel in the header: both targets, `SlaState` each, `SlaCountdown` for the nearer unmet one, the
  governing policy name, and a paused indicator.
- `DueSourceBadge` beside the existing due-date control.
- History entries for the five new SLA events render with the system actor, using the i18n key
  Phase 5 established for `SYSTEM_ACTOR` — never the English word "System".

## Queue and list additions

`SlaState` in one new column, and nothing else. The queue is Phase 4's screen and the phase's SC-014
promise is that it keeps working; adding a countdown to every row would both crowd it and invite the
client-side ticker `SlaCountdown` exists to avoid.

The existing due-date column and its sort are **unchanged** — they read `due_at`, which is now
populated by policy (research D6). That is the seam being used, not extended.

---

## i18n namespaces

New top-level keys in both `ar.json` and `en.json`: `sla.*`, `assignment.*`, `automation.*`,
`alerts.*`, plus `permission.module.sla`, `permission.module.assignment`,
`permission.module.automation` and their four action keys for the roles screen.

`frontend/tests/locales.test.ts` already asserts key parity between the two files and will fail on any
key added to one and not the other — which is the mechanism that keeps Principle I true without
inspection.

---

## Test obligations this contract creates

1. **Greyscale**: all four SLA states distinguishable with colour stripped (FR-085).
2. **RTL**: countdown and overdue phrases render correctly in Arabic with no reordering artefacts, and
   a number embedded in translated prose stays where it belongs.
3. **Keyboard**: the rule builder is fully operable — add, edit, remove, reorder rules and rows — with
   no pointer, and focus lands somewhere sensible after every add and remove.
4. **Dependent selects**: changing a condition's field resets its operator and value, so an invalid
   combination cannot be submitted.
5. **Locale parity**: no key in one file and not the other (existing test, extended by the new
   namespaces).
6. **Null SLA**: a ticket with no policy renders no SLA annotation anywhere.
7. **Paused**: a paused ticket's countdown does not decrement.
