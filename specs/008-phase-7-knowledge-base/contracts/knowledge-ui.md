# Contract: Knowledge Base Interface

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01

Four screens, one new public surface, and one problem no previous phase has had: **rendering
long-form content whose language may differ from the interface's.**

Everything here follows the Phase 0–6 conventions and does not restate them: Vue 3 `<script setup>`,
Tailwind, Pinia for cross-component state, all API calls through a service module, all *interface*
text from `ar.json` / `en.json`, direction applied at the document root.

---

## The direction problem, and its contract

Every phase so far applied direction once, at the root, and every string on the page shared it.
Phase 7 breaks that: an English article read inside an Arabic interface, or the reverse, is normal
rather than exceptional — Clarifications Q3 makes one-language articles legitimate.

Three rules:

1. **Interface chrome follows the interface.** Navigation, buttons, labels, the search box, the
   category list — all inherit the document root, exactly as before. **Principle I is unchanged
   here.**
2. **Article content follows the article.** The body element carries its own `dir` and `lang`,
   derived from which language's content is being shown. This is not the per-component direction
   flipping Principle I prohibits: Principle I forbids a component overriding a shared root for
   *chrome*, and this is content whose direction is a property of the text — the same argument Phase
   5 made for the chat widget on a foreign page.
3. **The reader is always told which language they are getting** (FR-005a). A `LanguageBadge` appears
   wherever an article is listed or opened, and it is not decorative: under Q3 a reader will meet
   articles they cannot read, and an unlabelled one looks like a page that failed to load.

**Mixed content inside a body** — Latin product names inside Arabic prose — needs bidirectional
isolation the same way Phase 6's countdowns did. Inline code and identifiers are wrapped so they
cannot reorder the sentence around them.

---

## `ArticleReader`

The reading view, used by agents and by the public help centre.

- Renders a **real heading hierarchy** (`h2`, `h3`) rather than styled paragraphs, so a screen reader
  can navigate an article and a reader can skim one. This is the accessibility difference between a
  document and a wall of text.
- `dir` and `lang` set from the article's language, per the rules above.
- The `LanguageBadge` sits with the title, not in a corner.
- When the article is part of a guide, `GuideNav` appears above and below: position ("Step 2 of 5"),
  and **links** to previous and next — not inferred order, and not a "continue" button that hides
  where the reader is (FR-011c).
- On the public surface only, a route to raising a ticket (FR-033) sits at the end, after the
  content. Before it would interrupt someone who is about to succeed.

## `SearchBox` and `ResultList`

- Results carry title, category, `LanguageBadge`, and the matched excerpt (FR-021). The excerpt is
  what lets a reader choose between five results without opening five.
- **The empty state is a first-class state, not an absence.** "Nothing matched" plus what to try next
  (FR-024) — never a blank region that reads as a loading failure.
- **The cross-language offer** (FR-029) renders when the reader's own language matched nothing and
  the other has hits: "3 articles match in English" as a control they choose, never as results
  silently substituted. Handing somebody content in a language they did not ask for, unlabelled, is
  the thing FR-005a exists to prevent.
- Search is debounced and cancellable; a stale response never overwrites a newer one.

## `SuggestionPanel` — on the ticket

- Sits beside the ticket, fetched in **its own request** (FR-045). The ticket renders first; the
  panel fills in.
- **Shows nothing when there is nothing** (FR-041), with a plain line saying so. This is the single
  most important behaviour on this screen: a panel that always shows three articles teaches agents
  the panel means nothing, and once they stop reading it, better suggestions cannot win them back.
- Opening a suggestion **must not lose the agent's place** (FR-044) — it opens beside the ticket or in
  a new tab, never by navigating the ticket away.
- A pinned article (`kb_ticket_articles`) is visually distinct from a suggestion, and says whether a
  colleague or a rule attached it — the null `attachedByUserId` the API exposes.

## Screen: Knowledge — `/admin/knowledge`

Guard: `kb:author`.

- Article list with status, audience, category, languages, last updated, and view count.
- **Status and audience carry text and an icon, never colour alone** (FR-056). "Draft" and
  "Published" differing only in hue is the failure the Phase 6 greyscale rule already caught once.
- The editor has both language pairs side by side, each labelled, with neither required — Q3's rule
  made visible rather than explained.
- **Publish is a separate, deliberate control** from save, and it states what it will do: which
  language(s) go live, and to whom (`audience`).
- **No delete control anywhere**, with `kb.articles.noDeleteReason` on the archive control explaining
  that archiving is the removal (FR-007).
- The stewardship view (FR-051) sorts by last-updated and by view count, so "old and unread" and
  "old and heavily read" are both findable — the second being the more urgent.

## Screen: Categories and guides — `/admin/knowledge/structure`

Guard: `kb:manage`.

- Categories in `position` order with keyboard reordering — move up / move down buttons, **not
  drag-only**, the rule Phase 6's rule builder established for any list whose order is functional.
- Each category shows its optional `ticketCategory` mapping with a line of consequence: this is what
  makes a billing ticket prefer billing articles (D6).
- Deleting a category that holds articles is **refused with the count and a route to reassign them**
  (FR-015). A refusal that names the obstacle is a different thing from a dead end.
- A guide's steps are an ordered list with the same keyboard reordering; adding a step is a search
  over articles, not a raw id field.

## Surface: the public help centre — `/help`

**The first screen in this project that an unauthenticated visitor is meant to read**, as opposed to
Phase 5's chat widget, which they interact with.

- Renders **outside the authenticated application shell** — no navigation to signed-in areas, no user
  menu, nothing that implies an account exists.
- Category browse, article read, and search. Nothing else.
- **Accepts no input beyond a search string and a language toggle** (FR-032b). No comments, no
  ratings, no contact form.
- Every route to raising a ticket goes to Phase 5's existing public form, which is unchanged.
- The language toggle switches the interface AND filters to that language's articles, with the
  cross-language offer (FR-029) available.
- **Mobile is the primary case.** A customer looking for help is holding a phone; the reading view is
  designed for it and checked on one (see quickstart).

### Deflection on the public form

- The form calls public search as the customer types the subject, and shows matches **beside** the
  submit control.
- **The submit control is never disabled, delayed, or moved** (FR-032e). Suggestions are advisory. A
  search that is slow or fails leaves the form fully usable, and a customer who wants a person gets
  one without arguing with a widget.

---

## i18n

New top-level keys in both `ar.json` and `en.json`: `kb.*`, `help.*`, plus `permission.module.kb`
and its three action keys for the roles screen.

**Article content is NOT in the locale files** — it is data, authored at runtime, and stored per
language on the row (D8). The distinction matters: `frontend/tests/locales.test.ts` asserts key
parity between the two files, and article bodies must never be pushed into that mechanism.

Category and guide names are also data, for the same reason: an administrator creating a category at
runtime cannot add a key to a locale file (FR-012).

---

## Test obligations this contract creates

1. **Direction**: an Arabic article inside an English interface renders `dir="rtl"` on the body and
   `dir="ltr"` on the chrome around it, and the reverse.
2. **Language labelling**: an article available in one language only always renders its
   `LanguageBadge` — in the list, in search results, and in the reader.
3. **Empty states**: the suggestion panel, search results, a category with no visible articles, and
   the whole help centre with nothing published, each render an explicit empty state (SC-013).
4. **Greyscale**: status and audience remain distinguishable with colour stripped (FR-056).
5. **Keyboard**: category and guide-step reordering are fully operable with no pointer, and focus
   lands sensibly after every move — the Phase 6 rule.
6. **Heading structure**: an article body produces a navigable heading hierarchy, not styled
   paragraphs.
7. **The cross-language offer is a control, not a substitution**: other-language results are never
   rendered as if they were the reader's own.
8. **Locale parity** (existing test), extended by the new namespaces.
