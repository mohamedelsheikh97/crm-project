'use strict';

/**
 * The ONLY way a portal account comes into existence (Phase 8, Clarifications
 * Q1, research.md D3).
 *
 * There is no self-registration. With it, the system would have to decide what
 * an unrecognised email address means — create a record, attach to an existing
 * one, or refuse — and every one of those answers is a way for an outsider to
 * claim a customer record. Phase 5 makes that worse than hypothetical: it
 * creates PROVISIONAL customer records automatically from inbound traffic, from
 * senders nobody has verified. Self-registration would let the sender of one
 * email become the portal identity of the record their email created.
 *
 * It also resolves the ambiguity Phase 2 made possible. Two customer records
 * may hold the same email address; an invitation names ONE CONTACT ROW ON ONE
 * RECORD, so the credential's target is decided by the person issuing it and
 * never inferred from an address (FR-003).
 *
 * `token_hash`, NOT the token. The emailed value is random, sent once, and
 * never stored — Phase 1's rule for secrets, applied to a secret that grants
 * account creation. A leaked copy of this table must not be a list of live
 * invitations. UNIQUE so a collision is a constraint violation rather than an
 * ambiguous match.
 *
 * USABLE means all three at once:
 *
 *   accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
 *
 * Anything else — including a hash matching nothing at all — raises ONE
 * IDENTICAL ERROR (FR-002c). Four causes, one answer, because distinguishing
 * them turns this endpoint into an oracle for which invitations exist.
 *
 * A STATELESS SIGNED INVITATION was the obvious cheaper design and cannot work:
 * FR-002c requires revocation, and a stateless token cannot be revoked without
 * a table — at which point the table is the design.
 *
 * ROWS ARE RETAINED after acceptance or revocation. They are the audit trail of
 * who let whom in.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('portal_invitations', {
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
      // SHA-256 hex of the emailed token. CHAR, not STRING: it is always 64.
      token_hash: { type: Sequelize.CHAR(64), allowNull: false },
      /**
       * WHY ONE TABLE HOLDS TWO THINGS.
       *
       * An invitation and a password reset are the same object: a one-time,
       * expiring, revocable, hashed token emailed to a named contact, redeemed
       * by setting a password. Every rule that matters is shared — single use,
       * uniform refusal, delivery only to the contact's own recorded address,
       * and never storing the token itself.
       *
       * A second table would have duplicated all of that, and duplicated code
       * that must refuse identically in four cases is where the fifth case that
       * refuses differently comes from. The `purpose` column is what the
       * acceptance path reads to decide whether it is creating an account or
       * replacing a password on one that exists.
       */
      purpose: {
        type: Sequelize.ENUM('invitation', 'password_reset'),
        allowNull: false,
        defaultValue: 'invitation',
      },
      /**
       * FR-002e requires every INVITATION to be attributable. Nullable only
       * because a password reset the customer requested themselves has no staff
       * actor — and inventing one would be a lie in the audit trail. The service
       * requires it for `purpose = 'invitation'`.
       */
      issued_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      // Non-NULL = spent (FR-002b). Single-use is enforced here, not by
      // deleting the row, because the row is the audit trail.
      accepted_at: { type: Sequelize.DATE, allowNull: true },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      revoked_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('portal_invitations', ['token_hash'], {
      name: 'portal_invitations_token_unique',
      unique: true,
    });

    // "Does this contact have an outstanding invitation?" is the question the
    // staff access screen asks for every contact on a record (FR-056).
    await queryInterface.addIndex('portal_invitations', ['customer_contact_id', 'accepted_at'], {
      name: 'portal_invitations_contact_accepted',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('portal_invitations');
  },
};
