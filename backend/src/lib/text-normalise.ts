/**
 * Text normalisation and tokenisation for the knowledge base search index
 * (Phase 7, research D1 and D2, contracts/search-contract.md).
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * MySQL's own full-text index was measured against this project's database —
 * 8.4.11, `utf8mb4_0900_ai_ci`, default settings — and returned ZERO matches
 * for a query for a word against a row holding that same word with the Arabic
 * definite article attached, in both directions, and zero for a real two-letter
 * Arabic word. The first has NO configuration fix. The second needs a global
 * server variable, a restart, and a full index rebuild — unexpressible in a
 * migration and possibly refused outright by a managed MySQL. Those are FR-020
 * and FR-027 failing, so the matching is ours.
 *
 * THE ONE RULE THIS FILE ENFORCES ABOVE ALL OTHERS: `normaliseForIndex` and
 * `normaliseQuery` run THE SAME PIPELINE. Normalising indexed text by one set
 * of rules and a query by another produces a word findable by nobody, and the
 * failure is invisible to any reviewer who does not read Arabic. That is why
 * both are thin wrappers over `pipeline` below rather than two implementations
 * that happen to agree today, and why a test asserts they agree on every case.
 *
 * PURE. No database, no configuration, no clock. Which is the point: a function
 * whose correctness most reviewers cannot spot-check by reading it must be
 * provable by running it — see backend/tests/search/text-normalise.test.ts.
 *
 * IF A FUTURE PHASE REPLACES THIS with a real search engine, the seam is this
 * file plus `search()` in kb-search.service.ts. Nothing above them knows how
 * matching works.
 */

/** A normalised token with its occurrence count, for ranking. */
export interface Token {
  term: string;
  /** Occurrences of this term in the input, before any cap is applied. */
  hits: number;
}

/**
 * `kb_article_terms.term` is VARCHAR(64). Truncating rather than dropping keeps
 * an absurdly long token findable by its first 64 characters, which is better
 * than losing it — and the same truncation happens to a query token, so the two
 * still meet.
 */
const MAX_TERM_LENGTH = 64;

/**
 * FR-027. The platform's floor of three is exactly what silently loses ordinary
 * Arabic words, so the floor here is two. One-character tokens are dropped:
 * they match nearly everything and rank nothing.
 */
const MIN_TERM_LENGTH = 2;

/**
 * Harakat (the short-vowel and gemination marks) and tatweel.
 *
 * Diacritics are OPTIONAL in written Arabic — the same word appears with and
 * without them depending on who typed it and how carefully. Tatweel is a
 * decorative stretch inserted for justification and carries no meaning at all.
 * Neither should make two spellings of one word into two different tokens.
 *
 * U+064B–U+0652 is the standard mark block; U+0640 is tatweel; U+0670 is the
 * superscript alef, which behaves the same way.
 */
// Written as escapes rather than as literal characters. Combining marks are
// invisible in a source file — several of these render as nothing at all, or
// attach themselves to the bracket beside them — so a literal class here is a
// thing no reviewer can verify and no editor displays reliably.
const MARKS = /[\u064B-\u0652\u0640\u0670]/gu;

/**
 * Orthographic folding: the same word, spelled differently.
 *
 * Readers do not intend these differences and mostly do not notice making them
 * — a hamza left off an alef, a final ya written without dots, a ta marbuta
 * typed as a ha. Folding them is what makes a search behave the way a person
 * expects rather than the way a byte comparison does.
 *
 * NOT STEMMING. See the note at the foot of this file: this collapses spellings
 * of one word, never different words onto one root.
 */
const FOLDINGS: ReadonlyArray<readonly [RegExp, string]> = [
  // Alef with hamza above / below, madda, and wasla all fold to a bare alef.
  [/[\u0623\u0625\u0622\u0671]/gu, '\u0627'],
  // Ta marbuta to ha: the ordinary way people type a feminine ending.
  [/\u0629/gu, '\u0647'],
  // Alef maqsura to ya.
  [/\u0649/gu, '\u064A'],
  // Waw and ya carrying hamza fold to their bare forms.
  [/\u0624/gu, '\u0648'],
  [/\u0626/gu, '\u064A'],
];

/** The Arabic definite article. */
const DEFINITE_ARTICLE = '\u0627\u0644';

/**
 * Steps 1-3 of the pipeline, applied to the whole string before it is split.
 *
 * NFKC first so two encodings of one character become one — a composed and a
 * decomposed form must not become two tokens. Lowercase after, for Latin.
 */
function foldCharacters(text: string): string {
  let folded = text.normalize('NFKC').toLowerCase();

  folded = folded.replace(MARKS, '');

  for (const [pattern, replacement] of FOLDINGS) {
    folded = folded.replace(pattern, replacement);
  }

  return folded;
}

/**
 * THE SPECIFIC FAILURE research D1 MEASURED.
 *
 * Arabic attaches its definite article to the front of the word rather than
 * standing it separately, so a reader searching for a word will not match the
 * same word written with it, and vice versa. MySQL cannot be configured out of
 * this; nothing in its stopword or minimum-token machinery touches it.
 *
 * THE LENGTH GUARD IS NOT DECORATION. Without it the article itself becomes an
 * empty token, and a genuine two-letter word beginning with those two letters
 * is destroyed entirely. Requiring at least MIN_TERM_LENGTH characters to
 * REMAIN means a word is only ever shortened when there is still a word left.
 */
function stripDefiniteArticle(token: string): string {
  if (!token.startsWith(DEFINITE_ARTICLE)) return token;

  const remainder = token.slice(DEFINITE_ARTICLE.length);

  return remainder.length >= MIN_TERM_LENGTH ? remainder : token;
}

/**
 * `Intl.Segmenter` rather than a regex, and this is the one step where a
 * library genuinely does better.
 *
 * Word boundaries are not spaces in every script, and the Unicode segmentation
 * algorithm knows things a character class does not. It is built into Node 22,
 * so using it costs no dependency (research D2).
 *
 * Constructed once: a Segmenter is not cheap to build, and this runs over every
 * article body on every publish.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * The whole pipeline, in one place, called by BOTH exported functions.
 *
 * A note on ordering. contracts/search-contract.md lists "strip a leading
 * definite article" before segmentation, because it describes the steps as they
 * apply to a WORD. Stripping is inherently word-initial, so the implementation
 * segments first and applies the word-level steps to each token — the same
 * pipeline, expressed where the word boundaries are actually known.
 */
function pipeline(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const terms: string[] = [];

  for (const segment of segmenter.segment(foldCharacters(text))) {
    // Punctuation, whitespace, and symbols segment out here rather than being
    // stripped by a character class that would have to guess at every script.
    if (!segment.isWordLike) continue;

    const term = stripDefiniteArticle(segment.segment).slice(0, MAX_TERM_LENGTH);

    if (term.length < MIN_TERM_LENGTH) continue;

    terms.push(term);
  }

  return terms;
}

/**
 * Tokens for INDEXING, with occurrence counts.
 *
 * The count feeds ranking (research D3). It is deliberately NOT capped here —
 * the cap belongs to the indexer, which is the layer that knows what the
 * database column can hold, and a test on this function should be able to see
 * the true count.
 */
export function normaliseForIndex(text: string): Token[] {
  const counts = new Map<string, number>();

  for (const term of pipeline(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts].map(([term, hits]) => ({ term, hits }));
}

/**
 * Tokens for QUERYING, deduplicated and in the order the reader typed them.
 *
 * Order is preserved because the ranking function reports which of the reader's
 * own terms matched; a set would lose that. Duplicates are dropped because
 * typing a word twice is not a stronger request for it.
 */
export function normaliseQuery(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of pipeline(text)) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

/**
 * WHAT THIS FILE DELIBERATELY DOES NOT DO, stated so a later phase adds it on
 * purpose rather than assuming it was forgotten:
 *
 *   - NO STEMMING. Arabic root-and-pattern morphology cannot be handled by
 *     rules of this size, and a wrong stem conflates unrelated words. That is a
 *     false positive the reader cannot detect — strictly worse than a miss they
 *     can see and rephrase around. Semantic matching is Phase 9's.
 *
 *   - NO STOPWORD REMOVAL. MySQL's own list is English-only, and removing "the"
 *     from a query about "The Sims" is a bug rather than an optimisation. The
 *     ranking function's fraction-matched multiplier already discounts common
 *     words in practice, without ever making one unsearchable.
 *
 *   - NO TRANSLITERATION between scripts. Matching a Latin spelling to an
 *     Arabic one is a guess, and guessing across scripts produces confident
 *     nonsense — the worst failure mode a search can have.
 */
