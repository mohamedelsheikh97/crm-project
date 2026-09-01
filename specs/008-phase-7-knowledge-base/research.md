# Phase 0 Research: Phase 7 — Knowledge Base

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

Thirteen decisions. Each was forced by something already in the codebase or by a measured fact about
the database, and each is written so `/speckit-tasks` can be generated from it without reopening the
question.

The spec left three questions open and `/speckit-specify` closed all three (Clarifications Q1–Q3).
Nothing below reopens them; D7, D9 and D8 implement them.

---

## D1 — Search is an application-side token index, NOT MySQL full-text

**Decision**: articles are indexed into a `kb_article_terms` table by a tokenizer this project owns
(D2). Search matches normalised tokens against that table and ranks by weighted overlap (D3). MySQL
`FULLTEXT` is not used.

**Rationale**: this was measured, not assumed. Against the project's own database — MySQL 8.4.11,
`utf8mb4_0900_ai_ci`, default settings — a `FULLTEXT` index behaves as follows:

| Query                                  | Result       | Meaning                                    |
| -------------------------------------- | ------------ | ------------------------------------------ |
| `كتاب` against a row holding `الكتاب`  | **0 matches** | The definite article `ال` breaks matching  |
| `الكتاب` against a row holding `كتاب`  | **0 matches** | …in both directions                        |
| `رف` (a real 2-character Arabic word)  | **0 matches** | `innodb_ft_min_token_size` = 3 drops it    |
| `الكِتَابُ` with diacritics in the data | matches      | The `ai_ci` collation handles harakat free |
| `the`                                  | 0 matches    | English-only stopword list                 |

Two of those are disqualifying:

- **The 2-character problem violates FR-027 directly.** Many ordinary Arabic words are two letters.
  The only fix is `innodb_ft_min_token_size`, which is a **global server variable requiring a
  restart AND a full rebuild of every full-text index** — something the application cannot do, a
  managed MySQL may not permit, and no migration can express. Shipping a search that silently loses
  words unless an operator remembers a `my.cnf` line is not a search anybody can trust.
- **The `ال` problem has no configuration fix at all.** The definite article is pervasive in written
  Arabic; a reader typing `كتاب` must find `الكتاب`. MySQL offers no Arabic stemmer, and the `ngram`
  parser — designed for CJK — would substring-match everything and destroy relevance.

FR-020 makes both languages non-negotiable, so a search that works well in English and badly in
Arabic fails the requirement rather than merely disappointing.

**What we own instead is small.** An inverted index over normalised tokens is a keyword table plus a
ranking function, not a search engine — the same shape of decision as Phase 6's `business-hours.ts`:
a bounded, pure, exhaustively testable piece of logic in exchange for correctness the platform
cannot give us.

**Alternatives considered**:

- _`FULLTEXT` with `innodb_ft_min_token_size = 2`._ Fixes one of the two problems, cannot fix `ال`,
  and makes correctness depend on server configuration outside the repository.
- _`FULLTEXT` with the `ngram` parser._ Solves token length by abandoning word boundaries; every
  2-character substring becomes a token, so relevance collapses and the index balloons.
- _`LIKE '%term%'`._ Measured to find both `كتاب` and `الكتاب` (substring matching sidesteps the
  prefix problem), and it is what Phases 2–3 use — but it cannot rank, cannot weight title above
  body, and scans. FR-019 requires relevance ordering.
- _An external engine (Elasticsearch, Meilisearch)._ Correct and a new piece of infrastructure to
  run, back up, and keep in sync, for a corpus of hundreds of articles. The constitution's YAGNI rule
  refuses it at this size.

---

## D2 — The normaliser: what "the same word" means

**Decision**: `backend/src/lib/text-normalise.ts`, pure, no dependency. `normaliseForIndex(text)`
returns a token list, applying in order:

1. Unicode NFKC, then lowercase (affects Latin only).
2. **Strip Arabic diacritics** (harakat, U+064B–U+0652) and **tatweel** (U+0640). The collation
   already ignores harakat for comparison, but the index stores tokens rather than compares columns,
   so it must do this itself.
3. **Normalise orthographic variants**: `أ إ آ ٱ → ا`, `ة → ه`, `ى → ي`, `ؤ → و`, `ئ → ي`. These are
   the same word spelled differently, and readers do not intend the difference.
4. **Strip the definite article** `ال` when the remainder is at least two characters — the specific
   failure D1 measured.
5. Split on Unicode word boundaries; keep tokens of **two characters or more**, which is FR-027.

**Rationale**: every rule above corresponds to a way two spellings of one word fail to match. Doing
this at index time AND at query time with the same function is what makes them meet in the middle;
using it in one place only would be worse than not doing it.

**One deliberate omission: no stemming.** Arabic root-and-pattern morphology cannot be stemmed by
rules of this size, and a bad stemmer conflates unrelated words — which is worse than missing a
match, because the reader cannot tell it happened. Phase 9's AI work is where semantic matching
belongs.

**Alternatives considered**: an Arabic stemming library (a new dependency whose failure mode is
silent false positives); ICU tokenisation via `Intl.Segmenter` (available in Node 22 and useful for
word boundaries, but it does none of steps 2–4, which are the ones that matter here — it is used for
step 5 only).

---

## D3 — Ranking: weighted term overlap, deterministic by construction

**Decision**: score = Σ over matched query tokens of the field weight (title = 10, body = 1),
multiplied by the fraction of query tokens matched. Ties break by `updated_at DESC, id DESC`.

**Rationale**: FR-019 requires relevance ordering that is *deterministic for the same query and
content* — the property SC-008 tests by having two agents see the same order. A total ordering with
an explicit tiebreak gives that; "whatever the database returned" does not.

Title weighting is what stops an article that mentions a word once outranking the article named after
it. The fraction-matched multiplier is what stops a long article that happens to contain one query
word outranking a short one that contains all of them.

**Deliberately NOT TF-IDF or BM25.** Both need corpus statistics maintained across writes, and at
this corpus size they would change the ordering without measurably improving it — while making the
"why did this rank first?" question much harder to answer.

---

## D4 — The index is rebuilt on write, inside the writing transaction

**Decision**: saving an article deletes its `kb_article_terms` rows and reinserts them, in the same
transaction as the article write.

**Rationale**: an index that can disagree with the article is worse than no index, because the
disagreement is invisible. Same-transaction rebuild makes "article saved but not searchable" and
"searchable under its old text" both unrepresentable.

Rebuild-not-diff because an article body is a few kilobytes and the token set changes wholesale on
almost any edit; diffing would be more code for no benefit.

**Only PUBLISHED articles are indexed** — which is FR-004 and FR-018 made structural. A draft has no
rows, so no query can reach it however the search is written, and archiving deletes them.

---

## D5 — Suggestion is search, with the ticket as the query

**Decision**: `suggestForTicket` normalises the ticket's subject and description through the SAME
tokenizer, runs the SAME ranking, and applies a minimum-score floor plus a category boost (D6).

**Rationale**: FR-038 says suggestions come from the ticket's own text, and FR-043 says it must work
in Arabic. Both are already true of search, so a second matching implementation would be a second
thing to keep correct in two languages.

**The score floor is FR-041 and it matters more than the ranking.** A ticket whose text supports no
confident match must produce NO suggestions. A panel that always shows three articles teaches agents
that the panel means nothing; a panel that is often empty and occasionally right is one they read.

**Computed on read, never stored** (spec Assumptions): a stored suggestion goes stale the moment an
article is archived, which is FR-042.

---

## D6 — The KB↔ticket relationship is a per-category mapping

**Decision**: `kb_categories` carries an optional `ticket_category` column. Suggestion multiplies the
score of articles whose category maps to the ticket's category by a fixed boost.

**Rationale**: Clarifications Q2 gave the knowledge base its own taxonomy, which is right for
browsing and costs exactly this: FR-040 cannot compare categories for equality and needs a stated
relationship. Putting it on the CATEGORY rather than the article means an administrator states it
once per category instead of once per article, and an article filed correctly inherits it.

A boost rather than a filter, deliberately: a technical article can be the right answer to a billing
ticket, and a filter would make that unreachable. The boost expresses "prefer" (FR-040's word)
without expressing "only".

**Alternatives considered**: a many-to-many mapping table (more expressive, and nobody has asked to
map one KB category to two ticket categories); per-article tagging (states the same fact hundreds of
times); inferring from the words of the category name (guessing).

---

## D7 — The public help centre extends Phase 5's single public router

**Decision**: three new routes are added to `backend/src/routes/public/index.ts` — browse categories,
read an article, search — with their own rate-limit scopes (`kb-read`, `kb-search`).

**Rationale**: that file opens with a comment stating it exists so *"a reviewer looking at this file
can see the entire public attack surface at once"*, and calling it a standing instruction rather
than a description. This is the first phase to test that, and honouring it costs nothing.

Separate rate-limit scopes because Phase 5's `rateLimit(scope, ...)` was built so that *"a flood of
form submissions cannot exhaust the chat allowance"* (FR-100). Search is more expensive than reading
and gets its own, tighter allowance.

**THE PUBLIC SURFACE READS FROM A DIFFERENT QUERY THAN THE INTERNAL ONE** (FR-032c). It filters on
`status = 'published' AND audience = 'customer'` at the service layer rather than accepting a flag
from the caller — a public endpoint that takes "which articles" as a parameter is one signature
change away from leaking internal content.

---

## D8 — Bilingual content lives in four columns on one row

**Decision**: `title_en`, `title_ar`, `body_en`, `body_ar` on `kb_articles`, with at least one
language pair required to publish (Clarifications Q3).

**Rationale**: this is exactly `reply_templates`' shape from Phase 4, which solved the same problem —
one logical item, optionally present in two languages, with the available languages surfaced to the
reader (Phase 4 FR-070). Reusing the shape means the "which languages does this exist in?" logic and
its interface treatment are already familiar in this codebase.

**Alternatives considered**: a row per language (`kb_article_translations`), which is the textbook
answer and buys nothing here — there are exactly two languages, fixed by the constitution, and the
join would appear in every read path. If Phase 12 introduces a third language, that is the migration
to write then rather than the structure to carry now.

The index (D1) stores a `lang` column per token so a query can prefer its own language, and FR-029's
cross-language near-miss is a second query against the other language's tokens.

---

## D9 — A guide is an ordered join, not a kind of article

**Decision**: `kb_guides` plus `kb_guide_steps(guide_id, article_id, position)`. An article is
unaware it is in a guide and may be in several.

**Rationale**: Clarifications Q2 defined a guide as an ordered series of articles. Modelling it as a
join keeps FR-011b true by construction — an article stays in its category and can appear in more
than one guide — and keeps the article table free of a concept most articles do not participate in.

**Alternatives considered**: a self-referencing `parent_article_id` (makes a guide a special article,
so every article query has to exclude guide containers); an ordered array column (unqueryable, and
reordering rewrites the row).

---

## D10 — Public URLs address articles by slug, not id

**Decision**: `kb_articles.slug`, unique, derived from the title on first publish and stable
thereafter.

**Rationale**: the public surface is linkable — an agent sends a customer an article link, and
FR-033 requires a route from an article to raising a ticket. A sequential id in a public URL
enumerates the corpus and tells a stranger how many articles exist; a slug does not.

**Stable after first publish**, deliberately: a slug that follows the title breaks every link
somebody already sent the moment a typo is fixed.

---

## D11 — View counting stores a counter, not an event

**Decision**: an integer `view_count` on the article, incremented on read.

**Rationale**: FR-050 forbids recording anything identifying the reader, and FR-049 asks only "how
many times". A counter cannot accidentally become a tracking log; an events table would hold
timestamps and could grow an IP column the first time somebody wanted a trend. Phase 10 owns trends,
and can build its own thing then.

Incremented outside the read transaction and never blocking the response: a failed increment costs a
count, not a reader.

---

## D12 — Three permission keys, and one deliberate absence

**Decision**:

```
define('kb', 'author')    // create, edit, and read drafts
define('kb', 'publish')   // publish, archive, restore
define('kb', 'manage')    // categories and guides
```

**Rationale**: authoring and publishing are split because publish is the *only* quality gate this
content has (spec Overview) — "may write a draft" is a reasonable thing to grant an agent, and "may
put words in front of customers in the organisation's name" is not the same authority. That is the
same reasoning that separated `messages:send` from `ticket_notes:create` in Phase 5.

**There is deliberately NO `kb:read` key.** Reading published articles rides on being signed in, and
FR-053 says so. A permission every role holds unconditionally cannot refuse anything — the reasoning
that kept `notifications:view` out of Phase 4's catalog, `timeline:view` out of Phase 5's, and
`sla:view` out of Phase 6's.

---

## D13 — `suggest_article` is one catalog entry and one executor branch

**Decision**: add to `backend/src/automation/catalog.ts`:

```
{ key: 'suggest_article', nameKey: 'automation.action.suggestArticle',
  params: [{ key: 'articleId', kind: 'articleId', required: true }] }
```

and one branch in `automation-engine.service.ts` calling the KB service.

**Rationale**: Phase 6 wrote *"`suggest_article` — Phase 7. One entry here plus one executor
branch."* into the catalog's own comment. This is the phase that collects it, and the shape it
predicted turns out to be the shape that fits — which is the point of having written it down.

The action attaches an article to a ticket, so it needs somewhere to attach to: `kb_ticket_articles`
(D14 in the data model), which is also what the agent-facing "pin this article" affordance writes to.
FR-047 falls out of the executor's existing failure path — a named article that is gone fails with a
recorded reason, exactly as an assignment to a deactivated user does.

---

## Open questions carried into implementation

None blocking. Two things are deliberately left to `/speckit-tasks`:

1. **The exact title/body weights and the suggestion score floor** (D3, D5). The starting values are
   title 10 / body 1, and a floor of "at least two matched query tokens, or one that is rare". They
   are tuning constants that want a corpus to tune against, and they belong in one named place so
   tuning is a one-line change rather than an archaeology exercise.
2. **Whether the public search endpoint paginates or caps.** FR-026 requires it bounded; a hard cap
   of the top 20 with no paging is the starting point, because a public reader scrolling to page 9
   is enumerating rather than searching.
