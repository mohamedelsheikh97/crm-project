import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { AiInvocation } from '../../src/models/ai-invocation.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import * as similarService from '../../src/services/similar-ticket.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * Similar resolved tickets (Phase 9, US5, FR-051 - FR-055, SC-013, SC-014).
 *
 * DETERMINISTIC BY CONSTRUCTION. This is the one feature in the phase whose
 * results a test can assert by exact id, and that is the argument for
 * implementing it with retrieval rather than a model (research D8) — not an
 * incidental benefit of it.
 */
describe('similar tickets', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('offers a resolved ticket on the same theme', async () => {
    const solved = await seed('Printer jams when printing duplex', 'resolved');
    await index(solved.id);

    const current = await seed('Printer jams on duplex printing', 'open');

    const results = await similarService.forTicket(current.id);

    expect(results.map((row) => row.ticketId)).toContain(solved.id);
    expect(results[0].resolutionExcerpt).toBeTruthy();
    expect(results[0].reference).toMatch(/^[A-Z]+-?\d+/);
  });

  it('never offers the ticket being viewed', async () => {
    const current = await seed('Printer jams when printing duplex', 'resolved');
    await index(current.id);

    const results = await similarService.forTicket(current.id);

    expect(results.map((row) => row.ticketId)).not.toContain(current.id);
  });

  it('offers nothing rather than a weak match (FR-054)', async () => {
    const unrelated = await seed('Invoice shows the wrong VAT rate', 'resolved');
    await index(unrelated.id);

    const current = await seed('Printer jams when printing duplex', 'open');

    // A shared stopword is not a similar problem. The floor is what makes the
    // empty answer possible at all — a model would produce something regardless.
    expect(await similarService.forTicket(current.id)).toEqual([]);
  });

  it('does not offer an UNRESOLVED ticket, even on the same theme', async () => {
    const openOne = await seed('Printer jams when printing duplex', 'open');
    await index(openOne.id);

    const current = await seed('Printer jams on duplex printing', 'open');

    // An open ticket has no resolution to learn from; suggesting one points an
    // agent at a colleague's unfinished work as though it were an answer.
    expect(await similarService.forTicket(current.id)).toEqual([]);
  });

  it('drops a ticket from the index when it leaves a settled state', async () => {
    const solved = await seed('Printer jams when printing duplex', 'resolved');
    await index(solved.id);

    const current = await seed('Printer jams on duplex printing', 'open');
    expect(await similarService.forTicket(current.id)).toHaveLength(1);

    // Reopened. The rows must go, or it goes on being suggested as though it
    // had an answer.
    await Ticket.update({ status: 'open' }, { where: { id: solved.id } });
    await index(solved.id);

    expect(await similarService.forTicket(current.id)).toEqual([]);
  });

  it('matches Arabic tickets using the Phase 7 normalisation', async () => {
    const solved = await seed('الطابعة تعلق عند الطباعة على الوجهين', 'resolved');
    await index(solved.id);

    const current = await seed('الطابعة تعلق أثناء الطباعة على الوجهين', 'open');

    expect((await similarService.forTicket(current.id)).map((r) => r.ticketId)).toContain(
      solved.id,
    );
  });

  it('makes NO model call and records NO invocation', async () => {
    const solved = await seed('Printer jams when printing duplex', 'resolved');
    await index(solved.id);

    const current = await seed('Printer jams on duplex printing', 'open');
    await similarService.forTicket(current.id);

    // research D8: this feature costs one query. If an invocation row ever
    // appears here, someone has quietly put a model in the path.
    expect(await AiInvocation.count()).toBe(0);
  });
});

async function seed(subject: string, status: string): Promise<{ id: number }> {
  const customer = (await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never)) as unknown as { id: number };

  return (await Ticket.create({
    customer_id: customer.id,
    subject,
    description: subject,
    category: 'technical',
    priority: 'normal',
    status,
    source: 'email',
  } as never)) as unknown as { id: number };
}

/** Drives the same reindex the ticket transition calls. */
async function index(ticketId: number): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await similarService.reindex(ticketId, transaction);
  });
}
