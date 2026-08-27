import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

// There is exactly one .env and it lives at the repository root (FR-001).
// backend/src/config -> backend/src -> backend -> repo root.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, '../../../.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    PORT: z.coerce.number().int().positive(),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive(),
    DB_NAME: z.string().min(1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CORS_ORIGIN: z
      .string()
      .min(1)
      .refine((value) => value !== '*', {
        message: 'must be an explicit origin; credentialed CORS forbids the wildcard "*"',
      }),
    LOG_LEVEL: z.string().min(1).optional().default('info'),

    // Account security policy (Phase 1, research.md D7). All optional with
    // defaults, so an existing .env keeps working. Read once at startup, so a
    // change requires a restart.
    PASSWORD_MIN_LENGTH: z.coerce
      .number()
      .int()
      // Floored at 8: the policy must not be configurable below the minimum
      // the service layer already enforced in Phase 0.
      .min(8, 'must be at least 8')
      .optional()
      .default(12),
    PASSWORD_HISTORY_SIZE: z.coerce.number().int().positive().optional().default(5),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().optional().default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().optional().default(15),

    // Customer attachments and phone handling (Phase 2, research.md D1-D2).
    // All optional with defaults, so an existing .env keeps working.

    // Must never sit under a statically served directory — every download goes
    // through a permission-checked endpoint (FR-033).
    ATTACHMENT_STORAGE_PATH: z.string().min(1).optional().default('./storage/attachments'),
    ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().optional().default(10_485_760),
    // Matched against the type sniffed from file CONTENT, never the extension
    // or the client's Content-Type (FR-032).
    ATTACHMENT_ALLOWED_TYPES: z
      .string()
      .optional()
      .default(
        'application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,' +
          'application/msword,' +
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
          'application/vnd.ms-excel,' +
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .transform((value) =>
        value
          .split(',')
          .map((type) => type.trim().toLowerCase())
          .filter(Boolean),
      ),
    // Parses a number entered without a country code, so +20 100 123 4567 and
    // 01001234567 are recognised as the same number. Duplicate detection —
    // this phase's Definition of done — depends on it.
    DEFAULT_PHONE_REGION: z
      .string()
      .regex(/^[A-Z]{2}$/, 'must be a two-letter uppercase region code, e.g. EG')
      .optional()
      .default('EG'),
  })
  .superRefine((value, ctx) => {
    // Equal secrets would silently defeat the access/refresh type separation.
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // One line per variable, so the developer sees the full list rather than
  // fixing them one restart at a time (FR-017).
  for (const issue of parsed.error.issues) {
    const variable = issue.path.join('.') || '<unknown>';
    const label = process.env[variable] === undefined ? 'MISSING' : 'INVALID';
    process.stderr.write(`${label} ${variable}: ${issue.message}\n`);
  }
  process.stderr.write('Environment validation failed. See .env.example for the full list.\n');
  process.exit(1);
}

/**
 * The one and only place `process.env` is read (FR-017, research.md D8).
 * Every other module imports this frozen object instead.
 */
export const env = Object.freeze(parsed.data);

export type Env = typeof env;
