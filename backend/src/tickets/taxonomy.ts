/**
 * Categories and priorities as code enumerations, not tables (Clarifications
 * Q1, research.md D6).
 *
 * The set is fixed and there is NO management interface. If a later phase needs
 * Administrator-managed categories, that is an additive migration plus a
 * screen; nothing here blocks it and nothing here anticipates it.
 *
 * Both are stored as their key and rendered from an i18n key, so a category
 * name is never an untranslated English string in an Arabic interface.
 */

export const TICKET_CATEGORIES = ['general', 'technical', 'billing', 'complaint'] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(TICKET_CATEGORIES);

export function isTicketCategory(value: unknown): value is TicketCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

export function categoryNameKey(category: TicketCategory): string {
  return `ticket.category.${category}`;
}

/**
 * Priorities carry a NUMERIC RANK because sorting by urgency is a real
 * requirement and alphabetical order puts `urgent` below `normal`, which is
 * exactly backwards.
 */
export const TICKET_PRIORITIES = [
  { key: 'low', rank: 1 },
  { key: 'normal', rank: 2 },
  { key: 'high', rank: 3 },
  { key: 'urgent', rank: 4 },
] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number]['key'];

const PRIORITY_RANKS = new Map<string, number>(
  TICKET_PRIORITIES.map((priority) => [priority.key, priority.rank]),
);

export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && PRIORITY_RANKS.has(value);
}

export function priorityRank(priority: TicketPriority): number {
  return PRIORITY_RANKS.get(priority) ?? 0;
}

export function priorityNameKey(priority: TicketPriority): string {
  return `ticket.priority.${priority}`;
}

export const DEFAULT_PRIORITY: TicketPriority = 'normal';

export function allPriorityKeys(): TicketPriority[] {
  return TICKET_PRIORITIES.map((priority) => priority.key);
}

/**
 * The SQL fragment that orders by urgency rather than by spelling. Built from
 * the declaration above, so adding a priority cannot leave the sort behind.
 */
export function prioritySortExpression(): string {
  const cases = TICKET_PRIORITIES.map(
    (priority) => `WHEN '${priority.key}' THEN ${priority.rank}`,
  ).join(' ');

  return `CASE \`Ticket\`.\`priority\` ${cases} ELSE 0 END`;
}
