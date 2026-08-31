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

  // Phase 3 — tickets sit at the top level for the same reason customers do:
  // they are the everyday work this system exists for, not administration.
  'tickets:view': { method: 'get', path: '/api/tickets' },
  'tickets:create': { method: 'post', path: '/api/tickets' },
  'tickets:update': { method: 'patch', path: '/api/tickets/999999' },
  'tickets:transition': { method: 'post', path: '/api/tickets/999999/transitions' },
  'tickets:assign': { method: 'put', path: '/api/tickets/999999/assignee' },
  'tickets:merge': { method: 'post', path: '/api/tickets/999999/merge' },
  'tickets:link': { method: 'post', path: '/api/tickets/999999/links' },

  // Phase 4 — the agent's workspace. Top level for the same reason again.
  'dashboard:view': { method: 'get', path: '/api/dashboard/queue' },
  'tickets:set_due_date': { method: 'put', path: '/api/tickets/999999/due-date' },
  'ticket_notes:create': { method: 'post', path: '/api/tickets/999999/notes' },
  'tasks:manage': { method: 'post', path: '/api/tasks' },
  'templates:use': { method: 'get', path: '/api/templates' },
  'templates:manage': { method: 'post', path: '/api/templates' },

  // Phase 5 — communication channels. Messages hang off the ticket path
  // because correspondence belongs to a ticket; channels and forms are
  // administration and sit at the top level.
  //
  // There is deliberately no probe for reading a thread or a timeline: both
  // ride on permissions that already have one (tickets:view, customers:view).
  'messages:send': { method: 'post', path: '/api/tickets/999999/messages' },
  'messages:reattribute': { method: 'post', path: '/api/tickets/999999/reattribute' },
  'channels:manage': { method: 'get', path: '/api/channels' },
  'forms:manage': { method: 'post', path: '/api/forms' },

  // Phase 6 — SLA & automation. All four sit under /api/admin: they are
  // configuration that changes what the system does to every future ticket,
  // not everyday work on one.
  //
  // There is deliberately no probe for reading a ticket's SLA state: it rides
  // on tickets:view, which already has one, and there is no `sla:view` key.
  'sla:manage': { method: 'get', path: '/api/admin/sla/policies' },
  // A plain probe works despite FR-051's extra condition: Administrator holds
  // both `assignment:manage` and `tickets:assign`, so the granted case reaches
  // the handler, and every role without the key is refused at the route. The
  // FR-051 condition itself — holding this key WITHOUT tickets:assign — is
  // covered by backend/tests/assignment/authority.test.ts.
  'assignment:manage': { method: 'get', path: '/api/admin/assignment' },
  'automation:manage': { method: 'get', path: '/api/admin/automation/rules' },
  'automation:view': { method: 'get', path: '/api/admin/automation/runs' },
};

const ROLE_KEYS = ['agent', 'supervisor', 'admin'] as const;

/**
 * Permissions that are NOT a route gate.
 *
 * `notes:manage` is conditional: the route requires `notes:create`, and the
 * service additionally demands `notes:manage` only when the note belongs to
 * someone else (FR-027). A route-level probe cannot express "allowed for your
 * own, refused for another's", so asserting one here would either pass
 * vacuously or fail for the wrong reason.
 *
 * These are still enforced and still tested — by the named tests listed
 * below, which cover the condition the matrix cannot.
 */
const CONDITIONAL_PERMISSIONS: Record<string, string> = {
  'notes:manage': 'backend/tests/customers/notes.test.ts',

  // Phase 3. `tickets:close` is conditional in the same way: the route gate is
  // tickets:transition, and the lifecycle service demands tickets:close for the
  // resolved -> closed edge, plus tickets:manage_any when the ticket belongs to
  // someone else (Clarifications Q2).
  'tickets:close': 'backend/tests/tickets/transitions.test.ts',
  // `tickets:reopen` gates ONE edge, closed -> open. A route probe would have
  // to first create a closed ticket, which is a lifecycle test, not a matrix
  // one — the matrix would either pass vacuously or fail for the wrong reason.
  'tickets:reopen': 'backend/tests/ticket-lifecycle.matrix.test.ts',
  // `tickets:manage_any` is never a route gate at all: it is only ever an
  // additional allowance the service consults.
  'tickets:manage_any': 'backend/tests/tickets/transitions.test.ts',

  // Phase 4. `dashboard:view_any` is conditional in exactly the way
  // `notes:manage` is: the route gate is dashboard:view, and the service
  // additionally demands view_any only when `userId` names someone else
  // (FR-010). A route probe cannot express "allowed for your own queue, refused
  // for another's".
  'dashboard:view_any': 'backend/tests/dashboard/queue.test.ts',
  // Same shape: ticket_notes:create gates the route, and the service demands
  // ticket_notes:manage only when the note belongs to someone else (FR-034).
  'ticket_notes:manage': 'backend/tests/ticket-notes/notes.test.ts',
};

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
    if (key in CONDITIONAL_PERMISSIONS) {
      // Covered by a named test instead — see CONDITIONAL_PERMISSIONS.
      return;
    }

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

  it('every catalog key has a probe or a named conditional test', () => {
    // Coverage is a probe OR a conditional entry — never neither. A conditional
    // entry is not an escape hatch: the test below requires it to name the file
    // that covers the condition a route probe cannot express.
    const missing = PERMISSIONS.map((p) => p.key).filter(
      (key) => !(key in PROBES) && !(key in CONDITIONAL_PERMISSIONS),
    );

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

  it('every conditional permission names the test that covers it', () => {
    // A conditional permission is exempt from the route probe, so it must
    // point at where it IS covered. Exempt and untested is the failure this
    // prevents.
    for (const [key, coveredBy] of Object.entries(CONDITIONAL_PERMISSIONS)) {
      expect(PERMISSIONS.map((p) => p.key)).toContain(key);
      expect(coveredBy).toMatch(/.test.ts$/);
    }
  });

  it('every catalog key is granted to at least one role', async () => {
    // The trap this project has hit at every phase boundary, stated as an
    // assertion: a key added to the catalog without a matching grant in a
    // seeder is refused for EVERYONE, and the resulting 403 looks like a
    // permission bug rather than a missing seeder. Administrators hold the
    // whole catalog, so an ungranted key here means the seeder was forgotten.
    const { roleHasPermission } = await import('../src/services/authorization.service.js');
    const roles = await Role.findAll();
    const ungranted: string[] = [];

    for (const permission of PERMISSIONS) {
      const held = await Promise.all(
        roles.map((role) => roleHasPermission(role.id, permission.key as PermissionKey)),
      );

      if (!held.some(Boolean)) ungranted.push(permission.key);
    }

    expect(ungranted).toEqual([]);
  });

  it('every catalog key is enforced by some route', () => {
    // A permission nothing checks is dead: it can be granted, it appears in the
    // roles screen, and it protects nothing.
    const covered = new Set([...Object.keys(PROBES), ...Object.keys(CONDITIONAL_PERMISSIONS)]);
    const orphaned = PERMISSIONS.map((p) => p.key).filter((key) => !covered.has(key));

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
