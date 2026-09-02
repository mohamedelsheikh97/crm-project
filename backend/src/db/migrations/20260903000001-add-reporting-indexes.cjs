'use strict';

/**
 * Indexes the reports need (Phase 10, research.md D1).
 *
 * NO COLUMN IS ADDED OR ALTERED. This migration is entirely additive, so no
 * existing behaviour can change — which is what makes it safe to add indexes to
 * tables this phase does not own.
 *
 * THE FINDING THAT PRODUCED IT: `tickets` had NO INDEX ON `created_at`. Its nine
 * existing indexes are `customer_id`, `assignee_user_id`, `status`, `priority`,
 * `(status, priority)`, `merged_into_ticket_id`, `due_at`, `source` and
 * `requesting_contact_id` — every one of them serves FINDING A WORKING SET,
 * because that is all any phase before this one needed. Nothing asked "how many
 * arrived last month", so nothing indexed the column that answers it.
 *
 * That reframed the whole performance question for this phase. The reports are
 * counts and sums over columns already stored; what they lacked was a way to
 * reach a date range without a table scan. The spec's Out of Scope refused to
 * adopt a data warehouse speculatively, and this migration is why that refusal
 * survived contact with the schema — adopting a second datastore to avoid adding
 * an index would have been a Technology Standards deviation requiring a
 * constitution amendment, taken to avoid a migration.
 *
 * `ticket_satisfaction` had only `(ticket_id)`, which is Phase 8's uniqueness
 * constraint rather than a reporting index. `ticket_sla`'s existing indexes are
 * `(response_target_at, paused_at)` and `(resolution_target_at, paused_at)` —
 * built for Phase 6's due-date sweep, so they answer "what is due" and not "what
 * was breached".
 *
 * `ticket_history` needs nothing: research D4's current-assignee attribution
 * means reporting never walks history.
 *
 * @type {import('sequelize-cli').Migration}
 */
const INDEXES = [
  // Every date filter in the phase. The one that was missing.
  { table: 'tickets', fields: ['created_at'], name: 'tickets_created_at_idx' },
  { table: 'tickets', fields: ['created_at', 'category'], name: 'tickets_created_category_idx' },
  { table: 'tickets', fields: ['created_at', 'source'], name: 'tickets_created_source_idx' },
  // Agent volumes within a period (research D4 attributes by current assignee).
  {
    table: 'tickets',
    fields: ['assignee_user_id', 'created_at'],
    name: 'tickets_assignee_created_idx',
  },
  // Compliance counts read the RECORDED outcome columns (research D3).
  { table: 'ticket_sla', fields: ['response_breached_at'], name: 'ticket_sla_resp_breach_idx' },
  { table: 'ticket_sla', fields: ['resolution_breached_at'], name: 'ticket_sla_reso_breach_idx' },
  { table: 'ticket_satisfaction', fields: ['submitted_at'], name: 'ticket_satisfaction_at_idx' },
];

module.exports = {
  async up(queryInterface) {
    for (const index of INDEXES) {
      await queryInterface.addIndex(index.table, index.fields, { name: index.name });
    }
  },

  async down(queryInterface) {
    for (const index of INDEXES) {
      await queryInterface.removeIndex(index.table, index.name);
    }
  },
};
