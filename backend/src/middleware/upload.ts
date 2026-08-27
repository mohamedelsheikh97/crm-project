import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

/**
 * Multipart handling for customer attachments.
 *
 * Memory storage on purpose: the size limit is small and the file is inspected
 * (sniffed for its real type) before anything is written, so buffering avoids
 * writing a file that is about to be rejected.
 *
 * The limit is applied HERE, before anything reaches disk (FR-031) — multer
 * aborts the stream once it is exceeded rather than accepting the whole upload
 * and checking afterwards.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ATTACHMENT_MAX_BYTES,
    files: 1,
  },
});

const singleFile = upload.single('file');

/**
 * Translates multer's own errors into the project's envelope, so a caller sees
 * the same shape they get from every other endpoint rather than a raw library
 * error.
 */
export function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  singleFile(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError('VALIDATION_ERROR', 413, 'The file is larger than the allowed limit.', [
            {
              field: 'file',
              message: 'attachment.error.tooLarge',
            },
          ]),
        );
        return;
      }

      next(
        new AppError('VALIDATION_ERROR', 400, 'The upload could not be read.', [
          { field: 'file', message: 'attachment.error.uploadFailed' },
        ]),
      );
      return;
    }

    next(error);
  });
}
