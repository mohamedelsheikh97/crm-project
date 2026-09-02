import { applyOverrides, AI_FEATURES, type AiFeatureKey } from '../ai/features.js';
import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { AiSetting } from '../models/ai-setting.model.js';

import { AUDIT_ACTIONS, record as recordAudit, type AuditEntry } from './audit.service.js';

/**
 * Runtime AI configuration (Phase 9, US6, FR-002, FR-062, SC-021).
 *
 * OWNS THE ONE ROW and pushes it into `ai/features.ts`, which is what every
 * service and the invocation path already read. That indirection is deliberate:
 * `features.ts` stays the single declaration of what the five features ARE
 * (research D12), and this service supplies what they currently are SET TO.
 *
 * SEEDED FROM THE ENVIRONMENT on first read, so a deployment that has never
 * opened the screen behaves exactly as it did when the flags were env-only.
 * After that the row wins, because FR-002 asks for an administrator to be able
 * to change it and an env var cannot be changed by one.
 *
 * NEVER RETURNS OR STORES A SECRET (FR-064). There is no API key here, no base
 * URL, and no processing location — see the migration for why the last of those
 * matters most.
 */
export interface AiConfigView {
  readonly enabled: boolean;
  readonly features: Record<AiFeatureKey, boolean>;
  readonly ceilings: Record<Exclude<AiFeatureKey, 'similar'>, number>;
  readonly assistantLangs: ReadonlyArray<'ar' | 'en'>;
  readonly groundingFloor: number;
}

/**
 * A short TTL rather than a process-lifetime cache.
 *
 * SC-021 wants a change visible "within one page load", and this application
 * may run as more than one process — so the process that served the PATCH is
 * not necessarily the one serving the next request. Ten seconds is short enough
 * to satisfy the requirement in practice and long enough that a hot path does
 * not query on every invocation.
 */
const TTL_MS = 10_000;

let cached: AiSetting | null = null;
let readAt = 0;

function parseLangs(value: string): Array<'ar' | 'en'> {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is 'ar' | 'en' => part === 'ar' || part === 'en');
}

function push(row: AiSetting): void {
  applyOverrides({
    summary: { enabled: row.summary_enabled, ceiling: row.ceiling_summary },
    draft: { enabled: row.draft_enabled, ceiling: row.ceiling_draft },
    classify: { enabled: row.classify_enabled, ceiling: row.ceiling_classify },
    similar: { enabled: row.similar_enabled, ceiling: null },
    assistant: { enabled: row.assistant_enabled, ceiling: row.ceiling_assistant },
    assistantLangs: parseLangs(row.assistant_langs),
    groundingFloor: row.grounding_floor,
  });
}

/** The row, created from the environment defaults if it does not exist yet. */
async function load(): Promise<AiSetting> {
  const existing = await AiSetting.findOne({ order: [['id', 'ASC']] });

  if (existing) return existing;

  return AiSetting.create({
    summary_enabled: env.AI_SUMMARY_ENABLED,
    draft_enabled: env.AI_DRAFT_ENABLED,
    classify_enabled: env.AI_CLASSIFY_ENABLED,
    similar_enabled: env.AI_SIMILAR_ENABLED,
    assistant_enabled: env.AI_ASSISTANT_ENABLED,
    ceiling_summary: env.AI_CEILING_SUMMARY,
    ceiling_draft: env.AI_CEILING_DRAFT,
    ceiling_classify: env.AI_CEILING_CLASSIFY,
    ceiling_assistant: env.AI_CEILING_ASSISTANT,
    assistant_langs: env.AI_ASSISTANT_LANGS.join(','),
    grounding_floor: env.AI_ASSISTANT_GROUNDING_FLOOR,
  });
}

/**
 * Ensures `features.ts` reflects the stored configuration.
 *
 * Called at the top of the invocation path, so no feature can be served from a
 * stale view of whether it is switched on.
 */
export async function ensureFresh(): Promise<void> {
  if (cached && Date.now() - readAt < TTL_MS) return;

  try {
    cached = await load();
    readAt = Date.now();
    push(cached);
  } catch {
    // The environment defaults already in `features.ts` stand. A settings read
    // that fails must not enable something an administrator turned off — and
    // because overrides are only ever applied on a successful read, a failure
    // leaves the last known good state rather than reverting to env.
  }
}

export async function current(): Promise<AiConfigView> {
  await ensureFresh();

  const row = cached ?? (await load());

  return {
    // The master switch stays in the environment: it is the "is this phase
    // deployed at all" flag that SC-022 leans on, not day-to-day operation.
    enabled: env.AI_ENABLED,
    features: {
      summary: row.summary_enabled,
      draft: row.draft_enabled,
      classify: row.classify_enabled,
      similar: row.similar_enabled,
      assistant: row.assistant_enabled,
    },
    ceilings: {
      summary: row.ceiling_summary,
      draft: row.ceiling_draft,
      classify: row.ceiling_classify,
      assistant: row.ceiling_assistant,
    },
    assistantLangs: parseLangs(row.assistant_langs),
    groundingFloor: row.grounding_floor,
  };
}

export interface ConfigPatch {
  features?: Partial<Record<AiFeatureKey, unknown>>;
  ceilings?: Partial<Record<string, unknown>>;
  assistantLangs?: unknown;
  groundingFloor?: unknown;
}

export interface Actor {
  readonly id: number;
  readonly email: string;
}

/**
 * Applies a patch, recording each kind of change as its own audit action.
 *
 * Enablement and ceilings get DISTINCT actions rather than one
 * `ai.config.changed` for everything (FR-062). They answer different questions:
 * "who turned the chatbot on" and "who raised the spending limit" are separate
 * incidents, and an administrator reading the log should not have to diff JSON
 * to tell them apart.
 */
export async function update(
  patch: ConfigPatch,
  actor: Actor,
  context: Pick<AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<AiConfigView> {
  const row = await load();
  const before = row.get({ plain: true });

  const changes: Partial<Record<string, boolean | number | string>> = {};
  const enablement: Array<{ feature: AiFeatureKey; enabled: boolean }> = [];
  const ceilings: Array<{ feature: string; from: number; to: number }> = [];

  for (const feature of AI_FEATURES) {
    const value = patch.features?.[feature];
    if (typeof value !== 'boolean') continue;

    const column = `${feature}_enabled` as keyof typeof before;
    if (before[column] === value) continue;

    changes[column as string] = value;
    enablement.push({ feature, enabled: value });
  }

  for (const feature of ['summary', 'draft', 'classify', 'assistant'] as const) {
    const value = patch.ceilings?.[feature];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) continue;

    const column = `ceiling_${feature}` as keyof typeof before;
    const from = Number(before[column]);
    if (from === value) continue;

    changes[column as string] = value;
    ceilings.push({ feature, from, to: value });
  }

  let langsChanged = false;

  if (typeof patch.assistantLangs === 'string' || Array.isArray(patch.assistantLangs)) {
    const raw = Array.isArray(patch.assistantLangs)
      ? patch.assistantLangs.join(',')
      : patch.assistantLangs;

    const langs = parseLangs(raw).join(',');

    if (langs !== before.assistant_langs) {
      changes.assistant_langs = langs;
      langsChanged = true;
    }
  }

  let floorChanged = false;

  if (
    typeof patch.groundingFloor === 'number' &&
    Number.isFinite(patch.groundingFloor) &&
    patch.groundingFloor >= 0 &&
    patch.groundingFloor <= 1 &&
    patch.groundingFloor !== Number(before.grounding_floor)
  ) {
    changes.grounding_floor = patch.groundingFloor;
    floorChanged = true;
  }

  if (Object.keys(changes).length === 0) return current();

  await sequelize.transaction(async (transaction) => {
    await row.update(changes, { transaction });

    for (const change of enablement) {
      await recordAudit(
        {
          action: change.enabled
            ? AUDIT_ACTIONS.AI_FEATURE_ENABLED
            : AUDIT_ACTIONS.AI_FEATURE_DISABLED,
          targetType: 'ai_feature',
          targetLabel: change.feature,
          actorUserId: actor.id,
          actorEmail: actor.email,
          ...context,
        },
        transaction,
      );
    }

    for (const change of ceilings) {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_CEILING_CHANGED,
          targetType: 'ai_feature',
          targetLabel: change.feature,
          actorUserId: actor.id,
          actorEmail: actor.email,
          previousValue: change.from,
          newValue: change.to,
          ...context,
        },
        transaction,
      );
    }

    if (langsChanged || floorChanged) {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_CONFIG_CHANGED,
          targetType: 'ai_config',
          actorUserId: actor.id,
          actorEmail: actor.email,
          previousValue: {
            assistantLangs: before.assistant_langs,
            groundingFloor: Number(before.grounding_floor),
          },
          newValue: {
            assistantLangs: changes.assistant_langs ?? before.assistant_langs,
            groundingFloor: changes.grounding_floor ?? Number(before.grounding_floor),
          },
          ...context,
        },
        transaction,
      );
    }
  });

  // Invalidate so the next read — including SC-021's next page load — sees it.
  cached = null;
  readAt = 0;

  return current();
}

/** Test seam. Drops the cache so a suite can change the row underneath. */
export function resetCache(): void {
  cached = null;
  readAt = 0;
}
