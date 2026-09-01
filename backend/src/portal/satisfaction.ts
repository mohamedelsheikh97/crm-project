/**
 * THE SATISFACTION SCALE, declared once (Phase 8, FR-048, research.md D8).
 *
 * A fixed 1-5 scale. The service validates against it, the interface renders
 * labels from it, and Phase 10's reporting will average it — so it exists in one
 * place rather than as a magic number in three.
 *
 * FIVE POINTS rather than a thumbs up/down, because "it was resolved but it took
 * three weeks" is a real answer that a binary cannot hold. Odd rather than even,
 * so a genuinely neutral experience has somewhere to go instead of being forced
 * into mild approval.
 *
 * The labels are i18n KEYS, never text (Constitution Principle I). A scale
 * rendered in English to an Arabic-speaking customer is the exact failure the
 * portal is most exposed to.
 */

export const SATISFACTION_MIN = 1;
export const SATISFACTION_MAX = 5;

export const SATISFACTION_SCORES = [1, 2, 3, 4, 5] as const;

export type SatisfactionScore = (typeof SATISFACTION_SCORES)[number];

export function isSatisfactionScore(value: unknown): value is SatisfactionScore {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SATISFACTION_MIN &&
    value <= SATISFACTION_MAX
  );
}

/** An i18n key per point on the scale. */
export function satisfactionScoreKey(score: SatisfactionScore): string {
  return `portal.rating.score.${score}`;
}

/**
 * How long a comment may be.
 *
 * Generous, because a customer explaining why they were dissatisfied is the most
 * valuable text this system collects and truncating it silently would be the
 * worst possible way to receive it. TEXT holds 64KB; this bound exists so the
 * refusal happens in validation with a message rather than at the column.
 */
export const SATISFACTION_COMMENT_MAX_LENGTH = 4000;
