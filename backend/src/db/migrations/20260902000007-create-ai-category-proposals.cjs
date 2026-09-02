'use strict';

/**
 * A proposed ticket category, awaiting a human (Phase 9, Clarifications Q2).
 *
 * THIS TABLE SITS BESIDE `tickets.category`, NEVER IN IT. Classification never
 * writes the field. A human accepts the proposal, and the acceptance is the
 * write — through the existing Phase 3 ticket update path, so the audit entry
 * and history record are identical to a person typing it.
 *
 * WHY, because it is the phase's most consequential design decision: Phase 6's
 * automation conditions and SLA policy selection both key on `tickets.category`.
 * Applying a category automatically would let a probabilistic guess select the
 * SLA policy a ticket is measured against and fire rules written for a human's
 * decision — and the resulting breach or misroute would present as a Phase 6
 * bug, in code that had not changed.
 *
 * `UNIQUE(ticket_id)` MAKES FR-047 STRUCTURAL. One live proposal per ticket, so
 * a dismissed proposal cannot be re-proposed: the second insert is a
 * duplicate-key violation, which the service translates rather than checking
 * for first. Same reasoning as Phase 8's `ticket_satisfaction`.
 *
 * `category_at_proposal` exists for FR-049. If the ticket's category has changed
 * since the proposal was made, a human has decided in the meantime, and the
 * proposal is suppressed rather than shown as a correction to their judgement.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_category_proposals', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Validated against TICKET_CATEGORIES on write. A string rather than an
      // ENUM so the taxonomy stays owned by `tickets/taxonomy.ts` — one place,
      // as Phase 3 established.
      proposed: { type: Sequelize.STRING(30), allowNull: false },
      // For tuning and SC-010 reporting. NEVER gates display on its own: a
      // confidence number the interface reasons about would be a second
      // threshold to get wrong.
      confidence: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
      state: {
        type: Sequelize.ENUM('pending', 'accepted', 'dismissed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      resolved_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      // What the ticket's category was when this was proposed (FR-049).
      category_at_proposal: { type: Sequelize.STRING(30), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // SC-011: for any period, how many were proposed, accepted, dismissed.
    await queryInterface.addIndex('ai_category_proposals', ['state', 'created_at'], {
      name: 'ai_category_proposals_state_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_category_proposals');
  },
};
