# Implementation Plan: Phase 7 — Knowledge Base

**Branch**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-phase-7-knowledge-base/spec.md`

**PLAN.md Reference**: Phase 7 — Knowledge Base

**Builds on**: Phase 6 — SLA & Automation, merged to `main` at `d960fd7`

## Summary

Phase 7 publishes. Articles are written, filed, and put in front of readers — agents searching from
inside a ticket, and, for the first time, customers who have not signed in to anything.

Six decisions shape the implementation.

**Search is ours, because the database measurably cannot do it in Arabic** (D1). Against this
project's own MySQL 8.4.11, a `FULLTEXT` index drops the real two-letter word `رف` entirely, and
fails to match `كتاب` against `الكتاب` in either direction. The first is fixable only by a global
server variable that needs a restart and a full index rebuild — outside the repository, and possibly
outside the operator's control on managed MySQL. The second has no configuration fix at all. FR-020
makes both languages non-negotiable, so this is a failed requirement rather than a rough edge. What
replaces it is a token table and a ranking function, not a search engine — the same trade Phase 6
made for working-time arithmetic.

**One tokenizer, used at both ends** (D2). `lib/text-normalise.ts` strips harakat and tatweel,
folds the alef/ya/ta-marbuta variants, removes the definite article `ال`, and keeps tokens of two
characters or more. Applying it at index time and at query time is what makes two spellings of one
word meet in the middle; applying it at one end only would be worse than not applying it.

**Suggestion is search with the ticket as the query** (D5), which is why FR-043 costs nothing: the
Arabic behaviour is already correct because it is the same code path. The part that needs care is
not the ranking but the floor — a panel that always shows three articles teaches agents the panel
means nothing.

**The public help centre extends the file Phase 5 built to be extended** (D7).
`routes/public/index.ts` opens by declaring that it exists so the whole unauthenticated surface stays
readable in one place, and calls that a standing instruction. This is the first phase to test it.

**A guide is a join, not a kind of article** (D9). An article stays in its category, unaware it is
part of a series, and may be in several — which is FR-011b true by construction rather than by
guard.

**Bilingual content reuses Phase 4's template shape** (D8): four columns on one row, at least one
language required to publish. Two languages fixed by the constitution do not need a translations
table, and the join would appear in every read path for a flexibility nobody has asked for.

**One correction to the spec came out of planning.** FR-049 asks the system to count article reads,
and the spec's Assumptions place read counts on the article. Counting a read on the PUBLIC surface
means an unauthenticated request writes to the database on every page view — which is a denial-of-
service amplifier pointed at the one surface strangers can reach. Public reads are therefore counted
through the same rate-limited path as everything else and the write is best-effort and non-blocking.
See _Changed during planning_.

## Technical Context

**Language/Version**: TypeScript ~6.0.2 strict on Node.js 22 LTS, both workspaces — unchanged from
Phases 0–6.

**Primary Dependencies**: **None added.** The candidate was an Arabic stemming or search library,
declined in D1 and D2: a stemmer's failure mode is silent false positives, which a reader cannot
detect, and an external search engine is infrastructure to run and keep in sync for a corpus of
hundreds of articles. `Intl.Segmenter` (Node 22, built in) provides word boundaries; the four
normalisation rules that matter are ours.

**Storage**: MySQL 8.4, `utf8mb4_0900_ai_ci`. **Six new tables** — `kb_categories`, `kb_articles`,
`kb_article_terms`, `kb_guides`, `kb_guide_steps`, `kb_ticket_articles`. No existing table is
altered. One declaration change: a `suggest_article` entry in `automation/catalog.ts` (D13).

**Testing**: Vitest across both workspaces, backend serially against `crm_support_test`. The
tokenizer gets a table-driven test over the specific Arabic cases D1 measured — `كتاب`/`الكتاب`, the
two-letter `رف`, harakat, and the alef variants — because those are the cases the platform gets
wrong and therefore the ones a regression would silently reintroduce. The Phase 1 authorization
matrix extends automatically over the three new permission keys. The public surface is tested for
what it CANNOT reach, not only for what it can.

**Target Platform**: Linux/Windows server; evergreen browsers. The public help centre is the second
surface after Phase 5's chat widget that an unauthenticated visitor sees.

**Performance Goals**: search returns fast enough to use mid-conversation (SC-004). The token table
is indexed on `(term, lang)`, so a query is an index range scan per token plus an aggregation, not a
scan of article bodies. Suggestion runs on ticket open and must not delay it (FR-045), so it is
fetched alongside the ticket rather than blocking its render.

**Constraints**:

- Only PUBLISHED articles have index rows (D4), so no draft or archived article is reachable by any
  query however it is written — FR-004 and FR-018 made structural.
- The index is rebuilt in the same transaction as the article write; "saved but not searchable" is
  unrepresentable (D4).
- The same tokenizer runs at index time and query time. Two implementations would be two chances to
  diverge in a language most reviewers cannot spot-check.
- The public surface filters `published AND customer-visible` in the SERVICE, never from a caller-
  supplied flag (D7, FR-032c).
- Draft, archived, and non-existent are indistinguishable to a public reader (FR-032c).
- The public surface accepts no reader-authored content of any kind (FR-032b).
- Deflection never blocks raising a ticket (FR-032e).
- Suggestions are computed on read and never stored (D5, FR-042).
- Read counting stores a counter, never an event, and never anything identifying the reader (D11).
- Article slugs are stable after first publish; links already sent must not break (D10).
- Single backend process, inherited unchanged from Phases 4–6.

**Scale/Scope**: ~18 new backend endpoints across two routers (admin/agent and public), 6 new
tables, 3 new permission catalog entries, 1 new automation action, 1 new `lib/` module, 4 new
frontend views, ~8 new components, and one new public frontend surface.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Initial evaluation (pre-research)

| Principle                                        | Assessment                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I — Bilingual-First & RTL** (NON-NEGOTIABLE)   | **At maximum risk, and in a way no previous phase has faced.** Every earlier phase rendered bilingual *chrome* around data. This phase makes the CONTENT bilingual and, per Clarifications Q3, deliberately allows an article to exist in one language only — so a reader will meet content they cannot read. It is also the first phase where a core function (search) can be correct in one language and broken in the other. |
| **II — Security by Default** (NON-NEGOTIABLE)    | **At high risk.** A new unauthenticated surface, which is the second in the project's history. Phase 5's was write-mostly and narrow; this one is read-mostly and browsable, which makes enumeration and disclosure the hazards rather than injection.                                                                                                                                             |
| **III — Layered Architecture** (NON-NEGOTIABLE)  | **At moderate risk.** Search is exactly the kind of logic that migrates into a model or a route handler "because it is just a query", and a tokenizer is exactly the kind of helper that gets inlined where it is first needed.                                                                                                                                                                    |
| **IV — Accessibility**                           | **At risk.** Long-form reading content is new: heading structure, reading order, and a language switch that changes the direction of a body of text rather than a label.                                                                                                                                                                                                                          |
| **V — Phase-Gated Delivery**                     | **Passes.** `/speckit-specify` complete with three clarifications resolved and no markers remaining; this plan precedes `/speckit-tasks`; PLAN.md traceability tables are in the spec.                                                                                                                                                                                                            |

**Outcome: proceed to research with four named constraints**, each carried into a decision.

### Post-design re-evaluation

| Principle | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I**     | **Passes, and this is the phase's main body of work.** D1 exists because the platform's search is measurably worse in Arabic, and rejecting it is Principle I applied to a function rather than to a label. D2's normaliser is tested against the exact cases that fail. Article content carries its own `dir` independent of the interface (FR-055), which is correct precisely because it is content rather than chrome — the same distinction Phase 5 drew for the chat widget. FR-005a and FR-029 handle the Q3 consequence: a reader is told what language they are being offered and told when their language has a near-miss, rather than shown a blank. |
| **II**    | **Passes with the defence written down.** The public surface is three read-only endpoints in the file Phase 5 built to keep that count visible (D7), each rate limited on its own scope. Visibility is decided in the service from `status` and `audience`, never from a caller parameter. Draft, archived, and absent all return the same answer (FR-032c), so the surface cannot be used to probe for unpublished content. No reader-authored input is accepted at all (FR-032b), which removes moderation and injection from the phase entirely. Slugs rather than ids (D10) so the corpus cannot be enumerated by counting. Three new permission keys are enforced server-side and covered by the generated matrix. |
| **III**   | **Passes.** `lib/text-normalise.ts` is pure text arithmetic reading no business rules, which is why it sits beside `business-hours.ts`, `phone.ts` and `clock.ts` rather than inside a service. Ranking, visibility, and suggestion live in services; controllers do HTTP; the public router delegates like every other.                                                                                                                                                                                                                                        |
| **IV**    | **Passes.** Article bodies render with a real heading hierarchy rather than styled text, so a screen reader can navigate one. A guide exposes its position and its next/previous steps as links, not as inferred order. Lifecycle state carries text and an icon, never colour alone (FR-056). The empty state is explicit on every surface (FR-057, SC-013) — an empty help centre must read as new, not broken.                                                                                                                                                 |
| **V**     | **Passes.** Artifacts complete; this section is the reviewer's gate before `/speckit-tasks`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Outcome: gate passes with no violations.** Three items are recorded in Complexity Tracking — the
hand-written tokenizer and index, six new tables, and the second unauthenticated surface. None is a
principle violation; each is the kind of thing the constitution asks to be justified rather than
absorbed silently.

## Project Structure

### Documentation (this feature)

```text
specs/008-phase-7-knowledge-base/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D13
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── knowledge-api.md      # Authoring, browse, search, suggestion, public
│   ├── search-contract.md    # The tokenizer and ranking contract
│   └── knowledge-ui.md       # Screens, reading view, states, i18n, a11y
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── auth/
│   │   └── permissions.ts              # + 3 catalog entries (D12)
│   ├── automation/
│   │   └── catalog.ts                  # + suggest_article (D13)
│   ├── controllers/
│   │   ├── knowledge/                  # Articles, categories, guides, search
│   │   └── public/                     # Help-centre read + search
│   ├── db/
│   │   ├── migrations/                 # 6 new tables
│   │   └── seeders/                    # KB permission grants
│   ├── lib/
│   │   └── text-normalise.ts           # NEW — the tokenizer (D2)
│   ├── models/                         # 6 new models
│   ├── routes/
│   │   ├── knowledge/                  # Authenticated
│   │   └── public/index.ts             # + 3 public routes (D7)
│   └── services/
│       ├── kb-article.service.ts       # CRUD and lifecycle
│       ├── kb-category.service.ts      # Categories and guides
│       ├── kb-search.service.ts        # Indexing and ranking (D1, D3, D4)
│       └── kb-suggestion.service.ts    # Ticket matching (D5, D6)
└── tests/
    ├── knowledge/     # articles, lifecycle, categories, guides, permissions
    ├── search/        # THE ARABIC TABLE (D1's measured cases), ranking, index
    └── public/        # what the help centre cannot reach

frontend/
├── src/
│   ├── components/knowledge/           # ArticleReader, SearchBox, ResultList,
│   │                                   # SuggestionPanel, GuideNav, LanguageBadge
│   ├── views/
│   │   ├── admin/KnowledgeView.vue     # Authoring and lifecycle
│   │   └── help/                       # NEW — the public help centre
│   └── services/knowledge.service.ts
└── tests/knowledge/                    # reading view, RTL content, suggestion
```

**Structure Decision**: the two-workspace layout is unchanged. One new `lib/` module appears —
`text-normalise.ts`, pure text arithmetic reading no business rules, on the same reasoning that put
`business-hours.ts` there in Phase 6. One genuinely new frontend area appears, `views/help/`,
because the public help centre must be reachable without the authenticated application shell — the
same separation Phase 5 made for the chat widget, though this one shares the main build rather than
needing its own entry.

## Complexity Tracking

| Violation                                                                          | Why Needed                                                                                                                                                                                                             | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A hand-written tokenizer and inverted index** instead of MySQL `FULLTEXT`         | FR-020 requires both languages to work; FR-027 forbids silently dropping short terms. Measured against this project's own database, `FULLTEXT` fails both in Arabic.                                                     | `FULLTEXT` needs `innodb_ft_min_token_size` — a global server variable requiring a restart and a full index rebuild, which no migration can express and a managed MySQL may refuse — and even then cannot match across the `ال` definite article, for which MySQL offers no fix. The `ngram` parser trades relevance for coverage. `LIKE` cannot rank. An external engine is infrastructure for a corpus of hundreds. **The measurements are in research.md D1**, and if a later phase's corpus outgrows this, the swap is behind two functions. |
| **Six new tables**                                                                 | Articles, their categories, their search index, guides, guide steps, and the ticket↔article attachment the automation action needs                                                                                       | Each is a distinct entity in the spec's Key Entities. The merges available were considered: guides as a flag on articles makes every article query exclude containers (D9); the term index as a JSON column on the article cannot be range-scanned, which is the entire point of it; article↔ticket as a JSON list on the ticket makes "which tickets reference this article?" unanswerable.                                                                                                        |
| **A second unauthenticated surface**                                               | Clarifications Q1, and Phase 5's Out of Scope, which assigned deflection before a conversation to this phase                                                                                                             | Deferring it to Phase 8 leaves a PLAN.md scope bullet unmet and orphans deflection between two phases each believing the other owns it. The risk is bounded by construction rather than by review: read-only (FR-032b), no caller-supplied visibility (D7), indistinguishable absence (FR-032c), slugs not ids (D10), and its own rate-limit scopes.                                                                                              |

### Changed during planning

Recorded because each was a decision forced by reading existing code or measuring the database, not a
preference, and the next phase will meet the consequences.

| Planned in the spec                                                          | Will be built                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Full-text search" (PLAN.md scope bullet)                                    | **An application-owned token index**, not MySQL full-text                                                         | Measured, not assumed: `FULLTEXT` drops the two-letter Arabic word `رف` and cannot match `كتاب` against `الكتاب` in either direction. See D1 for the measurement table. The scope bullet is met — the mechanism is not the one the words imply.                                                                                              |
| FR-049 "count how many times each article has been read"                     | **Public reads are counted best-effort, outside the response path**                                               | On the public surface, an unauthenticated GET that writes on every view is a denial-of-service amplifier aimed at the one surface strangers can reach. A dropped count is a statistic; a database saturated by page views is an outage. FR-050 is unaffected — nothing identifying the reader was going to be stored either way.               |
| —                                                                            | **`kb_articles.slug`**, stable after first publish                                                                | FR-033 makes articles linkable and the public surface makes those links external. Sequential ids in public URLs enumerate the corpus and disclose its size; a slug that follows the title breaks every link already sent the first time a typo is fixed (D10).                                                                                |
| —                                                                            | **`kb_categories.ticket_category`**                                                                               | Clarifications Q2 gave the KB its own taxonomy, so FR-040 cannot compare categories for equality and needs the relationship stated. Stating it once per category rather than per article is the cheaper true thing (D6).                                                                                                                     |

### Changed during implementation

Recorded because each was forced by the code rather than chosen, and the next phase will meet the
consequences. Following the Phase 5 and 6 precedent.

| Planned                                                                          | Built                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /knowledge/categories` gated `kb:manage` (contracts/knowledge-api.md)        | **Reading categories needs only a session; writing needs `kb:manage`**                                 | FR-010 makes filing mandatory, so the article editor must offer the category list — and every Agent authors. Gating the read on `kb:manage` would have made authoring impossible for the role the phase most wants writing. The same reasoning that kept `kb:read` out of the catalog entirely.                                                                                                                            |
| Three public endpoints, `/kb/categories` returning categories                     | **`/kb/categories` returns the whole browse tree** — categories with their published articles          | SC-007 requires every published article to be REACHABLE by browsing. A category list with no way into it is a dead end, and adding a fourth public endpoint would have widened the attack surface this phase spent its design keeping narrow. The corpus is small by construction, so the whole tree is a few dozen rows.                                                                                                     |
| "Add deflection to Phase 5's form component" (T075)                               | **A hosted form page at `/help/contact`, inside the help centre**                                      | Phase 5 built the public form as an API for embedding elsewhere; there is no form component in this application to add deflection to. FR-033 needs a route from an article to a person regardless, so the form lives where the unauthenticated visitor already is. Phase 5's submission endpoint is untouched.                                                                                                              |
| `SearchOptions.boosts`, keyed by article id                                       | **`SearchOptions.categoryBoosts`, keyed by KB category id**                                            | Caught by T048. The suggestion service populated the map with CATEGORY ids while `search` looked them up by ARTICLE id, so every lookup missed, every multiplier was 1, and the FR-040 boost did nothing — **while the code read as though it worked.** Renaming the field makes the key part of its name.                                                                                                                    |
| The pipeline order in contracts/search-contract.md (strip `ال` before segmenting) | **Segment first, then apply the word-level steps**                                                     | The contract describes the steps as they apply to a WORD, and stripping a leading definite article is inherently word-initial. Same pipeline, expressed where the word boundaries are actually known. Both exported functions still call one internal implementation, which is the property that matters.                                                                                                                    |
| A `publicShell` decision was not anticipated                                      | **`App.vue` gained one branch, driven by route meta**                                                  | The help centre must render outside the authenticated shell — no user menu, no navigation into signed-in areas. `App.vue` had wrapped every route in `DefaultLayout` unconditionally since Phase 0. Driven by `meta.publicShell` rather than a `/help` path prefix, so a later public surface opts in deliberately.                                                                                                          |
| `http.get(path)`                                                                  | **`http.get(path, { signal })`**                                                                       | Search-as-you-type has several requests in flight and they do not return in order. Without cancellation, a slow response for "car" lands after a fast one for "card reader" and overwrites it — the reader watches their results become wrong as they finish typing, which reads as the search being broken.                                                                                                                 |

#### A test corrected rather than the code

`backend/tests/search/ranking.test.ts` originally asserted that an article matching all three query
terms in its body outranks one with a query term in its TITLE. It does not, and should not: the
field weight is 10 and deliberately lopsided, because a title is a claim about what the whole
document is for. The test now asserts the case research D3 actually names — a long article
containing ONE query word against a short one containing all of them — plus a second test stating
the title-versus-body trade explicitly, so a corpus review (T097) that disagrees changes
`FIELD_WEIGHTS` rather than adding a special case.

The same happened twice in the suggestion tests: fixtures that sat below `MINIMUM_SCORE` and were
correctly excluded. The floor was doing its job; the fixtures were wrong. Both now clear the floor,
with a comment saying why, so neither test passes for the wrong reason.

### Non-violations worth recording

- **`lib/text-normalise.ts` outside `services/`** is not a new layer. It is pure text arithmetic
  reading no business rules, beside `business-hours.ts`, `phone.ts` and `clock.ts`.
- **No `kb:read` permission key.** Reading published articles rides on being signed in (FR-053). A
  key every role holds unconditionally cannot refuse anything — the reasoning that kept
  `notifications:view`, `timeline:view` and `sla:view` out of Phases 4, 5 and 6.
- **Allowing a one-language article** is not a Principle I exception. Principle I governs the
  interface, which stays fully bilingual; Phase 4 set the content precedent with one-language
  templates, and FR-005a keeps the promise that a reader is always told what they are being handed.
- **Article content carrying its own direction** is not the per-component direction flipping
  Principle I prohibits. Principle I forbids components overriding a shared document root; an
  Arabic article inside an English interface is content whose direction is a property of the text,
  exactly as Phase 5 argued for the chat widget on a foreign page.

## Phase closeout

**PLAN.md Phase 7 Definition of done** — _"An agent or customer can find a relevant article by
searching, and the system proactively suggests one on a matching ticket."_

| Clause                            | Delivered by                                                                       | Verified by                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| "An agent … can find"             | `kb-search.service` + the search box on the ticket screen                          | `backend/tests/search/`, including the Arabic table                 |
| "or customer"                     | The public help centre (D7), read-only and visibility-filtered in the service      | `backend/tests/public/` — asserting what it CANNOT reach            |
| "a relevant article by searching" | `text-normalise` + weighted ranking (D2, D3)                                       | Ranking and determinism tests; SC-008's two-agents-same-order       |
| "proactively suggests one"        | `kb-suggestion.service`, computed on read from the ticket's own text (D5)          | `backend/tests/knowledge/suggestion`, including the empty-panel floor |

**What the automated suite will not verify**, and is therefore owed to `quickstart.md`:

- **Whether the search is actually good.** The tests prove specific Arabic cases match and that
  ordering is deterministic; they cannot prove the results are the ones a person wanted. That needs
  a real corpus and a human reading the top five.
- **Whether the suggestion floor is set right.** Too low and the panel is noise; too high and it is
  always empty. Both pass every test. This wants tuning against real tickets (research, open
  question 1).
- Arabic long-form reading by eye: an article body in RTL with mixed Latin technical terms inside it.
- Screen-reader navigation of an article's heading structure and of a guide's sequence.
- The public help centre on a phone, which is the device a customer looking for help is holding.

**Carried into Phase 8.** The portal inherits a knowledge base in which some articles exist in one
language only (Clarifications Q3) and must not present that as a page that failed to load. It also
inherits the public help centre: Phase 8 should decide deliberately whether the authenticated portal
replaces it, wraps it, or sits beside it, rather than growing a second reading view.

**Carried into Phase 9.** Suggestion is deterministic and word-based on purpose (D2 declines
stemming, D3 declines TF-IDF). Phase 9's AI work is where semantic matching belongs, and it should
replace the ranking function behind `kb-search.service` rather than adding a second suggestion path
beside it.

**Carried into Phase 10.** Read counts are a total, not a time series (D11). Reporting must not
mistake the counter for history, and if trends are wanted the events table is Phase 10's to design.

**Carried into Phase 12.** The category taxonomy and the help centre are both global. Departments
will reopen whether either should be scoped, and `kb_categories.ticket_category` is the first place
that question will bite.

## Outstanding from earlier phases

- **Constitution amendment — Phase 6's, still unsigned.** `specs/007-phase-6-sla-automation/
  constitution-amendment.md` strikes the resolved "SLA targets before Phase 6" Open Item and asks for
  the messaging-provider Open Item to be recorded. It has been through no approval, and this phase
  does not touch it.
- **Constitution Open Item — messaging provider selection.** Still unrecorded. Phase 7 adds no
  consumer of it.
- **Phase 6 carried forward**: T136–T141, the by-eye greyscale, RTL, screen-reader, quickstart,
  real-transport, and calendar-confirmation passes. Unfinished, and not absorbed here — this phase
  adds its own equivalents rather than closing Phase 6's.
- **Phase 4 and Phase 5 carried forward**: their own manual passes remain open.
- Remaining Open Items (ERP identity for Phase 11, AI provider for Phase 9, branding for Phase 12)
  are untouched. **The AI provider decision becomes due next phase but one**, and D2/D3's deliberate
  refusal to guess at semantics is what keeps that decision clean.
