import { fileTypeFromBuffer } from 'file-type';
import type { ReadStream } from 'node:fs';

import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError, notFound, validationError } from '../errors/app-error.js';
import * as fileStorage from '../lib/file-storage.js';
import { Customer, CustomerAttachment, User } from '../models/index.js';

import * as auditService from './audit.service.js';
import type { Actor, AuditContext } from './customer.service.js';

export interface AttachmentView {
  id: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { id: number; fullName: string };
  createdAt: Date;
}

type WithUploader = CustomerAttachment & { uploader?: User };

function toView(attachment: WithUploader): AttachmentView {
  return {
    id: attachment.id,
    originalName: attachment.original_name,
    contentType: attachment.content_type,
    sizeBytes: attachment.size_bytes,
    uploadedBy: {
      id: attachment.uploaded_by_user_id,
      fullName: attachment.uploader?.full_name ?? '',
    },
    createdAt: attachment.created_at,
    // storage_key is NEVER returned. It is an internal locator, and exposing it
    // would invite someone to try addressing the file directly.
  };
}

async function requireCustomer(customerId: number): Promise<Customer> {
  const customer = await Customer.findByPk(customerId);

  if (!customer) {
    throw notFound();
  }

  return customer;
}

export async function list(customerId: number): Promise<{ items: AttachmentView[] }> {
  await requireCustomer(customerId);

  const rows = await CustomerAttachment.findAll({
    where: { customer_id: customerId },
    include: [{ model: User, as: 'uploader' }],
    order: [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  return { items: rows.map((row) => toView(row as WithUploader)) };
}

/**
 * Text files carry no magic bytes, so `file-type` cannot identify them. Rather
 * than rejecting every .txt, a plain-text upload is accepted when the allow-list
 * permits text/plain AND the bytes contain no NUL — which is what would
 * indicate a binary wearing a .txt extension.
 */
function looksLikePlainText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 8192).includes(0);
}

export async function upload(
  customerId: number,
  file: { originalname: string; buffer: Buffer; size: number } | undefined,
  actor: Actor,
  context: AuditContext = {},
): Promise<AttachmentView> {
  const customer = await requireCustomer(customerId);

  if (!file) {
    throw validationError([{ field: 'file', message: 'attachment.error.required' }]);
  }

  // Type comes from the file's CONTENT. The extension and the client-supplied
  // MIME type are both claims, not facts (FR-032). A PNG renamed .pdf is
  // refused here.
  const sniffed = await fileTypeFromBuffer(file.buffer);
  const allowed = env.ATTACHMENT_ALLOWED_TYPES;

  let contentType: string;
  let extension: string;

  if (sniffed) {
    contentType = sniffed.mime;
    extension = sniffed.ext;
  } else if (allowed.includes('text/plain') && looksLikePlainText(file.buffer)) {
    contentType = 'text/plain';
    extension = 'txt';
  } else {
    throw new AppError('VALIDATION_ERROR', 415, 'That file type is not allowed.', [
      { field: 'file', message: 'attachment.error.typeNotAllowed' },
    ]);
  }

  if (!allowed.includes(contentType.toLowerCase())) {
    throw new AppError('VALIDATION_ERROR', 415, 'That file type is not allowed.', [
      { field: 'file', message: 'attachment.error.typeNotAllowed' },
    ]);
  }

  // FILE FIRST, ROW SECOND (FR-034). An orphan file is harmless and sweepable;
  // a committed row pointing at a file that was never written is a broken
  // download.
  const stored = await fileStorage.store(file.buffer, extension);

  try {
    const created = await sequelize.transaction(async (transaction) => {
      const attachment = await CustomerAttachment.create(
        {
          customer_id: customerId,
          uploaded_by_user_id: actor.id,
          // Kept for display and Content-Disposition only — never a path.
          original_name: file.originalname,
          storage_key: stored.storageKey,
          content_type: contentType,
          size_bytes: file.size,
        },
        { transaction },
      );

      await auditService.record(
        {
          action: auditService.AUDIT_ACTIONS.CUSTOMER_ATTACHMENT_UPLOADED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'customer',
          targetId: customer.id,
          targetLabel: customer.display_name,
          metadata: {
            attachmentId: attachment.id,
            originalName: file.originalname,
            contentType,
            sizeBytes: file.size,
          },
          ...context,
        },
        transaction,
      );

      return attachment;
    });

    return toView(created as WithUploader);
  } catch (error) {
    // The row never committed, so the file must not survive.
    await fileStorage.remove(stored.storageKey);
    throw error;
  }
}

export interface DownloadTarget {
  stream: ReadStream;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Permission is checked by the route before this is reached; the file is never
 * served statically, so obtaining an address achieves nothing (FR-033).
 */
export async function getForDownload(
  customerId: number,
  attachmentId: number,
): Promise<DownloadTarget> {
  const attachment = await CustomerAttachment.findOne({
    where: { id: attachmentId, customer_id: customerId },
  });

  if (!attachment) {
    throw notFound();
  }

  return {
    stream: fileStorage.readStream(attachment.storage_key),
    originalName: attachment.original_name,
    contentType: attachment.content_type,
    sizeBytes: attachment.size_bytes,
  };
}

export async function remove(
  customerId: number,
  attachmentId: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const customer = await requireCustomer(customerId);
  const attachment = await CustomerAttachment.findOne({
    where: { id: attachmentId, customer_id: customerId },
  });

  if (!attachment) {
    throw notFound();
  }

  const storageKey = attachment.storage_key;

  await sequelize.transaction(async (transaction) => {
    await attachment.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CUSTOMER_ATTACHMENT_DELETED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        metadata: { attachmentId, originalName: attachment.original_name },
        ...context,
      },
      transaction,
    );
  });

  // After the commit: the attachment is already unreachable through the
  // application, which is what FR-035 asks. A failure here leaves a file that
  // nothing references — logged rather than thrown, since the requirement is
  // already met.
  await fileStorage.remove(storageKey);
}
