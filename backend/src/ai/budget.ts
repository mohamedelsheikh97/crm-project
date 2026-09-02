import { Op } from 'sequelize';

import { AiInvocation } from '../models/ai-invocation.model.js';

import { ceilingFor, type AiFeatureKey } from './features.js';

/**
 * Daily invocation ceilings (Phase 9, research.md D11, FR-005).
 *
 * A CEILING IS NOT A RATE LIMIT, and collapsing the two would be wrong. Phase
 * 5's limiter stops one principal hammering one surface within a minute; this
 * stops the organisation's monthly bill running away across all principals over
 * a day. Either can be hit without the other, and they fail for different
 * reasons with different remedies.
 *
 * COUNTED FROM `ai_invocations`, NOT FROM MEMORY. A spending limit that resets
 * on deploy is not a limit — and this codebase deploys by restarting a process.
 *
 * Counts every attempt, including bounded retries (FR-006), because an
 * unbounded retry on a paid call is a spending bug wearing a reliability
 * costume. Refusals are counted too where they cost something: a
 * `refused_ungrounded` never reached a provider, so it is excluded, but a
 * `failed` did and is not.
 */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface BudgetVerdict {
  readonly allowed: boolean;
  readonly used: number;
  readonly ceiling: number | null;
}

export async function check(feature: AiFeatureKey): Promise<BudgetVerdict> {
  // The RUNTIME ceiling, so a limit an administrator raised takes effect
  // without a deploy (US6).
  const ceiling = ceilingFor(feature);

  // `similar` makes no model call and has nothing to meter (research D8).
  if (ceiling === null) {
    return { allowed: true, used: 0, ceiling: null };
  }

  const used = await AiInvocation.count({
    where: {
      feature,
      created_at: { [Op.gte]: startOfToday() },
      // Outcomes that reached a provider, or would have. A refusal below the
      // grounding floor cost nothing, so it must not consume the allowance —
      // otherwise a customer asking unanswerable questions could exhaust the
      // budget for everyone without a single paid call being made.
      outcome: { [Op.in]: ['success', 'failed'] },
    },
  });

  return { allowed: used < ceiling, used, ceiling };
}
