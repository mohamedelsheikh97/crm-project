import { createRouter, createWebHistory } from 'vue-router';

import i18n from '../i18n';
import { ensureSessionRestored } from '../services/auth.service';
import { useAuthStore } from '../stores/auth.store';
import { usePortalStore } from '../stores/portal.store';
import AdminLayout from '../layouts/AdminLayout.vue';
import ChangePasswordView from '../views/ChangePasswordView.vue';
import DashboardView from '../views/DashboardView.vue';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import CustomerFormView from '../views/customers/CustomerFormView.vue';
import CustomerListView from '../views/customers/CustomerListView.vue';
import CustomerProfileView from '../views/customers/CustomerProfileView.vue';
import HelpArticleView from '../views/help/HelpArticleView.vue';
import HelpCentreView from '../views/help/HelpCentreView.vue';
import HelpContactView from '../views/help/HelpContactView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import AcceptInviteView from '../views/portal/AcceptInviteView.vue';
import NewRequestView from '../views/portal/NewRequestView.vue';
import PortalHelpView from '../views/portal/PortalHelpView.vue';
import PortalLoginView from '../views/portal/PortalLoginView.vue';
import PortalResetView from '../views/portal/PortalResetView.vue';
import RequestDetailView from '../views/portal/RequestDetailView.vue';
import RequestListView from '../views/portal/RequestListView.vue';
import TicketCreateView from '../views/tickets/TicketCreateView.vue';
import TicketDetailView from '../views/tickets/TicketDetailView.vue';
import TicketListView from '../views/tickets/TicketListView.vue';
import AuditLogView from '../views/admin/AuditLogView.vue';
import RolesView from '../views/admin/RolesView.vue';
import AssignmentView from '../views/admin/AssignmentView.vue';
import AutomationRulesView from '../views/admin/AutomationRulesView.vue';
import AutomationRunsView from '../views/admin/AutomationRunsView.vue';
import BusinessCalendarView from '../views/admin/BusinessCalendarView.vue';
import KnowledgeStructureView from '../views/admin/KnowledgeStructureView.vue';
import KnowledgeView from '../views/admin/KnowledgeView.vue';
import SlaPoliciesView from '../views/admin/SlaPoliciesView.vue';
import TemplatesView from '../views/admin/TemplatesView.vue';
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
    // The screen an agent lives in. Top level, like customers and tickets: it
    // is everyday work rather than administration.
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
      meta: {
        titleKey: 'route.dashboard.title',
        requiresAuth: true,
        permission: 'dashboard:view',
      },
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
    // Tickets sit alongside customers at the top level: this is the everyday
    // work the system exists for, not administration.
    {
      path: '/tickets',
      name: 'ticket-list',
      component: TicketListView,
      meta: {
        titleKey: 'route.tickets.list.title',
        requiresAuth: true,
        permission: 'tickets:view',
      },
    },
    {
      path: '/tickets/new',
      name: 'ticket-new',
      component: TicketCreateView,
      meta: {
        titleKey: 'route.tickets.create.title',
        requiresAuth: true,
        permission: 'tickets:create',
      },
    },
    {
      path: '/tickets/:id',
      name: 'ticket-detail',
      component: TicketDetailView,
      meta: {
        titleKey: 'route.tickets.detail.title',
        requiresAuth: true,
        permission: 'tickets:view',
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
        // Managing the library is administration; USING a template needs no
        // route at all — the picker lives inside the note composer.
        {
          path: 'templates',
          name: 'admin-templates',
          component: TemplatesView,
          meta: { titleKey: 'route.templates.title', permission: 'templates:manage' },
        },
        // Phase 6. All five are CONFIGURATION — they change what the system
        // does to every future ticket — which is why they sit under /admin
        // rather than beside the everyday ticket screens.
        {
          path: 'sla/policies',
          name: 'admin-sla-policies',
          component: SlaPoliciesView,
          meta: { titleKey: 'route.admin.sla.title', permission: 'sla:manage' },
        },
        {
          path: 'sla/calendar',
          name: 'admin-sla-calendar',
          component: BusinessCalendarView,
          meta: { titleKey: 'route.admin.calendar.title', permission: 'sla:manage' },
        },
        {
          path: 'assignment',
          name: 'admin-assignment',
          component: AssignmentView,
          meta: { titleKey: 'route.admin.assignment.title', permission: 'assignment:manage' },
        },
        {
          path: 'automation',
          name: 'admin-automation',
          component: AutomationRulesView,
          meta: { titleKey: 'route.admin.automation.title', permission: 'automation:manage' },
        },
        // A DIFFERENT PERMISSION from the builder: reading what automation did
        // is a supervisor's question; building rules is not.
        {
          path: 'automation/runs',
          name: 'admin-automation-runs',
          component: AutomationRunsView,
          meta: { titleKey: 'route.admin.automationRuns.title', permission: 'automation:view' },
        },
        // Phase 7. Under /admin because writing down what the organisation
        // knows sits beside the template library rather than beside a ticket
        // queue — it is content everybody reads, maintained by a few. The guard
        // is kb:author, which every Agent holds: the person who just solved
        // something is the person who should write it down.
        {
          path: 'knowledge',
          name: 'admin-knowledge',
          component: KnowledgeView,
          meta: { titleKey: 'route.admin.knowledge.title', permission: 'kb:author' },
        },
        // A DIFFERENT PERMISSION from the article screen, and the split is the
        // point: writing one article and deciding how everything is filed are
        // different jobs. `kb:manage` reorganises what every reader meets first.
        {
          path: 'knowledge/structure',
          name: 'admin-knowledge-structure',
          component: KnowledgeStructureView,
          meta: { titleKey: 'route.admin.knowledgeStructure.title', permission: 'kb:manage' },
        },
        {
          path: 'settings',
          name: 'admin-settings',
          component: SettingsShellView,
          meta: { titleKey: 'route.admin.settings.title', permission: 'settings:view' },
        },
      ],
    },
    // --- The public help centre (Phase 7, User Story 4) --------------------
    //
    // NO `requiresAuth`, AND NO `permission`, ON ANY OF THESE. That is the
    // point of the block, and it is grouped and commented for the same reason
    // routes/public/index.ts is a single file on the server: the whole
    // unauthenticated surface should be readable in one place.
    //
    // `publicShell: true` renders them OUTSIDE the authenticated application
    // shell — no navigation into signed-in areas, no user menu, nothing that
    // implies an account exists. A help centre offering a sign-in box to a
    // customer who has no account is telling them they are in the wrong place.
    {
      path: '/help',
      name: 'help',
      component: HelpCentreView,
      meta: { titleKey: 'route.help.title', publicShell: true },
    },
    {
      path: '/help/contact',
      name: 'help-contact',
      component: HelpContactView,
      meta: { titleKey: 'route.help.contact.title', publicShell: true },
    },
    // BY SLUG, NEVER BY ID (research D10). Sequential ids in a public URL
    // disclose the size of the corpus and let a stranger walk it. Declared
    // after /help/contact so the literal path wins the match.
    {
      path: '/help/:slug',
      name: 'help-article',
      component: HelpArticleView,
      meta: { titleKey: 'route.help.article.title', publicShell: true },
    },
    // --- The customer portal (Phase 8) -------------------------------------
    //
    // `portalShell: true` renders these in `PortalLayout` rather than the
    // authenticated staff shell (FR-063). Driven by route meta, exactly as Phase
    // 7's `publicShell` is, so a reader of this file meets the rule where the
    // route is declared.
    //
    // `requiresAuth` IS DELIBERATELY ABSENT. That flag means a STAFF session, and
    // the guard below reads the staff store — a portal route carrying it would
    // send every customer to the staff login screen. The portal's own guard is
    // three lines further down, keyed on the portal store.
    //
    // REFERENCES AND SLUGS IN PATHS, never ids (FR-065). And NO REGISTRATION
    // ROUTE: its absence is a requirement, not an omission (FR-002a).
    {
      path: '/portal/login',
      name: 'portal-login',
      component: PortalLoginView,
      meta: { titleKey: 'route.portal.login.title', portalShell: true },
    },
    {
      path: '/portal/invite/:token',
      name: 'portal-invite',
      component: AcceptInviteView,
      meta: { titleKey: 'route.portal.invite.title', portalShell: true },
    },
    {
      path: '/portal/forgot',
      name: 'portal-forgot',
      component: PortalResetView,
      meta: { titleKey: 'route.portal.reset.title', portalShell: true },
    },
    {
      path: '/portal/reset/:token',
      name: 'portal-reset',
      component: PortalResetView,
      meta: { titleKey: 'route.portal.reset.title', portalShell: true },
    },
    {
      path: '/portal',
      name: 'portal-requests',
      component: RequestListView,
      meta: {
        titleKey: 'route.portal.requests.title',
        portalShell: true,
        requiresPortalAuth: true,
      },
    },
    {
      path: '/portal/requests/new',
      name: 'portal-new-request',
      component: NewRequestView,
      meta: {
        titleKey: 'route.portal.newRequest.title',
        portalShell: true,
        requiresPortalAuth: true,
      },
    },
    // BY REFERENCE (TKT-000042), never by id.
    {
      path: '/portal/requests/:reference',
      name: 'portal-request',
      component: RequestDetailView,
      meta: {
        titleKey: 'route.portal.request.title',
        portalShell: true,
        requiresPortalAuth: true,
      },
    },
    {
      path: '/portal/help',
      name: 'portal-help',
      component: PortalHelpView,
      meta: { titleKey: 'route.portal.help.title', portalShell: true, requiresPortalAuth: true },
    },
    // BY SLUG (Phase 7 research D10), for the same reason.
    {
      path: '/portal/help/:slug',
      name: 'portal-help-article',
      component: PortalHelpView,
      meta: { titleKey: 'route.portal.help.title', portalShell: true, requiresPortalAuth: true },
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
router.beforeEach(async (to) => {
  // MUST come before any read of the store.
  //
  // `app.use(router)` starts the initial navigation from inside `install()`,
  // not from `app.mount()`, so this guard runs before anything main.ts does
  // afterwards. The access token lives in memory only (D5/D6), so a page load
  // begins with none, and a guard that read the store first would send every
  // `requiresAuth` route to the login screen on refresh — with a valid refresh
  // cookie sitting in the browser.
  //
  // Single-flight and already resolved after the first navigation, so this
  // costs one await per route change and no extra requests.
  await ensureSessionRestored();

  // Phase 8. THE PORTAL'S OWN GATE, keyed on the portal store rather than the
  // staff one — the front-end half of the realm separation. A customer sent to
  // the staff login screen would be told to sign in somewhere they have no
  // account, which is the confusion two stores exist to prevent.
  //
  // A CONVENIENCE, NOT A CONTROL, exactly as the staff guard below is: every
  // portal endpoint enforces independently, and a token from the wrong realm
  // fails at signature verification on the server.
  const portal = usePortalStore();

  if (to.meta.requiresPortalAuth && !portal.accessToken) {
    return { name: 'portal-login', query: { redirect: to.fullPath } };
  }

  if (to.name === 'portal-login' && portal.accessToken) {
    return { name: 'portal-requests' };
  }

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
