# Quickstart: Phase 7 — Knowledge Base

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01

How to run this phase's work and confirm it does what PLAN.md's Definition of done says: _"An agent or
customer can find a relevant article by searching, and the system proactively suggests one on a
matching ticket."_

Seven scenarios, then the manual passes the automated suite cannot cover. Everything runs with no
new infrastructure — the search is this project's own (research D1), so there is nothing to install
and nothing to keep in sync.

---

## Prerequisites

The Phase 0–6 setup, unchanged:

```powershell
npm install
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
```

**No new environment variables.** The only knobs this phase adds are the ranking weights and the
suggestion floor, and both live in named constants in the source rather than in configuration —
they want tuning against a corpus, not per-deployment variation.

Seeding grants `kb:author` to Agent and `kb:publish` / `kb:manage` to Supervisor and Administrator.
**No categories, articles, or guides are seeded**: a knowledge base's content is entirely the
organisation's, and inventing a taxonomy would be guessing at their business. Every surface should
therefore read as "nothing here yet" on first run — which is itself Scenario 7.

---

## Run the automated suite

```powershell
npm test                                     # both workspaces
npx vitest run backend/tests/search           # THE ARABIC TABLE — run this first
npx vitest run backend/tests/knowledge        # lifecycle, categories, guides, suggestion
npx vitest run backend/tests/public           # what the help centre cannot reach
```

**`backend/tests/search` is the file that matters most.** It contains the exact cases MySQL's
full-text index was measured to get wrong — `كتاب` against `الكتاب`, the two-letter word `رف`,
harakat, the alef variants — and they are the cases a regression would silently reintroduce. If that
file is green, the rest of search is a ranking function.

---

## Scenario 1 — Write an article and decide when it goes live (User Story 2)

1. Sign in as the seeded administrator, open `/admin/knowledge/structure`, and create a category —
   say "Hardware". Set its ticket-category mapping to `technical`.
2. Open `/admin/knowledge` and create an article in that category. Fill the English title and body
   only; leave Arabic empty.
3. Save. **Search for its title as an agent: it is not found.** It is a draft (FR-004).
4. Publish it. Search again: it appears.
5. Archive it. Search again: gone — but open it from the admin list and it is still there, intact
   (FR-007).
6. Restore it.

**What to look for**: the article's language badge says English throughout, including in search
results (FR-005a). Under Clarifications Q3 a one-language article is legitimate, and an unlabelled
one looks like a page that failed to load.

Then try to publish an article with a title but no body: refused with `kb.error.incompletePair`. A
half-written article is exactly what the publish gate exists to stop.

---

## Scenario 2 — Search finds it, in either language (User Story 1)

1. Publish two articles: one English about a card reader, one **Arabic** about the same subject.
2. From a ticket, search `card reader` — the English one is found.
3. Switch the interface to Arabic and search in Arabic — the Arabic one is found.

**Now the part the whole of research D1 exists for.** Publish an Arabic article whose body contains
`الكتاب`, then search for `كتاب` — **without** the definite article.

It is found. MySQL's own full-text index returns nothing for that query; this is the difference the
normaliser makes, and it is invisible until you look for it.

Then search for a genuine two-letter Arabic word such as `رف`. It is found. MySQL drops it entirely
unless a server variable is changed, restarted, and every index rebuilt.

Finally, search in English for something that exists only in Arabic. You get **an offer** — "3
articles match in Arabic" — not the articles themselves (FR-029). Being handed content in a language
you did not ask for, unlabelled, is what FR-005a prevents.

---

## Scenario 3 — The article appears before anyone goes looking (User Story 3, the Definition of done)

1. With the card-reader article published, raise a ticket whose subject mentions a card reader.
2. Open the ticket. The article is suggested beside it, without any search.
3. Click it: it opens **without losing your place on the ticket** (FR-044).

Now the behaviour that matters more than the suggestions:

4. Raise a ticket with a two-word subject that matches nothing — "please help".
5. Open it. **The panel says there is nothing to suggest.** It does not show three weak matches.

That empty panel is FR-041, and it is the difference between a feature agents use and one they learn
to ignore. If you find yourself tempted to lower the floor so the panel looks busier, that is the
decision this scenario exists to make you take deliberately.

6. Archive the article and reopen the ticket: the suggestion is gone (FR-042). Suggestions are
   computed on read and never stored.

---

## Scenario 4 — A customer finds it without raising a ticket (User Story 4)

1. Mark the card-reader article's audience **customer**.
2. Open `/help` **signed out**, in a private window.
3. Browse to the category, then read the article. The categories arrive WITH their articles in
   one response — a category you cannot open is a dead end, and a fourth public endpoint to fix
   that would have widened the surface this phase kept narrow.
4. Search for it.

**What to look for**: nothing on the page implies an account exists — no navigation into the
application, no user menu. The article shows no author, no view count, and no internal ids (FR-035).
The URL uses the slug, not the id (D10).

Then the refusals, which are the point of this surface:

5. Set another article to **internal** and publish it. Request it by slug from `/help`: **404**.
6. Request a **draft** by its slug: 404, with a byte-identical body.
7. Request a slug that has never existed: 404, identical again.

All three answers are the same (FR-032c). A public reader cannot use the response to learn that an
article exists but is not for them.

8. Hammer `/kb/search` — it rate limits on its own scope, and hammering it does **not** exhaust the
   allowance for `/kb/articles/:slug` (D7).

---

## Scenario 5 — Deflection, without ever getting in the way (FR-032d, FR-032e)

1. Open `/help/contact`. (Phase 5 built its form as an API for embedding elsewhere, so deflection
   lives on a hosted page in the help centre — see plan.md, _Changed during implementation_.
   Phase 5's submission endpoint is unchanged, and is what this page posts to.)
2. Start typing a subject that matches a published customer-visible article. Matches appear beside
   the submit control.
3. **Submit anyway, immediately.** The ticket is raised exactly as it was before this phase existed.

**What to look for**: the submit control is never disabled, never moves, and never waits for the
search. Stop the backend mid-typing if you like — the form stays fully usable. A customer who wants
a person gets one without arguing with a widget (FR-032e).

---

## Scenario 6 — Guides, and an automation rule that points at an article (User Stories 5 and 7)

1. Create a guide, add three published articles to it in order, and open the first from `/help`.
2. Confirm it says "Step 1 of 3" and offers **links** to next and previous, not a "continue" button
   that hides where you are (FR-011c).
3. Confirm each article is still in its own category and reachable by browsing (FR-011b) — a guide is
   a join, not a container (D9).

Then the automation half:

4. Open `/admin/automation`, create a rule: **when** a ticket is created, **if** category is
   `billing`, **then** suggest article → the billing FAQ.
5. Dry-run it, then enable it, then raise a billing ticket.
6. The article is attached to the ticket, and `/admin/automation/runs` records the run.
7. Archive that article and raise another billing ticket: the run is recorded as **failed with a
   reason** (FR-047), not silently doing nothing.

---

## Scenario 7 — The empty knowledge base (SC-013)

Worth doing **first**, on a fresh database, because it is the state every installation starts in and
the one nobody tests.

With nothing published:

- `/admin/knowledge` says there are no articles yet.
- `/help` says the help centre is empty.
- A search returns "nothing matched", not a blank region.
- The suggestion panel on any ticket says there is nothing to suggest.

None of them should look broken. A new help centre and a failed one must not be indistinguishable.

---

## Manual passes the automated suite does not cover

Recorded so they are not mistaken for done. Phases 4, 5 and 6 each carry equivalents forward
unfinished; these are this phase's, and they belong in `tasks.md` as explicit tasks.

- **Whether the search is actually any good.** The tests prove specific Arabic cases match and that
  ordering is deterministic. They cannot prove the top five results are the ones a person wanted.
  That needs a real corpus and somebody reading the results — and it is the pass most likely to
  change a weight.
- **Whether the suggestion floor is set right.** Too low and the panel is noise; too high and it is
  always empty. **Both pass every test.** This wants tuning against real tickets, and it is the one
  number in this phase that a wrong choice makes the feature worthless while looking correct.
- **Arabic long-form reading by eye.** An article body in RTL containing Latin product names and
  code. Bidirectional isolation is applied, but only a reader can say whether the result reads
  naturally.
- **Screen-reader navigation of an article** — heading hierarchy — **and of a guide** — sequence and
  position.
- **The public help centre on a phone.** A customer looking for help is holding one. This is the
  first surface in this project designed to be read rather than operated, and a desktop review will
  not catch a reading experience that fails at 375px.
- **Greyscale**: article status and audience distinguishable with colour stripped.

---

## Troubleshooting

**An article is published but not findable.** Check `kb_article_terms` has rows for it. Only
published articles are indexed (D4); if the rows are missing, the reindex did not run in the save
transaction, which is the one bug this design was shaped to make impossible.

**An Arabic word does not match.** Run the tokenizer on both the query and the article text and
compare the tokens. They are produced by the same function on purpose — if they differ, one call
site is not using it.

**Search finds nothing at all, in any language.** Check that the query is being normalised before it
reaches the term table. A raw query string will match almost nothing, because the index holds
normalised tokens.

**The suggestion panel is always empty.** Compare the ticket's normalised tokens with an article's.
If they overlap and the panel is still empty, the score floor is too high — that is the constant
named in `kb-suggestion.service.ts`, and this is exactly the tuning the manual pass above exists
for.

**A public request returns 404 for an article you can see as an agent.** That is correct if it is a
draft, archived, or internal. All three look the same from outside (FR-032c), which is the design —
check its `status` and `audience` as an agent rather than trusting the public response to tell you
why.
