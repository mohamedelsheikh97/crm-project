'use strict';

/**
 * A live conversation with a website visitor (Phase 5, research.md D14).
 *
 * `visitor_token` STORES A HASH, NOT THE TOKEN. It is a bearer capability:
 * whoever holds it can read and write one conversation. That makes it a
 * credential, and this project already decided how it treats credentials at
 * rest — a database read must not hand over live access. The value is compared
 * by hashing what the visitor presents, exactly as a password is.
 *
 * It is deliberately NOT a JWT. A token format that carries claims implies a
 * principal, and a website visitor is not one: they have no account, no role,
 * and no permissions. An opaque capability scoped to a single conversation is
 * the honest model, and revoking it is deleting a row (FR-075).
 *
 * `ticket_id` is nullable only between the session opening and the first
 * message. A visitor who opens the panel and closes it without typing has not
 * raised a ticket, and manufacturing one would fill the queue with silence.
 *
 * `locale` is what the widget renders in, and where its direction comes from.
 * It is stored per session because the widget sets its own direction rather
 * than inheriting one from a host page the organisation does not control
 * (FR-076).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('chat_sessions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // SHA-256 hex of the issued token. See the class comment.
      visitor_token: { type: Sequelize.CHAR(64), allowNull: false },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Whatever the visitor chose to tell us, which may be nothing (FR-069).
      visitor_name: { type: Sequelize.STRING(255), allowNull: true },
      visitor_identity: { type: Sequelize.STRING(255), allowNull: true },
      locale: { type: Sequelize.STRING(5), allowNull: false, defaultValue: 'en' },
      // open | ended
      state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'open' },
      last_seen_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The lookup on every visitor request, and the guarantee that one token
    // addresses one conversation.
    await queryInterface.addIndex('chat_sessions', ['visitor_token'], {
      name: 'chat_sessions_token',
      unique: true,
    });

    // The agent console: open conversations, most recently active first.
    await queryInterface.addIndex('chat_sessions', ['state', 'last_seen_at'], {
      name: 'chat_sessions_state',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('chat_sessions', 'chat_sessions_state');
    await queryInterface.removeIndex('chat_sessions', 'chat_sessions_token');
    await queryInterface.dropTable('chat_sessions');
  },
};
