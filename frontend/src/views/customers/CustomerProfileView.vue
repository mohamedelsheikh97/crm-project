<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import AttachmentList from '../../components/customers/AttachmentList.vue';
import NoteList from '../../components/customers/NoteList.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as customersService from '../../services/customers.service';
import type { Customer } from '../../services/customers.service';

const { t } = useI18n();
const route = useRoute();
const { can } = usePermissions();

const id = computed(() => Number(route.params.id));
const customer = ref<Customer | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  loading.value = true;

  try {
    customer.value = await customersService.get(id.value);
  } catch {
    error.value = t('error.unexpected');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="mx-auto max-w-4xl px-6 py-8">
    <RouterLink :to="{ name: 'customer-list' }" class="text-sm text-blue-800 underline">
      {{ t('customerProfile.back') }}
    </RouterLink>

    <p v-if="error" role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <p v-if="loading" class="mt-4 text-sm text-slate-500">{{ t('table.loading') }}</p>

    <template v-if="customer">
      <div class="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ customer.displayName }}</h1>
          <p class="mt-1 text-sm text-slate-600">
            {{ customer.company ?? t('customerProfile.noCompany') }}
          </p>
          <p v-if="!customer.isActive" class="mt-2 text-sm text-amber-700">
            {{ t('customers.status.inactive') }}
          </p>
        </div>

        <RouterLink
          v-if="can('customers:update')"
          :to="{ name: 'customer-edit', params: { id: customer.id } }"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          {{ t('customerProfile.edit') }}
        </RouterLink>
      </div>

      <section class="mb-10">
        <h2 class="mb-3 text-lg font-semibold">{{ t('customerProfile.details') }}</h2>

        <dl class="grid gap-3 sm:grid-cols-2">
          <div v-for="contact in customer.contacts" :key="contact.id ?? contact.raw">
            <dt class="text-xs text-slate-500">
              {{ t(`customerForm.kind.${contact.kind}`) }}
              <span v-if="contact.isPrimary"> · {{ t('customerForm.primary') }}</span>
            </dt>
            <!-- Raw, exactly as typed. Never the normalised form (rule 3). -->
            <dd class="text-sm">{{ contact.raw }}</dd>
          </div>

          <div class="sm:col-span-2">
            <dt class="text-xs text-slate-500">{{ t('customerForm.field.address') }}</dt>
            <dd class="whitespace-pre-wrap text-sm">
              {{ customer.address ?? t('customerProfile.noAddress') }}
            </dd>
          </div>
        </dl>
      </section>

      <div class="mb-10 border-t border-slate-200 pt-8">
        <NoteList :customer-id="customer.id" />
      </div>

      <div class="border-t border-slate-200 pt-8">
        <AttachmentList :customer-id="customer.id" />
      </div>
    </template>
  </section>
</template>
