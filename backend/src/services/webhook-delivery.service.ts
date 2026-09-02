import { Op } from 'sequelize';

import { classify, deliver } from '../integrations/delivery.js';
import { logger } from '../middleware/request-logger.js';
import { IntegrationEvent } from '../models/integration-event.model.js';
import { WebhookDeliveryAttempt } from '../models/webhook-delivery-attempt.model.js';
import { WebhookSubscription } from '../models/webhook-subscription.model.js';

import * as subscriptions from './webhook-subscription.service.js';

/**
 * Queueing, retrying and abandoning deliveries (Phase 11, US2, FR-030, FR-033,
 * FR-059, research D8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BACKOFF SPANS A NIGHT. THAT IS THE POINT OF THE NUMBERS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Seven attempts over roughly twenty-one hours, so an outage starting in the
 * evening is recovered by morning without anybody being paged. A tighter
 * schedule would exhaust itself while the receiver was still down; a longer one
 * would leave an administrator unable to tell "still retrying" from "given up".
 *
 * These are defaults rather than findings — research D17 collects every tuning
 * value in this phase in one place for exactly that reason.
 */
const BACKOFF_MINUTES = [0, 1, 5, 30, 120, 360, 720] as const;

export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

function nextAttemptAt(attemptNumber: number): Date | null {
  const minutes = BACKOFF_MINUTES[attemptNumber - 1];

  if (minutes === undefined) return null;

  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Fans an event out to every subscription that asked for it.
 *
 * ONE PENDING ATTEMPT PER SUBSCRIPTION, created in the same call, so the sweep
 * has something to find. Called by the sweep rather than by the code that
 * recorded the event, which is what keeps FR-029 true: an agent resolving a
 * ticket never waits for this.
 */
export async function enqueue(event: IntegrationEvent): Promise<number> {
  const wanted = await subscriptions.subscribersFor(event.event_type);

  if (wanted.length === 0) return 0;

  const already = await WebhookDeliveryAttempt.findAll({
    where: { event_id: event.id },
    attributes: ['subscription_id'],
  });

  const enqueued = new Set(already.map((attempt) => attempt.subscription_id));
  let created = 0;

  for (const subscription of wanted) {
    // Idempotent: a sweep that ran twice for the same event must not double the
    // queue. The unique-ish check is cheap because both columns are indexed.
    if (enqueued.has(subscription.id)) continue;

    await WebhookDeliveryAttempt.create({
      event_id: event.id,
      subscription_id: subscription.id,
      attempt_number: 1,
      state: 'pending',
      next_attempt_at: nextAttemptAt(1),
    } as never);

    created += 1;
  }

  return created;
}

/**
 * Claims one due attempt, or null.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CONDITIONAL UPDATE, NOT A READ-THEN-WRITE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two ticks inside one process cannot both take the same attempt, because the
 * update only matches a row still in `pending`. It does NOT solve the
 * multi-process case — the existing scheduler's own comment records that two
 * processes would double-fire, and here the duplicate leaves the building.
 *
 * That is why FR-031 makes at-least-once part of the PUBLISHED contract: a
 * receiver is required to deduplicate on `event_id`, so a double-fire is
 * survivable rather than corrupting. A lock is the real answer and it is out of
 * scope for this phase (research open question 1).
 */
async function claim(): Promise<WebhookDeliveryAttempt | null> {
  const candidate = await WebhookDeliveryAttempt.findOne({
    where: { state: 'pending', next_attempt_at: { [Op.lte]: new Date() } },
    order: [['next_attempt_at', 'ASC']],
  });

  if (!candidate) return null;

  const [claimed] = await WebhookDeliveryAttempt.update(
    { attempted_at: new Date() },
    { where: { id: candidate.id, state: 'pending', attempted_at: null } },
  );

  // Somebody else took it between the read and the write.
  if (claimed === 0) return null;

  return candidate;
}

/**
 * Delivers one attempt and records the outcome.
 *
 * A FAILED ATTEMPT BECOMES A NEW ROW, not an edited one, so the history is the
 * record rather than a counter (FR-060). "Delivery failed 6 times" is not
 * actionable; six rows each naming what happened are.
 */
async function attempt(row: WebhookDeliveryAttempt): Promise<void> {
  const event = await IntegrationEvent.findByPk(row.event_id);
  const subscription = await WebhookSubscription.findByPk(row.subscription_id);

  if (!event || !subscription) {
    await row.update({ state: 'abandoned', failure_reason: 'event or subscription removed' });
    return;
  }

  let secrets: string[];

  try {
    secrets = subscriptions.signingSecretsFor(subscription);
  } catch (error) {
    /**
     * The signing key changed, so this subscription's secret cannot be opened.
     *
     * ABANDONED WITH A REASON rather than sent unsigned. An unsigned
     * notification is one a receiver cannot trust (FR-027), and sending it
     * anyway would be worse than failing visibly — the administrator's action is
     * to rotate the subscription's secret, and they can only take it if they are
     * told.
     */
    await row.update({
      state: 'abandoned',
      failure_reason:
        error instanceof Error
          ? `cannot sign: ${error.message}`.slice(0, 255)
          : 'cannot sign this subscription',
    });

    await subscriptions.refreshHealth(subscription.id);
    return;
  }

  const outcome = await deliver({
    url: subscription.url,
    eventType: event.event_type,
    eventKey: event.event_key,
    payload: event.payload,
    secrets,
  });

  if (outcome.kind === 'succeeded') {
    await row.update({ state: 'succeeded', response_status: outcome.status });
    await subscriptions.refreshHealth(subscription.id);
    return;
  }

  await row.update({
    state: 'failed',
    response_status: outcome.status,
    failure_reason: outcome.reason.slice(0, 255),
    next_attempt_at: null,
  });

  /**
   * A PERMANENT failure stops here (FR-036).
   *
   * Retrying a 404 for twenty-one hours tells an administrator nothing they did
   * not know after the first attempt, and fills the failure list with noise that
   * hides the real problems.
   */
  const nextNumber = row.attempt_number + 1;
  const retryAt = outcome.kind === 'transient' ? nextAttemptAt(nextNumber) : null;

  if (retryAt === null) {
    /**
     * Exhausted, or permanent. The event is RETAINED and surfaced (FR-033) —
     * never discarded. An event that vanished when delivery gave up is the
     * failure nobody notices, and making it visible is the whole of User Story 6.
     */
    await WebhookDeliveryAttempt.create({
      event_id: row.event_id,
      subscription_id: row.subscription_id,
      attempt_number: nextNumber,
      state: 'abandoned',
      failure_reason:
        outcome.kind === 'permanent'
          ? `not retried: ${outcome.reason}`.slice(0, 255)
          : `exhausted after ${row.attempt_number} attempts`,
      next_attempt_at: null,
    } as never);
  } else {
    await WebhookDeliveryAttempt.create({
      event_id: row.event_id,
      subscription_id: row.subscription_id,
      attempt_number: nextNumber,
      state: 'pending',
      next_attempt_at: retryAt,
    } as never);
  }

  await subscriptions.refreshHealth(subscription.id);
}

/**
 * One sweep: fan out new events, then deliver what is due.
 *
 * WRITTEN SO THAT MISSING A TICK IS HARMLESS, which is the discipline
 * `lib/scheduler.ts` already states for its own sweeps. Due-ness is a database
 * column, not a timer's memory, so a restart loses nothing — that is FR-030's
 * "must survive a restart" for free rather than as a feature.
 */
export async function sweep(limit = 50): Promise<{ enqueued: number; delivered: number }> {
  let enqueued = 0;

  /**
   * Events with no attempt yet.
   *
   * Read by absence rather than by a flag on the event, so there is no "queued"
   * bookkeeping to get wrong — and a subscription created after an event was
   * recorded still receives it, which is what an administrator would expect.
   */
  const unqueued = await IntegrationEvent.findAll({
    where: {
      id: {
        [Op.notIn]: [
          // A correlated subquery would be tidier; Sequelize's portable form of
          // it is not, and the set is small because the sweep runs every minute.
          ...new Set(
            (
              await WebhookDeliveryAttempt.findAll({
                attributes: ['event_id'],
                group: ['event_id'],
              })
            ).map((attempt) => attempt.event_id),
          ),
        ],
      },
    },
    order: [['id', 'ASC']],
    limit,
  });

  for (const event of unqueued) {
    enqueued += await enqueue(event);
  }

  let delivered = 0;

  for (let index = 0; index < limit; index += 1) {
    const row = await claim();

    if (!row) break;

    try {
      await attempt(row);
      delivered += 1;
    } catch (error) {
      // A failure to RECORD an outcome is different from a failed delivery, and
      // it must not stop the sweep — the next tick will find the row again.
      logger.error({ err: error, attemptId: row.id }, 'webhook delivery attempt threw');
    }
  }

  return { enqueued, delivered };
}

/**
 * An administrator re-sending an abandoned event (FR-059, US6).
 *
 * CARRIES THE ORIGINAL `event_id`, because the event is unchanged — only the
 * attempt is new. That is what lets a receiver recognise it as something it may
 * already have seen rather than as a new occurrence.
 */
export async function resend(
  eventId: number,
  subscriptionId: number,
  byUserId: number,
): Promise<WebhookDeliveryAttempt> {
  const previous = await WebhookDeliveryAttempt.findAll({
    where: { event_id: eventId, subscription_id: subscriptionId },
    order: [['attempt_number', 'DESC']],
    limit: 1,
  });

  const nextNumber = (previous[0]?.attempt_number ?? 0) + 1;

  return WebhookDeliveryAttempt.create({
    event_id: eventId,
    subscription_id: subscriptionId,
    attempt_number: nextNumber,
    state: 'pending',
    // Immediately — an administrator pressing re-send has just fixed the
    // receiver and is watching.
    next_attempt_at: new Date(),
    resent_by_user_id: byUserId,
  } as never);
}

export { classify };
