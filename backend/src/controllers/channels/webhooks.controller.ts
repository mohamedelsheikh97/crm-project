import type { NextFunction, Request, Response } from 'express';

import { adapterFor } from '../../channels/registry.js';
import { logger } from '../../middleware/request-logger.js';
import { isChannel } from '../../models/message.model.js';
import * as intakeService from '../../services/intake.service.js';
import * as messageService from '../../services/message.service.js';

/**
 * Provider deliveries. ONE OF THE FOUR PUBLIC ENDPOINTS in this phase
 * (FR-105), and the only one authenticated by a signature rather than a token.
 *
 * THE ORDER HERE IS SECURITY-CRITICAL:
 *
 *   1. verify the signature against the RAW BYTES
 *   2. only then parse
 *   3. respond 200 as soon as the delivery is recorded
 *   4. convert afterwards
 *
 * Step 1 before step 2 because a payload that has not been authenticated must
 * not be handed to a parser — parsing untrusted input IS the attack surface
 * (FR-008, FR-054, FR-064).
 *
 * Step 3 before step 4 because a provider that is made to wait for conversion
 * will time out and retry, and a retry mid-conversion is exactly the duplicate
 * the ledger then has to absorb. Acknowledging receipt is honest the moment
 * the delivery is durable.
 */
export async function receive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const channel = String(req.params.channel);

    if (!isChannel(channel)) {
      // 404 rather than 400: a channel that does not exist has no endpoint, and
      // saying so more precisely would enumerate which channels do.
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: [] },
      });
      return;
    }

    const adapter = adapterFor(channel);

    if (!adapter.verifyWebhook || !adapter.parseWebhook) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: [] },
      });
      return;
    }

    // The exact bytes, captured by express.json's verify callback (research D5).
    // Re-serialising `req.body` changes key order and whitespace and the
    // signature stops matching — intermittently, which is worse than always.
    const rawBody = req.rawBody ?? Buffer.alloc(0);

    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    if (!adapter.verifyWebhook(rawBody, headers)) {
      // Recorded, because repeated unverifiable deliveries are worth seeing
      // (FR-054). Not stored as intake: an unauthenticated payload has no
      // business in a table an administrator reads.
      logger.warn({ channel }, 'Rejected a webhook whose signature did not verify.');

      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Signature verification failed.', details: [] },
      });
      return;
    }

    let messages;

    try {
      messages = adapter.parseWebhook(rawBody);
    } catch {
      // Verified but unparseable: the provider changed shape, or sent something
      // we do not model. 400 tells them not to retry it forever.
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Unrecognised payload.', details: [] },
      });
      return;
    }

    // CONVERSION IS AWAITED, then we acknowledge.
    //
    // The first draft of this replied immediately and converted afterwards, to
    // keep the provider from waiting. That was wrong twice over. It
    // acknowledged BEFORE the delivery was durable — `accept` writes the ledger
    // row, so replying first meant promising to remember something we had not
    // yet written down. And it made every failure invisible: the response had
    // already gone, so a conversion error could only be logged.
    //
    // The work is bounded — a ledger insert, an identity lookup, a ticket and a
    // message — and the ledger makes a provider retry harmless if we are slow.
    // Being briefly slow is a better failure than being confidently wrong.
    for (const message of messages) {
      try {
        await intakeService.accept(message, rawBody.toString('utf8'));
      } catch (error) {
        // `accept` records its own failures in the ledger; reaching here means
        // something outside it broke. Logged and swallowed, because one bad
        // message in a batch must not discard the rest.
        logger.error({ err: error, channel }, 'Webhook conversion failed.');
      }
    }

    // Delivery and read receipts, applied to messages already stored (FR-059).
    if (channel === 'whatsapp') {
      try {
        const { parseStatusUpdates } = await import('../../channels/whatsapp/cloud-api.js');

        for (const update of parseStatusUpdates(rawBody)) {
          const state =
            update.status === 'read'
              ? 'read'
              : update.status === 'delivered'
                ? 'delivered'
                : update.status === 'failed'
                  ? 'failed'
                  : 'sent';

          await messageService.applyDeliveryUpdate(channel, update.id, state);
        }
      } catch {
        // A simulator payload carries no statuses block. Not an error.
      }
    }

    res.status(200).json({ received: messages.length });
  } catch (error) {
    next(error);
  }
}
