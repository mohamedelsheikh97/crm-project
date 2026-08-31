'use strict';

/**
 * Tickets learn where they came from (Phase 5, research.md D9, FR-026).
 *
 * Two changes, and the second is the interesting one.
 *
 * `source` records the channel that created the ticket, or `manual` for one an
 * employee typed in. The default backfills every existing row correctly,
 * because before this phase a person created all of them.
 *
 * `created_by_user_id` becomes NULLABLE. A ticket the system created from an
 * inbound message has no human creator, and FR-026 requires it to be
 * distinguishable from one someone raised by hand. The alternative was a
 * seeded "system" user, which is worse than it looks: it appears in user lists
 * and assignment pickers, it needs a role and a password hash, and Phase 1's
 * last-administrator tests and Phase 4's ownership matrix would both have to
 * learn to ignore it. A null creator plus a source says the same thing without
 * inventing a person who does not exist.
 *
 * The pair is the test: `created_by_user_id IS NULL AND source <> 'manual'`
 * means the system raised it.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'source', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'manual',
    });

    await queryInterface.changeColumn('tickets', 'created_by_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });

    // Serves "which of these arrived on their own?", which is the question an
    // administrator asks when intake misbehaves.
    await queryInterface.addIndex('tickets', ['source'], { name: 'tickets_source' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('tickets', 'tickets_source');

    // REFUSE rather than corrupt. Restoring NOT NULL would need a value for
    // every system-created ticket, and there is no honest one — inventing a
    // creator is exactly what the `up` avoided. A deployment that has accepted
    // inbound mail cannot be rolled back past this point without deciding what
    // to do with those tickets, and that decision is not a migration's to make.
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM `tickets` WHERE `created_by_user_id` IS NULL',
    );

    if (Number(rows[0].count) > 0) {
      throw new Error(
        `Cannot revert: ${rows[0].count} ticket(s) have no creator because the system raised them. ` +
          'Reassign or remove them before rolling this migration back.',
      );
    }

    await queryInterface.changeColumn('tickets', 'created_by_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
    });

    await queryInterface.removeColumn('tickets', 'source');
  },
};
