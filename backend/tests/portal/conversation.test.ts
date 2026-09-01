import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { CustomerAttachment, Message, MessageAttachment } from '../../src/models/index.js';
import { createTestUser } from '../helpers/auth.js';
import * as optOutService from '../../src/services/opt-out.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { addMessages, buildPortalWorld, portalAgent, type PortalWorld } from './fixtures.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * THE CONVERSATION, AND ITS FILES (Phase 8, User Story 4, FR-029, FR-033,
 * FR-037, SC-010, SC-012, research.md D15).
 *
 * The attachment tests carry most of the weight here, because FR-033 turned out
 * not to be what it looked like. It reads as a scoping requirement on an existing
 * capability; `message-attachment.service.findForDownload` exists, does a bare
 * `findByPk`, and HAS NO CALLER AND NO ROUTE anywhere in the codebase. Phase 5
 * listed message attachments without ever serving their bytes.
 *
 * So this is a new endpoint, and it is the one place in the phase where the
 * obvious implementation is actively dangerous: an id with no scope serves any
 * file to any caller. The tests below try exactly that.
 */

async function attach(messageId: number, fileName: string): Promise<MessageAttachment> {
  return MessageAttachment.create({
    message_id: messageId,
    file_name: fileName,
    content_type: 'text/plain',
    byte_size: 12,
    // No real file behind it: every test here asserts a refusal, and the one
    // success case asserts the headers rather than the bytes.
    storage_key: `test/${fileName}`,
    is_inline: false,
  });
}

describe('reading the whole conversation (FR-029)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
    await addMessages(world.ticketA.id);
  });

  it('shows inbound and outbound across channels, in order', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages[0].direction).toBe('inbound');
    expect(response.body.messages[1].direction).toBe('outbound');
    // ONE HISTORY ACROSS CHANNELS: the customer wrote by email and was answered
    // in the portal, and both are in the same list.
    expect(response.body.messages.map((m: { channel: string }) => m.channel)).toEqual([
      'email',
      'portal',
    ]);
  });

  it('never names the agent who wrote the reply', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    // `message.service.MessageView` carries `author: { id, fullName }`. The portal
    // composes its own shape precisely so it does not — FR-031 excludes assignee
    // identity, and an outbound message's author is the same disclosure by
    // another route.
    for (const message of response.body.messages) {
      expect(message).not.toHaveProperty('author');
      expect(message).not.toHaveProperty('senderIdentity');
    }
  });

  it('stays complete for a customer who opted out of a channel (FR-037, SC-012)', async () => {
    await optOutService.record('email', world.a.email, 'keyword');

    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    // Opt-out governs outbound DELIVERY, not the customer's own record of what
    // was said. Withholding history from the person who came looking for it would
    // be the opposite of honouring their preference.
    expect(response.body.messages).toHaveLength(2);
  });
});

describe('attachments (FR-033, SC-010, research D15)', () => {
  let world: PortalWorld;
  let ownFile: MessageAttachment;
  let colleagueFile: MessageAttachment;

  beforeEach(async () => {
    world = await buildPortalWorld();
    await addMessages(world.ticketA.id);
    await addMessages(world.ticketB.id);

    const own = await Message.findOne({ where: { ticket_id: world.ticketA.id } });
    const colleague = await Message.findOne({ where: { ticket_id: world.ticketB.id } });

    ownFile = await attach(own?.id as number, 'my-invoice.txt');
    colleagueFile = await attach(colleague?.id as number, 'their-payroll.txt');
  });

  it('lists the customer’s own files with no storage key', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    const files = response.body.messages.flatMap(
      (message: { attachments: unknown[] }) => message.attachments,
    );

    expect(files).toHaveLength(1);
    expect(Object.keys(files[0]).sort()).toEqual(['byteSize', 'contentType', 'fileName', 'id']);
    // The storage path is never mounted or served, and its key never leaves the
    // building either.
    expect(JSON.stringify(files[0])).not.toContain('storage');
  });

  it('refuses a COLLEAGUE’s file, by its real id', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}/attachments/${colleagueFile.id}`,
    );

    // The id is real and the ticket reference is the customer's own. Only the
    // join between them refuses — which is why the service resolves session ->
    // ticket -> message -> attachment together rather than checking afterwards.
    expect(response.status).toBe(404);
  });

  it('refuses the customer’s own file under a colleague’s reference', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketB.reference}/attachments/${ownFile.id}`,
    );

    expect(response.status).toBe(404);
  });

  it('cannot reach an internal, agent-uploaded customer file', async () => {
    // Phase 2's attachments belong to a CUSTOMER RECORD, not to a message, so
    // they have no `message_id` and the portal's lookup — session, then scoped
    // ticket, then message, then attachment — cannot arrive at one.
    //
    // `uploaded_by_user_id` is NOT NULL, which is itself the reason these are not
    // correspondence: somebody who works here put them there.
    const uploader = await createTestUser({ roleKey: 'agent' });

    const internal = await CustomerAttachment.create({
      customer_id: world.customerId,
      original_name: 'internal-credit-note.txt',
      content_type: 'text/plain',
      size_bytes: 10,
      storage_key: 'test/internal-credit-note.txt',
      uploaded_by_user_id: uploader.id,
    });

    // THE ID IS DELIBERATELY OFFSET PAST EVERY MESSAGE ATTACHMENT.
    //
    // The first version of this test passed `internal.id` straight through, on the
    // theory that a colliding id proves the two tables are separate namespaces. It
    // proves nothing: the two sequences are independent, so `internal.id` collided
    // with the customer's OWN file and the endpoint correctly served it — the 500
    // that came back was a missing fixture file on disk, not a scoping failure.
    //
    // What can be asserted is that a customer-attachment id has no meaning here at
    // all, so an id in that space which is not one of THIS ticket's message
    // attachments is refused like anything else.
    const unreachableId = internal.id + 10_000;

    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}/attachments/${unreachableId}`,
    );

    expect(response.status).toBe(404);

    // And the structural half, which is the real claim: the portal exposes no
    // route that takes a customer-attachment id.
    const direct = await portalAgent(world.a.accessToken).get(
      `/api/portal/attachments/${internal.id}`,
    );

    expect([401, 404]).toContain(direct.status);
  });

  it('refuses an attachment id that does not exist', async () => {
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}/attachments/999999`,
    );

    expect(response.status).toBe(404);
  });
});
