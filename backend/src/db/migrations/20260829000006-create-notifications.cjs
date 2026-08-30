'use strict';

/**
 * Notifications — the first thing in this project that reaches a user who did
 * not ask (Phase 4, research.md D2).
 *
 * THERE IS NO MESSAGE COLUMN, AND NONE IS TO BE ADDED. The row carries a type
 * and the identifiers; the client composes the sentence from ar.json / en.json.
 * Two reasons, both structural rather than stylistic:
 *
 *   1. The same row may be read by an Arabic user and an English one, so the
 *      language cannot be decided at write time.
 *   2. Constitution Principle I forbids a hardcoded string anywhere.
 *
 * Actor and subject details are joined at READ time, so a renamed or
 * deactivated actor still reads correctly.
 *
 * The row is written BEFORE anything is emitted to the stream (FR-047). The
 * row is the truth; the stream is an accelerant. That is what makes a dropped
 * connection cost latency and never a notification.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notifications', {
      // BIGINT: this table grows with activity, not with user count. `id` is
      // also the client's `since` cursor after a reconnect.
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // THE RECIPIENT — the only user who may read this row (FR-051).
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // ticket.assigned | note.mentioned | task.reminder | ticket.due_soon
      type: { type: Sequelize.STRING(40), allowNull: false },
      // Null for system-generated notifications (task.reminder,
      // ticket.due_soon) — nobody caused them.
      actor_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // Subject references. Nullable because each type uses a different one.
      // A merged ticket_id is resolved through the merge chain at READ time
      // (FR-052) — storing the survivor here would be wrong, because the merge
      // may not have happened yet.
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      task_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tasks', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      note_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'ticket_notes', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // Serves both the unread count and the unread list.
    await queryInterface.addIndex('notifications', ['user_id', 'read_at'], {
      name: 'notifications_user_read',
    });
    // Paging, newest first. `id` rather than `created_at` as the tiebreaker,
    // for the second-precision reason ticket_history documents.
    await queryInterface.addIndex('notifications', ['user_id', 'id'], {
      name: 'notifications_user_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notifications');
  },
};
