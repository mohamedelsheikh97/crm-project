/**
 * The permission catalog — the single source of truth for enforcement, for the
 * roles screen, and for the generated matrix test (research.md D2).
 *
 * This file lives outside `services/` deliberately: it is a declaration every
 * layer reads, not logic any layer runs.
 *
 * A later phase adds a module by extending PERMISSIONS and adding a grant to
 * the seeder. No migration is needed, because grants are keyed by string. A
 * key that is not listed here grants nothing, even if a row for it exists in
 * `role_permissions`.
 */

export interface PermissionDefinition {
  key: string;
  module: string;
  action: string;
  /** i18n key — never a literal label (Constitution Principle I). */
  nameKey: string;
}

function define(module: string, action: string): PermissionDefinition {
  return {
    key: `${module}:${action}`,
    module,
    action,
    nameKey: `permission.action.${module}.${action}`,
  };
}

export const PERMISSIONS = [
  define('users', 'view'),
  define('users', 'create'),
  define('users', 'update'),
  define('users', 'deactivate'),
  define('users', 'reset_password'),
  define('roles', 'view'),
  // No `roles:create` or `roles:delete` — the role set is fixed (FR-021).
  define('roles', 'update_permissions'),
  define('audit', 'view'),
  define('settings', 'view'),

  // Phase 2 — Customer Management. Viewing, editing, and exporting are
  // distinguished because export is the action that takes customer data out of
  // the system (FR-042). Deactivation is separate from update because it is the
  // closest thing to deletion available.
  define('customers', 'view'),
  define('customers', 'create'),
  define('customers', 'update'),
  define('customers', 'deactivate'),
  define('customers', 'export'),

  // Separate modules so "may add a note" can be granted without "may edit the
  // customer". The manage action covers another user's note (FR-027); anyone
  // holding notes:create may always edit their own.
  define('notes', 'create'),
  define('notes', 'manage'),

  define('attachments', 'upload'),
  define('attachments', 'delete'),

  // Phase 3 — Ticket Management. The lifecycle actions are separated because
  // they carry different authority: transitioning is everyday work, closing
  // finishes a piece of it, and reopening undoes something already finished
  // (Clarifications Q2). Assignment is Supervisor-only (Q3), which is why it is
  // its own key rather than part of tickets:update.
  define('tickets', 'view'),
  define('tickets', 'create'),
  define('tickets', 'update'),
  define('tickets', 'transition'),
  define('tickets', 'close'),
  define('tickets', 'reopen'),
  define('tickets', 'assign'),
  define('tickets', 'merge'),
  define('tickets', 'link'),
  // Act on a ticket assigned to someone else. Conditional by nature: it is
  // never a route gate, only an additional allowance the service consults.
  define('tickets', 'manage_any'),

  // Phase 4 — Agent Dashboard.
  //
  // `dashboard:view` covers a user's OWN queue, notifications, and tasks;
  // `view_any` is what lets a Supervisor look at someone else's queue (FR-010).
  //
  // There is deliberately NO `notifications:view` key. A permission every role
  // holds unconditionally, and that can therefore never refuse anything, is not
  // a gate — it is noise on the roles screen and a matrix row that cannot fail.
  // Notifications and tasks are scoped by OWNERSHIP, enforced in the service
  // and verified by tests/ownership.matrix.test.ts (FR-076, SC-012). Same
  // reasoning `tickets:manage_any` above already applies.
  define('dashboard', 'view'),
  define('dashboard', 'view_any'),

  // Separate from tickets:update because reading a queue must never imply the
  // authority to change what is late (FR-075).
  define('tickets', 'set_due_date'),

  // Mirrors the customer `notes` split: "may add a note" is grantable without
  // "may edit someone else's". Anyone holding ticket_notes:create may always
  // edit their own.
  define('ticket_notes', 'create'),
  define('ticket_notes', 'manage'),

  // Own tasks only. Tasks are personal (Clarifications Q3) — there is no key
  // for acting on another user's task, because there is no such action.
  define('tasks', 'manage'),

  // Using the library is everyday work; changing it for everyone is not.
  define('templates', 'use'),
  define('templates', 'manage'),

  // Phase 5 — Communication Channels.
  //
  // `messages:send` is separate from `ticket_notes:create` on purpose (FR-043),
  // and the separation is the whole of SC-006. They are the two composers on
  // one screen: one writes to a colleague, the other speaks to a customer in
  // the organisation's name. Holding the authority to do the first must not
  // imply the second, and the person who may annotate a ticket is not
  // automatically the person who may answer it.
  define('messages', 'send'),
  // Correcting which customer a conversation belongs to moves correspondence
  // between records, so it is a supervisory act rather than everyday work.
  define('messages', 'reattribute'),

  // There is deliberately NO `timeline:view` key. The timeline rides on
  // `customers:view` and is filtered by ticket visibility (FR-090). A
  // permission every role holds unconditionally cannot refuse anything — the
  // same reasoning that kept `notifications:view` out of the Phase 4 catalog.

  // Switching a channel on points the outside world at this system.
  define('channels', 'manage'),
  // A published form is a public endpoint anyone can submit to.
  define('forms', 'manage'),
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEYS.has(value);
}

export function allPermissionKeys(): PermissionKey[] {
  return PERMISSIONS.map((p) => p.key as PermissionKey);
}

export interface PermissionModule {
  key: string;
  nameKey: string;
  actions: Array<{ key: string; nameKey: string }>;
}

/**
 * Module-grouped shape for GET /api/admin/permissions, so the roles screen can
 * never offer a permission nothing enforces.
 */
export function permissionCatalog(): PermissionModule[] {
  const modules = new Map<string, PermissionModule>();

  for (const permission of PERMISSIONS) {
    let entry = modules.get(permission.module);

    if (!entry) {
      entry = {
        key: permission.module,
        nameKey: `permission.module.${permission.module}`,
        actions: [],
      };
      modules.set(permission.module, entry);
    }

    entry.actions.push({ key: permission.key, nameKey: permission.nameKey });
  }

  return [...modules.values()];
}
