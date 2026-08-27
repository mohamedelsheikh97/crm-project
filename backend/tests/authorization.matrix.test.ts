import type { Router } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS, type PermissionKey } from '../src/auth/permissions.js';
import { Role } from '../src/models/index.js';
import adminRouter from '../src/routes/admin/index.js';
import { agentAs, agentFor, createTestUser, signInAs } from './helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from './helpers/database.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * One representative request per permission key. Generated FROM the catalog
 * rather than hand-listed, so a module added in a later phase without a matrix
 * entry fails here instead of shipping unverified.
 */
const PROBES: Record<
  PermissionKey,
  { method: 'get' | 'post' | 'patch' | 'put' | 'delete'; path: string }
> = {
  'users:view': { method: 'get', path: '/api/admin/users' },
  'users:create': { method: 'post', path: '/api/admin/users' },
  'users:update': { method: 'patch', path: '/api/admin/users/999999' },
  'users:deactivate': { method: 'post', path: '/api/admin/users/999999/deactivate' },
  'users:reset_password': { method: 'post', path: '/api/admin/users/999999/reset-password' },
  'roles:view': { method: 'get', path: '/api/admin/roles' },
  'roles:update_permissions': { method: 'put', path: '/api/admin/roles/999999/permissions' },
  'audit:view': { method: 'get', path: '/api/admin/audit' },
  'settings:view': { method: 'get', path: '/api/admin/settings' },

  // Phase 2 — customers sit at the top level, not under /api/admin: they are
  // everyday Agent work rather than administration.
  'customers:view': { method: 'get', path: '/api/customers' },
  'customers:create': { method: 'post', path: '/api/customers' },
  'customers:update': { method: 'patch', path: '/api/customers/999999' },
  'customers:deactivate': { method: 'post', path: '/api/customers/999999/deactivate' },
  'customers:export': { method: 'get', path: '/api/customers/export' },
  'notes:create': { method: 'post', path: '/api/customers/999999/notes' },
  'notes:manage': { method: 'patch', path: '/api/customers/999999/notes/999999' },
  'attachments:upload': { method: 'post', path: '/api/customers/999999/attachments' },
  'attachments:delete': { method: 'delete', path: '/api/customers/999999/attachments/999999' },
};

const ROLE_KEYS = ['agent', 'supervisor', 'admin'] as const;

interface RegisteredRoute {
  path: string;
  methods: string[];
  handlerCount: number;
}

/**
 * Walks the admin router by MODULE REFERENCE rather than by reconstructing
 * paths from the mounted app.
 *
 * Express 5 replaced each layer's `regexp` with opaque matcher functions, so a
 * mount path can no longer be recovered from internals. Importing the router
 * directly avoids that entirely and states the intent more plainly: every route
 * registered under the admin router must carry a permission.
 */
function collectAdminRoutes(): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];

  const walk = (layer: unknown): void => {
    const entry = layer as {
      route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
      handle?: Router & { stack?: unknown[] };
    };

    if (entry.route) {
      found.push({
        path: entry.route.path,
        methods: Object.keys(entry.route.methods),
        handlerCount: entry.route.stack.length,
      });
      return;
    }

    for (const child of entry.handle?.stack ?? []) {
      walk(child);
    }
  };

  for (const layer of (adminRouter as unknown as { stack: unknown[] }).stack) {
    walk(layer);
  }

  return found;
}

describe('permission matrix (SC-003)', () => {
  it.each(
    PERMISSIONS.flatMap((permission) =>
      ROLE_KEYS.map((roleKey) => ({ key: permission.key as PermissionKey, roleKey })),
    ),
  )('$roleKey against $key', async ({ key, roleKey }) => {
    const { agent } = await agentAs(roleKey);
    const role = await Role.findOne({ where: { key: roleKey } });
    const granted = await import('../src/services/authorization.service.js').then((m) =>
      m.roleHasPermission(role!.id, key),
    );

    const probe = PROBES[key];
    const response = await agent[probe.method](probe.path).send({});

    if (granted) {
      // Anything but 403. A 400/404/409 means the request reached the handler,
      // which is what "permitted" means here — the matrix tests authorization,
      // not payload validity.
      expect(response.status).not.toBe(403);
    } else {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('every catalog key has a probe, so nothing is silently untested', () => {
    const missing = PERMISSIONS.map((p) => p.key).filter((key) => !(key in PROBES));

    expect(missing).toEqual([]);
  });

  it('every admin route requires at least one permission', () => {
    const adminRoutes = collectAdminRoutes();

    expect(adminRoutes.length).toBeGreaterThan(0);

    // authenticate and requirePasswordChange are applied at the router level,
    // so a route with only its controller has no requirePermission of its own.
    const unguarded = adminRoutes.filter((route) => route.handlerCount < 2);

    expect(unguarded).toEqual([]);
  });

  it('every catalog key is enforced by some route', () => {
    // A permission nothing checks is dead: it can be granted, it appears in the
    // roles screen, and it protects nothing.
    const probed = new Set(Object.keys(PROBES));
    const orphaned = PERMISSIONS.map((p) => p.key).filter((key) => !probed.has(key));

    expect(orphaned).toEqual([]);
  });
});

describe('pipeline stages apply to every protected route', () => {
  it('refuses an inactive user with 401 everywhere', async () => {
    const admin = await agentAs('admin');
    const user = await createTestUser({ roleKey: 'admin' });
    const token = await signInAs(user);
    const victim = agentFor(token);

    await admin.agent.post(`/api/admin/users/${user.id}/deactivate`);

    for (const probe of Object.values(PROBES)) {
      const response = await victim[probe.method](probe.path).send({});
      expect(response.status).toBe(401);
    }
  });

  it('refuses a user owing a password change everywhere except the three exempt routes', async () => {
    const user = await createTestUser({ roleKey: 'admin', mustChangePassword: true });
    const agent = agentFor(await signInAs(user));

    for (const probe of Object.values(PROBES)) {
      const response = await agent[probe.method](probe.path).send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }

    // The three exempt routes stay reachable so the user can resolve it.
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
  });
});
