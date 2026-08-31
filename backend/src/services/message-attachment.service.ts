import { fileTypeFromBuffer } from 'file-type';

import type { InboundAttachment } from '../channels/types.js';
import { env } from '../config/env.js';
import * as fileStorage from '../lib/file-storage.js';
import { MessageAttachment } from '../models/index.js';

/**
 * Files that arrived with a message.
 *
 * REUSES PHASE 2'S RULES RATHER THAN DEFINING A SECOND REGIME (spec
 * Assumptions): the same storage path, the same size ceiling, the same
 * content-sniffed type check, and the same rule that nothing under the storage
 * path is ever served statically. What differs is the owner — Phase 2's
 * attachments belong to a customer record, these to one message.
 *
 * INTAKE MUST NOT FAIL BECAUSE OF AN ATTACHMENT. A refused file is recorded as
 * refused and the message still becomes a ticket. Losing a customer's question
 * because they attached a .exe to it would be the wrong trade every time: the
 * question is the thing somebody is waiting on.
 */

export interface StoreOutcome {
  stored: boolean;
  reason: string | null;
}

/**
 * Type from CONTENT, never from the file name or the sender's claim.
 *
 * Same rule as Phase 2 (FR-032, FR-035). An inbound message is the least
 * trustworthy input this system has: a `.pdf` from a stranger is a claim, and a
 * sniffed type is a fact.
 */
async function sniff(buffer: Buffer): Promise<{ contentType: string; extension: string } | null> {
  const found = await fileTypeFromBuffer(buffer);

  if (found) return { contentType: found.mime, extension: found.ext };

  // `file-type` cannot identify plain text — it has no magic number. Accepting
  // it when the allow-list permits it matters here more than in Phase 2,
  // because a .txt or .csv attached to an email is entirely ordinary.
  if (env.ATTACHMENT_ALLOWED_TYPES.includes('text/plain') && looksLikePlainText(buffer)) {
    return { contentType: 'text/plain', extension: 'txt' };
  }

  return null;
}

function looksLikePlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 512);

  // A NUL byte means binary. Everything else is decoded and checked for
  // replacement characters, which is how invalid UTF-8 announces itself.
  if (sample.includes(0)) return false;

  return !sample.toString('utf8').includes('�');
}

export async function store(
  messageId: number,
  attachment: InboundAttachment,
): Promise<StoreOutcome> {
  if (attachment.content.byteLength > env.ATTACHMENT_MAX_BYTES) {
    return { stored: false, reason: 'too_large' };
  }

  const identified = await sniff(attachment.content);

  if (!identified) {
    return { stored: false, reason: 'type_not_identified' };
  }

  if (!env.ATTACHMENT_ALLOWED_TYPES.includes(identified.contentType.toLowerCase())) {
    return { stored: false, reason: 'type_not_allowed' };
  }

  // FILE FIRST, ROW SECOND, as Phase 2 established (FR-034): an orphan file is
  // harmless and sweepable, a row pointing at a file that was never written is
  // a broken download.
  const written = await fileStorage.store(attachment.content, identified.extension);

  try {
    await MessageAttachment.create({
      message_id: messageId,
      // Displayed only. Never used to build a path.
      file_name: attachment.fileName.slice(0, 255),
      content_type: identified.contentType,
      byte_size: attachment.content.byteLength,
      storage_key: written.storageKey,
      // FR-036: an image an HTML body references by Content-ID is not a
      // document the customer chose to send, and is not listed as one.
      is_inline: attachment.isInline,
    });

    return { stored: true, reason: null };
  } catch (error) {
    await fileStorage.remove(written.storageKey);
    throw error;
  }
}

export interface AttachmentView {
  id: number;
  fileName: string;
  contentType: string;
  byteSize: number;
}

/**
 * What an agent sees against a message. INLINE IMAGES ARE EXCLUDED (FR-036) —
 * listing a signature logo and a tracking pixel beside the one file the
 * customer actually attached buries the thing they sent.
 */
export async function listFor(messageIds: number[]): Promise<Map<number, AttachmentView[]>> {
  if (messageIds.length === 0) return new Map();

  const rows = await MessageAttachment.findAll({
    where: { message_id: messageIds, is_inline: false },
    order: [['id', 'ASC']],
  });

  const byMessage = new Map<number, AttachmentView[]>();

  for (const row of rows) {
    const list = byMessage.get(row.message_id) ?? [];

    list.push({
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      byteSize: row.byte_size,
    });

    byMessage.set(row.message_id, list);
  }

  return byMessage;
}

export async function findForDownload(attachmentId: number): Promise<MessageAttachment | null> {
  return MessageAttachment.findByPk(attachmentId);
}
