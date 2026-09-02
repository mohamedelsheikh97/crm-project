'use strict';

/**
 * The link from an escalated ticket back to the conversation that produced it
 * (Phase 9, research.md D5).
 *
 * NULLABLE, AND NULL IS THE OVERWHELMING DEFAULT — the same shape as Phase 8's
 * `requesting_contact_id`. It exists so the ticket view can show FR-036b's
 * provenance without a reverse lookup, and so Phase 10 can report on
 * assistant-originated tickets.
 *
 * NO BACKFILL MIGRATION, unlike Phase 8's `requesting_contact_id`. There is no
 * historical truth to recover: no ticket created before this phase came from an
 * assistant, so every existing row is already correct at NULL. Phase 8 needed a
 * backfill because the association it added had always been true and merely
 * unrecorded; this one had never been true.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'assistant_conversation_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'assistant_conversations', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tickets', 'assistant_conversation_id');
  },
};
