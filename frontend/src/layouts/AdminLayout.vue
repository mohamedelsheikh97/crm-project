<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePermissions } from '../composables/usePermissions';

const { t } = useI18n();
const { can } = usePermissions();

/**
 * Entries are hidden when the role lacks the permission (FR-020) — and the
 * endpoint behind each screen enforces the same permission independently, so
 * this is presentation, not access control.
 */
const entries = computed(() =>
  [
    { name: 'admin-users', labelKey: 'admin.nav.users', permission: 'users:view' },
    { name: 'admin-roles', labelKey: 'admin.nav.roles', permission: 'roles:view' },
    { name: 'admin-audit', labelKey: 'admin.nav.audit', permission: 'audit:view' },
    // Phase 6. Grouped after the Phase 1-5 entries and before settings, so the
    // order reads as identity → work → policy → configuration.
    { name: 'admin-sla-policies', labelKey: 'admin.nav.sla', permission: 'sla:manage' },
    { name: 'admin-sla-calendar', labelKey: 'admin.nav.calendar', permission: 'sla:manage' },
    { name: 'admin-assignment', labelKey: 'admin.nav.assignment', permission: 'assignment:manage' },
    { name: 'admin-automation', labelKey: 'admin.nav.automation', permission: 'automation:manage' },
    {
      name: 'admin-automation-runs',
      labelKey: 'admin.nav.automationRuns',
      permission: 'automation:view',
    },
    // Phase 7. Sits with the template library conceptually — both are text
    // the organisation keeps and reuses — but after the Phase 6 configuration
    // entries, so the order still reads identity -> work -> policy -> content.
    { name: 'admin-knowledge', labelKey: 'admin.nav.knowledge', permission: 'kb:author' },
    {
      name: 'admin-knowledge-structure',
      labelKey: 'admin.nav.knowledgeStructure',
      permission: 'kb:manage',
    },
    { name: 'admin-settings', labelKey: 'admin.nav.settings', permission: 'settings:view' },
  ].filter((entry) => can(entry.permission)),
);
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-8">
    <h1 class="mb-6 text-2xl font-semibold tracking-tight">{{ t('admin.title') }}</h1>

    <div class="flex flex-col gap-8 md:flex-row">
      <!--
        Rendered inside the <nav> landmark Phase 0 left empty in DefaultLayout
        specifically to be populated from this phase.
      -->
      <nav :aria-label="t('admin.title')" class="md:w-56 md:shrink-0">
        <ul class="flex flex-col gap-1">
          <li v-for="entry in entries" :key="entry.name">
            <RouterLink
              :to="{ name: entry.name }"
              class="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              active-class="bg-slate-100 font-medium"
              :aria-current="$route.name === entry.name ? 'page' : undefined"
            >
              {{ t(entry.labelKey) }}
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="min-w-0 flex-1">
        <RouterView />
      </div>
    </div>
  </div>
</template>
