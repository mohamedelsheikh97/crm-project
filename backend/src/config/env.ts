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
