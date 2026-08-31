import { now } from '../lib/clock.js';
import { normaliseContact } from '../lib/phone.js';
import { ChannelOptOut } from '../models/index.js';
import type { Channel } from '../models/message.model.js';
import type { OptOutSource } from '../models/channel-opt-out.model.js';

/**
 * THE SINGLE PLACE "may we message this identity?" IS ANSWERED.
 *
 * FR-051 (refuse to send to someone who opted out), FR-060 (honour a WhatsApp
 * opt-out) and FR-065 (honour an SMS STOP) are one rule applied at three
 * moments, and they must not be able to drift — a second implementation for one
 * channel is exactly how one of them silently stops working. Same reasoning as
 * Phase 2's single duplicate detector.
 *
 * KEYED BY IDENTITY, NEVER BY CUSTOMER. A person who replies STOP has refused
 * messages to that NUMBER, and the refusal must survive the number moving
 * between customer records, a merge, a split, a deactivation, or a provisional
 * customer being merged away. Keying on `customer_id` would let any of those
 * quietly resurrect consent, and nobody would find out until somebody who asked
 * to be left alone was messaged again.
 */

/**
 * Which channels an identity can be normalised for.
 *
 * Email and phone normalise differently, and using the wrong one would mean a
 * refusal recorded in one format and checked in another — a defeat by
 * formatting, which is the failure mode `lib/phone.ts` exists to prevent.
 */
function contactKindFor(channel: Channel): 'phone' | 'email' {
  return channel === 'email' ? 'email' : 'phone';
}

export function normaliseFor(channel: Channel, identity: string): string {
  return normaliseContact(contactKindFor(channel), identity);
}

/**
 * Records a refusal. Idempotent: the unique index on
 * `(channel, identity_normalised)` means a provider redelivering the same STOP
 * cannot produce a second row, and re-recording is not an error.
 */
export async function record(
  channel: Channel,
  identity: string,
  source: OptOutSource,
): Promise<void> {
  const identityNormalised = normaliseFor(channel, identity);

  // findOrCreate rather than create-and-catch: the collision is the ordinary
  // case here, not an exceptional one.
  await ChannelOptOut.findOrCreate({
    where: { channel, identity_normalised: identityNormalised },
    defaults: {
      channel,
      identity_normalised: identityNormalised,
      opted_out_at: now(),
      source,
    },
  });
}

/**
 * Whether this identity has refused messages on this channel.
 *
 * Consulted by the send path before the adapter is called, so a refused message
 * never reaches a provider (FR-051).
 */
export async function isOptedOut(channel: Channel, identity: string): Promise<boolean> {
  const found = await ChannelOptOut.findOne({
    where: { channel, identity_normalised: normaliseFor(channel, identity) },
    attributes: ['id'],
  });

  return found !== null;
}

export interface OptOutView {
  channel: Channel;
  optedOutAt: Date;
  source: OptOutSource;
}

/**
 * The opt-out for one identity, so the ticket screen can show it BEFORE an
 * agent composes rather than refusing them afterwards (FR-051).
 */
export async function find(channel: Channel, identity: string): Promise<OptOutView | null> {
  const row = await ChannelOptOut.findOne({
    where: { channel, identity_normalised: normaliseFor(channel, identity) },
  });

  if (!row) return null;

  return { channel: row.channel, optedOutAt: row.opted_out_at, source: row.source };
}

/**
 * Removing a refusal is deliberately NOT exposed as an ordinary service call.
 *
 * Re-consent is not something an agent grants on a customer's behalf; it comes
 * back through the channel, from the person. This exists for the administrative
 * path and for tests, and its name says so.
 */
export async function forgetForAdministration(channel: Channel, identity: string): Promise<void> {
  await ChannelOptOut.destroy({
    where: { channel, identity_normalised: normaliseFor(channel, identity) },
  });
}
