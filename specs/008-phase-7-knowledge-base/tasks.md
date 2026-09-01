---
description: 'Task list for Phase 7 — Knowledge Base'
---

# Tasks: Phase 7 — Knowledge Base

**Input**: Design documents from `/specs/008-phase-7-knowledge-base/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution's Phase-Gated Delivery principle requires each phase to ship
tested, and Principle II makes the authorization matrix non-optional. This phase has a third reason:
**its central function is one most reviewers cannot check by reading it.** Whether `كتاب` finds
`الكتاب` is not visible in a diff, and the platform gets it wrong — so the Arabic table in
`backend/tests/search/` is not a check on the work, it is the only place the behaviour is
observable.

**Organization**: Grouped by user story. Stories run **US2 → US1 → US3 → US5 → US4 → US6 → US7**,
which is priority order with one deliberate deviation:

- **US2 (authoring) runs before US1 (search)**, though both are P1 and US1 is the headline story,
  because nothing can be found until something has been written. US1's own Independent Test requires
  published articles to search for; building search first means testing it against fixtures that
  have to be torn out.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7 per spec.md

## Path Conventions

Web app monorepo: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`.

---

## Phase 1: Setup

**Purpose**: Directories and the locale keys the roles screen needs. **No new dependencies** — the
tokenizer is written here rather than imported (research D1, D2), and `Intl.Segmenter` is built into
Node 22. Confirm that before starting rather than discovering it halfway through.

- [X] T001 Create the module directories `backend/src/controllers/knowledge/`, `backend/src/controllers/public/`, `backend/src/routes/knowledge/`, `backend/tests/knowledge/`, `backend/tests/search/`, `backend/tests/public/`, `frontend/src/components/knowledge/`, `frontend/src/views/help/`, `frontend/tests/knowledge/`
- [X] T002 [P] Add `permission.module.kb` and the three action keys to `frontend/src/locales/en.json` and `frontend/src/locales/ar.json`, so the roles screen can render the new module the moment the catalog entries land

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, permissions, models, and the tokenizer every reader-facing feature depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Two tasks in particular:

- **T016 (the tokenizer) and T017 (its Arabic table)** are the phase's foundation in the literal
  sense — search, suggestion, and the public help centre are all the same matching code. Write the
  test with the implementation, not after: it is the only artefact that proves the phase's central
  claim, and every later story inherits whatever it does not catch.
- **T015 (the test-helper seeder grant)** — a forgotten grant makes every new test fail with a 403
  whose cause is invisible, exactly as happened in Phases 2, 3, 4, 5 and 6.

### Schema

- [X] T003 [P] Migration `backend/src/db/migrations/20260901000001-create-kb-categories.cjs` per data-model.md, with unique `(slug)`, an index on `(position, id)`, and a comment recording that the taxonomy is FLAT by decision (no `parent_id`)
- [X] T004 [P] Migration `backend/src/db/migrations/20260901000002-create-kb-articles.cjs` with `category_id NOT NULL` (FR-010), `status` defaulting to `draft` (FR-004), `audience` defaulting to `internal`, `MEDIUMTEXT` bodies, unique `(slug)`, and indexes on `(status, audience)`, `(category_id, status)`, `(updated_at)`
- [X] T005 [P] Migration `backend/src/db/migrations/20260901000003-create-kb-article-terms.cjs` with composite primary key `(article_id, lang, field, term)` and the index on `(term, lang)` — the range scan that is the entire reason this table exists rather than a JSON column
- [X] T006 [P] Migration `backend/src/db/migrations/20260901000004-create-kb-guides.cjs` with unique `(slug)`, and a comment recording that a guide has no status of its own (FR-011d is derived from its steps)
- [X] T007 [P] Migration `backend/src/db/migrations/20260901000005-create-kb-guide-steps.cjs` with composite primary key `(guide_id, article_id)` and an index on `(guide_id, position)`
- [X] T008 [P] Migration `backend/src/db/migrations/20260901000006-create-kb-ticket-articles.cjs` with composite primary key `(ticket_id, article_id)` and `attached_by_user_id` nullable — null means a rule did it, the Phase 5/6 convention for a system act

### Permissions

- [X] T009 Add `kb:author`, `kb:publish`, and `kb:manage` to `backend/src/auth/permissions.ts`, with the comment recording why authoring and publishing are split (publish is the only quality gate this content has) and why there is deliberately no `kb:read` key
- [X] T010 Seeder `backend/src/db/seeders/20260901000001-kb-permissions.cjs` granting `kb:author` to Agent — the person who just solved something should write it down — and `kb:publish` / `kb:manage` to Supervisor and Administrator
- [X] T011 Add three probes to `PROBES` in `backend/tests/authorization.matrix.test.ts`; the generated matrix fails until every catalog key has one
- [X] T012 Register the new seeder in `backend/tests/helpers/database.ts` so a test user built with the new permissions actually holds them

### Models and declarations

- [X] T013 [P] Create the six Sequelize models in `backend/src/models/`: `kb-category.model.ts`, `kb-article.model.ts`, `kb-article-term.model.ts`, `kb-guide.model.ts`, `kb-guide-step.model.ts`, `kb-ticket-article.model.ts`, and register their associations in `backend/src/models/index.ts`
- [X] T014 [P] Add the knowledge-base actions to `AUDIT_ACTIONS` in `backend/src/services/audit.service.ts`, with the comment recording that article READS are deliberately not audited — the view counter is that record, and auditing page views would flood the log an investigator reads
- [X] T015 Extend the test-helper role/permission seeding in `backend/tests/helpers/` (see the CRITICAL note above)

### The tokenizer — the phase's foundation

- [X] T016 Create `backend/src/lib/text-normalise.ts` with `normaliseForIndex(text)` and `normaliseQuery(text)`, applying the six-step pipeline in contracts/search-contract.md: NFKC + lowercase, strip harakat and tatweel, fold the alef/ya/ta-marbuta variants, strip a leading `ال` when ≥2 characters remain, segment via `Intl.Segmenter`, keep tokens of length ≥2. **Both exported functions MUST call the same internal pipeline**
- [X] T017 Table-driven test `backend/tests/search/text-normalise.test.ts` over the exact cases research D1 measured: `كتاب`/`الكتاب` produce one token; the two-letter `رف` survives; harakat are ignored; the alef variants fold; `ال` alone is not destroyed; English is unaffected; and **`normaliseForIndex` and `normaliseQuery` agree on every case**

**Checkpoint**: schema, permissions, models, and the tokenizer are in place, and the Arabic table is green. `npm test --workspace backend` passes with the matrix green. Nothing new works yet; nothing existing is broken.

---

## Phase 3: User Story 2 — Somebody Writes an Article and Decides When It Goes Live (Priority: P1) 🎯 MVP

**Goal**: articles can be written, filed, published, archived, and restored, with the publish state
acting as the quality gate this content has instead of a conversation.

**Independent Test**: create a draft, confirm it is invisible, publish it, confirm it appears,
archive it, confirm it disappears — and that the archived article is still readable by its author.

**Why first**: nothing can be found until something has been written. Building search against
fixtures would mean tearing them out.

### Tests for User Story 2

- [X] T018 [P] [US2] Test `backend/tests/knowledge/lifecycle.test.ts`: a new article is a draft (FR-004); publishing sets `published_at` and its publisher; archiving hides it without destroying it; restoring returns it to published; a draft can be archived (FR-003, FR-007)
- [X] T019 [P] [US2] Test `backend/tests/knowledge/publish-validation.test.ts`: publishing requires a complete title-and-body pair in ONE language (FR-005) — a title with no body is refused with `kb.error.incompletePair`, neither pair complete is refused with `kb.error.noCompleteLanguage`, and a one-language article publishes successfully (Clarifications Q3)
- [X] T020 [P] [US2] Test `backend/tests/knowledge/permissions.test.ts`: `kb:author` may create and edit but NOT publish; `kb:publish` may publish, archive and restore; a user with neither is refused server-side; and reading a PUBLISHED article needs no key beyond being signed in (FR-053)
- [X] T021 [P] [US2] Test `backend/tests/knowledge/slug.test.ts`: the slug is derived at first publish, is unique, and does NOT change when the title is edited afterwards (D10) — every link already sent stays valid
- [X] T022 [P] [US2] Test `backend/tests/knowledge/audit.test.ts`: create, edit, publish, archive and restore each write an audit entry with the acting user (FR-009)

### Implementation for User Story 2

- [X] T023 [US2] Create `backend/src/services/kb-article.service.ts`: create, update, and read, with `availableLanguages` derived rather than stored (the field FR-005a depends on) and optimistic locking via `version`
- [X] T024 [US2] Add the lifecycle transitions to `backend/src/services/kb-article.service.ts` — publish, archive, restore — with slug derivation at first publish and `published_at` set once and never cleared, so "when did this first go live" survives an archive and restore
- [X] T025 [US2] Write the audit entries for every lifecycle act in `backend/src/services/kb-article.service.ts`, inside the same transaction as the change
- [X] T026 [P] [US2] Create `backend/src/controllers/knowledge/articles.controller.ts` and `backend/src/routes/knowledge/articles.routes.ts` per contracts/knowledge-api.md, gated `kb:author` for writing and `kb:publish` for the lifecycle. **There is no DELETE route** (FR-007)
- [X] T027 [US2] Mount the knowledge router in `backend/src/routes/index.ts`
- [X] T028 [P] [US2] Create `frontend/src/services/knowledge.service.ts` for the article endpoints
- [X] T029 [P] [US2] Create `frontend/src/views/admin/KnowledgeView.vue`: the article list with status, audience, languages and last-updated; the editor with both language pairs side by side and neither required; publish as a separate deliberate control stating which languages go live and to whom; **no delete control anywhere**, with `kb.articles.noDeleteReason` on archive
- [X] T030 [P] [US2] Create `frontend/src/components/knowledge/LanguageBadge.vue` — used wherever an article is listed or opened (FR-005a), because under Q3 an unlabelled one-language article looks like a page that failed to load
- [X] T031 [US2] Add the `/admin/knowledge` route with the `kb:author` guard to `frontend/src/router/index.ts`, the nav entry to `frontend/src/layouts/AdminLayout.vue`, and every new key to both locale files

**Checkpoint**: articles exist and have a lifecycle. Nothing can find them yet.

---

## Phase 4: User Story 1 — An Agent Finds the Answer Without Leaving the Ticket (Priority: P1) 🎯 MVP

**Goal**: published articles are findable by words in their title or body, in both languages, ranked
by relevance, from inside a ticket.

**Independent Test**: publish two articles, search from a ticket for a term in one of them, and
confirm the right article is found and readable without navigating away.

### Tests for User Story 1

- [X] T032 [P] [US1] Test `backend/tests/search/index-query-agreement.test.ts`: for every case in the T017 table, an article containing one spelling is found by a query for the other — end to end through the database. **This is the test that proves the phase's central claim**, and the one MySQL's own full-text index would fail
- [X] T033 [P] [US1] Test `backend/tests/search/visibility.test.ts`: a draft and an archived article are unfindable by search (FR-018), and archiving a published article removes its index rows (D4)
- [X] T034 [P] [US1] Test `backend/tests/search/ranking.test.ts`: an article with the term in its TITLE outranks one with it buried in the body; an article matching all query tokens outranks one matching a third of them; and the same query returns the same order twice (FR-019, SC-008)
- [X] T035 [P] [US1] Test `backend/tests/search/cross-language.test.ts`: a query in one language that matches nothing, against a corpus with matches in the other, returns an empty `items` with an `otherLanguage` COUNT — never the other-language articles themselves (FR-029, FR-005a)
- [X] T036 [P] [US1] Test `backend/tests/search/reindex.test.ts`: editing a published article rebuilds its index in the same transaction, so "searchable under its old text" is unrepresentable (D4)

### Implementation for User Story 1

- [X] T037 [US1] Create `backend/src/services/kb-search.service.ts` with `reindex(articleId, transaction)` and `removeFromIndex(articleId, transaction)`: delete-then-insert, per language, title and body as separate `field` rows, `hits` capped, and **only for published articles** — which makes FR-004 and FR-018 structural rather than checked
- [X] T038 [US1] Implement `search(options)` in `backend/src/services/kb-search.service.ts` with the ranking function from contracts/search-contract.md — field weight × capped hits, multiplied by the fraction of query tokens matched, tie-broken by `updated_at DESC, id DESC` — and the weights in ONE named constant so tuning is a one-line change
- [X] T039 [US1] Implement excerpt generation in `backend/src/services/kb-search.service.ts` (FR-021): the fragment showing WHY a result matched, which is what lets a reader choose between five results without opening five
- [X] T040 [US1] Implement the cross-language near-miss in `backend/src/services/kb-search.service.ts` (FR-029): when the reader's language returns nothing, count matches in the other and report the count — never substitute the articles
- [X] T041 [US1] Call `reindex` from every lifecycle transition in `backend/src/services/kb-article.service.ts`, inside the existing transaction (publish, edit-while-published, archive, restore)
- [X] T042 [P] [US1] Add the search endpoint to `backend/src/controllers/knowledge/search.controller.ts` and `backend/src/routes/knowledge/search.routes.ts`, with `audience` set by the SURFACE and never read from the request (D7)
- [X] T043 [P] [US1] Create `frontend/src/components/knowledge/SearchBox.vue` and `ResultList.vue` per contracts/knowledge-ui.md: title, category, `LanguageBadge` and excerpt per result; an explicit empty state with what to try next (FR-024); the cross-language offer as a CONTROL the reader chooses, never as substituted results; debounced and cancellable so a stale response cannot overwrite a newer one
- [X] T044 [US1] Add the search panel to `frontend/src/views/tickets/TicketDetailView.vue` so an agent can search without navigating away (FR-030), and add the keys to both locale files

**Checkpoint**: 🎯 **MVP.** Knowledge can be written and found. An organisation could use this.

---

## Phase 5: User Story 3 — The Right Article Appears Before Anyone Goes Looking (Priority: P1)

**Goal**: PLAN.md's Definition of done — the system proactively suggests a matching article on a
ticket, without anyone searching.

**Independent Test**: raise a ticket whose text matches a published article, open it, and confirm the
article is suggested with no search performed.

### Tests for User Story 3

- [X] T045 [P] [US3] Test `backend/tests/knowledge/suggestion.test.ts`: a ticket mentioning a term from a published article's title receives that article as a suggestion, ordered best-first and deterministic for two callers (FR-037, FR-039, SC-008)
- [X] T046 [P] [US3] Test `backend/tests/knowledge/suggestion-floor.test.ts`: **a ticket whose two-word subject matches nothing produces an EMPTY list, not a weak one** (FR-041). This is the single most important assertion in the story — a panel that always shows three articles teaches agents the panel means nothing
- [X] T047 [P] [US3] Test `backend/tests/knowledge/suggestion-visibility.test.ts`: a draft or archived article is never suggested, and archiving a suggested article removes it from the next read (FR-042)
- [X] T048 [P] [US3] Test `backend/tests/knowledge/suggestion-boost.test.ts`: an article whose category maps to the ticket's category outranks an equally-matching article whose does not — and a non-matching category is NOT excluded, because FR-040 says "prefer" (D6)
- [X] T049 [P] [US3] Test `backend/tests/knowledge/suggestion-arabic.test.ts`: an Arabic ticket produces suggestions from Arabic articles (FR-043) — free, because it is the same code path as search

### Implementation for User Story 3

- [X] T050 [US3] Create `backend/src/services/kb-suggestion.service.ts` with `suggestForTicket(ticketId)`: concatenate subject and description, normalise through the SAME tokenizer, rank with the SAME function, apply the category boost, apply the score floor, cap at a small number
- [X] T051 [US3] Put the score floor in ONE named constant in `backend/src/services/kb-suggestion.service.ts` with a comment saying what it costs to get wrong in each direction — too low is noise, too high is an always-empty panel, and both pass every test
- [X] T052 [P] [US3] Add `GET /tickets/:id/suggestions` to `backend/src/controllers/knowledge/suggestions.controller.ts` as **its own request**, not part of the ticket payload (FR-045)
- [X] T053 [P] [US3] Create `frontend/src/components/knowledge/SuggestionPanel.vue`: fetched separately so the ticket renders first; **shows an explicit "nothing to suggest" when empty** (FR-041); opening a suggestion never navigates the ticket away (FR-044)
- [X] T054 [US3] Add the panel to `frontend/src/views/tickets/TicketDetailView.vue` and the keys to both locale files

**Checkpoint**: 🏁 **PLAN.md's Definition of done is met** for the agent half — an article is found by searching, and suggested proactively on a matching ticket.

---

## Phase 6: User Story 5 — Content Is Organised Well Enough to Browse (Priority: P2)

**Goal**: categories and guides, so a reader who cannot name what they want can still reach it.

**Independent Test**: file articles under categories, browse from the top, and confirm every
published article is reachable without searching.

**Why before US4**: the public help centre browses this structure. Building it after would mean
wrapping something that does not exist yet.

### Tests for User Story 5

- [X] T055 [P] [US5] Test `backend/tests/knowledge/categories.test.ts`: a category holding articles cannot be deleted, and the refusal carries the COUNT so the administrator is told what to do rather than only that they cannot (FR-015)
- [X] T056 [P] [US5] Test `backend/tests/knowledge/guides.test.ts`: an article in a guide stays in its category and may appear in more than one guide (FR-011b); steps have a deterministic order; and replacing the sequence is atomic
- [X] T057 [P] [US5] Test `backend/tests/knowledge/guide-visibility.test.ts`: a guide whose steps are all drafts or archived is not offered to a reader (FR-011d), derived from its steps rather than from a stored flag
- [X] T058 [P] [US5] Test `backend/tests/knowledge/browse.test.ts`: every published article is reachable by browsing its category (SC-007), and a category with no visible articles says so rather than rendering empty (FR-014)

### Implementation for User Story 5

- [X] T059 [US5] Create `backend/src/services/kb-category.service.ts`: category CRUD with the `ticket_category` mapping (D6), position ordering, and the delete refusal that names the count
- [X] T060 [US5] Add guide management to `backend/src/services/kb-category.service.ts`: create, edit, and replace the whole ordered step sequence in one transaction
- [X] T061 [P] [US5] Create `backend/src/controllers/knowledge/structure.controller.ts` and `backend/src/routes/knowledge/structure.routes.ts` per contracts/knowledge-api.md, gated `kb:manage`
- [X] T062 [P] [US5] Create `frontend/src/views/admin/KnowledgeStructureView.vue`: categories in position order with **move-up / move-down buttons, not drag-only** (the Phase 6 rule for any list whose order is functional); the `ticketCategory` mapping with a line of consequence; guide steps with the same keyboard reordering, adding a step by searching articles rather than typing an id
- [X] T063 [P] [US5] Create `frontend/src/components/knowledge/GuideNav.vue` showing position ("Step 2 of 5") and LINKS to previous and next, not a "continue" button that hides where the reader is (FR-011c)
- [X] T064 [US5] Add the `/admin/knowledge/structure` route with the `kb:manage` guard to `frontend/src/router/index.ts`, the nav entry, and the keys to both locale files

**Checkpoint**: content is organised and browsable, internally.

---

## Phase 7: User Story 4 — A Customer Finds the Answer Without Raising a Ticket (Priority: P2)

**Goal**: a public, unauthenticated help centre — and deflection, which Phase 5's Out of Scope
assigned to this phase.

**Independent Test**: as a signed-out visitor, browse to and read a published customer-visible
article, search for it, and confirm nothing else is reachable by any means.

**⚠️ This story is the phase's new attack surface.** Its tests assert what the surface CANNOT do at
least as much as what it can.

### Tests for User Story 4

- [X] T065 [P] [US4] Test `backend/tests/public/kb-visibility.test.ts`: an internal article, a draft, an archived article, and a slug that never existed all return **byte-identical 404s** (FR-032c) — a public reader cannot learn that an article exists but is not for them
- [X] T066 [P] [US4] Test `backend/tests/public/kb-audience.test.ts`: the public search path cannot return an internal article **when called directly with an internal article present** — asserted against the service, not by trusting the controller to pass the right literal (D7)
- [X] T067 [P] [US4] Test `backend/tests/public/kb-rate-limit.test.ts`: `kb-search` and `kb-read` have independent allowances, so exhausting one does not exhaust the other (FR-036, the property Phase 5 built scoped limiting for)
- [X] T068 [P] [US4] Test `backend/tests/public/kb-payload.test.ts`: no public response carries an id, an author, a view count, an internal category id, or anything about customers, tickets or users (FR-035)
- [X] T069 [P] [US4] Test `backend/tests/public/deflection.test.ts`: submitting the public form succeeds identically whether or not deflection returned anything, **including when the search path throws** (FR-032e)

### Implementation for User Story 4

- [X] T070 [US4] Create `backend/src/controllers/public/kb.controller.ts` with `audience: 'customer'` and `status: 'published'` as **hard-coded literals**, never read from the request (D7, FR-032c)
- [X] T071 [US4] Add the three public routes to `backend/src/routes/public/index.ts` — categories, article-by-slug, search — with the `kb-read` and `kb-search` rate scopes. **Add them to that file specifically**: it opens by declaring that it exists so the whole unauthenticated surface stays readable at once, and this is the first phase to test whether that holds
- [X] T072 [P] [US4] Create `frontend/src/views/help/HelpCentreView.vue` and `HelpArticleView.vue`, rendering **outside the authenticated application shell** — no navigation into signed-in areas, no user menu, nothing implying an account exists
- [X] T073 [P] [US4] Create `frontend/src/components/knowledge/ArticleReader.vue`: a real heading hierarchy rather than styled paragraphs; `dir` and `lang` set from the ARTICLE's language independently of the interface (FR-055); `LanguageBadge` with the title; bidirectional isolation for Latin terms inside Arabic prose
- [X] T074 [US4] Add the public `/help` routes to `frontend/src/router/index.ts` **without an auth guard**, and confirm the router's existing guard does not redirect them
- [X] T075 [US4] Add deflection to the public form in `frontend/src/views/help/` and Phase 5's form component: matches appear beside the submit control, and **the submit control is never disabled, delayed, or moved** (FR-032e)
- [X] T076 [US4] Add the route from an article to raising a ticket (FR-033), placed AFTER the content rather than before it, and the `help.*` keys to both locale files

**Checkpoint**: a customer can find an answer without raising a ticket, and cannot reach anything else.

---

## Phase 8: User Story 6 — Out-of-Date Content Is Found Before a Customer Finds It (Priority: P3)

**Goal**: stewardship — which articles are stale, unread, or recently changed.

**Independent Test**: publish several articles, view them, and confirm the management view reports
when each was last updated and how often each has been read.

### Tests for User Story 6

- [X] T077 [P] [US6] Test `backend/tests/knowledge/view-count.test.ts`: reading an article increments its counter, and **nothing identifying the reader is stored anywhere** (FR-049, FR-050, SC-011)
- [X] T078 [P] [US6] Test `backend/tests/knowledge/stewardship.test.ts`: the management view reports last-updated and by whom (FR-048) and can be sorted to surface stale, unread, and recently-changed articles (FR-051)

### Implementation for User Story 6

- [X] T079 [US6] Add view counting to `backend/src/services/kb-article.service.ts` as a counter increment, **never an event row** (D11) — a counter cannot accidentally grow an IP column the first time somebody wants a trend
- [X] T080 [US6] Make the PUBLIC read path's increment best-effort and outside the response path (plan.md, Changed during planning): an unauthenticated GET that writes on every view is a denial-of-service amplifier aimed at the one surface strangers can reach, and a dropped count is a statistic where a saturated database is an outage
- [X] T081 [US6] Add the stewardship columns and sorting to `frontend/src/views/admin/KnowledgeView.vue`, so "old and unread" and "old and heavily read" are both findable — the second being the more urgent

**Checkpoint**: content decay is visible before a customer finds it.

---

## Phase 9: User Story 7 — An Automation Rule Can Point at an Article (Priority: P3)

**Goal**: the `suggest_article` action Phase 6's catalog was shaped to receive.

**Independent Test**: add the article action to a rule, fire the rule, and confirm the article is
attached and the run recorded exactly as any other automation action.

### Tests for User Story 7

- [X] T082 [P] [US7] Confirm the existing generated catalog test in `backend/tests/automation/engine.test.ts` accepts a well-formed rule using `suggest_article` — the test iterates the catalog, so a new entry without validator support fails there automatically
- [X] T083 [P] [US7] Test `backend/tests/knowledge/automation-action.test.ts`: a rule with the action attaches the article to the ticket with a null `attached_by_user_id` and records an `acted` run; a rule naming an ARCHIVED or deleted article records a `failed` run with a reason rather than doing nothing silently (FR-047)
- [X] T084 [P] [US7] Test `backend/tests/knowledge/attachments.test.ts`: attaching the same article twice is a no-op rather than a conflict, and an agent's attachment is distinguishable from a rule's

### Implementation for User Story 7

- [X] T085 [US7] Add the `suggest_article` entry to `backend/src/automation/catalog.ts` with an `articleId` param, replacing the comment that reserved it for this phase with the entry it predicted
- [X] T086 [US7] Add the executor branch to `backend/src/services/automation-engine.service.ts`, writing `kb_ticket_articles` with a null `attached_by_user_id` and failing with a recorded reason when the article is gone — the existing failure path, not a new one
- [X] T087 [P] [US7] Add attach and unattach endpoints to `backend/src/controllers/knowledge/attachments.controller.ts`, gated `tickets:update`
- [X] T088 [US7] Show pinned articles distinctly from suggestions in `frontend/src/components/knowledge/SuggestionPanel.vue`, saying whether a colleague or a rule attached it, and add the keys to both locale files

**Checkpoint**: all seven user stories are independently functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T089 [P] Run `frontend/tests/locales.test.ts` and resolve every key present in one locale file and absent from the other — the mechanism that keeps Principle I true without inspection
- [X] T090 [P] Frontend test `frontend/tests/knowledge/direction.test.ts`: an Arabic article inside an English interface renders `dir="rtl"` on the body and `dir="ltr"` on the chrome around it, and the reverse (FR-055, SC-010)
- [X] T091 [P] Frontend test `frontend/tests/knowledge/empty-states.test.ts`: the suggestion panel, search results, an empty category, and the whole help centre with nothing published each render an explicit empty state (FR-057, SC-013)
- [X] T092 [P] Greyscale pass: article status and audience remain distinguishable with colour stripped (FR-056)
- [ ] T093 [P] Arabic long-form reading pass by eye: an article body in RTL containing Latin product names and code. Bidirectional isolation is applied, but only a reader can say whether it reads naturally
- [ ] T094 [P] Screen-reader pass over an article's heading hierarchy and a guide's sequence and position — the reading experience this phase introduces, which no earlier phase had
- [ ] T095 [P] **Mobile pass on the public help centre.** A customer looking for help is holding a phone; this is the first surface in this project designed to be read rather than operated, and a desktop review will not catch a reading experience that fails at 375px
- [ ] T096 Run the seven quickstart scenarios end to end against a running application, starting with Scenario 7 (the empty knowledge base) on a fresh database
- [ ] T097 **Search quality pass against a real corpus.** The tests prove specific Arabic cases match and that ordering is deterministic; they cannot prove the top five results are the ones a person wanted. This is the pass most likely to change a weight
- [ ] T098 **Suggestion floor tuning against real tickets.** Too low is noise, too high is an always-empty panel, and **both pass every test** — the one number in this phase whose wrong value makes the feature worthless while looking correct
- [X] T099 Update `README.md` with the knowledge base's shape, and record why search is this project's own rather than the database's — the measurement table in research D1 is the answer to "why not FULLTEXT?", and it will be asked
- [X] T100 Fill the "Changed during implementation" table in `specs/008-phase-7-knowledge-base/plan.md` with what the code actually forced, following the Phase 5 and 6 precedent

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US2 (Phase 3)**: depends on Foundational. Blocks every other story — nothing can be found,
  browsed, suggested, or published until articles exist.
- **US1 (Phase 4)**: depends on US2 (articles to find) and on T016/T017 (the tokenizer).
- **US3 (Phase 5)**: depends on US1 — suggestion IS search with the ticket as the query (D5).
- **US5 (Phase 6)**: depends on Foundational for the schema; the category ENTITY is foundational
  because `kb_articles.category_id` is `NOT NULL`, while category MANAGEMENT is this story.
- **US4 (Phase 7)**: depends on US1 (search), US2 (published articles), and US5 (browse structure).
- **US6 (Phase 8)**: depends on US2, and on US4 for the public read path T080 covers.
- **US7 (Phase 9)**: depends on US2 and on Phase 6's automation engine, which already exists.
- **Polish (Phase 10)**: depends on everything.

### Within Each User Story

- Tests first, and confirmed failing, before the implementation that satisfies them.
- Migrations → models → services → controllers/routes → frontend.
- Backend before the frontend that calls it.

### Parallel Opportunities

- **Phase 2 migrations T003–T008** are six independent files — the largest parallel block.
- **T013 and T014** are independent of the migrations and of each other.
- Every test task marked [P] within a story is a separate file.
- **US6 and US7 can be worked in parallel** once US4 lands: they touch different services and
  different screens.
- Frontend component tasks marked [P] are separate files; the view and router tasks that wire them
  are not.

---

## Parallel Example: Foundational migrations

```bash
# Six independent migration files:
Task: "Migration create-kb-categories"      # T003
Task: "Migration create-kb-articles"        # T004
Task: "Migration create-kb-article-terms"   # T005
Task: "Migration create-kb-guides"          # T006
Task: "Migration create-kb-guide-steps"     # T007
Task: "Migration create-kb-ticket-articles" # T008
```

## Parallel Example: User Story 4 tests

```bash
Task: "backend/tests/public/kb-visibility.test.ts"  # T065
Task: "backend/tests/public/kb-audience.test.ts"    # T066
Task: "backend/tests/public/kb-rate-limit.test.ts"  # T067
Task: "backend/tests/public/kb-payload.test.ts"     # T068
Task: "backend/tests/public/deflection.test.ts"     # T069
```

---

## Implementation Strategy

### MVP

**Setup + Foundational + US2 + US1** (T001–T044). Knowledge can be written, published, and found in
both languages. Demo quickstart Scenarios 1 and 2. An organisation could use this on its own —
knowledge stops living in the heads of whoever has been here longest.

### Recommended increments

1. **Setup + Foundational** → schema, permissions, models, and the tokenizer. **Stop and run T017**:
   if the Arabic table is not green, nothing built on it will be.
2. **+ US2** → articles exist and have a lifecycle. Demo Scenario 1.
3. **+ US1** → 🎯 **MVP.** Knowledge is findable. Demo Scenario 2, including the `كتاب`/`الكتاب`
   case that MySQL's own index cannot do.
4. **+ US3** → 🏁 **The Definition of done is met** for the agent half. Demo Scenario 3, and pay
   attention to the empty panel.
5. **+ US5** → browsable structure and guides. Demo Scenario 6.
6. **+ US4** → the public help centre and deflection. Demo Scenarios 4 and 5. **The Definition of
   done is now met in full.**
7. **+ US6** → stewardship.
8. **+ US7** → the automation action.
9. **+ Polish** → the five manual passes, and the two tuning passes no test can perform.

### Parallel Team Strategy

After Foundational, US2 → US1 → US3 is one developer's critical path: they are the same content and
the same matching code, and splitting them would put two people in `kb-search.service.ts`. Once US1
lands, a second developer can take US5 and then US4's frontend, which is the largest isolated piece
of interface work in the phase.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- Commit after each task or logical group.
- **The tokenizer runs at BOTH ends, or it is worthless.** If a task tempts you toward normalising a
  query differently from the indexed text — "just lowercase it here" — stop: the result is a word
  findable by nobody, and it is invisible to any reviewer who does not read Arabic.
- **Only published articles have index rows.** Any code that filters drafts out at QUERY time has
  reintroduced the failure D4's design removes; the correct answer is that there is nothing to
  filter.
- **The public surface's visibility is a literal, never a parameter.** If a task tempts you toward
  passing `audience` through from the request "so the endpoint is reusable", stop: that is one
  signature change away from serving internal content, and the change would look harmless in review.
- **An empty suggestion panel is a feature.** Resist the pull to lower the floor so it looks busier.
