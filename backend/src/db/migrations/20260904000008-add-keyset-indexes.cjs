'use strict';

/**
 * The composite indexes keyset paging needs (Phase 11, FR-008, FR-009, SC-005).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEITHER OF THESE EXISTED. THAT IS THE FINDING WORTH RECORDING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 10 discovered `tickets` had no `created_at` index at all — every report
 * in that phase filters on it and nothing before had needed to — and added one.
 * This phase found the neighbouring gap: the published interface orders by
 * `(updated_at, id)`, and that pair is indexed on neither `tickets` nor
 * `customers`.
 *
 * Without it every page of every published list sorts the table. At the volumes
 * an integration synchronises — reading a whole collection, page by page — that
 * is the difference between a sync and a timeout.
 *
 * WHY `(updated_at, id)` AND NOT `updated_at` ALONE. Two reasons, and the second
 * is the one that bites:
 *
 *   - MySQL `DATETIME` is second-precision, so records updated in the same
 *     second have no defined order. `id` is the tiebreaker — the same reasoning
 *     `ticket.service.ts` already applies to its own sort.
 *   - Keyset paging's WHERE clause is `(updated_at, id) > (:u, :i)`, a
 *     tuple comparison. A single-column index cannot serve it without a filesort
 *     on the second column, which is most of what the index was for.
 *
 * WHY OFFSET PAGING COULD NOT SERVE FR-008 (research D2, and this is the reason
 * the phase needed a new mechanism rather than reusing the existing one):
 * insert a record while a client is paging and every later page shifts by one,
 * so one record is read twice and one is never read at all. For a screen that is
 * harmless — a human re-reading a row corrupts nothing. For a client
 * synchronising into another system's database, a skipped record is a customer
 * that silently does not exist over there.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('tickets', ['updated_at', 'id'], {
      name: 'tickets_keyset_updated',
    });

    await queryInterface.addIndex('customers', ['updated_at', 'id'], {
      name: 'customers_keyset_updated',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('tickets', 'tickets_keyset_updated');
    await queryInterface.removeIndex('customers', 'customers_keyset_updated');
  },
};
