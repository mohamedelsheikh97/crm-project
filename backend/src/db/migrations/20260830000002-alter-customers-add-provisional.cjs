'use strict';

/**
 * Customers the system created from an unrecognised sender (Phase 5,
 * Clarifications Q2, research.md D7, FR-014a-FR-014d).
 *
 * A FLAG, NOT A SECOND TABLE. A provisional customer is an ordinary customer in
 * every respect except that nobody has confirmed who it is. Keeping it in
 * `customers` means the Phase 4 queue, the context panel, the timeline, and
 * every existing query keep working untouched, and only the places that must
 * distinguish (FR-014b) look at this column. A separate "pending sender" table
 * would have made every one of those consumers learn about two kinds of
 * customer, and each of them would have had to remember.
 *
 * Existing rows are all FALSE, which is correct: a person created every
 * customer that exists before this migration runs.
 *
 * WORTH KNOWING: this makes `customers` the first table in the project that the
 * outside world can cause rows in. The defence is FR-020 (nothing is created
 * for a sender that was only ever refused) plus the per-channel intake rate
 * limit — not this column.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('customers', 'is_provisional', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Serves the "unconfirmed customers" review list an agent works through.
    await queryInterface.addIndex('customers', ['is_provisional'], {
      name: 'customers_is_provisional',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('customers', 'customers_is_provisional');
    await queryInterface.removeColumn('customers', 'is_provisional');
  },
};
