# Contract: Messaging UI

**Feature**: `006-phase-5-communication-channels` | **Date**: 2026-08-30

Screens, states, i18n keys, and the accessibility contract. The API is in
[channels-api.md](./channels-api.md); adapters are in [channel-adapters.md](./channel-adapters.md).

Rules from Phases 0–4 that apply throughout and are not repeated per component: `<script setup>`
only; state that crosses components lives in a Pinia store; components never call `fetch` directly;
every string comes from `ar.json` / `en.json`; direction comes from the document root.

**One exception to that last rule, and it is deliberate.** The chat widget renders inside a page the
organisation does not control and therefore has no shared root to inherit from. It sets its own
`dir` from its configured locale (FR-076). This is recorded in plan.md as a non-violation: Principle
I forbids a component overriding a shared root, not a component that has none.

---

## The ticket screen — two composers, one screen

The single most dangerous surface in the phase. SC-006 is that an internal note is never delivered to
a customer and no reply is ever sent that the agent believed was a note.

**Structural separation, not styling.** `MessageThread.vue` and `ReplyComposer.vue` are distinct
components from Phase 4's `TicketNoteThread.vue` and `TicketNoteComposer.vue`, calling distinct
services against distinct endpoints. There is no shared "composer" component with an `isInternal`
prop, and no toggle that switches one component between the two modes. A wrong prop default would be
a disclosure; two components make it unrepresentable (FR-044).

**Distinguishable by more than colour** (FR-002, FR-110). Each region carries:

- a persistent heading naming what it is (`messages.thread.heading`, `notes.thread.heading`)
- a border treatment that survives greyscale
- an icon with a text alternative
- for the reply composer, a standing line naming the recipient and channel:
  `messages.composer.sendingTo` → *"Sending to hala@example.com by email"*

The reply composer's submit control names the act (`messages.composer.send` → *"Send to customer"*),
never a bare "Send". The note composer's says *"Save internal note"*. Read aloud in either language,
they cannot be confused.

**Quick-reply templates** (FR-045) insert into either composer through Phase 4's existing
`TemplatePicker.vue`, unchanged. The picker gains an insertion target; it does not learn what a
channel is.

**Delivery state** is shown per message (FR-047): `pending`, `sent`, `delivered`, `read`, `failed`.
Never presented as delivered until the provider says so. A `failed` message shows its
`deliveryDetail` inline to the agent who sent it (FR-048), with a retry affordance only when the
adapter reported it retryable.

**Reply-window refusal** (FR-057). When `POST` returns `CHANNEL_WINDOW_CLOSED`, the composer does not
show an error after the fact — it disables free-form entry and offers the permitted templates from
the `window` sibling, before the agent types.

### i18n keys

```text
messages.thread.heading            messages.composer.send
messages.thread.empty              messages.composer.sendingTo
messages.channel.email|whatsapp|sms|chat|form
messages.direction.inbound|outbound
messages.delivery.pending|sent|delivered|read|failed
messages.error.noReplyChannel      messages.error.optedOut
messages.error.windowClosed        messages.error.channelUnavailable
```

---

## Customer timeline

`CustomerTimelineView.vue`, reachable from the customer record and from Phase 4's
`CustomerContextPanel.vue` — which gains a link and is not otherwise rebuilt (FR-093).

One chronological list, paged (FR-091). Each entry shows channel, direction, time, and its ticket,
each identifiable without colour (FR-088, FR-110), and leads to that ticket (FR-089).

**Correspondence only** (FR-087a). The view has no filter for notes or history, because it holds
none — an absent control is a clearer contract than a disabled one.

**Two empty states, distinguished**: a customer who has never corresponded
(`timeline.empty.never`), and a customer whose correspondence the caller may not see
(`timeline.empty.noVisible`). Phase 4 established that an unexplained empty area is a defect.

---

## Agent chat console

Lives in the Phase 4 dashboard, consuming the same Server-Sent Events transport (research D10).

Arriving visitor messages are announced through a **polite** live region and never steal focus
(FR-077) — the same pattern Phase 4 established for notifications, reused rather than reinvented.

An unanswered conversation is visible without being modal. Nothing in this phase interrupts an agent
mid-sentence.

---

## The chat widget

A separate build output (research D14), embedded with one script tag. It ships the locale files and
its own styles; it never ships the authenticated application.

**Isolation.** Styles are scoped so a host page's reset cannot break the widget and the widget cannot
restyle the host. A single high `z-index` is declared once and documented, because a widget that
renders behind a host's header is indistinguishable from one that failed to load.

**Direction and language** come from the embed configuration, not the host page (FR-076).

**Accessibility** (FR-077): reachable and operable by keyboard alone, with a visible focus indicator;
focus is trapped inside the panel while it is open and returned to the launcher when it closes;
arriving messages are announced politely; the launcher carries an accessible name and an unread count
that is text, not a coloured dot.

**States**, each with its own key:

```text
widget.launcher.label            widget.state.connecting
widget.state.noAgents            widget.state.ended
widget.identity.prompt           widget.send.label
widget.error.rateLimited         widget.error.unavailable
```

`widget.state.noAgents` is shown when nobody is available — and the conversation still becomes a
ticket (FR-074). The visitor is told, not turned away.

**Reconnection.** A dropped stream reconnects and catches up through the same `?since=` mechanism
Phase 4 built for notifications. Persist-then-emit means a dropped connection costs latency, never a
message.

---

## Public form

Rendered from a definition, in the submission's language with the correct direction (FR-086 labels,
FR-083 validation messages). Required-field failures name the field and are announced to screen
readers, not only shown in colour — Constitution Principle IV, and the same rule Phase 1 applied to
its login form.

Rate-limit refusals say so plainly (`widget.error.rateLimited`) rather than presenting as a generic
failure the visitor will retry immediately.

---

## Administration

`ChannelSettingsView.vue` (`channels:manage`) — enablement, resolved provider, and configuration
state per channel. **Never displays a credential**, and shows no field that would accept one
(FR-006). The `isEnabled: true, isConfigured: false` combination is surfaced prominently: a channel
switched on that cannot work is the failure an administrator most needs to see.

`FormBuilderView.vue` (`forms:manage`) — fields, types, required flags, and bilingual labels, with
both language inputs visible together so a missing translation is obvious at authoring time rather
than at submission time.

---

## Accessibility contract (whole phase)

Every item is a test in `/speckit-tasks`, and the last three are manual — the same honest split
Phase 4 recorded.

| Requirement | Where |
| --- | --- |
| Every control keyboard-operable, visible focus indicator (FR-109) | thread, composer, timeline, widget, form, both admin views |
| WCAG 2.1 AA contrast in both languages (FR-109) | all of the above |
| Channel, direction, delivery state not colour-alone (FR-110) | thread, timeline |
| Arriving message announced politely, focus not stolen (FR-077) | widget, agent console |
| Focus trapped in the open widget, returned on close | widget |
| Correct direction in both languages, root-derived except the widget (FR-107, FR-076) | all |
| Validation errors announced, not only shown | public form, both composers |
