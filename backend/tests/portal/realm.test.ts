import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { PORTAL_ENDPOINTS, portalUrl } from '../../src/portal/endpoints.js';
import {
  signPortalAccessToken,
  signPortalRefreshToken,
} from '../../src/services/portal-token.service.js';
import { signAccessToken, signRefreshToken } from '../../src/services/token.service.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { buildPortalWorld, type PortalWorld } from './fixtures.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * THE REALM MATRIX (Phase 8, FR-012, FR-013, SC-002, research.md D1).
 *
 * This file and `scope.test.ts` are the two tests this phase cannot be shipped
 * without, and they are here because THE PROPERTY THEY PROVE IS INVISIBLE IN A
 * DIFF. Nothing in a code review reliably shows that a customer's token cannot
 * pass staff authentication. You cannot see it by reading the middleware, because
 * the middleware looks correct either way — what makes it true is that the two
 * realms are signed with different secrets, and the only way to observe that is
 * to try.
 *
 * WHAT WOULD HAPPEN WITHOUT IT: `verifyAccessToken` returns `{ id, email }` and
 * `authenticate` passes that id to `User.findByPk`. A portal token of the same
 * shape signed with `JWT_ACCESS_SECRET` would resolve to THE STAFF USER WHOSE ID
 * EQUALS THE PORTAL ACCOUNT'S — a real account, with a real role, and whatever
 * permissions it holds. On a small dataset that is most ids.
 *
 * IT ENUMERATES `portal/endpoints.ts` RATHER THAN SAMPLING, because SC-002 says
 * "across the full endpoint set, not a sample". A portal endpoint added later
 * without a declaration is caught by the reconciliation test; one added WITH a
 * declaration is caught here the moment it forgets its middleware.
 */

/** Every token that is not a valid portal access token. All must be refused. */
function foreignTokens(staffUserId: number, staffEmail: string, portalAccountId: number) {
  return [
    // THE ONE THAT MATTERS: a staff access token, presented to the portal.
    {
      label: 'a staff access token',
      token: signAccessToken({ id: staffUserId, email: staffEmail }),
    },
    { label: 'a staff refresh token', token: signRefreshToken({ id: staffUserId }) },
    // Right realm, wrong kind. Phase 1's `type` assertion, inherited.
    {
      label: 'a portal REFRESH token',
      token: signPortalRefreshToken({ id: portalAccountId, epoch: 0 }),
    },
    { label: 'a malformed token', token: 'not.a.token' },
    // A syntactically valid JWT signed with nothing this application trusts.
    {
      label: 'a token signed with an unknown key',
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoicG9ydGFsLWFjY2VzcyIsInN1YiI6IjEifQ.' +
        'nope-this-signature-is-not-ours',
    },
  ];
}

describe('the realm boundary: portal endpoints refuse everything that is not a portal session', () => {
  let world: PortalWorld;
  let staff: { id: number; email: string };

  beforeEach(async () => {
    world = await buildPortalWorld();
    const { user } = await agentAs('admin');
    staff = { id: user.id, email: user.email };
  });

  const authenticated = PORTAL_ENDPOINTS.filter((endpoint) => endpoint.session === 'required');

  it('has authenticated endpoints to test', () => {
    // A guard against the whole suite silently passing because a refactor
    // emptied the declaration. Enumerated tests fail this way when they fail.
    expect(authenticated.length).toBeGreaterThan(8);
  });

  for (const endpoint of authenticated) {
    describe(`${endpoint.method} ${endpoint.path}`, () => {
      /**
       * The baseline. Every other case in this describe must be
       * INDISTINGUISHABLE from this one — same status, same body.
       */
      it('refuses a request with no Authorization header', async () => {
        const url = portalUrl(endpoint).replace(':reference', world.ticketA.reference);
        const response = await supertest(app)
          [endpoint.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](
            url.replace(':attachmentId', '1').replace(':slug', 'anything').replace(':token', 'x'),
          )
          .send(endpoint.sampleBody ?? {});

        expect(response.status).toBe(401);
        expect(response.body.error?.code).toBe('UNAUTHENTICATED');
      });

      for (const { label, token } of foreignTokens(1, 'nobody@test.local', 1)) {
        it(`refuses ${label} identically`, async () => {
          const url = portalUrl(endpoint)
            .replace(':reference', world.ticketA.reference)
            .replace(':attachmentId', '1')
            .replace(':slug', 'anything')
            .replace(':token', 'x');

          const response = await supertest(app)
            [endpoint.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](url)
            .set('Authorization', `Bearer ${token}`)
            .send(endpoint.sampleBody ?? {});

          expect(response.status).toBe(401);
          expect(response.body.error?.code).toBe('UNAUTHENTICATED');
        });
      }
    });
  }

  /**
   * THE CASE THIS FILE EXISTS FOR, stated once as plainly as possible.
   *
   * The portal account's id is deliberately chosen to collide with a real staff
   * user's id, because that collision is what the missing defence would have
   * turned into an escalation.
   */
  it('a portal token whose subject equals a real staff user id resolves to nothing', async () => {
    const collidingToken = signPortalAccessToken({ id: staff.id });

    const response = await supertest(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${collidingToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('the realm boundary: staff endpoints refuse a portal token', () => {
  let world: PortalWorld;
  let agent: AuthedAgent;

  /**
   * A representative walk across the staff surface. Every top-level staff
   * router, one route each — enough to prove the refusal is structural rather
   * than per-endpoint, which it is: no staff route mounts
   * `authenticate-portal`, and `verifyAccessToken` cannot accept a portal token
   * because it is signed with a different key.
   */
  const STAFF_ROUTES = [
    '/api/auth/me',
    '/api/tickets',
    '/api/customers',
    '/api/dashboard',
    '/api/notifications',
    '/api/tasks',
    '/api/templates',
    '/api/knowledge/articles',
    '/api/admin/users',
    '/api/admin/audit',
    '/api/admin/portal/invitations/1',
  ];

  beforeEach(async () => {
    world = await buildPortalWorld();
    ({ agent } = await agentAs('admin'));
  });

  it('a real staff session reaches the staff surface', async () => {
    // The control. Without it, a suite that refused everything for the wrong
    // reason — a broken app, a bad route mount — would still pass.
    const response = await agent.get('/api/tickets');
    expect(response.status).toBe(200);
  });

  for (const route of STAFF_ROUTES) {
    it(`${route} refuses a portal access token`, async () => {
      const response = await supertest(app)
        .get(route)
        .set('Authorization', `Bearer ${world.a.accessToken}`);

      // 401, never 403: a 403 would confirm the token authenticated somebody.
      expect(response.status).toBe(401);
      expect(response.body.error?.code).toBe('UNAUTHENTICATED');
    });
  }

  it('no staff user is resolved from a portal token', async () => {
    const response = await supertest(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(401);
    // Nothing about a user in the body — not a name, not an id, not an email.
    expect(JSON.stringify(response.body)).not.toContain('@');
  });
});

describe('a portal session reaches the portal', () => {
  /**
   * The other control. A realm test that only ever asserts refusal proves the
   * door is locked and says nothing about whether it opens.
   */
  it('lists the signed-in contact’s own requests', async () => {
    const world = await buildPortalWorld();

    const response = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].reference).toBe(world.ticketA.reference);
  });
});
