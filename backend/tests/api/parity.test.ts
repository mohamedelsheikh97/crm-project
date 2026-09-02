import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse as parseFilters } from '../../src/reporting/filters.js';
import { resolve as resolvePeriod } from '../../src/reporting/period.js';
import * as customerService from '../../src/services/customer.service.js';
import * as slaService from '../../src/services/report-sla.service.js';
import * as ticketService from '../../src/services/ticket.service.js';
import * as volumeService from '../../src/services/report-volume.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';
import { apiClientWith, type ApiAgent } from './helpers.js';

/**
 * The published interface and the services agree (Phase 11, US1, FR-010,
 * SC-007).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS PREVENTS IS A MEETING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Somebody presents a number pulled through the API, somebody else has the
 * screen open, the two differ by three, and the rest of the hour is about which
 * is right rather than about what the number means. Once that has happened,
 * nobody trusts either surface again.
 *
 * Phase 10 wrote the same test for its export against its screens, and the
 * assertions here are chained the same way: the interface equals the service,
 * AND the service equals the hand-computed answer in `fixture-answers.ts`.
 * Comparing only the two surfaces would pass happily if a shared bug made both
 * wrong.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('published interface parity with the services', () => {
  let client: ApiAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    client = await apiClientWith('customers:view', 'tickets:view', 'reports:view');
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('presents a customer with the same field values the service returned', async () => {
    const internal = await customerService.list({ pageSize: 1, isActive: 'all' });
    const [first] = internal.items;

    expect(first).toBeDefined();

    const response = await client.get(`/api/v1/customers/${first!.id}`);

    expect(response.status).toBe(200);

    const detail = await customerService.getById(first!.id);

    // Field for field, across the rename. A presenter that dropped or defaulted
    // a value would show up here rather than in an integrator's database.
    expect(response.body.id).toBe(detail.id);
    expect(response.body.display_name).toBe(detail.displayName);
    expect(response.body.company).toBe(detail.company);
    expect(response.body.is_active).toBe(detail.isActive);
    expect(response.body.is_provisional).toBe(detail.isProvisional);
    expect(response.body.primary_email).toBe(detail.primaryEmail);
    expect(response.body.primary_phone).toBe(detail.primaryPhone?.raw ?? null);
    expect(response.body.contact_count).toBe(detail.contactCount);
    expect(response.body.contacts.length).toBe(detail.contacts.length);
  });

  it('presents a ticket with the same field values, including the reference', async () => {
    const internal = await ticketService.list({ pageSize: 1, includeMerged: true });
    const [first] = internal.items;

    expect(first).toBeDefined();

    const response = await client.get(`/api/v1/tickets/${first!.id}`);
    const detail = await ticketService.getById(first!.id);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(detail.id);
    // Derived from the id in ONE place (`tickets/reference.ts`). If the
    // presenter formatted it itself there would be two.
    expect(response.body.reference).toBe(detail.reference);
    expect(response.body.subject).toBe(detail.subject);
    expect(response.body.status).toBe(detail.status);
    expect(response.body.category).toBe(detail.category);
    expect(response.body.priority).toBe(detail.priority);
    expect(response.body.merged_into_ticket_id).toBe(detail.mergedIntoTicketId);
    expect(response.body.customer?.id ?? null).toBe(detail.customer?.id ?? null);
    expect(response.body.assignee?.id ?? null).toBe(detail.assignee?.id ?? null);
  });

  it('agrees with the volume service AND with the hand-computed answer', async () => {
    const period = await resolvePeriod(MONTH.from, MONTH.to);
    const internal = await volumeService.report(period, parseFilters({}));

    const response = await client.get(`/api/v1/reports/volume?${PERIOD}`);

    expect(response.status).toBe(200);

    // The interface equals the service...
    expect(response.body.received.value).toBe(internal.received.value);
    expect(response.body.openAtEnd.value).toBe(internal.openAtEnd.value);

    // ...and the service equals the number somebody counted by hand. Chaining
    // both is what catches a shared bug rather than a presentation bug.
    expect(response.body.received.value).toBe(FEBRUARY.received);
    expect(response.body.openAtEnd.value).toBe(FEBRUARY.openAtEnd);

    // The inequality Phase 10 built its fixture around: "received" and "open at
    // the end" are different questions, and a surface that conflated them would
    // pass a fixture where they coincided.
    expect(response.body.received.value).not.toBe(response.body.openAtEnd.value);
  });

  it('agrees on SLA compliance, counts and exclusions', async () => {
    const period = await resolvePeriod(MONTH.from, MONTH.to);
    const internal = await slaService.report(period, parseFilters({}));

    const response = await client.get(`/api/v1/reports/sla?${PERIOD}`);

    expect(response.body.responseCompliance.value).toBeCloseTo(
      internal.responseCompliance.value ?? Number.NaN,
      10,
    );
    expect(response.body.responseCompliance.count).toBe(internal.responseCompliance.count);
    expect(response.body.responseCompliance.count).toBe(FEBRUARY.sla.withPolicy);

    /**
     * THE DENOMINATOR AND THE EXCLUSION TRAVEL WITH THE RATE.
     *
     * A ticket with no policy was never promised anything, so counting it as
     * compliant would inflate every figure. Phase 10 excludes it and REPORTS the
     * exclusion; if the published interface dropped `excluded`, an integrator
     * would see a rate narrower than the total with no explanation.
     */
    const noPolicy = response.body.responseCompliance.excluded.find(
      (entry: { reason: string }) => entry.reason === 'no_policy',
    );

    expect(noPolicy?.count).toBe(FEBRUARY.sla.excludedNoPolicy);
  });

  it('agrees on the ticket COUNT for the same filter', async () => {
    /**
     * Not just field values — the population.
     *
     * The two surfaces page differently (offset for the screens, keyset here),
     * so this asserts they select the same rows despite that. `includeMerged` is
     * true on the internal call because the published collection includes merged
     * tickets deliberately.
     */
    const internal = await ticketService.list({
      category: ['billing'],
      pageSize: 100,
      includeMerged: true,
    });

    const response = await client.get('/api/v1/tickets?category=billing&limit=100');

    expect(response.body.data.length).toBe(internal.items.length);

    const publishedIds = response.body.data.map((row: { id: number }) => row.id).sort();
    const internalIds = internal.items.map((row) => row.id).sort();

    expect(publishedIds).toEqual(internalIds);
  });

  it('publishes no field the service did not produce', async () => {
    /**
     * The direction FR-010 is really about.
     *
     * A field the service does not return had to come from somewhere — and the
     * only place it could have come from is a query in the controller or the
     * presenter, which is a second definition of what a customer is.
     *
     * Checked as a fixed key set rather than by comparison, because the whole
     * point is that the published shape is DELIBERATE: adding to it should be a
     * visible change to this list.
     */
    const response = await client.get('/api/v1/customers?limit=1');

    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'company',
      'contact_count',
      'created_at',
      'display_name',
      'id',
      'is_active',
      'is_provisional',
      'primary_email',
      'primary_phone',
      'updated_at',
    ]);
  });
});
