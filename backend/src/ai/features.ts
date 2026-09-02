import { env } from '../config/env.js';

/**
 * The five AI features, declared ONCE (research D12).
 *
 * Both the admin surface and every service read this list rather than testing
 * env flags individually. That is what makes FR-002's independence testable:
 * `backend/tests/ai/feature-independence.test.ts` iterates this object,
 * disables each entry in turn, and asserts the other four still work. A set of
 * scattered `env.AI_X_ENABLED` checks could not be enumerated, so the test
 * would have to name the features itself and would silently miss a sixth.
 *
 * `location` is documentation of a decision made elsewhere, NOT a switch. The
 * processor a feature actually reaches is determined by which factory module
 * its service imports (research D2) — changing this value changes nothing about
 * where content goes, and `backend/tests/ai/egress.test.ts` is what proves the
 * real boundary. It is recorded here so the admin activity view can show an
 * operator what a feature is expected to use without inviting them to change it.
 */
export const AI_FEATURES = ['summary', 'draft', 'classify', 'similar', 'assistant'] as const;

export type AiFeatureKey = (typeof AI_FEATURES)[number];

export interface FeatureDeclaration {
  readonly key: AiFeatureKey;
  readonly enabled: boolean;
  /**
   * Daily invocation ceiling. `null` for `similar`, which makes no model call
   * at all (research D8) and therefore has nothing to meter.
   */
  readonly ceiling: number | null;
  readonly location: 'external' | 'local' | 'none';
}

function declare(
  key: AiFeatureKey,
  enabled: boolean,
  ceiling: number | null,
  location: FeatureDeclaration['location'],
): FeatureDeclaration {
  // AI_ENABLED is the master switch: with it off, every feature is off
  // regardless of its own flag. One place to turn the phase off entirely is
  // what SC-022 leans on.
  return { key, enabled: env.AI_ENABLED && enabled, ceiling, location };
}

export const FEATURES: Readonly<Record<AiFeatureKey, FeatureDeclaration>> = {
  summary: declare('summary', env.AI_SUMMARY_ENABLED, env.AI_CEILING_SUMMARY, 'external'),
  draft: declare('draft', env.AI_DRAFT_ENABLED, env.AI_CEILING_DRAFT, 'external'),
  classify: declare('classify', env.AI_CLASSIFY_ENABLED, env.AI_CEILING_CLASSIFY, 'external'),

  // No provider, no ceiling: similar tickets reuse the Phase 7 token index and
  // cost one query (research D8).
  similar: declare('similar', env.AI_SIMILAR_ENABLED, null, 'none'),

  // The only feature whose processing may not leave controlled infrastructure
  // (Clarifications Q1, FR-008).
  assistant: declare('assistant', env.AI_ASSISTANT_ENABLED, env.AI_CEILING_ASSISTANT, 'local'),
};

/**
 * Runtime overrides, supplied by `services/ai-config.service.ts` (US6).
 *
 * `FEATURES` above holds the ENVIRONMENT DEFAULTS and stays the single
 * declaration of what the five features are. This holds what they are currently
 * SET TO, which FR-002 requires an administrator to be able to change without a
 * deploy — an environment variable cannot be edited through a screen and a
 * change to it is not auditable, which is the rule Phase 6 established for SLA
 * policies and the assignment strategy.
 *
 * NOTE WHAT CANNOT BE OVERRIDDEN: `location`. It is absent from this type on
 * purpose. The processing location is compile-time (research D2), and a runtime
 * override for it would be exactly the failure FR-008a exists to prevent.
 */
interface Overrides {
  readonly summary: { enabled: boolean; ceiling: number | null };
  readonly draft: { enabled: boolean; ceiling: number | null };
  readonly classify: { enabled: boolean; ceiling: number | null };
  readonly similar: { enabled: boolean; ceiling: number | null };
  readonly assistant: { enabled: boolean; ceiling: number | null };
  readonly assistantLangs: ReadonlyArray<'ar' | 'en'>;
  readonly groundingFloor: number;
}

let overrides: Overrides | null = null;

export function applyOverrides(next: Overrides): void {
  overrides = next;
}

/** Test seam, so a suite can return to the environment defaults. */
export function clearOverrides(): void {
  overrides = null;
}

export function isEnabled(key: AiFeatureKey): boolean {
  // AI_ENABLED remains the master switch in either case: it is the "is this
  // phase deployed at all" flag SC-022 leans on, and no database row can
  // switch a feature on when the environment has the phase off.
  if (!env.AI_ENABLED) return false;

  return overrides ? overrides[key].enabled : FEATURES[key].enabled;
}

export function ceilingFor(key: AiFeatureKey): number | null {
  return overrides ? overrides[key].ceiling : FEATURES[key].ceiling;
}

export function groundingFloor(): number {
  return overrides ? overrides.groundingFloor : env.AI_ASSISTANT_GROUNDING_FLOOR;
}

/**
 * Whether the assistant will answer in this language at all (research D4).
 *
 * A language outside the configured set is not a degraded assistant — it is no
 * assistant, and the caller falls back to the Phase 8 ticket route (FR-042).
 */
export function assistantSpeaks(lang: string): boolean {
  if (!isEnabled('assistant')) return false;

  const langs = overrides ? overrides.assistantLangs : env.AI_ASSISTANT_LANGS;

  return langs.includes(lang as 'ar' | 'en');
}
