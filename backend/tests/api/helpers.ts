import supertest from 'supertest';

import app from '../../src/app.js';
import type { PermissionKey } from '../../src/auth/permissions.js';
import * as apiClientService from '../../src/services/api-client.service.js';
import { createTestUser } from '../helpers/auth.js';

/**
 * Issuing credentials for the published-interface tests.
 *
 * Every test in this directory needs a credential with a specific set of
 * permissions, and `grantableBy` has to be supplied because FR-020 is checked at
 * grant time. Repeating that in eight files would mean eight chances to pass the
 * wrong set and accidentally test a wider credential than intended.
 */
export interface ApiAgent {
  readonly bearer: string;
  readonly clientId: string;
  get: (path: string) => supertest.Test;
  post: (path: string) => supertest.Test;
  put: (path: string) => supertest.Test;
  patch: (path: string) => supertest.Test;
  delete: (path: string) => supertest.Test;
}

/**
 * A credential holding exactly the permissions asked for.
 *
 * `grantableBy` is the SAME set, so these helpers cannot be used to test FR-020
 * — `tests/integrations/grant-authority.test.ts` calls the service directly for
 * that. Keeping them identical here means a test asking for two permissions
 * gets two, rather than silently getting whatever an administrator happened to
 * hold.
 */
export async function apiClientWith(...permissions: PermissionKey[]): Promise<ApiAgent> {
  const admin = await createTestUser({ roleKey: 'admin' });

  const { client, bearer } = await apiClientService.issue({
    name: `Test client (${permissions.join(', ') || 'no permissions'})`,
    permissions,
    createdByUserId: admin.id,
    grantableBy: new Set(permissions),
  });

  const auth = (test: supertest.Test) => test.set('Authorization', `Bearer ${bearer}`);

  return {
    bearer,
    clientId: client.client_id,
    get: (path) => auth(supertest(app).get(path)),
    post: (path) => auth(supertest(app).post(path)),
    put: (path) => auth(supertest(app).put(path)),
    patch: (path) => auth(supertest(app).patch(path)),
    delete: (path) => auth(supertest(app).delete(path)),
  };
}

/** An unauthenticated request, for the refusal assertions. */
export function anonymous() {
  return supertest(app);
}
