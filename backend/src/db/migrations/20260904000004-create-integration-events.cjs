'use strict';

/**
 * The transactional outbox (Phase 11, FR-026, FR-029 - FR-032, research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ROW IS WRITTEN INSIDE THE TRANSACTION THAT CAUSED IT. THAT IS THE DESIGN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The two failure modes are asymmetric and both matter:
 *
 *   - Write the event BEFORE commit and the transaction rolls back: a webhook
 *     fires for something that did not happen. The receiver creates a record for
 *     a ticket that does not exist, and no later event ever corrects it.
 *   - Write the event AFTER commit, in a separate step, and the process dies in
 *     between: the change happened and nobody is ever told. FR-030 and SC-013
 *     both forbid losing an event.
 *
 * Writing it inside the transaction makes both impossible: the event exists
 * exactly when the change does. Everything after that point is delivery, which
 * is allowed to fail and be retried.
 *
 * `occurred_at` IS MILLISECOND PRECISION while most of this schema is
 * second-precision, and that is not tidiness. FR-032 tells receivers to order
 * events by occurrence time because delivery order is not guaranteed — and two
 * events for one ticket inside a second are ordinary (a status change that
 * triggers an automation rule, for instance). Second precision would make that
 * instruction unfollowable in exactly the case where ordering matters most.
 *
 * `payload` IS STORED, NOT RECOMPUTED AT DELIVERY. A retry twelve hours later
 * must deliver what happened, not what is true now; recomputing would mean the
 * retry of a "ticket resolved" event describing a ticket that has since been
 * reopened.
 *
 * IT CARRIES IDENTIFIERS AND METADATA ONLY (FR-028). No ticket subject or body,
 * no customer name, no message text, no reporting figure. A notification goes to
 * an address a person typed into a form; if that address is wrong or is later
 * taken over, a payload of identifiers is an inconvenience while a payload of
 * record content is a disclosure. A test asserts this against a fixture whose
 * subject and customer name are distinctive strings, so it is a search rather
 * than a review.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('integration_events', {
      // BIGINT: one row per lifecycle event across the whole system, forever
      // until pruned. INT UNSIGNED would be enough for a long time and this is
      // the one table where running out would be an outage rather than an
      // inconvenience.
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      /**
       * The stable identifier a receiver deduplicates on (FR-031).
       *
       * Generated once and NEVER regenerated: a retry and an administrator's
       * manual re-send both carry the original, which is what lets a receiver
       * tell a repeat from a new event.
       */
      event_key: { type: Sequelize.CHAR(36), allowNull: false, unique: true },
      event_type: { type: Sequelize.STRING(60), allowNull: false },
      subject_type: { type: Sequelize.STRING(30), allowNull: false },
      subject_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      // Millisecond precision — see the note above. MySQL needs the precision
      // stated explicitly; a bare DATE truncates to the second.
      occurred_at: { type: 'DATETIME(3)', allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The delivery sweep reads in creation order; the retention prune reads the
    // same column from the other end.
    await queryInterface.addIndex('integration_events', ['created_at'], {
      name: 'integration_events_created',
    });

    // The overview answers "what happened to this ticket?" without a scan.
    await queryInterface.addIndex('integration_events', ['subject_type', 'subject_id'], {
      name: 'integration_events_subject',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('integration_events');
  },
};
