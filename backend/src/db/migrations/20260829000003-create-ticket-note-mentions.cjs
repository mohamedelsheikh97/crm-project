'use strict';

/**
 * Who a note named (Phase 4, research.md D5).
 *
 * A TABLE rather than a parse of the body, for three reasons:
 *
 *   1. The UNIQUE constraint below IS FR-039. Mentioning the same person twice
 *      in one note cannot produce two notifications, because it cannot produce
 *      two rows. That is a database guarantee, not dedupe logic somebody has
 *      to remember to write.
 *   2. "Who was mentioned" becomes queryable without parsing text.
 *   3. FR-037's refusal becomes a real check against a real user, resolved at
 *      composition time.
 *
 * Rows survive the mentioned user's deactivation (FR-035) — hence RESTRICT.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_note_mentions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      note_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'ticket_notes', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // THIS CONSTRAINT IS FR-039. Do not remove it in favour of application-side
    // deduplication.
    await queryInterface.addIndex('ticket_note_mentions', ['note_id', 'user_id'], {
      name: 'ticket_note_mentions_note_user',
      unique: true,
    });
    // "Which notes mentioned me" — not used by a screen in this phase, but it
    // is the access path any future mention inbox would take, and it costs one
    // index on a narrow table.
    await queryInterface.addIndex('ticket_note_mentions', ['user_id'], {
      name: 'ticket_note_mentions_user',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_note_mentions');
  },
};
