'use strict';

/**
 * The search index (Phase 7, research D1). THE REASON THIS PHASE DOES NOT USE
 * MYSQL FULL-TEXT.
 *
 * Measured against this project's own MySQL 8.4.11 with default settings, the
 * platform returns ZERO matches for all three of these:
 *
 *   - a query for a word, against a row holding that word with the Arabic
 *     definite article prefixed
 *   - the same in the other direction
 *   - a query for a real two-letter Arabic word
 *
 * The first two are the definite article, for which FULLTEXT has NO
 * configuration fix at all. The third is `innodb_ft_min_token_size = 3`, a
 * global server variable requiring a restart and a full index rebuild — not
 * something a migration can express, and something a managed MySQL may simply
 * refuse. Those are FR-020 and FR-027 failing, so the index is ours.
 *
 * `term` holds a NORMALISED token from `lib/text-normalise.ts` and never raw
 * text. The same function produces these rows and parses a query, which is the
 * whole of why they meet (research D2). Normalising at index time by one set of
 * rules and at query time by another produces a word findable by nobody, and it
 * is invisible to any reviewer who does not read Arabic.
 *
 * ONLY PUBLISHED ARTICLES HAVE ROWS HERE (research D4). Drafting writes none,
 * archiving deletes them, publishing rebuilds them. FR-004 and FR-018 are
 * therefore structural: no query can reach an unpublished article however it is
 * written, because there is nothing to reach.
 *
 * REBUILT, NOT DIFFED, IN THE WRITING TRANSACTION. An index that can disagree
 * with its article is worse than no index, because the disagreement is silent.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_article_terms', {
      // CASCADE, and this is the one place in the project where cascade is
      // exactly right: an index row has no meaning without its article.
      article_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'kb_articles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Which language's content produced this token. Lets a query prefer its
      // own language, and makes FR-029's cross-language near-miss a SECOND
      // QUERY rather than a heuristic.
      lang: { type: Sequelize.ENUM('en', 'ar'), allowNull: false, primaryKey: true },
      // The weight input for ranking (research D3). Title 10, body 1 — what
      // stops an article that mentions a word once outranking the article named
      // after it.
      field: { type: Sequelize.ENUM('title', 'body'), allowNull: false, primaryKey: true },
      term: { type: Sequelize.STRING(64), allowNull: false, primaryKey: true },
      // Occurrences within that field, capped by the indexer so a word repeated
      // fifty times cannot dominate a document that is about something else.
      hits: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
    });

    // THE INDEX THIS TABLE EXISTS FOR. A query normalises to a handful of
    // terms and range-scans this — which is the whole reason the tokens live in
    // rows rather than in a JSON column on the article.
    await queryInterface.addIndex('kb_article_terms', ['term', 'lang'], {
      name: 'kb_article_terms_lookup',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_article_terms', 'kb_article_terms_lookup');
    await queryInterface.dropTable('kb_article_terms');
  },
};
