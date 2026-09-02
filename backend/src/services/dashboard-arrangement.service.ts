import type { PermissionKey } from '../auth/permissions.js';
import { DashboardArrangement } from '../models/dashboard-arrangement.model.js';

import { FIGURE_CATALOG, FIGURE_KEYS, isFigureKey, type FigureKey } from '../reporting/figures.js';

/**
 * Dashboard arrangements (Phase 10, US6, FR-040 - FR-042).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE ROW PER USER, AND NOTHING ELSE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `UNIQUE(user_id)`, `ON DELETE CASCADE`, and a JSON array of figure keys. No
 * `is_shared`, no ownership transfer, no template: FR-040 asks that a
 * supervisor can arrange their own dashboard, and every one of those additions
 * would introduce a second person's authority into a row that currently needs
 * only one — which is the whole reason there is no id parameter on the route.
 *
 * THE LAYOUT STORES KEYS, NOT FIGURES. A stored figure would be a cached number
 * with no period and no provenance, and it would be wrong within the hour. A
 * key is a reference resolved against the live catalog on every read.
 */

/** The default, used before anybody has arranged anything (FR-041). */
export const DEFAULT_LAYOUT: readonly FigureKey[] = [
  'volume.received',
  'volume.openAtEnd',
  'volume.overTime',
  'volume.byStatus',
  'volume.byCategory',
];

export class InvalidLayoutError extends Error {
  constructor(readonly keys: string[]) {
    super(`unknown figure keys: ${keys.join(', ')}`);
    this.name = 'InvalidLayoutError';
  }
}

/**
 * The arrangement to render for this user, filtered by their authority.
 *
 * FR-042: a figure the viewer no longer has authority for is ABSENT rather than
 * an error. A supervisor who loses a permission should find one tile gone, not
 * a dashboard that refuses to load — and certainly not a saved layout they
 * cannot edit because reading it fails.
 *
 * THE STORED ROW IS NOT REWRITTEN. Authority can be restored, and silently
 * pruning the key on read would mean the tile never comes back — the user would
 * have to notice and re-add something they never removed.
 */
export async function forUser(
  userId: number,
  held: readonly PermissionKey[],
): Promise<FigureKey[]> {
  const permitted = new Set(held);
  const row = await DashboardArrangement.findOne({ where: { user_id: userId } });

  const stored = row ? row.layout.filter(isFigureKey) : [...DEFAULT_LAYOUT];

  return stored.filter((key) => permitted.has(FIGURE_CATALOG[key]));
}

/**
 * Saves this user's arrangement, refusing anything not in the catalog.
 *
 * REFUSED, NOT SANITISED. Dropping an unknown key and storing the rest would
 * mean the user saved six tiles and got five, with nothing saying which was
 * lost or why — and the next person to read the row would have no way to tell
 * a deliberately short layout from a silently truncated one.
 */
export async function save(userId: number, layout: unknown): Promise<FigureKey[]> {
  if (!Array.isArray(layout)) {
    throw new InvalidLayoutError(['layout must be an array of figure keys']);
  }

  const unknownKeys = layout.filter((key) => !isFigureKey(key)).map((key) => String(key));

  if (unknownKeys.length > 0) throw new InvalidLayoutError(unknownKeys);

  // Duplicates removed rather than refused: the same tile twice is a client
  // slip, not a request that needs an answer, and the intent is unambiguous.
  const deduped = [...new Set(layout as FigureKey[])];

  if (deduped.length > FIGURE_KEYS.length) {
    throw new InvalidLayoutError(['layout is longer than the figure catalog']);
  }

  /**
   * Upsert on `user_id`, which the unique index makes safe against two
   * concurrent saves from the same person's two tabs — the later one wins
   * rather than both inserting.
   */
  const existing = await DashboardArrangement.findOne({ where: { user_id: userId } });

  if (existing) {
    existing.layout = deduped;
    await existing.save();
  } else {
    await DashboardArrangement.create({ user_id: userId, layout: deduped } as never);
  }

  return deduped;
}
