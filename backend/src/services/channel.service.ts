import * as registry from '../channels/registry.js';
import { notFound, validationError } from '../errors/app-error.js';
import { ChannelIntake, ChannelSetting } from '../models/index.js';
import { INTAKE_STATUSES } from '../models/channel-intake.model.js';
import { isChannel, type Channel } from '../models/message.model.js';

import * as auditService from './audit.service.js';

export interface Actor {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Channel administration.
 *
 * NEVER RETURNS A CREDENTIAL, and never accepts one (FR-006). Secrets live in
 * environment configuration where Phases 0-4 put every other secret. What an
 * administrator needs from a screen is whether a channel is on and whether it
 * can work — not the ability to paste an access token into a database row that
 * a backup, a log, or an export can then carry.
 */

/**
 * Keys that look like a credential, refused rather than stored.
 *
 * Refusing beats ignoring: an administrator who pastes a token into settings
 * and sees it silently accepted will believe the channel is configured, and
 * will not go and set the environment variable that actually matters.
 */
const CREDENTIAL_SHAPED = /(secret|token|password|passwd|apikey|api_key|credential|private)/i;

export async function list(): Promise<{ items: registry.ChannelStatus[] }> {
  return { items: await registry.statuses() };
}

export async function update(
  channel: string,
  input: { isEnabled?: unknown; settings?: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<registry.ChannelStatus> {
  if (!isChannel(channel)) throw notFound();

  const settings = input.settings;

  if (settings !== undefined && settings !== null) {
    if (typeof settings !== 'object' || Array.isArray(settings)) {
      throw validationError([{ field: 'settings', message: 'channels.error.settingsInvalid' }]);
    }

    for (const key of Object.keys(settings as Record<string, unknown>)) {
      if (CREDENTIAL_SHAPED.test(key)) {
        throw validationError([
          { field: `settings.${key}`, message: 'channels.error.credentialNotAllowed' },
        ]);
      }
    }
  }

  const [row] = await ChannelSetting.findOrCreate({
    where: { channel: channel as Channel },
    defaults: { channel: channel as Channel, is_enabled: false },
  });

  const previouslyEnabled = row.is_enabled;

  if (typeof input.isEnabled === 'boolean') row.is_enabled = input.isEnabled;
  if (settings !== undefined) row.settings_json = settings as Record<string, unknown> | null;
  row.updated_by_user_id = actor.id;

  await row.save();

  // FR-104. Switching a channel on points the outside world at this system,
  // which is a configuration change of the kind the audit log exists for.
  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.CHANNEL_UPDATED,
    actorUserId: actor.id,
    actorEmail: actor.email,
    targetType: 'channel',
    targetId: row.id,
    targetLabel: channel,
    metadata: { wasEnabled: previouslyEnabled, isEnabled: row.is_enabled },
    ...context,
  });

  const statuses = await registry.statuses();
  const status = statuses.find((entry) => entry.channel === channel);

  if (!status) throw notFound();

  return status;
}

export interface IntakeReviewEntry {
  id: number;
  channel: Channel;
  providerMessageId: string;
  receivedAt: Date;
  status: string;
  reason: string | null;
  attempts: number;
}

/**
 * What arrived and did not become a ticket (FR-037, FR-101).
 *
 * `failed` and `ignored` are shown SEPARATELY because they mean different
 * things: one is a problem somebody must fix, the other is the system correctly
 * declining to raise a ticket for an out-of-office reply. Merging them would
 * bury the first in the second.
 */
export async function unconvertedIntake(
  options: { status?: string; page?: unknown; pageSize?: unknown } = {},
): Promise<{ items: IntakeReviewEntry[]; page: number; pageSize: number; total: number }> {
  const pageSize = Math.min(Number(options.pageSize) || 25, 100);
  const page = Math.max(Number(options.page) || 1, 1);

  const status =
    options.status === INTAKE_STATUSES.IGNORED || options.status === INTAKE_STATUSES.FAILED
      ? options.status
      : [INTAKE_STATUSES.FAILED, INTAKE_STATUSES.IGNORED];

  const { rows, count } = await ChannelIntake.findAndCountAll({
    where: { status },
    order: [['received_at', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      providerMessageId: row.provider_message_id,
      receivedAt: row.received_at,
      status: row.status,
      reason: row.reason,
      attempts: row.attempts,
    })),
    page,
    pageSize,
    total: count,
  };
}
