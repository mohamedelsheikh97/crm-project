'use strict';

/**
 * Default grants for Phase 7 — Knowledge Base.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's
 * deliberate changes. Same contract as the Phase 1-6 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * @type {import('sequelize-cli').Migration}
 */

// THE PERSON WHO JUST SOLVED SOMETHING IS THE PERSON WHO SHOULD WRITE IT DOWN.
//
// This is the whole argument for granting an agent `kb:author` by default. A
// knowledge base whose authors are a separate team is a knowledge base that
// fills up slowly with second-hand accounts. The agent who worked the ticket
// has the answer while it is still fresh, and the cost of letting them write it
// is a draft nobody has published yet — which is visible to nobody (FR-004).
const AGENT_GRANTS = ['kb:author'];

const SUPERVISOR_GRANTS = [
  ...AGENT_GRANTS,
  // Deciding what goes in front of customers in the organisation's name is a
  // supervisory act, not an authoring one. Agents write; supervisors publish.
  'kb:publish',
  // Reorganising the filing changes what every reader sees on the front page.
  // A supervisor already directs the work this content comes out of.
  'kb:manage',
];

// Administrators hold every catalog key, so this list is the Phase 7 addition
// rather than the complete set.
const ADMIN_GRANTS = [...SUPERVISOR_GRANTS];

const GRANTS = {
  agent: AGENT_GRANTS,
  supervisor: SUPERVISOR_GRANTS,
  admin: ADMIN_GRANTS,
};

module.exports = {
  async up(queryInterface) {
    const [roles] = await queryInterface.sequelize.query('SELECT id, `key` FROM roles');
    const [existing] = await queryInterface.sequelize.query(
      'SELECT role_id, permission_key FROM role_permissions',
    );

    const held = new Set(existing.map((row) => `${row.role_id}:${row.permission_key}`));
    const now = new Date();
    const rows = [];

    for (const role of roles) {
      for (const permissionKey of GRANTS[role.key] ?? []) {
        if (held.has(`${role.id}:${permissionKey}`)) continue;

        rows.push({
          role_id: role.id,
          permission_key: permissionKey,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface, Sequelize) {
    // Removes only the keys this seeder introduces. A blanket delete would take
    // an Administrator's own additions with it.
    await queryInterface.bulkDelete('role_permissions', {
      permission_key: {
        [Sequelize.Op.in]: ['kb:author', 'kb:publish', 'kb:manage'],
      },
    });
  },
};
