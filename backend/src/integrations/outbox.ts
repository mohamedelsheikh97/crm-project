import { randomUUID } from 'node:crypto';

import type { Transaction } from 'sequelize';

import { env } from '../config/env.js';
import { IntegrationEvent } from '../models/integration-event.model.js';
import type { WebhookEventType } from '../models/webhook-subscription.model.js';

/**
 * THE TRANSACTIONAL OUTBOX (Phase 11, US2, FR-026, FR-029 - FR-031, research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ROW IS WRITTEN INSIDE THE TRANSACTION THAT CAUSED IT. NOT BEFORE, NOT AFTER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The two failure modes are asymmetric and both matter:
 *
 *   - Write the event BEFORE commit and the transaction rolls back: a webhook
 *     fires for something that did not happen. The receiver creates a record for
 *     a ticket that does not exist, and no later event ever corrects it.
 *   - Write the event AFTER commit, in a separate step, and the process dies in
 *     between: the change happened and nobody is ever told. FR-030 and SC-013
 *     both forbid losing an event.
 *
 * Inside the transaction, the event exists exactly when the change does.
 * Everything after that point is delivery, which is allowed to fail and retry.
 *
 * `transaction` IS A REQUIRED ARGUMENT, not optional. That is the mechanism
 * rather than a style choice: a caller who has no transaction cannot call this,
 * so the guarantee above cannot be lost by forgetting to pass one.
 */

/** Where the event's subject can be read. Identifiers, never content. */
function subjectUrl(type: 'ticket' | 'customer', id: number): string {
  return `/api/v1/${type === 'ticket' ? 'tickets' : 'customers'}/${id}`;
}

export interface RecordEventInput {
  readonly eventType: WebhookEventType;
  readonly subjectType: 'ticket' | 'customer';
  readonly subjectId: number;
  /**
   * When it happened, to the millisecond.
   *
   * Supplied rather than defaulted to `new Date()` so a caller inside a long
   * transaction records the moment of the CHANGE rather than the moment of the
   * write. Two events for one ticket inside a second are ordinary — a status
   * change that triggers an automation rule — and FR-032 tells receivers to
   * order by this, so the precision is load-bearing.
   */
  readonly occurredAt?: Date;
}

/**
 * Records that something happened, for later delivery.
 *
 * Returns the event so a caller can log its key; nothing is delivered here.
 * Delivery is the scheduler's job, which is what keeps FR-029 true — an agent
 * resolving a ticket never waits for a receiver.
 *
 * SILENT WHEN THE PHASE IS OFF. With `INTEGRATIONS_ENABLED=false` this writes
 * nothing, so FR-067's "the system works with every integration capability
 * switched off" holds without the callers needing to know. An event recorded
 * while the phase is disabled would be delivered whenever somebody enabled it,
 * possibly months later, which is worse than not recording it.
 */
export async function record(
  input: RecordEventInput,
  transaction: Transaction,
): Promise<IntegrationEvent | null> {
  if (!env.INTEGRATIONS_ENABLED) return null;

  const eventKey = randomUUID();
  const occurredAt = input.occurredAt ?? new Date();

  /**
   * THE PAYLOAD IS BUILT ONCE AND STORED (FR-028).
   *
   * Stored rather than recomputed at delivery because a retry twelve hours later
   * must deliver what happened, not what is true now — recomputing would mean
   * the retry of a "ticket resolved" event describing a ticket that has since
   * been reopened.
   *
   * IDENTIFIERS AND METADATA ONLY. No ticket subject or body, no customer name,
   * no message text. A notification goes to an address a person typed into a
   * form; if that address is wrong or is later taken over, a payload of
   * identifiers is an inconvenience while a payload of record content is a
   * disclosure. The receiver reads what it needs through the published
   * interface, under its own authority, at the moment it reads.
   */
  return IntegrationEvent.create(
    {
      event_key: eventKey,
      event_type: input.eventType,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      occurred_at: occurredAt,
      payload: {
        event_id: eventKey,
        event_type: input.eventType,
        occurred_at: occurredAt.toISOString(),
        api_version: '1',
        subject: {
          type: input.subjectType,
          id: input.subjectId,
          url: subjectUrl(input.subjectType, input.subjectId),
        },
      },
    } as never,
    { transaction },
  );
}
