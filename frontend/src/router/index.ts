import { createRouter, createWebHistory } from 'vue-router';

import i18n from '../i18n';
import { useAuthStore } from '../stores/auth.store';
import AdminLayout from '../layouts/AdminLayout.vue';
import ChangePasswordView from '../views/ChangePasswordView.vue';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import CustomerFormView from '../views/customers/CustomerFormView.vue';
import CustomerListView from '../views/customers/CustomerListView.vue';
import CustomerProfileView from '../views/customers/CustomerProfileView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import AuditLogView from '../views/admin/AuditLogView.vue';
import RolesView from '../views/admin/RolesView.vue';
import SettingsShellView from '../views/admin/SettingsShellView.vue';
import UserFormView from '../views/admin/UserFormView.vue';
import UsersListView from '../views/admin/UsersListView.vue';

const router = createRouter({
  // History mode (Phase 0 FR-013).
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      // An i18n key, never a literal — navigation is translatable from the
      // first route onward (Phase 0 frontend-shell.md).
      meta: { titleKey: 'route.home.title' },
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { titleKey: 'route.login.title' },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: ChangePasswordView,
      meta: { titleKey: 'route.changePassword.title', requiresAuth: true },
    },
    // Customers sit at the top level, not under /admin: they are everyday Agent
    // work rather than administration.
    {
      path: '/customers',
      name: 'customer-list',
      component: CustomerListView,
      meta: {
        titleKey: 'route.customers.list.title',
        requiresAuth: true,
        permission: 'customers:view',
      },
    },
    {
      path: '/customers/new',
      name: 'customer-new',
      component: CustomerFormView,
      meta: {
        titleKey: 'route.customers.form.title',
        requiresAuth: true,
        permission: 'customers:create',
      },
    },
    {
      path: '/customers/:id',
      name: 'customer-profile',
      component: CustomerProfileView,
      meta: {
        titleKey: 'route.customers.profile.title',
        requiresAuth: true,
        permission: 'customers:view',
      },
    },
    {
      path: '/customers/:id/edit',
      name: 'customer-edit',
      component: CustomerFormView,
      meta: {
        titleKey: 'route.customers.form.title',
        requiresAuth: true,
        permission: 'customers:update',
      },
    },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'admin-users' } },
        {
          path: 'users',
          name: 'admin-users',
          component: UsersListView,
          meta: { titleKey: 'route.admin.users.title', permission: 'users:view' },
        },
        {
          path: 'users/new',
          name: 'admin-user-new',
          component: UserFormView,
          meta: { titleKey: 'route.admin.userForm.title', permission: 'users:create' },
        },
        {
          path: 'users/:id',
          name: 'admin-user-edit',
          component: UserFormView,
          meta: { titleKey: 'route.admin.userForm.title', permission: 'users:update' },
        },
        {
          path: 'roles',
          name: 'admin-roles',
          component: RolesView,
          meta: { titleKey: 'route.admin.roles.title', permission: 'roles:view' },
        },
        {
          path: 'audit',
          name: 'admin-audit',
          component: AuditLogView,
          meta: { titleKey: 'route.admin.audit.title', permission: 'audit:view' },
        },
        {
          path: 'settings',
          name: 'admin-settings',
          component: SettingsShellView,
          meta: { titleKey: 'route.admin.settings.title', permission: 'settings:view' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { titleKey: 'route.notFound.title' },
    },
  ],
});

/**
 * A CONVENIENCE, NOT A CONTROL.
 *
 * This guard exists so a user does not land on a screen that will immediately
 * error. Every endpoint behind every guarded route enforces the same permission
 * server-side (FR-015, contracts/authorization.md). Removing this guard would
 * make the interface worse; it would not make anything reachable.
 */
router.beforeEach((to) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    // Remember where they were heading, so signing in lands them there
    // rather than dumping them on the home page.
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  // A signed-in user has no business on the login screen.
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'home' };
  }

  // A forced password change is enforced by the backend for every route except
  // three; mirroring it here keeps the user from bouncing off an error.
  if (auth.isAuthenticated && auth.mustChangePassword && to.name !== 'change-password') {
    return { name: 'change-password' };
  }

  const permission = to.meta.permission;

  if (typeof permission === 'string' && !auth.permissions.has(permission)) {
    // Denied rather than unauthenticated: they are signed in, just not
    // permitted. The endpoint behind the screen refuses independently.
    return { name: 'home', query: { denied: '1' } };
  }

  return true;
});

router.afterEach((to) => {
  const titleKey = to.meta.titleKey;

  if (typeof titleKey === 'string') {
    document.title = i18n.global.t(titleKey);
  }
});

export default router;
