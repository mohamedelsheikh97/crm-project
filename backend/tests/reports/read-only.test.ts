import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build } from '../reporting/fixture.js';

/**
 * REPORTING WRITES NOTHING TO AN OPERATIONAL RECORD (Phase 10, FR-064, SC-028).
 *
 * The one guarantee that lets this phase read across all forty-eight tables
 * without anybody having to worry about it. Every other phase in this system
 * writes something; this one computes, displays and exports.
 *
 * The two things it IS allowed to write are excluded by name below: a user's own
 * dashboard arrangement, and the audit entry recording that an export happened.
 * The second is a record of READING, not a change to anything read.
 *
 * WHY A CHECKSUM RATHER THAN ROW COUNTS ALONE. A count catches an insert or a
 * delete and misses an UPDATE — and an update is the more likely accident here:
 * a reporting query that touched a `last_viewed_at` column, or a Sequelize
 * instance saved after being loaded for a calculation. The checksum catches a
 * changed value in a row that still exists.
 */
const WATCHED = [
  'tickets',
  'ticket_sla',
  'ticket_satisfaction',
  'ticket_history',
  'customers',
  'users',
  'messages',
  'ai_invocations',
  'ai_category_proposals',
] as const;

async function snapshot(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const table of WATCHED) {
    const [rows] = (await sequelize.query(`CHECKSUM TABLE \`${table}\``)) as [
      Array<{ Checksum: number | null }>,
      unknown,
    ];

    const [counted] = (await sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\``)) as [
      Array<{ n: number }>,
      unknown,
    ];

    result[table] = `${rows[0]?.Checksum ?? 'null'}:${counted[0]?.n ?? 0}`;
  }

  return result;
}

describe('reporting is read-only', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await build();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('leaves every operational table byte-identical across a full reporting pass', async () => {
    const before = await snapshot();

    // Exercise the reporting modules that exist. As report services are added,
    // each is added here — the point is a FULL pass, so a service that writes is
    // caught by the phase's own suite rather than in production.
    const period = await import('../../src/reporting/period.js');
    const sources = await import('../../src/reporting/sources.js');
    const filters = await import('../../src/reporting/filters.js');

    const resolved = await period.resolve('2026-02-01', '2026-02-28');
    const parsed = filters.parse({});

    await sources.models.Ticket.count({
      where: sources.ticketsCreatedIn(resolved, parsed),
    });
    await sources.models.Ticket.findAll({
      where: sources.ticketsCreatedIn(resolved, parsed),
      limit: 50,
    });
    await sources.models.TicketSla.findAll({ where: sources.slaStartedIn(resolved), limit: 50 });
    await sources.models.TicketSatisfaction.findAll({
      where: sources.satisfactionIn(resolved),
      limit: 50,
    });
    await sources.models.AiInvocation.count({ where: sources.invocationsIn(resolved) });
    await sources.models.AiCategoryProposal.count({ where: sources.proposalsIn(resolved) });

    const after = await snapshot();

    expect(after).toEqual(before);
  });

  it('names the two things this phase MAY write, so the guarantee stays honest', () => {
    // Not an assertion about behaviour — a statement of scope, kept here so the
    // exclusions are visible beside the guarantee rather than discovered later.
    const permittedWrites = ['dashboard_arrangements', 'audit_logs'] as const;

    for (const table of permittedWrites) {
      expect(WATCHED as readonly string[]).not.toContain(table);
    }
  });
});
