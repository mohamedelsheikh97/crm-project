# Contract: Portal UI

**Feature**: `009-phase-8-customer-portal` | **Date**: 2026-09-01

The portal is the third front-end surface, and the first authenticated one that is not the staff
application. Its audience is nobody who was trained on it, on a device nobody chose for them.

---

## The shell

`App.vue` currently selects between two shells: `route.meta.publicShell === true` renders bare (Phase 7's
help centre), everything else gets `DefaultLayout`. It becomes a three-way selection (D13):

```text
meta.publicShell  → bare              (Phase 7 help centre — no session)
meta.portalShell  → PortalLayout      (Phase 8 portal — customer session)
otherwise         → DefaultLayout     (staff application)
```

`PortalLayout.vue` contains: the organisation name, the language switch, a link to help content, a link
to the request list, and sign out. It contains **no** staff navigation, no permission-derived menu, and
no vocabulary from the staff application (FR-063). It is not a variant of `DefaultLayout` with items
removed — an item removed by a `v-if` comes back the first time someone edits the shared file.

### Two clients, and neither can see the other's token

`stores/portal.ts` and `services/portal-http.ts` are separate from the staff store and client. The
portal client attaches only the portal token; the staff client attaches only the staff token (D13).

A single shared client with one interceptor would attach whichever token it held to whichever call was
made. The server refuses that in both directions (D1), so it is not a hole — but it produces confusing
401s and invites somebody to "fix" it by relaxing the server. Two clients make the correct thing the
easy thing.

The two sessions can coexist in one browser: an agent testing the portal is a normal thing to do, and
signing into one must not sign the other out.

---

## Routes

| Path                              | View                  | Session  | Notes                                            |
| --------------------------------- | --------------------- | -------- | ------------------------------------------------ |
| `/portal/login`                   | `PortalLoginView`     | no       | Also the destination of every portal 401         |
| `/portal/invite/:token`           | `AcceptInviteView`    | no       | Sets the credential, then signs in               |
| `/portal/forgot`, `/portal/reset/:token` | `PortalResetView` | no      | Always reports "check your email" (FR-006)       |
| `/portal`                         | `RequestListView`     | yes      | The landing surface                              |
| `/portal/requests/new`            | `NewRequestView`      | yes      | With deflection (FR-041)                         |
| `/portal/requests/:reference`     | `RequestDetailView`   | yes      | Conversation, reply, rating                      |
| `/portal/help`, `/portal/help/:slug` | `PortalHelpView`   | yes      | Phase 7 content inside the portal shell          |

**References, never ids** (FR-065). `/portal/requests/TKT-000042`, and article routes by slug — Phase 7's
rule, unchanged.

There is **no** `/portal/register`. Its absence is a requirement (FR-002a).

---

## Screens

### Accept invitation

The first thing a customer ever sees, and the one most likely to be mistaken for phishing. It states
which organisation is inviting them and which address the invitation was sent to, before asking for
anything. Then: set a password, choose a language, continue.

An invalid token — expired, used, revoked, wrong — shows one message covering all four (FR-002c) with a
route to ask for a new invitation. It does not say which of the four happened.

### Request list

Reference, subject, customer state, last activity. Open requests first, settled below, distinguishable
without colour alone.

**The empty state does real work here.** For a newly invited customer whose history predates the contact
association (D4), an empty list is the **normal** first experience. It reads as "you have no open
requests" with a prominent way to raise one — never as an error, and never as a spinner that never
resolves. A separate, quieter line covers the case where the customer expects to see history: contact
us and we will connect your earlier requests.

### New request

Subject, description, optionally category and urgency from Phase 3's taxonomy rendered from i18n keys.

**Deflection** (FR-041): as the description is typed, matching published articles appear beside the form —
debounced, cancellable (Phase 7's `signal` precedent), and never blocking. Submitting stays exactly one
action away whether an article was offered or not (FR-042). No results is silence, not an error message
(FR-044).

**No upload control** (FR-022). In its place, one sentence in locale text saying files can be sent by
replying to the request by email once it exists (FR-022a). Not a disabled button — a disabled control
invites clicking and explains nothing.

### Request detail

The conversation in one chronological list across channels, each entry marked as from the customer or
from the organisation, with its channel and time. Attachments are listed with name, type, and size, and
download through the scoped endpoint.

The reply box is present when the state allows it, and **absent** on a closed request — replaced by
"raise a new request", prefilled with a reference to this one (D9). The 409 exists as a guard for a
stale page, not as the path a customer normally meets.

**Nothing internal appears, because nothing internal arrives.** The view renders exactly the projection
in [visibility-contract.md](./visibility-contract.md); there are no fields it chooses not to show.

### Rating

Offered only on a settled request (FR-047). A fixed scale, an optional comment, one submission.

After submission, the score is shown back as recorded, with its date. A second attempt reports "already
recorded" rather than replacing anything (FR-049). Ignoring it entirely is a first-class outcome — the
prompt is a section of the page, not a modal, and it never nags (FR-051).

### Help

Phase 7's browse, search, and article reading inside the portal shell. Identical results to the public
help centre (FR-039). A one-language article keeps its language badge (FR-043) — the promise Phase 7's
FR-005a made, honoured on a second surface.

---

## Staff-side screens

**Customer detail** gains a portal-access section: per contact, whether it holds an account, has an
invitation outstanding, or is locked out, with the actions from
[portal-api.md](./portal-api.md#staff-additions-existing-realm-portalmanage). Hidden without
`portal:manage` — and refused server-side regardless (FR-059).

Issuing an invitation to a **provisional** record shows the service's warning before confirming
(FR-002f).

**Ticket detail** gains the requesting contact, and a way to set it where absent (FR-026i, FR-057a). The
label says what it means operationally — this is who can see the conversation in the portal — because
"requesting contact" alone will be read as decoration.

---

## Bilingual and RTL (Principle I)

- Every string is a locale key in `ar.json` and `en.json`. The portal is the surface where a missing
  Arabic key stops being an internal blemish and becomes what the organisation looks like.
- Direction is set at the document root by the existing toggle. No per-component flipping.
- **Customer states are i18n keys derived from the declared mapping** (D7), never the internal status
  string. There is no path by which an untranslated internal word reaches a customer.
- Channel names, categories, and priorities render from keys, as everywhere else.
- The language switch works **before** sign-in: the login and invitation screens are the first thing an
  Arabic-speaking customer sees.
- A signed-in customer's choice persists on their account (FR-064), so it survives a new device.
- Article content carries its own direction independent of the interface — Phase 7's rule, unchanged.

## Accessibility (Principle IV)

- Keyboard operable throughout, including the rating control, which must be radio-group semantics rather
  than a row of clickable icons.
- Every state carries text, not colour alone.
- Validation errors are associated with their field and announced (FR-062) — the portal is where an
  unannounced error means an abandoned request rather than a puzzled colleague.
- The conversation is a list with a real heading structure, so a screen reader can move between entries
  rather than through one wall of text.
- Empty states are announced, not merely rendered — a customer who cannot see the page must be able to
  tell "nothing here" from "still loading".
- **Mobile first**, which no previous surface in this project has been. A customer checking a request is
  holding a phone. Minimum target size on every control, no horizontal scrolling of the conversation, and
  a reply box usable with a keyboard covering half the screen.

## What the tests cannot check, and quickstart must

- Whether the invitation email and acceptance screen read as legitimate rather than as phishing, in both
  languages.
- Whether an empty request list reads as normal rather than broken.
- Whether "awaiting you" is true of `pending` (research open question 1).
- Arabic RTL reading of a whole conversation containing Latin file names and technical terms.
- Screen-reader navigation of the request list, the conversation, and the rating control.
- The whole portal on an actual phone.
