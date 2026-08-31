/**
 * WHICH POLICY APPLIES WHEN SEVERAL MATCH (Phase 6, FR-013).
 *
 * A DECLARATION, not logic. The matcher in sla-policy.service.ts and the
 * screen that explains precedence to an administrator both read this file, so
 * "what the system does" and "what the interface says it does" cannot drift.
 *
 * FR-013 requires the precedence to be DETERMINISTIC AND TOTAL: given any set
 * of matching policies, exactly one is selected, and two runs on identical
 * state select the same one. Two rules achieve that:
 *
 *   1. MORE SPECIFIC WINS. A policy naming both a priority and a category is a
 *      narrower promise than one naming only a priority, and the narrower
 *      promise is the one the organisation meant for this ticket.
 *
 *   2. TIES BREAK ON MOST RECENTLY UPDATED. Two policies of identical
 *      specificity are a configuration the administrator built deliberately —
 *      typically a temporary override beside a standing policy — and the one
 *      they touched last is the one they meant. `id DESC` is the final
 *      tiebreak so the order is total even for two policies saved in the same
 *      second.
 *
 * There is deliberately NO unique constraint preventing overlap (see the
 * migration): forbidding it would stop an administrator adding a temporary
 * override without first deleting the standing policy.
 */

/** Higher is more specific. Derived on write, stored on the policy row. */
export const SPECIFICITY = {
  PRIORITY_AND_CATEGORY: 3,
  PRIORITY_ONLY: 2,
  CATEGORY_ONLY: 1,
  CATCH_ALL: 0,
} as const;

export type Specificity = (typeof SPECIFICITY)[keyof typeof SPECIFICITY];

/**
 * The single place specificity is computed. Never accepted from a client — a
 * caller that could set it could jump the queue past every other policy.
 */
export function specificityOf(scope: {
  priority: string | null;
  category: string | null;
}): Specificity {
  if (scope.priority !== null && scope.category !== null) return SPECIFICITY.PRIORITY_AND_CATEGORY;
  if (scope.priority !== null) return SPECIFICITY.PRIORITY_ONLY;
  if (scope.category !== null) return SPECIFICITY.CATEGORY_ONLY;
  return SPECIFICITY.CATCH_ALL;
}

/**
 * The ORDER BY both the matcher and the policies list use, so the list an
 * administrator reads IS the precedence order rather than a description of it.
 */
export const PRECEDENCE_ORDER: ReadonlyArray<[string, 'ASC' | 'DESC']> = [
  ['specificity', 'DESC'],
  ['updated_at', 'DESC'],
  ['id', 'DESC'],
];

/** i18n key describing what a policy matches, for the screen. */
export function scopeLabelKey(scope: { priority: string | null; category: string | null }): string {
  switch (specificityOf(scope)) {
    case SPECIFICITY.PRIORITY_AND_CATEGORY:
      return 'sla.scope.priorityAndCategory';
    case SPECIFICITY.PRIORITY_ONLY:
      return 'sla.scope.priorityOnly';
    case SPECIFICITY.CATEGORY_ONLY:
      return 'sla.scope.categoryOnly';
    default:
      return 'sla.scope.catchAll';
  }
}
