import { env } from '../config/env.js';
import { ChannelSetting } from '../models/index.js';
import { ALL_CHANNELS, CHANNELS, type Channel } from '../models/message.model.js';

import { chatAdapter } from './chat/simulator.js';
import { emailImapSmtpAdapter } from './email/imap-smtp.js';
import { emailSimulatorAdapter } from './email/simulator.js';
import { formAdapter } from './form/inbound.js';
import { portalAdapter } from './portal/in-app.js';
import { smsGatewayAdapter } from './sms/gateway.js';
import { smsSimulatorAdapter } from './sms/simulator.js';
import type { ChannelAdapter } from './types.js';
import { whatsappCloudApiAdapter } from './whatsapp/cloud-api.js';
import { whatsappSimulatorAdapter } from './whatsapp/simulator.js';

/**
 * Config → adapter, and the one refusal that keeps this phase honest
 * (research.md D1, D2).
 *
 * The PROVIDER comes from the environment because it decides which code runs.
 * ENABLEMENT comes from `channel_settings` because an administrator changes it
 * at runtime. Keeping them apart is why a channel can be switched off without a
 * deployment and cannot be re-pointed at a different provider through a screen.
 */

const SIMULATOR = 'simulator';

function resolve(channel: Channel): ChannelAdapter {
  switch (channel) {
    case CHANNELS.EMAIL:
      return env.CHANNEL_EMAIL_PROVIDER === SIMULATOR
        ? emailSimulatorAdapter
        : emailImapSmtpAdapter;
    case CHANNELS.WHATSAPP:
      return env.CHANNEL_WHATSAPP_PROVIDER === SIMULATOR
        ? whatsappSimulatorAdapter
        : whatsappCloudApiAdapter;
    case CHANNELS.SMS:
      return env.CHANNEL_SMS_PROVIDER === SIMULATOR ? smsSimulatorAdapter : smsGatewayAdapter;
    // Chat has no third party — this system IS the provider. The adapter exists
    // anyway so chat enters intake through the same door as every other channel
    // and gets identity resolution, threading, and the ledger for free.
    case CHANNELS.CHAT:
      return chatAdapter;
    // A form is inbound-only by definition (FR-003).
    case CHANNELS.FORM:
      return formAdapter;
    // The portal has no third party either, and unlike a form it CAN be replied
    // on — the adapter simply performs no network call, because both ends of the
    // conversation are inside this application (Phase 8, research D6).
    case CHANNELS.PORTAL:
      return portalAdapter;
  }
}

export function adapterFor(channel: Channel): ChannelAdapter {
  return resolve(channel);
}

/** Every adapter, in declaration order. */
export function allAdapters(): ChannelAdapter[] {
  return ALL_CHANNELS.map(resolve);
}

export async function isEnabled(channel: Channel): Promise<boolean> {
  const setting = await ChannelSetting.findOne({ where: { channel }, attributes: ['is_enabled'] });
  return setting?.is_enabled === true;
}

export interface ChannelStatus {
  channel: Channel;
  isEnabled: boolean;
  provider: string;
  isConfigured: boolean;
}

/**
 * What an administrator sees. Never a credential (FR-006) — only whether one is
 * present, which is the thing they actually need to know.
 */
export async function statuses(): Promise<ChannelStatus[]> {
  const settings = await ChannelSetting.findAll();
  const enabled = new Map(settings.map((row) => [row.channel, row.is_enabled]));

  return ALL_CHANNELS.map((channel) => {
    const adapter = resolve(channel);

    return {
      channel,
      isEnabled: enabled.get(channel) === true,
      provider: adapter.provider,
      isConfigured: adapter.isConfigured(),
    };
  });
}

export class SimulatorInProductionError extends Error {
  constructor(channels: Channel[]) {
    super(
      `Refusing to start: ${channels.join(', ')} ${channels.length === 1 ? 'is' : 'are'} enabled ` +
        'in production but resolve to the simulator, which delivers nothing. ' +
        'Set the matching CHANNEL_*_PROVIDER, or switch the channel off.',
    );
    this.name = 'SimulatorInProductionError';
  }
}

/**
 * THE REFUSAL (FR-005c).
 *
 * A simulator in production is the single INVISIBLE failure in this phase.
 * Everything continues to look right from the inside: tickets keep arriving,
 * agents keep replying, every reply is recorded as sent. Meanwhile no customer
 * hears anything, and nobody finds out until someone complains through another
 * route — by which time the backlog is days deep.
 *
 * A startup check rather than a request-time one, precisely because of that: by
 * the time a request arrives, a process that runs and lies is already worse
 * than a process that never started.
 *
 * Only ENABLED channels are checked. A production deployment that has not
 * switched WhatsApp on is not misconfigured — it simply is not using WhatsApp.
 *
 * Called from server.ts after the database connection is asserted, because
 * enablement is a table read.
 */
export async function assertProductionReady(): Promise<void> {
  if (env.NODE_ENV !== 'production') return;

  const settings = await ChannelSetting.findAll({ where: { is_enabled: true } });

  const offenders = settings
    .map((row) => row.channel)
    .filter((channel) => resolve(channel).provider === SIMULATOR)
    // Chat, forms and the portal have no external provider, so their
    // "simulator" is the real implementation. Excluding them is not a loophole:
    // there is nothing for them to be pointed at instead.
    .filter(
      (channel) =>
        channel !== CHANNELS.CHAT && channel !== CHANNELS.FORM && channel !== CHANNELS.PORTAL,
    );

  if (offenders.length > 0) {
    throw new SimulatorInProductionError(offenders);
  }
}
