import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';

/**
 * Attachment storage on the filesystem (research.md D2).
 *
 * Pure mechanism — no model access, no business rules — which is why this lives
 * in `lib/` rather than `services/`. The interface is deliberately narrow so
 * object storage can replace it in a later phase without touching a service.
 *
 * Two rules are enforced here and nowhere else:
 *
 * 1. The stored name is GENERATED. The user's filename never reaches the
 *    filesystem — it is attacker-controlled input, and `../..` inside one is
 *    how it becomes a path traversal.
 * 2. A key that is not a plain generated identifier is REJECTED, so a crafted
 *    value read back from anywhere cannot escape the directory.
 *
 * The directory this writes to must never be served statically. Every download
 * streams through an authenticated, permission-checked endpoint (FR-033).
 */

/** `<uuid>.<ext>` — nothing else is a valid key. */
const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$/;

function storageRoot(): string {
  return path.resolve(env.ATTACHMENT_STORAGE_PATH);
}

/**
 * Resolves a key to an absolute path, refusing anything that is not a generated
 * identifier.
 *
 * The pattern check alone would be enough, but the containment check below is
 * kept as a second barrier: defence against a future change loosening the
 * pattern without anyone noticing what it was protecting.
 */
export function resolvePath(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error('Invalid storage key.');
  }

  const root = storageRoot();
  const resolved = path.resolve(root, storageKey);

  if (resolved !== path.join(root, storageKey)) {
    throw new Error('Invalid storage key.');
  }

  return resolved;
}

export interface StoredFile {
  storageKey: string;
  absolutePath: string;
}

/**
 * Writes the file and returns its generated key.
 *
 * Callers MUST write the file before committing the database row, and call
 * `remove` if the commit fails. An orphan file is harmless and sweepable; a
 * committed row pointing at a file that was never written is a broken download
 * (FR-034).
 */
export async function store(buffer: Buffer, extension: string): Promise<StoredFile> {
  const root = storageRoot();
  await mkdir(root, { recursive: true });

  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const storageKey = safeExtension ? `${randomUUID()}.${safeExtension}` : randomUUID();
  const absolutePath = resolvePath(storageKey);

  await writeFile(absolutePath, buffer);

  return { storageKey, absolutePath };
}

export function readStream(storageKey: string): ReadStream {
  return createReadStream(resolvePath(storageKey));
}

/**
 * Removes a stored file. Never throws for a file that is already gone —
 * removal is called both on a rollback path and on a delete path, and neither
 * should fail because the file was not there.
 */
export async function remove(storageKey: string): Promise<void> {
  try {
    await unlink(resolvePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
