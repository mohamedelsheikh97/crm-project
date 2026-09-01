'use strict';

/**
 * A customer's means of signing in (Phase 8, research.md D2).
 *
 * ONE ROW PER CONTACT, NOT PER CUSTOMER. The UNIQUE on
 * `customer_contact_id` makes that a schema fact rather than a service rule, so
 * two contacts on one company record are two independent accounts (FR-003a) and
 * neither can reach the other's tickets.
 *
 * THIS IS NOT A `users` ROW, and the distinction is the phase's central
 * security decision. A customer in `users` would appear in assignment pickers
 * and user lists, would need a `role_id`, and would count toward Phase 1's
 * last-administrator invariant. Portal capability comes from holding a portal
 * session, not from a permission grant — which is why there is no `role_id`
 * here and no customer entry in the permission catalog.
 *
 * NO `customer_id` COLUMN. The customer is the contact's customer, derived by
 * join. `timeline.service.ts` states the reasoning for messages and it holds
 * here: "a denormalised copy would be a second place for the truth to live,
 * which FR-019's customer merge would then have to keep in step." Phase 2's
 * merge moves contacts between customers; a copied `customer_id` would be a
 * second thing for it to update, and a stale one would point a portal account
 * at the wrong company.
 *
 * `failed_login_attempts` and `locked_until` MIRROR the two columns Phase 1 put
 * on `users` rather than sharing them. Mirroring two columns is smaller than
 * generalising an account abstraction across two realms whose only shared
 * behaviour is counting to a threshold — and sharing the columns would mean
 * sharing the table, which the paragraph above rejects.
 *
 * `session_epoch` is what makes withdrawal work on a REFRESH token. An access
 * token expires in 15 minutes and the per-request freshness read catches
 * `withdrawn` immediately; a refresh token lives seven days. Withdrawal
 * increments this, and a refresh token carrying an older value is refused
 * (FR-060, SC-031). Also incremented on credential reset and on the customer's
 * own "sign out everywhere".
 *
 * CASCADE from the contact, deliberately: FR-003b requires that removing the
 * contact ends the account rather than leaving it resolving to nothing.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('portal_accounts', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      customer_contact_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'customer_contacts', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Never recoverable, never returned, never logged (FR-004).
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      // A LOCKED account is `active` with `locked_until` in the future: lockout
      // is temporary and self-clearing, withdrawal is a decision somebody made.
      status: {
        type: Sequelize.ENUM('active', 'withdrawn'),
        allowNull: false,
        defaultValue: 'active',
      },
      failed_login_attempts: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      locked_until: { type: Sequelize.DATE, allowNull: true },
      session_epoch: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      // Who let them in. SET NULL so deactivating a staff member does not
      // delete the customer's access.
      invited_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      activated_at: { type: Sequelize.DATE, allowNull: false },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      // NULL means "not chosen yet", which is different from "English".
      preferred_language: { type: Sequelize.ENUM('ar', 'en'), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // THE INVARIANT, not an optimisation: one account per contact.
    await queryInterface.addIndex('portal_accounts', ['customer_contact_id'], {
      name: 'portal_accounts_contact_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('portal_accounts');
  },
};
