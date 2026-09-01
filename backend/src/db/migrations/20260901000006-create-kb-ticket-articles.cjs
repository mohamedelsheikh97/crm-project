'use strict';

/**
 * An article DELIBERATELY attached to a ticket (Phase 7).
 *
 * THIS IS NOT WHERE SUGGESTIONS LIVE, and confusing the two would undo FR-042.
 * Suggestions are computed on read and never stored (research D5): a stored
 * suggestion goes stale the moment an article is archived, and nothing would
 * notice. This table holds only decisions — an agent pinning an article, or a
 * rule acting.
 *
 * `attached_by_user_id` NULL MEANS AN AUTOMATION RULE DID IT. That is the
 * Phase 5 and 6 convention for a system act, and the reason those phases made
 * their actor columns nullable in the first place. It is also what lets the
 * interface tell "a colleague pinned this" from "a rule did", which are
 * different things to an agent reading the panel.
 *
 * The composite primary key makes attaching the same article twice a no-op
 * rather than a duplicate — a double-click is not an error worth refusing.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_ticket_articles', {
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      article_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'kb_articles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      attached_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('kb_ticket_articles');
  },
};
