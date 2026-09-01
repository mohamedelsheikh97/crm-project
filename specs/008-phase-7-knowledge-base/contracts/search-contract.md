# Contract: Tokenisation, Indexing, and Ranking

**Feature**: `008-phase-7-knowledge-base` | **Date**: 2026-09-01

This is the contract for the phase's hardest decision (research D1–D3): the project owns its search
because the database measurably cannot do it in Arabic.

Everything here is pure and testable without a database except where it says otherwise. That is the
point — a function whose correctness most reviewers cannot spot-check by reading it must be provable
by running it.

---

## Why this exists at all

Measured against this project's own MySQL 8.4.11, `utf8mb4_0900_ai_ci`, default settings:

| Query                                 | `FULLTEXT` result | Consequence                             |
| ------------------------------------- | ----------------- | --------------------------------------- |
| `كتاب` against a row holding `الكتاب` | 0 matches         | The `ال` prefix breaks matching         |
| `الكتاب` against a row holding `كتاب` | 0 matches         | …and in the other direction             |
| `رف` — a real 2-letter Arabic word    | 0 matches         | `innodb_ft_min_token_size = 3` drops it |
| `الكِتَابُ` with harakat in the data   | matches           | The collation handles diacritics free   |

The first three are FR-020 and FR-027 failing. The fourth is the one thing the platform gives us,
and the normaliser below does it anyway so the index does not depend on collation behaviour.

**If a future phase replaces this with a real search engine**, the seam is
`normaliseForIndex` + `search`. Nothing above them knows how matching works.

---

## `lib/text-normalise.ts`

```ts
/** A normalised token with its position, for ranking. */
export interface Token {
  term: string;
  /** Occurrences of this term in the input. */
  hits: number;
}

export function normaliseForIndex(text: string): Token[];
export function normaliseQuery(text: string): string[];
```

Both call the same internal pipeline. **They must, and a test asserts it**: normalising at index time
by one set of rules and at query time by another is the failure that makes a word findable by nobody,
and it is invisible to anyone who does not read Arabic.

### The pipeline, in order

| Step | Operation                                    | Why                                                                                                                                                                          |
| ---- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Unicode NFKC, then lowercase                 | Latin case folding, and canonical composition so two encodings of one character are one token.                                                                                |
| 2    | Strip harakat `U+064B–U+0652` and tatweel `U+0640` | Diacritics are optional in written Arabic — the same word appears with and without them. Tatweel is decoration inserted for justification and carries no meaning.       |
| 3    | Fold `أ إ آ ٱ → ا`, `ة → ه`, `ى → ي`, `ؤ → و`, `ئ → ي` | The same word spelled differently. Readers do not intend the difference and mostly do not notice making it.                                                       |
| 4    | Strip leading `ال` when ≥2 characters remain | **The specific failure measured above.** `الكتاب` and `كتاب` become one token. The length guard stops `ال` itself and two-letter words beginning `ال` from being destroyed. |
| 5    | Split on word boundaries via `Intl.Segmenter` | Built into Node 22, and correct for scripts whose boundaries are not spaces. This is the only step a library does better than a regex.                                        |
| 6    | Keep tokens of **length ≥ 2**                | FR-027. The platform's floor of 3 is what silently loses ordinary Arabic words.                                                                                              |

### What it deliberately does NOT do

- **No stemming.** Arabic root-and-pattern morphology cannot be handled by rules of this size, and a
  wrong stem conflates unrelated words — a false positive the reader cannot detect, which is worse
  than a miss they can see. Semantic matching is Phase 9's.
- **No stopword removal.** MySQL's list is English-only and removing "the" from a query about "The
  Sims" is a bug; the ranking's fraction-matched multiplier already discounts common words in
  practice.
- **No transliteration.** Matching `mohamed` to `محمد` is a guess, and guessing across scripts
  produces confident nonsense.

### Test obligations

A table-driven test over **the exact cases D1 measured**, because those are the cases the platform
gets wrong and therefore the ones a regression would silently reintroduce:

1. `كتاب` and `الكتاب` produce the same token.
2. `رف` (2 characters) survives; a 1-character token does not.
3. `الكِتَابُ` and `الكتاب` produce the same token.
4. `مُحَمَّد` and `محمد` produce the same token.
5. `أحمد`, `احمد`, `إحمد` produce the same token.
6. `ال` alone is not destroyed into nothing.
7. English is unaffected: `Reader`, `reader`, `READER` are one token.
8. `normaliseForIndex` and `normaliseQuery` agree on every case above.

---

## Indexing — `kb-search.service.ts`

```ts
export async function reindex(articleId: number, transaction: Transaction): Promise<void>;
export async function removeFromIndex(articleId: number, transaction: Transaction): Promise<void>;
```

**Rules, each of which makes a requirement structural rather than checked:**

1. **Only published articles are indexed.** `reindex` on a draft or archived article writes nothing
   and deletes any rows that exist. FR-004 and FR-018 then need no query-side check — there is
   nothing to find.
2. **The rebuild is in the caller's transaction.** Delete then insert. "Saved but not searchable" and
   "searchable under its old text" are both unrepresentable.
3. **Each language is indexed separately**, into rows carrying `lang`. A one-language article
   produces rows for that language only, which is what makes FR-029's cross-language near-miss a
   second query rather than a heuristic.
4. **Title and body are separate rows** with `field` set accordingly — the ranking input.
5. **`hits` is capped** at a small ceiling so a word repeated fifty times cannot dominate a document
   that is about something else.

---

## Searching

```ts
export interface SearchOptions {
  query: string;
  lang: 'en' | 'ar';
  audience: 'internal' | 'customer';   // decided by the CALLER's surface, never by the request
  categoryId?: number;
  limit?: number;
}

export interface SearchHit {
  articleId: number;
  score: number;
  /** Which language's content matched — shown to the reader (FR-005a). */
  lang: 'en' | 'ar';
  /** The fragment showing why it matched (FR-021). */
  excerpt: string;
}

export async function search(options: SearchOptions): Promise<SearchHit[]>;
```

### The ranking function (D3)

```
score(article) = ( Σ over matched query tokens of  weight(field) × min(hits, cap) )
                 × ( matchedTokens / totalQueryTokens )
```

with `weight(title) = 10`, `weight(body) = 1`.

- **The field weight** stops an article that mentions a word once outranking the article named after
  it.
- **The fraction-matched multiplier** stops a long article containing one query word outranking a
  short one containing all of them.
- **Ties break by `updated_at DESC, id DESC`** — a total ordering, which is what SC-008 tests when
  two agents open the same ticket and must see the same order. "Whatever the database returned" is
  not an ordering.

**Deliberately not TF-IDF or BM25.** Both need corpus statistics maintained across every write, and
at this corpus size they would reorder results without measurably improving them — while making
"why did this rank first?" much harder to answer. The weights live in one named constant so tuning
is a one-line change (research, open question 1).

### Visibility is the caller's, not the request's

`audience` is set by the surface that calls, never read from a query parameter (D7, FR-032c). The
public controller passes `'customer'` as a literal. A public endpoint that accepts "which articles"
as input is one signature change away from serving internal content, and that change would look
harmless in review.

### Cross-language near-miss (FR-029)

When a search in the reader's language returns nothing, the service runs the same query against the
other language's rows. If that finds anything, the result carries a flag saying so — the interface
offers "there are N articles in English" rather than reporting a flat absence. It does **not**
silently return them: handing somebody content in a language they did not ask for, without saying so,
is the thing FR-005a exists to prevent.

---

## Suggestion — `kb-suggestion.service.ts`

```ts
export async function suggestForTicket(ticketId: number): Promise<SearchHit[]>;
```

**It is `search`, with the ticket as the query** (D5):

1. Concatenate the ticket's subject and description.
2. Normalise through the same tokenizer — which is why FR-043's Arabic requirement costs nothing.
3. Rank with the same function.
4. **Boost** articles whose category's `ticket_category` matches the ticket's category (D6). A boost
   and not a filter: FR-040 says "prefer", and a technical article can be the right answer to a
   billing ticket.
5. **Apply the score floor, and return NOTHING when nothing clears it** (FR-041).
6. Cap at a small number, best first.

### The floor is the part that matters

A panel that always shows three articles teaches agents that the panel means nothing, and once they
have stopped reading it, improving the suggestions cannot bring them back. A panel that is often
empty and occasionally right is one they read.

Starting rule: **at least two matched query tokens**, or one token that appears in few articles.
Named constant, tuned against real tickets (research, open question 1).

### Never stored, always recomputed

FR-042: a stored suggestion goes stale the moment an article is archived. `kb_ticket_articles` holds
only DELIBERATE attachments — an agent pinning one, or a rule acting — which is a different fact.

---

## Test obligations this contract creates

Named here so `/speckit-tasks` cannot omit them:

1. **The Arabic table** above, on the tokenizer, as a pure unit test.
2. **Index/query agreement**: for every case in the table, an article containing the word is found by
   a query for its other spelling — end to end, through the database.
3. **Only published articles are reachable**: a draft and an archived article are unfindable by
   agent search, public search, browse, and suggestion. Four surfaces, one property.
4. **Determinism**: the same query over the same corpus returns the same order twice, and two
   different callers see the same order (SC-008).
5. **Title outranks body**: an article with the term in its title precedes one with the term buried
   in its body.
6. **The public surface cannot reach internal articles**, asserted by calling the public path
   directly with an internal article present — not by trusting the controller to pass the right
   literal.
7. **The suggestion floor holds**: a ticket with a two-word subject that matches nothing produces an
   EMPTY list, not a weak one.
8. **Cross-language near-miss** reports its finding rather than silently returning other-language
   content.
