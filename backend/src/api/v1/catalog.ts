import type { PermissionKey } from '../../auth/permissions.js';

/**
 * THE ROUTE CATALOG — one declaration, three consumers (Phase 11, FR-005).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ROUTER, THE DOCUMENTATION AND THE TESTS ALL READ THIS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-005 requires the documentation to be derived from the implementation rather
 * than maintained beside it, and the reason is not tidiness: hand-written API
 * documentation is wrong within weeks, and wrong documentation is worse than
 * none, because an integrator trusts it and debugs their own code first.
 *
 * Declaring routes once and building the router FROM the declaration makes
 * "documented" and "served" the same fact. A second list — the router's, and the
 * document's — would drift, and the drift would be invisible until an integrator
 * called an endpoint that no longer exists.
 *
 * Phase 10 established the pattern with `reporting/figures.ts`: one catalog,
 * consumed by the response builder, the authority filter and the layout
 * validator. This is the same technique applied to routes.
 *
 * ADDING AN ENDPOINT: add a row here. The router mounts it, the document
 * describes it, and `tests/api/route-auth.test.ts` covers it — or fails.
 */

export interface RouteSpec {
  /** Path relative to `/api/v1`, in Express form. */
  readonly path: string;
  /** GET only in version 1 — `tests/api/read-only.test.ts` asserts it. */
  readonly method: 'get';
  /** The handler's export name on its controller module. */
  readonly handler: string;
  /** Which controller module under `controllers/v1/`. */
  readonly controller: 'customers' | 'tickets' | 'reports' | 'meta';
  /**
   * What a caller must present.
   *
   * THREE STATES, and the middle one is easy to miss:
   *
   *   a permission key   — authenticated AND holding that key
   *   `'authenticated'`  — a valid credential, no particular key. `whoami` is
   *                        the only one: it reports what the CALLER holds, so
   *                        gating it on a permission would be circular, but it
   *                        must know who is asking.
   *   `null`             — no credential at all. Only the description document,
   *                        which an integrator reads before they have a working
   *                        credential and which contains no data.
   */
  readonly permission: PermissionKey | 'authenticated' | null;
  /**
   * `hide` answers 404 instead of 403 when the permission is absent.
   *
   * Used only for the agent report: FR-013 and Phase 10's FR-030b want it
   * ABSENT rather than present-and-withheld, because a 403 tells the caller that
   * per-agent figures exist and somebody else can read them.
   */
  readonly onDenied?: 'hide';
  readonly summary: string;
  readonly paged?: boolean;
  readonly period?: boolean;
}

export const ROUTES: readonly RouteSpec[] = [
  {
    path: '/openapi.json',
    method: 'get',
    handler: 'openapi',
    controller: 'meta',
    // Unauthenticated on purpose: an integrator reads this before they have a
    // credential, and it contains no data.
    permission: null,
    summary: 'This description, machine-readable.',
  },
  {
    path: '/whoami',
    method: 'get',
    handler: 'whoami',
    controller: 'meta',
    // Authenticated, but no key: it reports what the caller holds, so gating it
    // on a permission would be circular.
    permission: 'authenticated',
    summary: 'What this credential holds. Answers the first question behind every 403.',
  },

  {
    path: '/customers',
    method: 'get',
    handler: 'list',
    controller: 'customers',
    permission: 'customers:view',
    summary: 'Customers, keyset-paged. Supports `since` for reconciliation.',
    paged: true,
  },
  {
    path: '/customers/:id',
    method: 'get',
    handler: 'get',
    controller: 'customers',
    permission: 'customers:view',
    summary: 'One customer with its contacts.',
  },

  {
    path: '/tickets',
    method: 'get',
    handler: 'list',
    controller: 'tickets',
    permission: 'tickets:view',
    summary: 'Tickets, keyset-paged. Filters by status, priority, category, customer.',
    paged: true,
  },
  {
    path: '/tickets/:id',
    method: 'get',
    handler: 'get',
    controller: 'tickets',
    permission: 'tickets:view',
    summary: 'One ticket. A merged ticket answers 409 with the survivor.',
  },
  {
    path: '/tickets/:id/messages',
    method: 'get',
    handler: 'messages',
    controller: 'tickets',
    permission: 'tickets:view',
    summary: 'The correspondence on one ticket, oldest first.',
  },

  {
    path: '/reports/volume',
    method: 'get',
    handler: 'volume',
    controller: 'reports',
    permission: 'reports:view',
    summary: 'Ticket volume and status for a period.',
    period: true,
  },
  {
    path: '/reports/sla',
    method: 'get',
    handler: 'sla',
    controller: 'reports',
    permission: 'reports:view',
    summary: 'Response and resolution compliance, as recorded.',
    period: true,
  },
  {
    path: '/reports/csat',
    method: 'get',
    handler: 'csat',
    controller: 'reports',
    permission: 'reports:view',
    summary: 'Satisfaction distribution and response rate.',
    period: true,
  },
  {
    path: '/reports/agents',
    method: 'get',
    handler: 'agents',
    controller: 'reports',
    permission: 'reports:view_agents',
    // ABSENT, not withheld. See the RouteSpec note on `onDenied`.
    onDenied: 'hide',
    summary: 'Per-agent figures. Absent without `reports:view_agents`.',
    period: true,
  },
];

/** Express path → OpenAPI path (`:id` becomes `{id}`). */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]\w*)/g, '{$1}');
}
