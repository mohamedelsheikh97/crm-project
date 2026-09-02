'use strict';

/**
 * The similar-ticket term index (Phase 9, research.md D8).
 *
 * A DELIBERATE MIRROR of Phase 7's `kb_article_terms`, using the same
 * normalisation pipeline and the same fraction-matched ranking. Reusing the
 * shape rather than inventing one means the Arabic normalisation rules Phase 7
 * measured — the ones MySQL FULLTEXT could not handle — apply here for free.
 *
 * NO MODEL CALL IS INVOLVED IN THIS FEATURE, and the table is why. Every
 * property FR-051 to FR-055 asks for is better served by retrieval:
 * visibility becomes a WHERE clause rather than a post-filter (FR-052), the
 * result is deterministic enough for a test to assert exact ids, the empty case
 * is a score floor rather than a model that will produce something regardless
 * (FR-054), and it costs nothing per view.
 *
 * ONLY RESOLVED AND CLOSED TICKETS ARE INDEXED. FR-051 offers "resolved tickets
 * addressing a similar problem" — an open ticket has no resolution to learn
 * from, and suggesting one would point an agent at a colleague's unfinished
 * work as though it were an answer. Rows are written when a ticket reaches a
 * settled state and removed if it leaves one, so the index cannot outlive the
 * fact that made a ticket worth suggesting.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_terms', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      term: { type: Sequelize.STRING(64), allowNull: false },
      // `subject` outweighs `body` for the same reason `title` does in Phase 7:
      // a word in the subject is what the ticket is about, a word in the body
      // may be an aside.
      field: { type: Sequelize.ENUM('subject', 'body'), allowNull: false },
      hits: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      lang: { type: Sequelize.ENUM('ar', 'en'), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('ticket_terms', ['term', 'lang'], {
      name: 'ticket_terms_term_lang_idx',
    });

    await queryInterface.addIndex('ticket_terms', ['ticket_id'], {
      name: 'ticket_terms_ticket_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_terms');
  },
};
