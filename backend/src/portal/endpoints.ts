/**
 * EVERY PORTAL ENDPOINT, DECLARED ONCE (Phase 8, FR-018, research.md D10).
 *
 * `routes/public/index.ts` opens by explaining why it exists: "Every other
 * router in this project begins with `authenticate`; this one deliberately does
 * not, and keeping that exception in a single visible place is what stops it
 * spreading." The portal is the second exception to "authenticated means staff",
 * and it needs the same property for the same reason — so a reviewer can see the
 * entire customer-reachable surface at once.
 *
 * This file goes one step further than a comment, because Phase 8's two central
 * security properties are not visible in a diff. The realm matrix
 * (`tests/portal/realm.test.ts`) and the scope matrix
 * (`tests/portal/scope.test.ts`) both ITERATE this list. A portal endpoint added
 * without a scope, or reachable with a staff token, is therefore a failing test
 * rather than a leak nobody thought to look for.
 *
 * TWO RULES FOR ANYONE ADDING TO THIS FILE:
 *
 *   1. Add the declaration and the route together. A route mounted without a
 *      declaration is invisible to both matrices; T129's reconciliation test
 *      fails if the two ever disagree.
 *   2. `session: 'none'` needs a reason written down. There are seven, they are
 *      all authentication or invitation acceptance, and none of them reads
 *      customer data.
 */

export type PortalHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * What the scope matrix should try to reach with somebody else's identifiers.
 *
 * `undefined` means the endpoint names no scoped resource in its path — it is
 * either unauthenticated or it operates on the session's own contact, so there
 * is nothing to substitute.
 */
export type PortalTargetKind = 'ticket' | 'ticketAttachment';

export interface PortalEndpointDeclaration {
  method: PortalHttpMethod;
  /** Path relative to the portal mount (`/api/portal`), with `:params`. */
  path: string;
  session: 'required' | 'none';
  /** Rate-limit scope. Authenticated scopes key on the account, not the IP (D11). */
  rateLimit: string;
  /**
   * A body the matrices can send so a 400 from validation never masks the 401 or
   * 404 the test is actually asserting.
   */
  sampleBody?: Record<string, unknown>;
  targets?: PortalTargetKind;
}

export const PORTAL_ENDPOINTS: readonly PortalEndpointDeclaration[] = [
  // --- Session. Unauthenticated by necessity: these are how a session begins,
  // ends, or is recovered. None of them reads a customer's records.
  {
    method: 'POST',
    path: '/auth/login',
    session: 'none',
    rateLimit: 'portal-auth',
    sampleBody: { email: 'nobody@example.invalid', password: 'not-a-real-password' },
  },
  { method: 'POST', path: '/auth/refresh', session: 'none', rateLimit: 'portal-auth' },
  // Idempotent by design, exactly as Phase 1's staff logout is: it succeeds with
  // no cookie and no token, because failing to log out is worse than logging out
  // twice.
  { method: 'POST', path: '/auth/logout', session: 'none', rateLimit: 'portal-auth' },
  {
    method: 'POST',
    path: '/auth/forgot-password',
    session: 'none',
    rateLimit: 'portal-auth',
    sampleBody: { email: 'nobody@example.invalid' },
  },
  {
    method: 'POST',
    path: '/auth/reset-password',
    session: 'none',
    rateLimit: 'portal-auth',
    sampleBody: { token: 'not-a-real-token', password: 'Str0ng-Passw0rd!2026' },
  },

  // --- Invitation acceptance. Unauthenticated because the whole point is that
  // the customer has no credential yet. The token IS the credential, which is
  // why these are here rather than in routes/public: an invitation token is not
  // "no credential".
  { method: 'GET', path: '/invitations/:token', session: 'none', rateLimit: 'portal-invite' },
  {
    method: 'POST',
    path: '/invitations/:token/accept',
    session: 'none',
    rateLimit: 'portal-invite',
    sampleBody: { password: 'Str0ng-Passw0rd!2026' },
  },

  // --- Session, authenticated.
  { method: 'POST', path: '/auth/logout-all', session: 'required', rateLimit: 'portal-auth' },
  {
    method: 'POST',
    path: '/auth/change-password',
    session: 'required',
    rateLimit: 'portal-auth',
    sampleBody: { currentPassword: 'x'.repeat(12), newPassword: 'Str0ng-Passw0rd!2026' },
  },

  // --- Profile. The customer's own contact, and the one field they may change.
  { method: 'GET', path: '/me', session: 'required', rateLimit: 'portal-read' },
  {
    method: 'PATCH',
    path: '/me/language',
    session: 'required',
    rateLimit: 'portal-read',
    sampleBody: { language: 'en' },
  },

  // --- Requests.
  { method: 'GET', path: '/tickets', session: 'required', rateLimit: 'portal-read' },
  {
    method: 'POST',
    path: '/tickets',
    session: 'required',
    rateLimit: 'portal-submit',
    sampleBody: { subject: 'Scope matrix probe', description: 'Scope matrix probe.' },
  },
  {
    method: 'GET',
    path: '/tickets/:reference',
    session: 'required',
    rateLimit: 'portal-read',
    targets: 'ticket',
  },
  {
    method: 'POST',
    path: '/tickets/:reference/replies',
    session: 'required',
    rateLimit: 'portal-reply',
    sampleBody: { body: 'Scope matrix probe.' },
    targets: 'ticket',
  },
  {
    method: 'GET',
    path: '/tickets/:reference/attachments/:attachmentId',
    session: 'required',
    rateLimit: 'portal-read',
    targets: 'ticketAttachment',
  },
  {
    method: 'POST',
    path: '/tickets/:reference/satisfaction',
    session: 'required',
    rateLimit: 'portal-submit',
    sampleBody: { score: 5 },
    targets: 'ticket',
  },

  // --- Help content. Phase 7's services with `audience: 'customer'` and
  // `status: 'published'` as literals. Not scoped by contact — published content
  // belongs to nobody (FR-039).
  { method: 'GET', path: '/kb/categories', session: 'required', rateLimit: 'portal-read' },
  { method: 'GET', path: '/kb/articles/:slug', session: 'required', rateLimit: 'portal-read' },
  { method: 'GET', path: '/kb/search', session: 'required', rateLimit: 'portal-search' },
  { method: 'GET', path: '/kb/suggestions', session: 'required', rateLimit: 'portal-search' },
];

/** Where the portal router is mounted. One constant, read by the router and both matrices. */
export const PORTAL_MOUNT = '/api/portal';

/** The full URL of a declared endpoint, with `:params` still in place. */
export function portalUrl(endpoint: PortalEndpointDeclaration): string {
  return `${PORTAL_MOUNT}${endpoint.path}`;
}

/**
 * WHAT IS DELIBERATELY ABSENT, stated so a later phase adds it on purpose:
 *
 *   - No registration route of any kind (FR-002a). The only path that creates a
 *     portal account is `POST /invitations/:token/accept`, and nobody can mint
 *     that token.
 *   - No file upload on any endpoint (FR-022). The router refuses multipart
 *     outright rather than ignoring it, so a client that tries gets an answer.
 *   - No endpoint that takes a customer or contact id. Both come from the
 *     session and a supplied one is ignored (FR-015).
 *   - No endpoint that edits customer data — name, address, contacts. Phase 2
 *     owns those, and a customer who could change the email their account is
 *     keyed to could move their own identity.
 *   - No SLA, note, task, assignee, or history endpoint. Not "filtered" — absent
 *     (FR-031).
 */
