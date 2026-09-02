import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

import { classifyHost, hostOf } from '../lib/net-address.js';

// There is exactly one .env and it lives at the repository root (FR-001).
// backend/src/config -> backend/src -> backend -> repo root.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, '../../../.env') });

/**
 * A boolean environment variable (Phase 9).
 *
 * NOT `z.coerce.boolean()`. That is `Boolean(value)`, which makes the string
 * `"false"` TRUE — so `AI_ENABLED=false` would enable the phase, and
 * `AI_ASSISTANT_ENABLED=false` would put a chatbot in front of customers. The
 * defaults are all `false`, which means the coercion bug only ever fails open.
 *
 * Explicit truthy tokens only; anything else, including an empty string, an
 * absent variable, and every typo, is false.
 */
function envFlag() {
  return z
    .string()
    .optional()
    .default('false')
    .transform((value) => ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()));
}

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

    // --- Phase 9 — AI Features (research.md D2, D4, D11, D12).
    //
    // THE EGRESS SPLIT IS NOT CONFIGURABLE HERE, and its absence is the point.
    // Clarifications Q1 lets staff-facing features use an external provider and
    // forbids it for the customer-facing assistant. There is deliberately no
    // AI_ASSISTANT_PROVIDER or AI_*_LOCATION variable: a boundary that lives in
    // a settings value is one careless edit from sending customer chat to a
    // third party, with nothing failing and no error raised (FR-008a).
    // Which processor serves which feature is decided by which factory module a
    // service imports, and `backend/tests/ai/egress.test.ts` reads the import
    // graph to prove it.
    AI_ENABLED: envFlag(),

    // Staff-facing processing. May leave the system (Clarifications Q1).
    AI_EXTERNAL_API_KEY: z.string().min(1).optional(),

    // Customer-facing processing. MUST NOT leave controlled infrastructure.
    // Validated below as a private address: the assistant refuses to run rather
    // than reach a public endpoint (FR-008, FR-008b).
    AI_LOCAL_BASE_URL: z.string().url().optional(),

    AI_SUMMARY_ENABLED: envFlag(),
    AI_DRAFT_ENABLED: envFlag(),
    AI_CLASSIFY_ENABLED: envFlag(),
    AI_SIMILAR_ENABLED: envFlag(),
    AI_ASSISTANT_ENABLED: envFlag(),

    // Daily invocation ceilings per feature (D11). A ceiling is not a rate
    // limit: the limiter stops one principal hammering a surface within a
    // minute, this stops the monthly bill running away across all of them over
    // a day. Counted from `ai_invocations` rather than memory, because a
    // spending limit that resets on deploy is not a limit.
    AI_CEILING_SUMMARY: z.coerce.number().int().positive().optional().default(500),
    AI_CEILING_DRAFT: z.coerce.number().int().positive().optional().default(500),
    AI_CEILING_CLASSIFY: z.coerce.number().int().positive().optional().default(2000),
    AI_CEILING_ASSISTANT: z.coerce.number().int().positive().optional().default(2000),

    // Which languages the assistant will answer in (D4). A language not listed
    // falls through to the Phase 8 ticket route. Self-hostable models are
    // materially weaker in Arabic, and an assistant that answers Arabic
    // customers confusingly is worse for them than one that routes them to a
    // person — so English-only is a SUPPORTED configuration, not a degradation.
    AI_ASSISTANT_LANGS: z
      .string()
      .optional()
      .default('en')
      .transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part === 'ar' || part === 'en'),
      ),

    // Below this retrieval score the assistant does not call a model at all
    // (D3 step 2). The single most consequential number in the phase, and the
    // one every test passes at either extreme — see research open question 1.
    AI_ASSISTANT_GROUNDING_FLOOR: z.coerce.number().min(0).optional().default(0.35),

    /**
     * Phase 11 — Integrations.
     *
     * `envFlag()` for every boolean, NEVER `z.coerce.boolean()`. Phase 9 shipped
     * that bug and the comment above records why it survived review:
     * `Boolean("false") === true`, so a flag explicitly switched off would have
     * read as ON, and it only ever failed open because every AI default was
     * false. The same trap is here, and this phase has a flag whose wrong value
     * would expose a published interface rather than merely enable a feature.
     */
    INTEGRATIONS_ENABLED: envFlag(),

    /**
     * Which ERP adapter runs. THE ENVIRONMENT DECIDES WHICH CODE RUNS;
     * enablement is a database setting an administrator changes at runtime —
     * the division `channels/registry.ts` established in Phase 5, and the
     * reason ERP sync can be switched off without a deployment but cannot be
     * re-pointed at a different adapter through a screen.
     */
    ERP_PROVIDER: z.enum(['simulator']).optional().default('simulator'),

    /**
     * Delivery is separable from the rest of the phase on purpose: an operator
     * troubleshooting a runaway receiver needs to stop DELIVERING without
     * taking the published interface down with it. Events keep accumulating in
     * the outbox meanwhile, so nothing is lost by switching this off.
     */
    WEBHOOK_DELIVERY_ENABLED: envFlag(),

    /**
     * Per-attempt timeout. Not optional in spirit: a receiver that accepts a
     * connection and never answers would otherwise hold a socket for as long as
     * the OS allows, and enough of them exhaust the pool.
     */
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),

    /** Requests per credential per five minutes (research D17). */
    API_RATE_LIMIT_PER_WINDOW: z.coerce.number().int().positive().optional().default(600),

    /**
     * How long a rotated-out secret keeps working. One working day by default,
     * so an integrator can redeploy without a failed request — FR-018's whole
     * point is that rotating is not an outage, because a credential nobody can
     * rotate without downtime is a credential nobody rotates.
     */
    CREDENTIAL_ROTATION_OVERLAP_HOURS: z.coerce.number().int().positive().optional().default(24),

    /**
     * Retention for events, delivery attempts and sync runs. They answer the
     * same kind of after-the-fact question an audit record does, so they get
     * the same basis.
     */
    INTEGRATION_RETENTION_DAYS: z.coerce.number().int().positive().optional().default(90),

    /**
     * The key that encrypts webhook signing secrets at rest (`lib/secret-box.ts`).
     *
     * NEEDED BECAUSE THIS SYSTEM SIGNS AND THE SUBSCRIBER VERIFIES — the reverse
     * of every other secret here, all of which are hashed because somebody else
     * holds them and we only verify. HMAC needs the key material, so a digest
     * cannot serve.
     *
     * 32 bytes, base64. Distinct from every JWT secret: those authenticate
     * people and this one protects a secret we send signatures with, and reusing
     * one value across both would mean a leak of either compromised both.
     */
    /**
     * Lets webhook delivery reach a loopback address. TEST ONLY.
     *
     * ═══════════════════════════════════════════════════════════════════════
     * THE `superRefine` BELOW MAKES THIS IMPOSSIBLE OUTSIDE `NODE_ENV=test`.
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Delivery is tested against a real HTTP server rather than a mocked
     * `fetch`, because mocking would let the suite pass while the signature was
     * computed over a re-serialised body, while `redirect: 'manual'` was
     * missing, or while the timeout was never applied — every one of which is a
     * real defect this phase can ship, and none of which a mock would notice.
     *
     * A real server in a test binds to 127.0.0.1, which FR-034's guard refuses.
     * So the guard needs one door, and the door has to be one that cannot be
     * opened in production: the validation below REFUSES TO START if this is
     * true and the environment is not `test`.
     *
     * That is a stronger guarantee than a comment saying "do not set this",
     * and it keeps the guard's production behaviour identical — there is no
     * branch in `delivery.ts` that a deployment could reach.
     */
    WEBHOOK_ALLOW_LOOPBACK: envFlag(),

    WEBHOOK_SIGNING_KEY: z
      .string()
      .optional()
      .default('')
      .refine(
        (value) => value === '' || Buffer.from(value, 'base64').length === 32,
        'must be 32 bytes, base64-encoded (openssl rand -base64 32)',
      ),
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
    /**
     * THE TEST-ONLY DOOR IS BOLTED SHUT OUTSIDE TESTS.
     *
     * `WEBHOOK_ALLOW_LOOPBACK` exists so delivery can be tested against a real
     * local HTTP server. In any other environment it would turn webhook
     * delivery into a server-side request forgery primitive — a subscriber
     * naming an internal address and reading the response — which is precisely
     * what FR-034 exists to prevent.
     *
     * Refusing to START is deliberate rather than ignoring the flag: a
     * deployment that set it has a misunderstanding worth surfacing loudly, and
     * silently overriding it would leave somebody believing it worked.
     */
    if (value.WEBHOOK_ALLOW_LOOPBACK && value.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_ALLOW_LOOPBACK'],
        message:
          'may only be true when NODE_ENV=test. Outside tests it would let a webhook ' +
          "subscription make this server probe its own network on the subscriber's behalf " +
          '(FR-034).',
      });
    }

    /**
     * Webhook delivery cannot sign without its key, so it refuses to start
     * rather than sending unsigned payloads — the same fail-closed posture
     * Phase 9 applies to its AI provider configuration.
     *
     * Checked only when delivery is enabled, so a deployment not using webhooks
     * needs no key.
     */
    if (value.INTEGRATIONS_ENABLED && value.WEBHOOK_DELIVERY_ENABLED) {
      if (value.WEBHOOK_SIGNING_KEY === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_SIGNING_KEY'],
          message:
            'is required when WEBHOOK_DELIVERY_ENABLED is true. Without it a payload could only ' +
            'be sent unsigned, and an unsigned notification is one a receiver cannot trust ' +
            '(FR-027). Generate one with: openssl rand -base64 32',
        });
      }
    }

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

    /**
     * PHASE 9 STARTUP REFUSALS (contracts/provider-contract.md § Startup refusal).
     *
     * Phase 8 established the pattern and the reason transfers exactly: a
     * misconfiguration that works perfectly until somebody notices is worse
     * than one that stops the process. An assistant quietly answering customers
     * through an external provider is precisely that kind of misconfiguration,
     * and nothing downstream would raise an error.
     */
    const staffAiEnabled =
      value.AI_ENABLED &&
      (value.AI_SUMMARY_ENABLED || value.AI_DRAFT_ENABLED || value.AI_CLASSIFY_ENABLED);

    required(
      staffAiEnabled,
      ['AI_EXTERNAL_API_KEY'],
      'when AI_ENABLED is true with a staff-facing AI feature enabled',
    );

    const assistantEnabled = value.AI_ENABLED && value.AI_ASSISTANT_ENABLED;

    required(
      assistantEnabled,
      ['AI_LOCAL_BASE_URL'],
      'when AI_ASSISTANT_ENABLED is true — the assistant has no external fallback (FR-008b)',
    );

    // The assistant's processor must be on infrastructure the organisation
    // controls. Checked HERE rather than at call time so a public URL stops the
    // process instead of quietly serving one customer conversation offsite.
    if (assistantEnabled && value.AI_LOCAL_BASE_URL) {
      /**
       * THE ADDRESS RANGES NOW LIVE IN ONE PLACE (Phase 11, research D10).
       *
       * `lib/net-address.ts` classifies a host; this call site states which
       * answer it requires. Phase 11's webhook delivery requires the OPPOSITE
       * one, and the two assertions are named for their direction so a mistake
       * reads wrong at the call site rather than looking fine.
       *
       * Sharing the classifier means a correction to the ranges — the
       * link-local block covering cloud metadata was missing here, for
       * instance — reaches both rules instead of one.
       */
      const isPrivate = classifyHost(hostOf(value.AI_LOCAL_BASE_URL)) === 'private';

      if (!isPrivate) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_LOCAL_BASE_URL'],
          message:
            'must resolve to controlled infrastructure (loopback, RFC1918, .internal or .local). ' +
            'The customer-facing assistant must not reach a public endpoint (FR-008).',
        });
      }
    }

    // AI_ENABLED with nothing enabled is almost always a half-finished edit.
    // Refusing is kinder than starting a system whose AI surfaces are all absent
    // for a reason nobody can see.
    if (
      value.AI_ENABLED &&
      !value.AI_SUMMARY_ENABLED &&
      !value.AI_DRAFT_ENABLED &&
      !value.AI_CLASSIFY_ENABLED &&
      !value.AI_SIMILAR_ENABLED &&
      !value.AI_ASSISTANT_ENABLED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_ENABLED'],
        message: 'is true but no AI feature is enabled — enable one, or set AI_ENABLED=false',
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
