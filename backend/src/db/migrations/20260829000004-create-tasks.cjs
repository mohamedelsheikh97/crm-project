'use strict';

/**
 * Personal follow-up commitments (Phase 4, research.md D9, Clarifications Q3).
 *
 * A task is owned by exactly one user and CANNOT be given to another. That was
 * a deliberate decision, not an omission: delegation already has a mechanism in
 * this system — Phase 3 ticket assignment — and PLAN.md does not name a second
 * one. The service takes `owner_user_id` from the session and never from the
 * request body, so "you cannot give someone a task" is enforced by the shape of
 * the code rather than by a validation rule somebody could forget.
 *
 * NO DESTROY PATH, consistent with every other record here. A task is completed
 * (completed_at set) or reopened (cleared). It is never deleted.
 *
 * `reminded_at` is what makes FR-063 true BY CONSTRUCTION. The sweep matches
 * `remind_at <= now AND reminded_at IS NULL` with NO LOWER BOUND, so a reminder
 * whose time passed while the process was down still fires on the next tick
 * after restart. There is no catch-up code path to forget to write.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tasks', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // Set from the session context. Never a request field.
      owner_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      title: { type: Sequelize.STRING(255), allowNull: false },
      due_at: { type: Sequelize.DATE, allowNull: true },
      remind_at: { type: Sequelize.DATE, allowNull: true },
      // NULL = the reminder has not fired. See the class comment.
      reminded_at: { type: Sequelize.DATE, allowNull: true },
      // NULL = outstanding. No status column, no delete path.
      completed_at: { type: Sequelize.DATE, allowNull: true },
      // At most one of these two is non-null — see the CHECK below.
      //
      // onUpdate is RESTRICT rather than the CASCADE used elsewhere, and it has
      // to be: MySQL refuses a CHECK constraint on a column whose foreign key
      // carries a referential action that rewrites it, and ON UPDATE CASCADE is
      // exactly that. Nothing is lost — these are auto-increment surrogate keys
      // that this project never updates, so the CASCADE was ceremonial. The
      // CHECK is not ceremonial (FR-056).
      //
      // A task linked to a ticket that is later merged is repointed at the
      // survivor by the merge service (FR-065), not by the database.
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // FR-056 in the schema as well as the service, so the invariant survives a
    // direct write. "A task is about one thing" is not a UI convenience.
    await queryInterface.sequelize.query(
      'ALTER TABLE `tasks` ADD CONSTRAINT `tasks_one_link` ' +
        'CHECK (`ticket_id` IS NULL OR `customer_id` IS NULL)',
    );

    // The dashboard's outstanding-tasks list.
    await queryInterface.addIndex('tasks', ['owner_user_id', 'completed_at'], {
      name: 'tasks_owner_open',
    });
    // The reminder sweep, which runs every 60 seconds.
    await queryInterface.addIndex('tasks', ['remind_at', 'reminded_at'], {
      name: 'tasks_remind',
    });
    // The merge repoint (FR-065) and the ticket screen's task list.
    await queryInterface.addIndex('tasks', ['ticket_id'], { name: 'tasks_ticket' });
    await queryInterface.addIndex('tasks', ['customer_id'], { name: 'tasks_customer' });
  },

  async down(queryInterface) {
    // The CHECK constraint goes with the table; dropping the table removes it.
    await queryInterface.dropTable('tasks');
  },
};
