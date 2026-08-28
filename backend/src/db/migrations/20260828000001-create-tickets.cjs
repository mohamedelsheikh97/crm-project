'use strict';

/**
 * The ticket table.
 *
 * NO `reference` COLUMN. data-model.md D5 called for `TKT-000123` as a stored
 * generated column derived from the primary key. MySQL forbids that outright —
 * a generated column expression may not refer to an AUTO_INCREMENT column — so
 * the reference is derived at read time instead, in backend/src/tickets/
 * reference.ts. That keeps the "derived from the PK" property the decision was
 * actually after, removes the window in which a row would exist without a
 * reference, and turns search-by-reference into an exact id lookup rather than
 * a string match.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tickets', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // RESTRICT is belt-and-braces: Phase 2 chose deactivation over deletion
      // precisely so this reference cannot dangle. There is no delete path to
      // restrict, and that is the point.
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      // Stored as taxonomy KEYS, never display labels — the interface renders
      // them through i18n (Constitution Principle I).
      category: { type: Sequelize.STRING(30), allowNull: false },
      priority: { type: Sequelize.STRING(20), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'new' },
      // Null means unassigned. RESTRICT so a user holding tickets cannot be
      // hard-deleted; users deactivate, they do not disappear.
      assignee_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // Non-null means merged: the ticket is a redirect and is unworkable by
      // every route (FR-042, FR-043). Chains resolve transitively (FR-045).
      merged_into_ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // The CURRENT escalation's reason. Every escalation ever made is in
      // ticket_history; this is only what is true now.
      escalation_reason: { type: Sequelize.TEXT, allowNull: true },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('tickets', ['customer_id'], { name: 'tickets_customer' });
    await queryInterface.addIndex('tickets', ['assignee_user_id'], { name: 'tickets_assignee' });
    await queryInterface.addIndex('tickets', ['status'], { name: 'tickets_status' });
    await queryInterface.addIndex('tickets', ['priority'], { name: 'tickets_priority' });
    // The common working list: open work, most urgent first.
    await queryInterface.addIndex('tickets', ['status', 'priority'], {
      name: 'tickets_status_priority',
    });
    await queryInterface.addIndex('tickets', ['merged_into_ticket_id'], {
      name: 'tickets_merged_into',
    });

    // NO DESTROY PATH. Tickets are merged or closed, never deleted. `merge`
    // emits record.deleted as the security-relevant fact while the row is
    // retained, so every reference to it stays valid.
  },

  async down(queryInterface) {
    // dropTable removes the foreign keys and the indexes with it. The Phase 1
    // failure — an index that could not be dropped because a constraint
    // depended on it — only arises when removing an index from a surviving
    // table, which this does not do.
    await queryInterface.dropTable('tickets');
  },
};
