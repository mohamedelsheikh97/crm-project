'use strict';

/**
 * DATA ONLY. Associates existing tickets with the contact that raised them
 * (Phase 8, FR-026g, research.md D4).
 *
 * Clarifications Q2's fail-closed rule means every ticket that predates this
 * phase is invisible in the portal until something associates it. Most of them
 * can be associated without guessing, and this migration does exactly the ones
 * that can.
 *
 * THE CONDITION, and why it is a fact rather than a guess:
 * `messages.sender_identity_normalised` is written by the same normaliser that
 * wrote `customer_contacts.value_normalised` — `lib/phone.ts`, the single
 * normalisation site Phase 2 established. An exact match between those two
 * columns is therefore not a heuristic. It is the same value, twice.
 *
 * IT DECLINES RATHER THAN CHOOSING. Where a ticket's earliest inbound sender
 * matches TWO contacts on the record — the same address recorded twice, which
 * Phase 2's duplicate handling permits — the ticket is left NULL. A wrong
 * association here is a disclosure, not a cosmetic error, and "probably this
 * one" is not good enough for that. Tickets it cannot decide wait for a human
 * (FR-026h).
 *
 * NEVER OVERWRITES a non-NULL value, so it is idempotent: re-running it is a
 * no-op for everything it has already done, and it cannot undo a manual
 * association made after it ran.
 *
 * TICKETS WITH NO INBOUND MESSAGES — every ticket an agent typed — are
 * untouched by construction. There is nothing to match them against, and
 * inventing a requester for them is exactly what FR-026e forbids.
 *
 * THE DOWN MIGRATION clears only what this one could have set, identified by
 * the same deterministic condition. A backfill that cannot be undone cleanly
 * would make the column's introduction irreversible in practice, which is not
 * a property to hand the next person who needs to roll back.
 *
 * @type {import('sequelize-cli').Migration}
 */

/**
 * Tickets whose earliest inbound message's sender matches EXACTLY ONE contact
 * on that ticket's own customer.
 *
 * Written as one statement so the "exactly one" test and the assignment cannot
 * drift apart. The HAVING clause is the whole safety property.
 */
const MATCHES = `
  SELECT
    t.id                     AS ticket_id,
    MIN(cc.id)               AS contact_id,
    COUNT(DISTINCT cc.id)    AS contact_count
  FROM tickets t
  JOIN (
    SELECT ticket_id, MIN(id) AS message_id
    FROM messages
    WHERE direction = 'inbound'
      AND sender_identity_normalised IS NOT NULL
    GROUP BY ticket_id
  ) first_inbound ON first_inbound.ticket_id = t.id
  JOIN messages m ON m.id = first_inbound.message_id
  JOIN customer_contacts cc
    ON cc.customer_id = t.customer_id
   AND cc.value_normalised = m.sender_identity_normalised
  GROUP BY t.id
  HAVING contact_count = 1
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE tickets t
      JOIN (${MATCHES}) matched ON matched.ticket_id = t.id
      SET t.requesting_contact_id = matched.contact_id
      WHERE t.requesting_contact_id IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE tickets t
      JOIN (${MATCHES}) matched ON matched.ticket_id = t.id
      SET t.requesting_contact_id = NULL
      WHERE t.requesting_contact_id = matched.contact_id
    `);
  },
};
