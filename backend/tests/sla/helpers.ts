import { AlertSubscription, BusinessCalendar, Role, SlaPolicy } from '../../src/models/index.js';
import { ALL_ALERT_EVENTS } from '../../src/models/alert-subscription.model.js';
import { specificityOf } from '../../src/sla/precedence.js';
import type { TicketCategory, TicketPriority } from '../../src/tickets/taxonomy.js';

/**
 * Phase 6 test fixtures.
 *
 * `truncateAll()` empties the configuration tables between tests, so every
 * Phase 6 test that needs a calendar or a policy seeds its own. That is
 * deliberate: a test whose outcome depends on the seeded defaults would start
 * failing the day somebody edits them.
 */

/** Sun-Thu, 09:00-17:00, Africa/Cairo — the project's stated default. */
export async function seedCalendar(
  overrides: Partial<{
    timeZone: string;
    workingDays: number;
    dayStartMinute: number;
    dayEndMinute: number;
  }> = {},
): Promise<BusinessCalendar> {
  return BusinessCalendar.create({
    name: 'Test',
    time_zone: overrides.timeZone ?? 'Africa/Cairo',
    // 31 = 0b0011111 = Sun..Thu, with Sunday as bit 0. 62 would be Mon..Fri.
    working_days: overrides.workingDays ?? 31,
    day_start_minute: overrides.dayStartMinute ?? 540,
    day_end_minute: overrides.dayEndMinute ?? 1020,
    is_active: true,
  });
}

export async function seedPolicy(
  options: {
    name?: string;
    priority?: TicketPriority | null;
    category?: TicketCategory | null;
    responseMinutes?: number;
    resolutionMinutes?: number;
    isActive?: boolean;
  } = {},
): Promise<SlaPolicy> {
  const priority = options.priority ?? null;
  const category = options.category ?? null;

  return SlaPolicy.create({
    name: options.name ?? `Policy ${Math.random().toString(36).slice(2, 8)}`,
    name_ar: null,
    priority,
    category,
    response_minutes: options.responseMinutes ?? 60,
    resolution_minutes: options.resolutionMinutes ?? 240,
    is_active: options.isActive ?? true,
    // Derived exactly as the service derives it, so a fixture can never
    // accidentally out-rank a policy the service would have chosen.
    specificity: specificityOf({ priority, category }),
    created_by_user_id: null,
  });
}

/**
 * Alert subscriptions for every event: the assignee plus the Supervisor role.
 *
 * SEEDED BY THE TEST, NOT BY THE HELPERS, and deliberately so. `truncateAll`
 * reseeds PERMISSIONS, not CONTENT — the rule tests/helpers/database.ts states
 * for exactly this reason — so a test that depends on who hears about an event
 * says so itself rather than inheriting the shipped defaults. A test whose
 * outcome changes the day somebody edits a seeder is not testing what it claims.
 *
 * In-app only. Email and SMS are opted into per test, so the transport
 * behaviour is never accidental.
 */
export async function seedAlertSubscriptions(
  options: { byEmail?: boolean; bySms?: boolean } = {},
): Promise<void> {
  const supervisor = await Role.findOne({ where: { key: 'supervisor' } });

  for (const eventKey of ALL_ALERT_EVENTS) {
    await AlertSubscription.create({
      event_key: eventKey,
      recipient_kind: 'assignee',
      role_id: null,
      in_app: true,
      by_email: options.byEmail ?? false,
      by_sms: options.bySms ?? false,
    });

    if (supervisor) {
      await AlertSubscription.create({
        event_key: eventKey,
        recipient_kind: 'role',
        role_id: supervisor.id,
        in_app: true,
        by_email: options.byEmail ?? false,
        by_sms: options.bySms ?? false,
      });
    }
  }
}
