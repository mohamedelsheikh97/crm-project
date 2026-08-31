'use strict';

/**
 * Where an SMS alert reaches a user (Phase 6, FR-072, FR-077, research.md D13).
 *
 * NAMED `alert_phone`, NOT `phone`, AND THE NAME IS THE POINT. This is not a
 * profile field, is never shown to a customer, and is not the beginning of a
 * contact directory. It exists because FR-072 requires SMS alerting and FR-077
 * requires a recipient with no reachable address to be SKIPPED rather than
 * failed — and a user record with no number at all is unreachable, which is a
 * different and worse thing than being skipped.
 *
 * Phase 12 should not inherit this as a general contact field. If a user
 * profile needs a phone number, that is a separate column with a separate
 * purpose.
 *
 * Normalised through lib/phone.ts on write, the same helper Phase 2 uses for
 * customer contacts, so one number written two ways is one number.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'alert_phone', {
      type: Sequelize.STRING(32),
      allowNull: true,
      after: 'full_name',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'alert_phone');
  },
};
