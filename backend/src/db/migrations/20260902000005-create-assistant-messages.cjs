'use strict';

/**
 * The turns of a customer-to-bot exchange (Phase 9, research.md D5, D6).
 *
 * THE ONE TABLE IN THIS PHASE THAT STORES TEXT, and the exception is principled
 * rather than convenient. Clarifications Q3 chose metadata-only for AI
 * invocations; this is not an AI artefact record. It is what the organisation
 * SAID TO A CUSTOMER, retained on exactly the basis Phase 5 retains outbound
 * messages, and required by FR-043 so an administrator can read what was said
 * in the organisation's name.
 *
 * FR-065a is the reconciliation, and it is worth stating plainly because
 * reading FR-065 and FR-043 separately makes the spec look self-contradictory:
 * what is retained is retained because of WHAT IT IS, not because AI produced
 * it. A prompt assembled to summarise a ticket is a working artefact with no
 * independent existence. A sentence a customer read is not.
 *
 * `cited_article_ids` is a JSON id list rather than a join table on purpose. It
 * is display provenance for a message already sent, not a queryable
 * relationship — and an article later archived must not alter what the bot said
 * at the time. A foreign key would either block the archive or rewrite history.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('assistant_messages', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      conversation_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'assistant_conversations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: { type: Sequelize.ENUM('customer', 'assistant'), allowNull: false },
      body: { type: Sequelize.TEXT, allowNull: false },
      cited_article_ids: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('assistant_messages', ['conversation_id', 'id'], {
      name: 'assistant_messages_conversation_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('assistant_messages');
  },
};
