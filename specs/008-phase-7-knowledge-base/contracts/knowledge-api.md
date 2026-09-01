# Contract: Knowledge Base API

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01

Two surfaces with different rules. The authenticated one follows every convention Phases 1–6 fixed
and does not restate them: JWT verified by middleware, permission checked server-side by the route's
guard, validation errors as `{ errors: [{ field, message }] }` with `message` an i18n key,
optimistic locking via `version`, `409` on a stale version, `404` where a permission would otherwise
disclose existence, audit inside the same transaction as the change.

**The public one follows different rules, and they are stated in full below.** That is the point of
keeping it in one file.

---

## Authenticated — `/api/knowledge`

### Articles

Guard: `kb:author` for reading and writing drafts; `kb:publish` for the lifecycle transitions.

| Method   | Path                    | Guard        | Purpose                                            |
| -------- | ----------------------- | ------------ | -------------------------------------------------- |
| `GET`    | `/articles`             | signed in    | List, filterable by status, category, and audience. |
| `POST`   | `/articles`             | `kb:author`  | Create. **Always a draft** (FR-004).                |
| `GET`    | `/articles/:id`         | signed in\*  | One article, including both languages.              |
| `PATCH`  | `/articles/:id`         | `kb:author`  | Edit. Requires `version`.                           |
| `POST`   | `/articles/:id/publish` | `kb:publish` | FR-006.                                             |
| `POST`   | `/articles/:id/archive` | `kb:publish` | FR-007.                                             |
| `POST`   | `/articles/:id/restore` | `kb:publish` | Archived → published.                               |

\* A **draft** is visible only to `kb:author` holders. Reading a *published* article needs no
permission beyond being signed in (FR-053) — which is why there is no `kb:read` key.

**There is no `DELETE`.** FR-007: archiving removes an article from every reader surface without
destroying it. The absent route needs no explanation beyond the tooltip
`kb.articles.noDeleteReason`.

```json
{
  "id": 12,
  "slug": "card-reader-keeps-rebooting",
  "categoryId": 3,
  "titleEn": "Card reader keeps rebooting",
  "titleAr": null,
  "bodyEn": "…",
  "bodyAr": null,
  "availableLanguages": ["en"],
  "status": "published",
  "audience": "customer",
  "publishedAt": "2026-09-01T09:00:00Z",
  "viewCount": 41,
  "updatedAt": "2026-09-01T09:00:00Z",
  "updatedBy": { "id": 4, "fullName": "Hala Ahmed" },
  "version": 2
}
```

`availableLanguages` is derived, not stored, and is the field FR-005a depends on: every surface that
lists or opens an article uses it to say what language the reader is being handed. It is the same
shape Phase 4 used for one-language reply templates.

**Publish validation** (FR-005): a full pair — title AND body in the same language — must exist.

- Neither pair complete → `kb.error.noCompleteLanguage`
- A title with no body, or a body with no title → `kb.error.incompletePair`
- No category → cannot happen; `categoryId` is `NOT NULL` (FR-010).

**Slug** is derived from the title at **first publish** and never changes (D10). Editing the title of
a published article leaves the slug alone, deliberately: every link already sent stays valid. The
response says so via `slugLockedAt`, so the interface can explain why the URL no longer matches the
title.

### Categories and guides

Guard: `kb:manage`.

| Method   | Path                         | Purpose                                                    |
| -------- | ---------------------------- | ---------------------------------------------------------- |
| `GET`    | `/categories`                | All, in `position` order, with article counts.             |
| `POST`   | `/categories`                | Create.                                                    |
| `PATCH`  | `/categories/:id`            | Edit, including `ticketCategory` and `position`.           |
| `DELETE` | `/categories/:id`            | **Refused while it holds articles** (FR-015).              |
| `GET`    | `/guides`                    | All, with their steps.                                     |
| `POST`   | `/guides`                    | Create.                                                    |
| `PATCH`  | `/guides/:id`                | Edit.                                                      |
| `PUT`    | `/guides/:id/steps`          | Replace the whole ordered sequence in one transaction.     |
| `DELETE` | `/guides/:id`                | Deletes the guide; the articles in it are untouched.       |

Deleting a category that still holds articles returns `409` with
`kb.error.categoryHasArticles` and **the count**, so the administrator is told what to do rather
than only that they cannot. FR-015 is the requirement; naming the obstacle is the difference between
a refusal and a dead end.

`PUT /guides/:id/steps` replaces the whole sequence because a guide's order is one editorial
decision. A partial reorder would leave two steps claiming one position.

### Search and suggestion

| Method | Path                                | Guard     | Purpose                                     |
| ------ | ----------------------------------- | --------- | ------------------------------------------- |
| `GET`  | `/search?q=&lang=&categoryId=`      | signed in | Agent-facing search (FR-017–FR-029).        |
| `GET`  | `/tickets/:id/suggestions`          | `tickets:view` | Suggested articles for a ticket (FR-037). |

```json
{
  "items": [
    {
      "articleId": 12,
      "slug": "card-reader-keeps-rebooting",
      "title": "Card reader keeps rebooting",
      "lang": "en",
      "excerpt": "…the reader power-cycles when the <em>card</em> is inserted…",
      "categoryName": "Hardware",
      "score": 41.5
    }
  ],
  "otherLanguage": { "lang": "ar", "count": 3 }
}
```

`otherLanguage` is FR-029: present only when the reader's own language returned nothing and the other
one has matches. It carries a **count, not the articles** — offering to look is not the same as
handing somebody content in a language they did not ask for.

`GET /tickets/:id/suggestions` is **its own request**, not part of the ticket payload — FR-045 says
suggestion must not delay the ticket screen, and the ticket is what the agent is waiting for.

An empty `items` with no `otherLanguage` is the honest answer for a ticket that matches nothing
(FR-041), and the interface must render it as "nothing to suggest" rather than as a loading state
that never resolves.

### Attaching an article to a ticket

| Method   | Path                                   | Guard          | Purpose                       |
| -------- | -------------------------------------- | -------------- | ----------------------------- |
| `POST`   | `/tickets/:id/articles`                | `tickets:update` | Pin an article to a ticket. |
| `DELETE` | `/tickets/:id/articles/:articleId`     | `tickets:update` | Unpin.                      |

Attaching the same article twice is a **no-op returning 200**, not a conflict — a double-click is not
an error worth refusing. The automation action (research D13) writes the same row with a null
`attachedByUserId`, which is how the interface tells "a colleague pinned this" from "a rule did".

---

## Public — `/api/public/kb`

**Three endpoints. Read-only. No session. This section is the whole of the phase's new attack
surface**, and it lives in `routes/public/index.ts` beside Phase 5's, because that file exists so a
reviewer can see the entire public surface at once (D7).

| Method | Path                     | Rate scope  | Purpose                          |
| ------ | ------------------------ | ----------- | -------------------------------- |
| `GET`  | `/kb/categories`         | `kb-read`   | Browse structure.                |
| `GET`  | `/kb/articles/:slug`     | `kb-read`   | Read one article.                |
| `GET`  | `/kb/search?q=&lang=`    | `kb-search` | Search (FR-032).                 |

### The rules this surface follows

1. **Visibility is a literal, not a parameter.** The controller calls the service with
   `audience: 'customer'` and `status: 'published'` hard-coded. There is no query parameter, header,
   or body field that can widen it (D7, FR-032c).
2. **Draft, archived, and non-existent are one answer.** All three return `404` with an identical
   body. A public reader cannot use response codes, timings, or messages to learn that an article
   exists but is not for them (FR-032c).
3. **Slugs, never ids** (D10). Sequential ids disclose the size of the corpus and let a stranger walk
   it.
4. **No input is accepted beyond a search string and a language.** No comments, no ratings, no
   corrections, no contact fields (FR-032b). This removes moderation, spam, and stored-injection
   from the phase.
5. **Its own rate-limit scopes**, so a flood of searches cannot exhaust the allowance for reading —
   the property Phase 5 built `rateLimit(scope, …)` for. `kb-search` is tighter than `kb-read`
   because it costs more.
6. **Nothing about customers, tickets, users, or configuration appears in any response** (FR-035).
   The article payload carries no author name, no internal category id, and no counts.
7. **Search results are capped, not paged** (research, open question 2). A public reader reaching
   page nine is enumerating, not searching.

```json
{
  "slug": "card-reader-keeps-rebooting",
  "title": "Card reader keeps rebooting",
  "body": "…",
  "lang": "en",
  "availableLanguages": ["en"],
  "category": { "slug": "hardware", "name": "Hardware" },
  "guide": { "slug": "setting-up-a-terminal", "position": 2, "total": 5 }
}
```

No `id`, no `viewCount`, no author, no `updatedAt`. `guide` is present only when the article is part
of one, and carries the reader's position so FR-011c works without a second request.

### Deflection

`GET /kb/search` is what the public form uses (FR-032d). Phase 5's form submission path is unchanged;
the form's interface calls search as the customer types a subject and offers matches **beside** the
submit control.

**It never blocks or delays submission** (FR-032e). The suggestions are advisory, the submit button
is always live, and a search that fails or times out leaves the form entirely usable. A customer who
wants a person gets one.

---

## What has no endpoint, deliberately

- **No article deletion.** FR-007; archiving is the removal.
- **No public "was this helpful?"** — Phase 8 owns satisfaction feedback, and two rating mechanisms
  in two phases would be two things to reconcile.
- **No bulk import or export.** Nobody has asked, and an import path is a second way to create
  content that bypasses the publish gate.
- **No "related articles" endpoint.** Articles are not linked to each other (spec Assumptions); what
  looks like a relationship here is the category and the guide.
- **No search suggestions or autocomplete.** It would need its own index and its own rate limit for a
  convenience nothing in the spec asks for.
