'use strict';

/**
 * WHICH CONTACT RAISED THIS TICKET (Phase 8, Clarifications Q2, research.md D4).
 *
 * The phase's structural change, and the only one that alters an existing table.
 *
 * Clarifications Q2 scopes the customer portal to the signing-in CONTACT rather
 * than to the customer record, because `customers.company` means one record
 * routinely represents an organisation and its contacts are several different
 * people. Inviting one of them must not hand them every request their
 * colleagues ever raised.
 *
 * That is not expressible against the schema as it stands: `tickets` records a
 * customer and nothing narrower. This column is what makes it expressible.
 *
 * NULL MEANS INVISIBLE IN THE PORTAL (FR-026f). It does NOT mean "visible to
 * every contact on the record", and no query may read it that way. Reading
 * absence as permission is the single mistake that would reintroduce exactly
 * the leak Q2 exists to prevent — silently, and on the oldest data in the
 * system. The visible cost is accepted and stated: at launch most historical
 * tickets are invisible in the portal until 20260901000011 associates them or a
 * staff member does it by hand.
 *
 * NULLABLE rather than NOT NULL because FR-026e is real: an agent raising a
 * ticket during a phone call may genuinely not know which contact it was, and a
 * default would invent a requester.
 *
 * SET NULL rather than CASCADE. Removing a contact must not delete a ticket —
 * the ticket becomes invisible in the portal, which is the correct fail-closed
 * outcome and matches this project's standing rule that records are
 * deactivated or merged, never deleted.
 *
 * The FK cannot express the constraint that actually matters — that the contact
 * belongs to the TICKET'S OWN customer — because that is a two-table
 * relationship. Every write site checks it in the service. An association
 * across customers would be a cross-customer disclosure.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'requesting_contact_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'customer_contacts', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    // Every portal ticket read filters on this column, and it is the only
    // filter that narrows the result to one person.
    await queryInterface.addIndex('tickets', ['requesting_contact_id'], {
      name: 'tickets_requesting_contact_id',
    });
  },

  async down(queryInterface) {
    // Index first: dropping a column an index depends on is the failure mode
    // Phase 1 hit.
    await queryInterface.removeIndex('tickets', 'tickets_requesting_contact_id');
    await queryInterface.removeColumn('tickets', 'requesting_contact_id');
  },
};
