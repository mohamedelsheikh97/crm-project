'use strict';

/**
 * Default grants for Phase 6 — SLA & Automation.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's
 * deliberate changes. Same contract as the Phase 1-5 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * @type {import('sequelize-cli').Migration}
 */

// NOTHING. And this is the load-bearing line of the file.
//
// FR-051: configuring automatic assignment is self-assignment by a longer
// route. Phase 3 Clarifications Q3 fixed assignment as Supervisor-only and
// Phase 4 honoured it; an agent who could choose the routing strategy could
// route work to themselves without ever touching a ticket.
//
// Nor does an agent read the automation record: `automation:view` discloses
// what rules ran on tickets across the whole system.
const AGENT_GRANTS = [];

const SUPERVISOR_GRANTS = [
  ...AGENT_GRANTS,
  // A supervisor already directs work by assigning tickets. Reading what
  // automation did to those tickets is the same job, and User Story 7 exists
  // because a supervisor is the person who asks "what changed this overnight?".
  'automation:view',
];

// Administrators hold every catalog key, so this list is the Phase 6 addition
// rather than the complete set.
const ADMIN_GRANTS = [
  ...SUPERVISOR_GRANTS,
  // Policies and the calendar together (see permissions.ts). Setting what the
  // organisation promises its customers, and what an hour of that promise
  // means, is a policy decision rather than a supervisory one.
  'sla:manage',
  // The routing strategy, the per-agent ceiling, and competencies. The service
  // additionally requires `tickets:assign`, so this key alone is not enough.
  'assignment:manage',
  // A rule changes what the system does to every future ticket, without a
  // person in the loop. That is configuration, not supervision.
  'automation:manage',
];

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
        [Sequelize.Op.in]: [
          'sla:manage',
          'assignment:manage',
          'automation:manage',
          'automation:view',
        ],
      },
    });
  },
};
