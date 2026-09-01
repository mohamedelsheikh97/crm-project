<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as portalAccessService from '../../services/portal-access.service';
import type { PortalAccessRow } from '../../services/portal-access.service';

/**
 * Portal access, per email contact (Phase 8, User Story 1 and 8, FR-056).
 *
 * DISPLAY ONLY. Every action here is refused server-side without
 * `portal:manage`; hiding the panel is a convenience for the staff member, not a
 * control (Constitution Principle II).
 *
 * PER CONTACT, NOT PER CUSTOMER, and the panel is shaped that way on purpose:
 * Clarifications Q2 makes a portal account belong to one person, so a company
 * record with three email contacts has three independent answers here. A
 * customer-level "portal access: on/off" would have been a smaller screen and a
 * lie.
 *
 * THE PROVISIONAL WARNING IS SHOWN BEFORE CONFIRMING (FR-002f), and it comes from
 * the server rather than being computed here — the rule lives in the service so a
 * second client cannot skip it.
 */
const props = defineProps<{ customerId: number }>();

const { t } = useI18n();

const rows = ref<PortalAccessRow[]>([]);
const loading = ref(true);
const notice = ref<string | null>(null);
const warning = ref<string | null>(null);
const busy = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;

  try {
    rows.value = await portalAccessService.overview(props.customerId);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function act(row: PortalAccessRow, action: () => Promise<unknown>): Promise<void> {
  busy.value = row.contactId;
  notice.value = null;
  warning.value = null;

  try {
    await action();
    await load();
  } finally {
    busy.value = null;
  }
}

function invite(row: PortalAccessRow): Promise<void> {
  return act(row, async () => {
    const result = await portalAccessService.invite(props.customerId, row.contactId);
    notice.value = t('portalAccess.invited', { email: result.email });

    if (result.provisionalWarning) {
      warning.value = t('portalAccess.warning.provisional');
    }
  });
}

function revoke(row: PortalAccessRow): Promise<void> {
  return act(row, () => portalAccessService.revokeInvitation(row.invitationId as number));
}

function withdraw(row: PortalAccessRow): Promise<void> {
  if (!window.confirm(t('portalAccess.confirm.withdraw', { email: row.email }))) {
    return Promise.resolve();
  }

  return act(row, async () => {
    await portalAccessService.withdraw(row.accountId as number);
    notice.value = t('portalAccess.withdrawn');
  });
}

function restore(row: PortalAccessRow): Promise<void> {
  return act(row, () => portalAccessService.restore(row.accountId as number));
}

function unlock(row: PortalAccessRow): Promise<void> {
  return act(row, () => portalAccessService.unlock(row.accountId as number));
}

function sendReset(row: PortalAccessRow): Promise<void> {
  return act(row, () => portalAccessService.sendReset(props.customerId, row.contactId));
}
</script>

<template>
  <div>
    <h2 class="mb-1 text-lg font-semibold">{{ t('portalAccess.title') }}</h2>
    <p class="mb-3 text-sm text-slate-600">{{ t('portalAccess.description') }}</p>

    <p v-if="notice" role="status" class="mb-3 text-sm text-slate-700">{{ notice }}</p>

    <p
      v-if="warning"
      role="alert"
      class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {{ warning }}
    </p>

    <p v-if="loading" role="status" class="text-sm text-slate-600">{{ t('table.loading') }}</p>

    <p
      v-else-if="rows.length === 0"
      role="status"
      class="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
    >
      {{ t('portalAccess.noEmailContacts') }}
    </p>

    <table v-else class="w-full text-sm">
      <caption class="sr-only">
        {{
          t('portalAccess.title')
        }}
      </caption>
      <thead>
        <tr class="border-b border-slate-200 text-start">
          <th scope="col" class="py-2 text-start font-medium">
            {{ t('portalAccess.column.contact') }}
          </th>
          <th scope="col" class="py-2 text-start font-medium">
            {{ t('portalAccess.column.status') }}
          </th>
          <th scope="col" class="py-2 text-start font-medium">
            {{ t('portalAccess.column.actions') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row of rows" :key="row.contactId" class="border-b border-slate-100">
          <td class="py-2">{{ row.email }}</td>
          <!-- TEXT, not colour alone (Principle IV). -->
          <td class="py-2">{{ t(`portalAccess.status.${row.status}`) }}</td>
          <td class="py-2">
            <div class="flex flex-wrap gap-2">
              <button
                v-if="row.status === 'none'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="invite(row)"
              >
                {{ t('portalAccess.action.invite') }}
              </button>

              <button
                v-if="row.status === 'invited'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="revoke(row)"
              >
                {{ t('portalAccess.action.revoke') }}
              </button>

              <button
                v-if="row.status === 'locked'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="unlock(row)"
              >
                {{ t('portalAccess.action.unlock') }}
              </button>

              <button
                v-if="row.status === 'active' || row.status === 'locked'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="withdraw(row)"
              >
                {{ t('portalAccess.action.withdraw') }}
              </button>

              <button
                v-if="row.status === 'withdrawn'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="restore(row)"
              >
                {{ t('portalAccess.action.restore') }}
              </button>

              <button
                v-if="row.status === 'active' || row.status === 'locked'"
                type="button"
                :disabled="busy === row.contactId"
                class="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100"
                @click="sendReset(row)"
              >
                {{ t('portalAccess.action.resetCredential') }}
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
