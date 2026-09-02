import { col, fn } from 'sequelize';

import { figure, type Figure, type ResolvedPeriod } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import * as sources from '../reporting/sources.js';
import { rate } from '../reporting/suppression.js';
import { AI_FEATURES } from '../ai/features.js';

/**
 * Reporting on the AI capability (Phase 10, FR-055 - FR-058).
 *
 * COUNTS ONLY, because counts are all Phase 9 keeps. Its `ai_invocations` table
 * holds no prompt and no completion by deliberate decision (its Clarifications
 * Q3), so this report cannot show what a bad summary actually said — and
 * `contentRetained: false` travels in the response so a reader learns that it
 * was never kept rather than concluding the log is broken (FR-057).
 *
 * `ai_category_proposals` is the one AI table with a genuine accuracy metric in
 * it. Phase 9 left the acceptance rate to be established from real traffic
 * (its SC-010), and FR-056 is where that number finally becomes visible.
 */
export interface AiReport {
  readonly byFeature: Figure<
    Array<{ feature: string; invocations: number; failures: number; tokens: number }>
  >;
  readonly proposalAcceptance: Figure<number | null>;
  readonly deflectionRate: Figure<number | null>;
  /** FR-057. Stated in the payload, not left to be inferred from an empty column. */
  readonly contentRetained: false;
}

export async function report(period: ResolvedPeriod, filters: ReportFilters): Promise<AiReport> {
  const described = describeFilters(filters);
  const where = sources.invocationsIn(period);

  const rows = (await sources.models.AiInvocation.findAll({
    where,
    attributes: [
      'feature',
      'outcome',
      [fn('COUNT', col('id')), 'n'],
      [fn('COALESCE', fn('SUM', col('input_tokens')), 0), 'inTokens'],
      [fn('COALESCE', fn('SUM', col('output_tokens')), 0), 'outTokens'],
    ],
    group: ['feature', 'outcome'],
    raw: true,
  })) as unknown as Array<Record<string, unknown>>;

  const perFeature = new Map<
    string,
    { invocations: number; failures: number; tokens: number; ungrounded: number }
  >();

  for (const key of AI_FEATURES) {
    perFeature.set(key, { invocations: 0, failures: 0, tokens: 0, ungrounded: 0 });
  }

  for (const row of rows) {
    const key = String(row.feature);
    const entry = perFeature.get(key) ?? {
      invocations: 0,
      failures: 0,
      tokens: 0,
      ungrounded: 0,
    };

    const n = Number(row.n);
    entry.invocations += n;
    entry.tokens += Number(row.inTokens) + Number(row.outTokens);

    if (row.outcome === 'failed') entry.failures += n;
    if (row.outcome === 'refused_ungrounded') entry.ungrounded += n;

    perFeature.set(key, entry);
  }

  const totalInvocations = [...perFeature.values()].reduce(
    (sum, entry) => sum + entry.invocations,
    0,
  );

  const byFeature = AI_FEATURES.map((key) => {
    const entry = perFeature.get(key)!;
    return {
      feature: key,
      invocations: entry.invocations,
      failures: entry.failures,
      tokens: entry.tokens,
    };
  });

  // Proposal acceptance (FR-056). The measure Phase 9 could not establish
  // without traffic.
  const proposals = (await sources.models.AiCategoryProposal.findAll({
    where: sources.proposalsIn(period),
    attributes: ['state', [fn('COUNT', col('id')), 'n']],
    group: ['state'],
    raw: true,
  })) as unknown as Array<{ state: string; n: number | string }>;

  const proposalCounts = new Map(proposals.map((row) => [row.state, Number(row.n)]));
  const proposalsMade = [...proposalCounts.values()].reduce((sum, n) => sum + n, 0);
  const accepted = proposalCounts.get('accepted') ?? 0;

  /**
   * Assistant deflection (FR-058): questions the assistant answered or declined
   * without a ticket being raised.
   *
   * `refused_ungrounded` is Phase 9's record of the assistant declining WITHOUT
   * calling a model — its research D3 step 2. Those rows are the numerator that
   * makes SC-015's deflection rate computable at all.
   */
  const assistant = perFeature.get('assistant')!;

  return {
    byFeature: figure(
      { value: byFeature, count: totalInvocations, total: totalInvocations },
      period,
      described,
    ),
    proposalAcceptance: figure(
      {
        value: rate(accepted, proposalsMade),
        count: proposalsMade,
        total: proposalsMade,
        suppressed: rate(accepted, proposalsMade) === null && proposalsMade > 0,
      },
      period,
      described,
    ),
    deflectionRate: figure(
      {
        value: rate(assistant.ungrounded, assistant.invocations),
        count: assistant.invocations,
        total: assistant.invocations,
        suppressed:
          rate(assistant.ungrounded, assistant.invocations) === null && assistant.invocations > 0,
      },
      period,
      described,
    ),
    contentRetained: false,
  };
}
