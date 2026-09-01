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

    // Agent dashboard (Phase 4, research.md D3). How long before a ticket's
    // due date its assignee is warned. ONE system-wide value on purpose: the
    // spec's Assumptions fix it as system-wide, and per-priority or
    // per-customer thresholds are Phase 6's SLA policy, not this phase's.
    DUE_WARNING_LEAD_MINUTES: z.coerce.number().int().positive().optional().default(60),

    // SLA and automation (Phase 6, research.md D15). ONLY operational tuning
    // lives here. Policies, the business calendar, the assignment strategy,
    // alert subscriptions, and automation rules are all DATABASE ROWS, because
    // FR-001, FR-026, FR-043, FR-054 and FR-079 require an administrator to
    // edit them at runtime with an audit entry — and an environment variable is
    // neither editable through a screen nor auditable.
    //
    // How far ahead of a target the at-risk warning fires. Phase 4's
    // DUE_WARNING_LEAD_MINUTES above is its ancestor and stays: that one warns
    // about a due date, this one about an SLA target.
    SLA_WARNING_LEAD_MINUTES: z.coerce.number().int().positive().optional().default(60),

    // The rule cascade bound (FR-062). Depth 0 is the originating event, so 3
    // permits "arrival sets priority → priority change assigns → assignment
    // notifies" and stops a cycle within a second. Raising it raises the cost
    // of a misconfiguration, which is why it is deployment configuration rather
    // than a screen.
    AUTOMATION_MAX_DEPTH: z.coerce.number().int().positive().optional().default(3),

    // The FR-078 ceiling, per recipient per hour. A misconfigured rule with an
    // outbound action is a machine that can send thousands of messages at real
    // cost; Phase 5's per-conversation limits were never designed to stop it.
    ALERT_MAX_PER_RECIPIENT_PER_HOUR: z.coerce.number().int().positive().optional().default(20),

    // Communication channels (Phase 5, research.md D1-D2). Every channel
    // defaults to `simulator`, which exercises the whole inbound and outbound
    // path without contacting anything. That default is what makes the phase
    // testable with no commercial account (FR-005b) — and why
    // channels/registry.ts refuses to start a PRODUCTION process against one
    // (FR-005c). A simulator in production is the single invisible failure in
    // this phase: tickets keep arriving and replies keep reporting sent, while
    // no customer ever hears anything.
    CHANNEL_EMAIL_PROVIDER: z.enum(['simulator', 'imap-smtp']).optional().default('simulator'),
    CHANNEL_WHATSAPP_PROVIDER: z.enum(['simulator', 'cloud-api']).optional().default('simulator'),
    CHANNEL_SMS_PROVIDER: z.enum(['simulator', 'gateway']).optional().default('simulator'),

    MAIL_POLL_SECONDS: z.coerce.number().int().positive().optional().default(60),

    // Per channel, per sender. Bounds provisional-customer creation, which is
    // the first way the outside world can add rows to `customers` (research D7).
    INTAKE_RATE_PER_MINUTE: z.coerce.number().int().positive().optional().default(60),
    // Chat and form submission, per visitor (FR-078, FR-086).
    PUBLIC_RATE_PER_MINUTE: z.coerce.number().int().positive().optional().default(20),

    // Origin permitted to embed the widget. Separate from CORS_ORIGIN: the
    // widget lives on a marketing site, the application does not.
    CHAT_WIDGET_ORIGIN: z.string().min(1).optional(),

    // Signs the `support+<token>@` reply address, the threading fallback for
    // clients that strip References (research D4). A guessed token must not be
    // able to attach a stranger's mail to someone else's ticket.
    CHANNEL_ADDRESS_TOKEN_SECRET: z.string().min(32).optional(),

    // --- Provider credentials. Required ONLY when the matching provider is not
    // `simulator`; the superRefine below enforces that pairing, so a channel
    // switched on without its credentials fails at startup rather than at the
    // first message (FR-005, FR-006).
    MAIL_IMAP_HOST: z.string().min(1).optional(),
    MAIL_IMAP_PORT: z.coerce.number().int().positive().optional().default(993),
    MAIL_IMAP_USER: z.string().min(1).optional(),
    MAIL_IMAP_PASSWORD: z.string().min(1).optional(),
    MAIL_SMTP_HOST: z.string().min(1).optional(),
    MAIL_SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
    MAIL_SMTP_USER: z.string().min(1).optional(),
    MAIL_SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM_ADDRESS: z.string().min(1).optional(),

    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),

    SMS_API_BASE_URL: z.string().min(1).optional(),
    SMS_API_KEY: z.string().min(1).optional(),
    SMS_SENDER_ID: z.string().min(1).optional(),
    SMS_WEBHOOK_SECRET: z.string().min(1).optional(),

    // --- Phase 8 — Customer Portal (research.md D1, D11).
    //
    // REQUIRED, not optional with a default. Every other Phase 8 knob has a
    // default because a missing value is an inconvenience; a missing portal
    // secret is not. The alternative to requiring them is falling back to the
    // staff secret, which is the one misconfiguration in this phase that works
    // perfectly until somebody notices they can act as a staff user.
    PORTAL_JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    PORTAL_JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),

    // How long an invitation stays usable. Seven days is long enough to survive
    // a holiday and short enough that a forwarded mailbox is not a standing key
    // (research open question 3). No requirement fixes it.
    PORTAL_INVITE_TTL_HOURS: z.coerce.number().int().positive().optional().default(168),
    // Base allowance for the portal rate-limit scopes. Authenticated scopes are
    // keyed by ACCOUNT, not by IP: an office behind one address is many
    // customers, and IP-keying would let one of them lock out the rest (D11).
    PORTAL_RATE_PER_MINUTE: z.coerce.number().int().positive().optional().default(20),
  })
  .superRefine((value, ctx) => {
    /**
     * FOUR SECRETS, PAIRWISE DISTINCT (Phase 1 research D5; Phase 8 research D1).
     *
     * Phase 1 needed two so a refresh token could not be presented as an access
     * token. Phase 8 needs four so a CUSTOMER token cannot be presented as a
     * STAFF one — and that axis matters more, because the staff realm resolves
     * its subject against `users` and would hand back a real role.
     *
     * Checked pairwise rather than by set size so the message names the pair
     * that collided. A developer who reused one value wants to be told which.
     */
    const secrets: ReadonlyArray<readonly [name: string, secret: string]> = [
      ['JWT_ACCESS_SECRET', value.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', value.JWT_REFRESH_SECRET],
      ['PORTAL_JWT_ACCESS_SECRET', value.PORTAL_JWT_ACCESS_SECRET],
      ['PORTAL_JWT_REFRESH_SECRET', value.PORTAL_JWT_REFRESH_SECRET],
    ];

    for (const [index, [name, secret]] of secrets.entries()) {
      for (const [earlierName, earlierSecret] of secrets.slice(0, index)) {
        if (secret === earlierSecret) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `must differ from ${earlierName}`,
          });
        }
      }
    }

    /**
     * Credentials are required by the PROVIDER CHOICE, not by an enablement
     * flag (Phase 5, FR-005). Enablement lives in `channel_settings` where an
     * administrator can change it at runtime; the provider lives here because
     * it decides which code runs. Pairing the check to the provider means the
     * failure surfaces at startup with the variable named, which is the whole
     * point of this file.
     */
    const required = (
      condition: boolean,
      keys: readonly (keyof typeof value)[],
      because: string,
    ): void => {
      if (!condition) return;

      for (const key of keys) {
        if (value[key] === undefined || value[key] === '') {
          ctx.addIssue({ code: 'custom', path: [key as string], message: `required ${because}` });
        }
      }
    };

    required(
      value.CHANNEL_EMAIL_PROVIDER === 'imap-smtp',
      [
        'MAIL_IMAP_HOST',
        'MAIL_IMAP_USER',
        'MAIL_IMAP_PASSWORD',
        'MAIL_SMTP_HOST',
        'MAIL_SMTP_USER',
        'MAIL_SMTP_PASSWORD',
        'MAIL_FROM_ADDRESS',
      ],
      'when CHANNEL_EMAIL_PROVIDER is "imap-smtp"',
    );

    required(
      value.CHANNEL_WHATSAPP_PROVIDER === 'cloud-api',
      [
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_VERIFY_TOKEN',
      ],
      'when CHANNEL_WHATSAPP_PROVIDER is "cloud-api"',
    );

    required(
      value.CHANNEL_SMS_PROVIDER === 'gateway',
      ['SMS_API_BASE_URL', 'SMS_API_KEY', 'SMS_SENDER_ID', 'SMS_WEBHOOK_SECRET'],
      'when CHANNEL_SMS_PROVIDER is "gateway"',
    );

    // The address-token fallback is only reachable on real mail, so it is only
    // required there (research D4).
    required(
      value.CHANNEL_EMAIL_PROVIDER === 'imap-smtp',
      ['CHANNEL_ADDRESS_TOKEN_SECRET'],
      'when CHANNEL_EMAIL_PROVIDER is "imap-smtp"',
    );
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
