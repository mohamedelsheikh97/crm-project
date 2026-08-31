'use strict';

/**
 * The default service commitments (Phase 6, FR-009, spec FR-009 table).
 *
 * FOUR POLICIES, ONE PER PRIORITY. FR-009 requires a fresh installation to
 * measure SOMETHING rather than nothing: an installation with no policies has
 * no targets, no breaches, and no escalations, and the whole phase would appear
 * broken until someone found the configuration screen.
 *
 * Durations are WORKING MINUTES against the seeded calendar (Clarifications
 * Q1), not wall-clock. "1 day" here means one working day — 8 hours at
 * 09:00-17:00 — which is why `low` resolution is 2400 rather than 7200.
 *
 *   urgent   1h / 4h    =    60 /  240
 *   high     4h / 1d    =   240 /  480
 *   normal   8h / 3d    =   480 / 1440
 *   low      1d / 5d    =   480 / 2400
 *
 * BILINGUAL NAMES because a seeded policy appears in an Arabic interface and
 * Principle I forbids an untranslated English string there (FR-004). A policy
 * an administrator creates themselves needs only one name — they are entitled
 * to name it in their own language.
 *
 * CATEGORY-SCOPED POLICIES ARE SUPPORTED (FR-003) AND NOT SEEDED. Which
 * categories deserve their own promise is an organisational decision, and
 * guessing would put commitments into the system nobody made.
 *
 * RECONCILING: inserts only policies whose name is absent, so re-running cannot
 * overwrite edited durations.
 *
 * @type {import('sequelize-cli').Migration}
 */
const POLICIES = [
  {
    name: 'Urgent',
    name_ar: 'عاجل',
    priority: 'urgent',
    response_minutes: 60,
    resolution_minutes: 240,
  },
  {
    name: 'High',
    name_ar: 'مرتفع',
    priority: 'high',
    response_minutes: 240,
    resolution_minutes: 480,
  },
  {
    name: 'Normal',
    name_ar: 'عادي',
    priority: 'normal',
    response_minutes: 480,
    resolution_minutes: 1440,
  },
  {
    name: 'Low',
    name_ar: 'منخفض',
    priority: 'low',
    response_minutes: 480,
    resolution_minutes: 2400,
  },
];

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query('SELECT name FROM sla_policies');
    const held = new Set(existing.map((row) => row.name));
    const now = new Date();

    const rows = POLICIES.filter((policy) => !held.has(policy.name)).map((policy) => ({
      ...policy,
      category: null,
      is_active: true,
      // Priority only, no category: specificity 2. Derived here to match
      // sla/precedence.ts — the service derives it on every write, and this
      // seeder must not disagree with it.
      specificity: 2,
      created_by_user_id: null,
      version: 0,
      created_at: now,
      updated_at: now,
    }));

    if (rows.length > 0) {
      await queryInterface.bulkInsert('sla_policies', rows);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('sla_policies', {
      name: { [Sequelize.Op.in]: POLICIES.map((policy) => policy.name) },
    });
  },
};
