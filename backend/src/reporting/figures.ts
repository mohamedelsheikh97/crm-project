import type { PermissionKey } from '../auth/permissions.js';

/**
 * THE DASHBOARD FIGURE CATALOG: every key, with the authority it requires
 * (Phase 10, US1 and US6, data-model.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE DECLARATION, THREE CONSUMERS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The dashboard response builds from it, its authority filter reads it, and a
 * saved arrangement is validated against it. A second list would drift, and the
 * drift would be silent in the worst direction: an arrangement holding a key the
 * dashboard no longer serves renders as a gap its owner cannot explain or
 * remove.
 *
 * IT LIVES HERE, NOT IN THE CONTROLLER, because the arrangement SERVICE needs
 * it. A service importing a controller would invert this codebase's layering
 * (`routes -> controllers -> services -> models`, Principle III) and would be a
 * genuine import cycle besides — the controller already imports the service.
 *
 * WHY THE AI FIGURES NEED `ai:manage` AND NOT `reports:view`. Phase 9 gated its
 * activity view on `ai:manage` and made that key administrator-only on purpose:
 * it is the key that decides whether the organisation transmits customer content
 * to an external provider at all. Serving the same invocation and token figures
 * under `reports:view` would be a way around that decision, made by accident, on
 * the surface most likely to be projected onto a wall.
 */
export const FIGURE_CATALOG = {
  'volume.received': 'reports:view',
  'volume.openAtEnd': 'reports:view',
  'volume.byStatus': 'reports:view',
  'volume.byCategory': 'reports:view',
  'volume.byChannel': 'reports:view',
  'volume.overTime': 'reports:view',
  'ai.byFeature': 'ai:manage',
  'ai.proposalAcceptance': 'ai:manage',
  'ai.deflectionRate': 'ai:manage',
} as const satisfies Record<string, PermissionKey>;

export type FigureKey = keyof typeof FIGURE_CATALOG;

/**
 * The figure keys a dashboard arrangement may reference.
 *
 * DERIVED from the catalog, never written out a second time. This is the list
 * the arrangement service validates against, and the agent-unreachable test
 * walks it to assert no per-agent figure is ever served here (FR-030b).
 */
export const FIGURE_KEYS = Object.keys(FIGURE_CATALOG) as readonly FigureKey[];

export function isFigureKey(value: unknown): value is FigureKey {
  return typeof value === 'string' && value in FIGURE_CATALOG;
}
