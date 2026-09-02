import { ALL_CHANNELS, type Channel } from '../models/message.model.js';
import { isTicketCategory, TICKET_PRIORITIES, type TicketCategory } from '../tickets/taxonomy.js';

/**
 * The one filter shape every report accepts (Phase 10, contracts/reports-api.md).
 *
 * ONE SHAPE, NOT PER-REPORT SHAPES. FR-002 requires figures on a surface to
 * agree, and the surest way to break that is two reports interpreting the same
 * request differently.
 *
 * VALIDATED AGAINST THE TAXONOMY, NOT ACCEPTED AS A STRING. An unknown category
 * is a REFUSAL rather than an empty result — because an empty result reads as
 * "no tickets in that category last month", which is a claim, and a false one.
 * Phase 3 owns the taxonomy and research D2 forbids restating it here, so this
 * validates by calling `isTicketCategory` rather than by listing the four values.
 */
export class InvalidFilterError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
    this.name = 'InvalidFilterError';
  }
}

export interface ReportFilters {
  readonly category: TicketCategory | null;
  readonly channel: Channel | null;
  readonly priority: string | null;
  readonly agentId: number | null;
}

const PRIORITY_KEYS: ReadonlySet<string> = new Set(TICKET_PRIORITIES.map((entry) => entry.key));
const CHANNEL_SET: ReadonlySet<string> = new Set(ALL_CHANNELS);

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new InvalidFilterError(field, 'must be a string');
  return value;
}

export function parse(query: Record<string, unknown>): ReportFilters {
  const category = optionalString(query.category, 'category');

  if (category !== null && !isTicketCategory(category)) {
    throw new InvalidFilterError('category', 'is not a known ticket category');
  }

  const channel = optionalString(query.channel, 'channel');

  if (channel !== null && !CHANNEL_SET.has(channel)) {
    throw new InvalidFilterError('channel', 'is not a known channel');
  }

  const priority = optionalString(query.priority, 'priority');

  if (priority !== null && !PRIORITY_KEYS.has(priority)) {
    throw new InvalidFilterError('priority', 'is not a known priority');
  }

  let agentId: number | null = null;

  if (query.agentId !== undefined && query.agentId !== null && query.agentId !== '') {
    const parsed = Number(query.agentId);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new InvalidFilterError('agentId', 'must be a positive integer');
    }

    agentId = parsed;
  }

  return {
    category: category as TicketCategory | null,
    channel: channel as Channel | null,
    priority,
    agentId,
  };
}

/**
 * The filters as a flat record for the figure envelope (FR-003).
 *
 * Every report puts this in every figure it returns, so an export lands in a
 * mailbox carrying a record of what produced it rather than being quoted as the
 * whole picture (FR-047).
 */
export function describe(filters: ReportFilters): Record<string, string | number | null> {
  return {
    category: filters.category,
    channel: filters.channel,
    priority: filters.priority,
    agentId: filters.agentId,
  };
}
