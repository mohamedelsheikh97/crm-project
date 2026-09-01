# Phase 1 Data Model: Phase 7 — Knowledge Base

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01

Six new tables. No existing table is altered — a first since Phase 2, and a consequence of the fact
that an article belongs to nobody: there is no customer or ticket to hang a column on.

Everything is MySQL 8.4, `utf8mb4_0900_ai_ci`, `INT UNSIGNED` surrogate keys, `created_at` /
`updated_at` in snake_case, migrations named `20260901NNNNNN-*.cjs` — the conventions Phases 0–6
established without exception.

Where a column exists to make a requirement structurally true rather than merely checked, the reason
is written beside it. Those comments belong in the migration and the model, not only here.

---

## `kb_categories`

The knowledge base's own filing structure (Clarifications Q2), separate from Phase 3's ticket
categories.

| Column            | Type                                        | Notes                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | `INT UNSIGNED PK AI`                        |                                                                                                                                                                                                                                                                                                                                                                          |
| `name_en`         | `VARCHAR(120) NULL`                         | At least one of the two is required, enforced in the service. Stored per language rather than as an i18n key because an administrator creates these at runtime and cannot add keys to a locale file (FR-012).                                                                                                                                                             |
| `name_ar`         | `VARCHAR(120) NULL`                         |                                                                                                                                                                                                                                                                                                                                                                          |
| `slug`            | `VARCHAR(140) NOT NULL`                     | Public URLs address a category by slug, for the reason articles do (D10).                                                                                                                                                                                                                                                                                                |
| `ticket_category` | `VARCHAR(30) NULL`                          | **The stated KB↔ticket relationship FR-040 requires** (D6). Null means "relates to no particular ticket category", which is the honest answer for a category like "Getting started". Validated against `TICKET_CATEGORIES` in the service, not by an ENUM, so adding a ticket category needs no migration here. A BOOST, never a filter — a technical article can answer a billing ticket. |
| `position`        | `SMALLINT UNSIGNED NOT NULL DEFAULT 0`      | Browse order is an editorial decision, not alphabetical accident.                                                                                                                                                                                                                                                                                                        |
| `version`         | `INT UNSIGNED NOT NULL DEFAULT 0`           | Optimistic locking, per the Phase 2 precedent.                                                                                                                                                                                                                                                                                                                           |

**Unique**: `(slug)`. **Index**: `(position, id)`.

**FLAT, NOT A TREE** (spec Assumptions). No `parent_id`. A help centre needing three levels of
hierarchy on its first day has a content problem rather than a software one, and a self-join is an
additive migration if that turns out to be wrong.

**NO DESTROY PATH while articles reference it.** FR-015 forbids orphaning an article; the service
refuses to delete a category that still holds one and says which.

## `kb_articles`

| Column               | Type                                                | Notes                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | `INT UNSIGNED PK AI`                                |                                                                                                                                                                                                                                                                                                                          |
| `category_id`        | `INT UNSIGNED NOT NULL`                             | FK `kb_categories`, `ON DELETE RESTRICT`. **NOT NULL is FR-010**: an article that can only be found by search is one nobody can browse to, so filing is mandatory rather than encouraged.                                                                                                                                  |
| `slug`               | `VARCHAR(180) NOT NULL`                             | Derived from the title at FIRST PUBLISH and **stable thereafter** (D10). Sequential ids in public URLs enumerate the corpus; a slug that tracks the title breaks every link already sent the first time a typo is fixed.                                                                                                   |
| `title_en`           | `VARCHAR(200) NULL`                                 | Phase 4's `reply_templates` shape, reused deliberately (D8): one logical item, optionally present in two languages. At least one full pair — title AND body in the same language — is required to publish (FR-005).                                                                                                        |
| `title_ar`           | `VARCHAR(200) NULL`                                 |                                                                                                                                                                                                                                                                                                                          |
| `body_en`            | `MEDIUMTEXT NULL`                                   | `MEDIUMTEXT` rather than `TEXT`: a long procedure with examples passes 64KB more easily than it looks, and hitting that ceiling truncates a customer's instructions silently.                                                                                                                                             |
| `body_ar`            | `MEDIUMTEXT NULL`                                   |                                                                                                                                                                                                                                                                                                                          |
| `status`             | `ENUM('draft','published','archived') NOT NULL DEFAULT 'draft'` | **Draft by default is FR-004.** An article is not visible because somebody published it, not because it was created.                                                                                                                                                                                          |
| `audience`           | `ENUM('internal','customer') NOT NULL DEFAULT 'internal'`       | **Internal by default**, deliberately: the safe default for content that has not been considered is "colleagues only". Making it customer-visible is a decision (FR-031).                                                                                                                                       |
| `published_at`       | `DATETIME NULL`                                     | FR-006. Null until first publish; NOT cleared by archiving, because "when did this go live" stays true.                                                                                                                                                                                                                   |
| `published_by_user_id` | `INT UNSIGNED NULL`                               | FK `users`, `ON DELETE SET NULL`.                                                                                                                                                                                                                                                                                        |
| `created_by_user_id` | `INT UNSIGNED NULL`                                 | FK `users`, `ON DELETE SET NULL`.                                                                                                                                                                                                                                                                                        |
| `updated_by_user_id` | `INT UNSIGNED NULL`                                 | FK `users`, `ON DELETE SET NULL`. FR-048 — "when was this last touched, and by whom" is the whole of the stewardship view.                                                                                                                                                                                                |
| `view_count`         | `INT UNSIGNED NOT NULL DEFAULT 0`                   | **A COUNTER, NEVER AN EVENT TABLE** (D11). FR-050 forbids storing anything identifying the reader, and a counter cannot accidentally grow an IP column the first time somebody wants a trend. Phase 10 owns trends and can design its own thing.                                                                            |
| `version`            | `INT UNSIGNED NOT NULL DEFAULT 0`                   |                                                                                                                                                                                                                                                                                                                          |

**Unique**: `(slug)`. **Indexes**: `(status, audience)` — the visibility predicate every reader query
starts from; `(category_id, status)`; `(updated_at)` for the stewardship view.

**NO DESTROY PATH.** FR-007: archiving removes an article from every reader surface WITHOUT
destroying it, and an archived article is restorable. There is no delete method, endpoint, or
interface control, for the same reason customers and tickets have none.

**NO VERSION HISTORY** (spec Assumptions). An edit replaces the text and the audit log records who
did it. That is a stated limitation rather than an oversight; adding history later is a new table,
not a change to this one.

## `kb_article_terms`

The search index (D1). The reason this phase does not use MySQL full-text.

| Column       | Type                            | Notes                                                                                                                                                                                                          |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `article_id` | `INT UNSIGNED NOT NULL`         | FK `kb_articles`, `ON DELETE CASCADE`. Deleting the article takes its index with it, which is the one place cascade is exactly right.                                                                            |
| `term`       | `VARCHAR(64) NOT NULL`          | A NORMALISED token from `lib/text-normalise.ts` — never raw text. The same function produces these and parses a query, which is what makes them meet (D2).                                                       |
| `lang`       | `ENUM('en','ar') NOT NULL`      | Which language's content produced this token. Lets a query prefer its own language and makes FR-029's cross-language near-miss a second query rather than a heuristic.                                            |
| `field`      | `ENUM('title','body') NOT NULL` | The weight input for ranking (D3). Title 10, body 1 — what stops an article that mentions a word once outranking the article named after it.                                                                     |
| `hits`       | `SMALLINT UNSIGNED NOT NULL`    | Occurrences within that field. A small signal, capped so a word repeated fifty times cannot dominate.                                                                                                            |

**Primary key**: `(article_id, lang, field, term)`. **Index**: `(term, lang)` — the one the search
range-scans, and the reason this table exists rather than a JSON column.

**ONLY PUBLISHED ARTICLES HAVE ROWS HERE** (D4). Drafting writes none; archiving deletes them;
publishing rebuilds them. FR-004 and FR-018 are therefore structural: no query can reach an
unpublished article however it is written, because there is nothing to reach.

**REBUILT, NOT DIFFED, IN THE WRITING TRANSACTION.** An index that can disagree with its article is
worse than no index, because the disagreement is invisible.

## `kb_guides`

A guide is an ordered series of articles on one subject (Clarifications Q2).

| Column      | Type                                   | Notes                                                                          |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| `id`        | `INT UNSIGNED PK AI`                   |                                                                                |
| `title_en`  | `VARCHAR(200) NULL`                    | At least one required, as with categories.                                      |
| `title_ar`  | `VARCHAR(200) NULL`                    |                                                                                |
| `slug`      | `VARCHAR(180) NOT NULL`                |                                                                                |
| `audience`  | `ENUM('internal','customer') NOT NULL DEFAULT 'internal'` | Internal by default, matching articles.                     |
| `position`  | `SMALLINT UNSIGNED NOT NULL DEFAULT 0` |                                                                                |
| `version`   | `INT UNSIGNED NOT NULL DEFAULT 0`      |                                                                                |

**Unique**: `(slug)`.

**A guide has no status of its own.** FR-011d says a guide with no reader-visible articles is not
offered, which is derived from its steps rather than stored — a stored flag would go stale the
moment a step was archived.

## `kb_guide_steps`

| Column       | Type                                   | Notes                                                                                                                       |
| ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `guide_id`   | `INT UNSIGNED NOT NULL`                | FK `kb_guides`, `ON DELETE CASCADE`.                                                                                        |
| `article_id` | `INT UNSIGNED NOT NULL`                | FK `kb_articles`, `ON DELETE CASCADE`.                                                                                      |
| `position`   | `SMALLINT UNSIGNED NOT NULL`           | The order the reader works through. Authored, not computed (spec Assumptions) — there is no prerequisite graph and no branching. |

**Primary key**: `(guide_id, article_id)` — an article appears at most once in a guide.
**Index**: `(guide_id, position)`.

**A JOIN, NOT A KIND OF ARTICLE** (D9). The article is unaware it is in a guide, stays in its
category, and may appear in several guides — which is FR-011b true by construction. Modelling a
guide as a special article would force every article query in the system to exclude containers.

## `kb_ticket_articles`

What the automation action attaches to, and what "pin this article to the ticket" writes.

| Column               | Type                                                | Notes                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket_id`          | `INT UNSIGNED NOT NULL`                             | FK `tickets`, `ON DELETE CASCADE`.                                                                                                                                                        |
| `article_id`         | `INT UNSIGNED NOT NULL`                             | FK `kb_articles`, `ON DELETE CASCADE`.                                                                                                                                                    |
| `attached_by_user_id` | `INT UNSIGNED NULL`                                | FK `users`, `ON DELETE SET NULL`. **NULL means an automation rule did it** — the Phase 5 and 6 convention for a system act, and the reason those columns were made nullable in Phase 5.    |
| `created_at`         | `DATETIME NOT NULL`                                 |                                                                                                                                                                                           |

**Primary key**: `(ticket_id, article_id)`. Attaching the same article twice is a no-op rather than a
duplicate.

**THIS IS NOT WHERE SUGGESTIONS LIVE.** Suggestions are computed on read and never stored (D5,
FR-042); this table holds only DELIBERATE attachments — an agent pinning one, or a rule acting. The
distinction matters: a stored suggestion goes stale the moment an article is archived, and an
attachment is a decision somebody made.

---

## Additions to existing declarations

### `auth/permissions.ts` — three new keys

```
define('kb', 'author')    // create, edit, read drafts
define('kb', 'publish')   // publish, archive, restore
define('kb', 'manage')    // categories and guides
```

**Authoring and publishing are split** because publishing is the only quality gate this content has.
"May write a draft" is a reasonable grant for an agent who has just solved something; "may put words
in front of customers in the organisation's name" is a different authority — the same reasoning that
separated `messages:send` from `ticket_notes:create` in Phase 5.

**No `kb:read` key.** Reading published articles rides on being signed in (FR-053) — the reasoning
that kept `notifications:view` out of Phase 4's catalog, `timeline:view` out of Phase 5's, and
`sla:view` out of Phase 6's.

### `automation/catalog.ts` — one new action

```
{ key: 'suggest_article', nameKey: 'automation.action.suggestArticle',
  params: [{ key: 'articleId', kind: 'articleId', required: true }] }
```

Phase 6's catalog comment predicted this exactly: _"`suggest_article` — Phase 7. One entry here plus
one executor branch."_ The executor branch writes `kb_ticket_articles` with a null
`attached_by_user_id`, and FR-047 falls out of the existing failure path — a named article that is
gone fails with a recorded reason, exactly as an assignment to a deactivated user does.

### `services/audit.service.ts` — new actions

```
KB_ARTICLE_CREATED / _UPDATED / _PUBLISHED / _ARCHIVED / _RESTORED
KB_CATEGORY_CHANGED
KB_GUIDE_CHANGED
```

FR-009: article content is organisational speech, and changes to it are answerable. Reads are NOT
audited — the view counter is the record, and auditing every public page view would flood the log an
investigator reads, which is the failure Phase 4 avoided when it declined to audit ordinary note
activity.

---

## Seeded data

| Seeder                                | Contents                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260901000001-kb-permissions.cjs`   | `kb:author` to Agent — the person who just solved something is the person who should write it down. `kb:publish` and `kb:manage` to Supervisor and Administrator. Agents author; supervisors decide what goes live. |

**No categories, no articles, and no guides are seeded.** A knowledge base's content is entirely the
organisation's, and inventing a taxonomy for them would be guessing at their business. FR-057 and
SC-013 are what make that safe: every surface reads as "nothing here yet" rather than as broken.

---

## State transitions

### An article

```
(none) ── created ──────────▶ draft        no index rows; invisible everywhere
draft  ── published ────────▶ published    index built; slug fixed; published_at set
published ── edited ────────▶ published    index REBUILT in the same transaction
published ── archived ──────▶ archived     index rows deleted; article retained
archived ── restored ───────▶ published    index rebuilt; published_at unchanged
draft  ── archived ─────────▶ archived     abandoning a draft without destroying it
```

`published_at` is set once and never cleared: "when did this first go live" stays true through an
archive and restore, and FR-048's stewardship view depends on being able to tell a long-standing
article from a newly published one.

**There is no `deleted`.** FR-007.

### The search index

```
article published ──▶ tokenize(title, body) per language ──▶ rows written
article edited     ──▶ rows deleted, rows rewritten          (same transaction)
article archived   ──▶ rows deleted
article restored   ──▶ rows rewritten
category changed   ──▶ nothing (category is not indexed text)
```

The index is a pure function of the article's published content. Nothing else writes to it, and
nothing reads it for an article that is not published — which is why FR-018 needs no check.
