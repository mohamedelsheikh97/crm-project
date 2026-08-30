'use strict';

/**
 * Internal, colleague-to-colleague notes on a ticket (Phase 4, research.md D5).
 *
 * A SEPARATE TABLE from customer_notes, deliberately. Folding both into one
 * `notable_type`/`notable_id` table would be a speculative abstraction the
 * constitution prohibits, and the two sides carry genuinely different
 * permissions (notes:* against ticket_notes:*). Two small tables that say what
 * they are beat one that needs a discriminator to be read.
 *
 * INTERNAL means internal (FR-031). No customer-facing surface may read this
 * table in this or any later phase without a decision recorded in that phase's
 * spec. Phase 8 builds the customer portal; this note is one thing it must not
 * show.
 *
 * `body` stores `@[user:12]` mention tokens rather than display names. A stored
 * name goes stale on rename and misattributes after deactivation, which would
 * break FR-035 and FR-041.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_notes', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
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
      // RESTRICT, not CASCADE: deactivating a user must leave their notes
      // readable and attributed (FR-035). Nothing in this project deletes a
      // user, and this constraint is why that stays true.
      author_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      // Deliberately separate from updated_at, exactly as customer_notes does:
      // updated_at moves for any write, while edited_at means specifically
      // "a human changed what this says" (FR-033). A silently rewritten note
      // is worse than no note.
      edited_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('ticket_notes', ['ticket_id', 'created_at'], {
      name: 'ticket_notes_ticket_created',
    });
    // `id` tiebreaker for the second-precision DATETIME problem Phase 2 found
    // with customer notes: several notes routinely land in the same second.
    await queryInterface.addIndex('ticket_notes', ['ticket_id', 'id'], {
      name: 'ticket_notes_ticket_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_notes');
  },
};
