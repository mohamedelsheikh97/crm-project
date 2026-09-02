'use strict';

/**
 * One customer-to-bot exchange (Phase 9, research.md D5).
 *
 * NOT A `messages` ROW, and the reasons are all written down in earlier phases.
 *
 * Phase 5 kept the timeline CORRESPONDENCE-ONLY and said in writing that this
 * is what would make it safe for Phase 8 to build a customer window on. Phase
 * 8's spec then relied on exactly that. A pre-ticket exchange with a bot is not
 * correspondence with the organisation, and putting it in `messages` would
 * retroactively break the property two phases were built on.
 *
 * `messages` also requires a `ticket_id`, and this record exists precisely in
 * the window BEFORE there is a ticket — for most conversations, permanently:
 * SC-015 targets 30% deflection, so the majority are answered and thrown away.
 * Modelling them as ticket messages would need a provisional ticket per
 * question, which is the opposite of deflection.
 *
 * `UNIQUE(ticket_id)` IS WHAT MAKES FR-036c TRUE. Escalating twice is a
 * duplicate-key violation, not a race a check-then-insert can lose. A customer
 * who keeps typing after escalation continues the same conversation against the
 * same ticket, and the service translates the violation into "already
 * escalated" — the pattern Phase 8's satisfaction service established.
 *
 * ONE IDENTITY, NEVER TWO. Exactly one of `portal_account_id` and
 * `anon_token_hash` is set, and never a `users.id`: the realm separation Phase
 * 8 built holds here unchanged.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('assistant_conversations', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      portal_account_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'portal_accounts', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Hashed, never the raw token — the same treatment Phase 8 gives an
      // invitation token, and for the same reason: possession of the value is
      // the credential.
      anon_token_hash: { type: Sequelize.CHAR(64), allowNull: true },
      // The conversation's CONTENT language, fixed at the first message
      // (research D9). Not the reader's interface locale.
      lang: { type: Sequelize.ENUM('ar', 'en'), allowNull: false },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        unique: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      escalated_at: { type: Sequelize.DATE, allowNull: true },
      last_activity_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('assistant_conversations', ['portal_account_id'], {
      name: 'assistant_conversations_account_idx',
    });

    await queryInterface.addIndex('assistant_conversations', ['anon_token_hash'], {
      name: 'assistant_conversations_anon_idx',
    });

    // Unescalated conversations are disposable; this is what a pruning job
    // would read. The ones that mattered became tickets.
    await queryInterface.addIndex('assistant_conversations', ['last_activity_at'], {
      name: 'assistant_conversations_activity_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('assistant_conversations');
  },
};
