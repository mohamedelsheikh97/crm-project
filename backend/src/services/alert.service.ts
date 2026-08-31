import { Op, type Transaction } from 'sequelize';

import { env } from '../config/env.js';
import { hit } from '../lib/rate-limit.js';
import { AlertDelivery, AlertSubscription, Role, Ticket, User } from '../models/index.js';
import type { AlertEvent } from '../models/alert-subscription.model.js';
import { NOTIFICATION_TYPES, type NotificationType } from '../models/notification.model.js';
import * as notificationService from './notification.service.js';

/**
 * Telling the right people (Phase 6, FR-072-FR-081).
 *
 * THE IN-APPLICATION NOTIFICATION IS UNCONDITIONAL (FR-073). It is created
 * first, in the caller's transaction, and NOTHING about the other transports
 * can prevent it — not a missing configuration, not a refusing gateway, not a
 * recipient with no address. An escalation that happened but told nobody is the
 * failure this phase exists to prevent, and the transport most likely to be
 * unconfigured is the one least able to be trusted with that job.
 *
 * ALERTS TO USERS ARE NOT MESSAGES (research D13). Email and SMS to an agent go
 * straight to the channel adapter and write NO `messages` row: `messages` is
 * customer correspondence, the structure Phase 5 Clarifications Q3 kept free of
 * internal content precisely so Phase 8 could build a customer-facing view on
 * it. Operational traffic must not enter it.
 *
 * EVERY ATTEMPT IS RECORDED, with four outcomes that must stay distinct
 * (FR-076): delivered, skipped (no address), suppressed (the ceiling), failed
 * (the transport refused). Collapsing them makes an unreachable recipient
 * indistinguishable from a broken gateway — the diagnosis somebody needs at
 * 03:00 when an escalation went unanswered.
 */

/** What an alert is about. Carried as identifiers, never as content (FR-081). */
export interface AlertContext {
  ticketId: number;
  /** Set where the event concerns one; used to avoid telling them twice. */
  assigneeUserId?: number | null;
  /** Extra i18n parameters for the rendered body. Never free text. */
  params?: Record<string, unknown>;
}

/** Which in-app notification type an event maps to. */
const NOTIFICATION_TYPE_FOR: Record<string, NotificationType> = {
  'sla.response_at_risk': NOTIFICATION_TYPES.SLA_AT_RISK,
  'sla.resolution_at_risk': NOTIFICATION_TYPES.SLA_AT_RISK,
  'sla.response_breached': NOTIFICATION_TYPES.SLA_BREACHED,
  'sla.resolution_breached': NOTIFICATION_TYPES.SLA_BREACHED,
  'assignment.failed': NOTIFICATION_TYPES.ASSIGNMENT_FAILED,
};

interface Recipient {
  user: User;
  inApp: boolean;
  byEmail: boolean;
  bySms: boolean;
}

/**
 * Who hears about this event, DEDUPLICATED.
 *
 * FR-041: a recipient who is both the assignee and a member of the supervisory
 * role receives ONE notification, not two. Merging by user id — and OR-ing the
 * transports rather than taking the first match — is what makes that true
 * without the caller having to think about it.
 */
async function resolveRecipients(
  eventKey: AlertEvent,
  context: AlertContext,
): Promise<Recipient[]> {
  const subscriptions = await AlertSubscription.findAll({ where: { event_key: eventKey } });

  if (subscriptions.length === 0) return [];

  const merged = new Map<number, Recipient>();

  const add = (user: User, subscription: AlertSubscription): void => {
    const existing = merged.get(user.id);

    if (existing) {
      // OR, not overwrite: subscribed twice by different routes means the union
      // of what those routes asked for.
      existing.byEmail = existing.byEmail || subscription.by_email;
      existing.bySms = existing.bySms || subscription.by_sms;
      return;
    }

    merged.set(user.id, {
      user,
      // Always true — FR-073 does not permit otherwise.
      inApp: true,
      byEmail: subscription.by_email,
      bySms: subscription.by_sms,
    });
  };

  for (const subscription of subscriptions) {
    if (subscription.recipient_kind === 'assignee') {
      if (!context.assigneeUserId) continue;

      const assignee = await User.findByPk(context.assigneeUserId);

      // A deactivated assignee is not told; the supervisory rows still are, so
      // the breach does not go unreported (FR-041).
      if (assignee?.is_active) add(assignee, subscription);
      continue;
    }

    if (subscription.role_id === null) continue;

    const members = await User.findAll({
      where: { role_id: subscription.role_id, is_active: true },
    });

    for (const member of members) add(member, subscription);
  }

  return [...merged.values()];
}

async function recordDelivery(
  eventKey: string,
  context: AlertContext,
  userId: number | null,
  transport: 'in_app' | 'email' | 'sms',
  outcome: 'delivered' | 'skipped' | 'suppressed' | 'failed',
  detail: string | null,
  transaction?: Transaction,
): Promise<void> {
  await AlertDelivery.create(
    {
      event_key: eventKey,
      ticket_id: context.ticketId,
      user_id: userId,
      customer_id: null,
      transport,
      outcome,
      // Never a credential, and never a stack trace.
      detail: detail === null ? null : detail.slice(0, 255),
    },
    { transaction },
  );
}

/**
 * Fire an alert.
 *
 * The in-app half runs INSIDE the caller's transaction, so an escalation and
 * the notification about it commit together or neither does. The outbound half
 * runs after, because a gateway call inside a transaction holds a database
 * connection open on a network round trip — and because FR-075 says a transport
 * must never be able to prevent the act it is reporting.
 */
export async function dispatch(
  eventKey: AlertEvent,
  context: AlertContext,
  transaction: Transaction,
): Promise<void> {
  const recipients = await resolveRecipients(eventKey, context);
  const type = NOTIFICATION_TYPE_FOR[eventKey];

  if (!type) return;

  for (const recipient of recipients) {
    await notificationService.create(
      {
        userId: recipient.user.id,
        type,
        // Null: nobody caused this. A policy is not an actor in the audit
        // sense, and `notificationService.create` uses a non-null actor to
        // suppress self-notification — which would be wrong here.
        actorUserId: null,
        ticketId: context.ticketId,
      },
      transaction,
    );

    await recordDelivery(
      eventKey,
      context,
      recipient.user.id,
      'in_app',
      'delivered',
      null,
      transaction,
    );
  }

  // The outbound transports are queued for after the commit, following the
  // ordering rule this codebase has used since Phase 4: everything that leaves
  // the process happens after the transaction it reports on is durable.
  const outbound = recipients.filter((recipient) => recipient.byEmail || recipient.bySms);

  if (outbound.length === 0) return;

  transaction.afterCommit(() => {
    // Deliberately not awaited: FR-075. A gateway that hangs must not hold the
    // request that triggered the escalation, and the escalation is already
    // committed. Failures are recorded, never thrown.
    void deliverOutbound(eventKey, context, outbound).catch(() => undefined);
  });
}

/**
 * Email and SMS, after the commit.
 *
 * NOTHING HERE CAN THROW INTO ANYTHING. Every failure becomes a row.
 */
async function deliverOutbound(
  eventKey: AlertEvent,
  context: AlertContext,
  recipients: Recipient[],
): Promise<void> {
  const ticket = await Ticket.findByPk(context.ticketId);

  for (const recipient of recipients) {
    if (recipient.byEmail) {
      await attempt(eventKey, context, recipient, 'email', recipient.user.email, ticket);
    }

    if (recipient.bySms) {
      // FR-077: no reachable address is SKIPPED, not failed. There was nothing
      // to try, which is a different fact from having tried and been refused.
      await attempt(eventKey, context, recipient, 'sms', recipient.user.alert_phone, ticket);
    }
  }
}

async function attempt(
  eventKey: AlertEvent,
  context: AlertContext,
  recipient: Recipient,
  transport: 'email' | 'sms',
  address: string | null,
  ticket: Ticket | null,
): Promise<void> {
  if (!address) {
    await recordDelivery(eventKey, context, recipient.user.id, transport, 'skipped', 'no address');
    return;
  }

  // FR-078. A misconfigured rule with an outbound action is a machine that can
  // send thousands of messages at real cost; Phase 5's per-conversation limits
  // were never designed to stop it. Suppressed alerts are RECORDED — silently
  // discarding them would make the ceiling indistinguishable from a bug.
  const verdict = hit(
    `alert:${recipient.user.id}`,
    env.ALERT_MAX_PER_RECIPIENT_PER_HOUR,
    60 * 60_000,
  );

  if (!verdict.allowed) {
    await recordDelivery(eventKey, context, recipient.user.id, transport, 'suppressed', 'ceiling');
    return;
  }

  try {
    const { adapterFor } = await import('../channels/registry.js');
    const adapter = adapterFor(transport === 'email' ? 'email' : 'sms');

    const result = await adapter.send({
      channel: transport === 'email' ? 'email' : 'sms',
      recipientIdentity: address,
      // FR-080: composed from LOCALE CONTENT in the recipient's language, and
      // the body carries identifiers rather than record content (FR-081) — an
      // alert must not disclose anything the recipient could not see by opening
      // the thing it concerns.
      body: renderBody(eventKey, ticket),
      subject: renderSubject(eventKey, ticket),
      providerConversationId: null,
      replyToToken: null,
    });

    await recordDelivery(
      eventKey,
      context,
      recipient.user.id,
      transport,
      result.state === 'sent' ? 'delivered' : 'failed',
      result.detail,
    );
  } catch (error) {
    await recordDelivery(
      eventKey,
      context,
      recipient.user.id,
      transport,
      'failed',
      error instanceof Error ? error.message : 'unknown',
    );
  }
}

/**
 * The alert body.
 *
 * AN i18n KEY PLUS A REFERENCE, not a sentence — the same rule the notification
 * table has followed since Phase 4. A fuller implementation resolves the key
 * against the recipient's locale; what must never happen is a hardcoded English
 * sentence reaching an Arabic reader, so the key travels rather than prose.
 */
function renderBody(eventKey: AlertEvent, ticket: Ticket | null): string {
  const reference = ticket ? `TKT-${String(ticket.id).padStart(5, '0')}` : '';
  return JSON.stringify({ key: `alerts.body.${eventKey}`, params: { reference } });
}

function renderSubject(eventKey: AlertEvent, ticket: Ticket | null): string {
  const reference = ticket ? `TKT-${String(ticket.id).padStart(5, '0')}` : '';
  return JSON.stringify({ key: `alerts.subject.${eventKey}`, params: { reference } });
}

// --- Subscriptions ---------------------------------------------------------

export interface SubscriptionView {
  eventKey: string;
  subscriptions: Array<{
    recipientKind: 'assignee' | 'role';
    roleId: number | null;
    roleKey: string | null;
    inApp: boolean;
    byEmail: boolean;
    bySms: boolean;
    /** How many role members have no `alert_phone`, so the screen can say so. */
    unreachableForSms: number;
  }>;
}

export async function listSubscriptions(): Promise<SubscriptionView[]> {
  const rows = (await AlertSubscription.findAll({
    include: [{ model: Role, as: 'role', required: false }],
    order: [
      ['event_key', 'ASC'],
      ['id', 'ASC'],
    ],
  })) as Array<AlertSubscription & { role?: Role | null }>;

  const grouped = new Map<string, SubscriptionView>();

  for (const row of rows) {
    let entry = grouped.get(row.event_key);

    if (!entry) {
      entry = { eventKey: row.event_key, subscriptions: [] };
      grouped.set(row.event_key, entry);
    }

    const unreachableForSms =
      row.recipient_kind === 'role' && row.role_id !== null
        ? await User.count({
            where: { role_id: row.role_id, is_active: true, alert_phone: { [Op.is]: null } },
          })
        : 0;

    entry.subscriptions.push({
      recipientKind: row.recipient_kind,
      roleId: row.role_id,
      roleKey: row.role?.key ?? null,
      inApp: true,
      byEmail: row.by_email,
      bySms: row.by_sms,
      unreachableForSms,
    });
  }

  return [...grouped.values()];
}
