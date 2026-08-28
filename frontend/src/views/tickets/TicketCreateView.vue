<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import * as customersService from '../../services/customers.service';
import type { CustomerSummary } from '../../services/customers.service';
import { ApiError } from '../../services/http';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
} from '../../services/tickets.service';
import * as ticketsService from '../../services/tickets.service';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const subject = ref('');
const description = ref('');
const category = ref<TicketCategory>('general');
const priority = ref<TicketPriority>('normal');
const customerId = ref<number | null>(null);

const customers = ref<CustomerSummary[]>([]);
const customerSearch = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

/**
 * Arriving from a customer profile pre-selects them, so the common path —
 * "this customer has a problem" — does not make the Agent search for someone
 * they were already looking at.
 */
onMounted(async () => {
  const preset = Number(route.query.customerId);
  if (Number.isInteger(preset) && preset >= 1) customerId.value = preset;

  await searchCustomers();
});

async function searchCustomers(): Promise<void> {
  try {
    customers.value = (
      await customersService.list({ search: customerSearch.value || undefined, pageSize: 20 })
    ).items;
  } catch {
    // A failed customer lookup is not a reason to block the form; the field
    // still accepts a selection made before the failure.
  }
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'CUSTOMER_INACTIVE') return t('ticket.error.customerInactive');
    return cause.message;
  }

  return t('error.unexpected');
}

async function submit(): Promise<void> {
  submitting.value = true;
  error.value = null;
  fieldErrors.value = {};

  try {
    const created = await ticketsService.create({
      customerId: customerId.value ?? undefined,
      subject: subject.value,
      description: description.value || null,
      category: category.value,
      priority: priority.value,
    });

    await router.push({ name: 'ticket-detail', params: { id: created.id } });
  } catch (cause) {
    if (cause instanceof ApiError && cause.details.length > 0) {
      for (const detail of cause.details) {
        // The server sends `key:accepted,values` for a closed set, so the part
        // before the colon is the translatable message.
        fieldErrors.value[detail.field] = t(detail.message.split(':')[0]);
      }
    }

    error.value = messageFor(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form class="mx-auto max-w-2xl space-y-6" @submit.prevent="submit">
    <h1 class="text-2xl font-semibold">{{ t('ticketForm.createTitle') }}</h1>

    <p v-if="error" class="rounded-md bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
      {{ error }}
    </p>

    <div>
      <label class="block text-sm font-medium" for="ticket-customer">
        {{ t('ticketForm.field.customer') }}
      </label>
      <input
        id="ticket-customer-search"
        v-model="customerSearch"
        type="search"
        class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        :placeholder="t('customers.search')"
        @keyup.enter.prevent="searchCustomers"
      />
      <select
        id="ticket-customer"
        v-model.number="customerId"
        class="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        :aria-invalid="Boolean(fieldErrors.customerId)"
      >
        <option :value="null">{{ t('ticketForm.selectCustomer') }}</option>
        <option v-for="customer in customers" :key="customer.id" :value="customer.id">
          {{ customer.displayName }}
        </option>
      </select>
      <p v-if="fieldErrors.customerId" class="mt-1 text-sm text-red-700 dark:text-red-300">
        {{ fieldErrors.customerId }}
      </p>
    </div>

    <div>
      <label class="block text-sm font-medium" for="ticket-subject">
        {{ t('ticketForm.field.subject') }}
      </label>
      <input
        id="ticket-subject"
        v-model="subject"
        type="text"
        required
        class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        :aria-invalid="Boolean(fieldErrors.subject)"
      />
      <p v-if="fieldErrors.subject" class="mt-1 text-sm text-red-700 dark:text-red-300">
        {{ fieldErrors.subject }}
      </p>
    </div>

    <div>
      <label class="block text-sm font-medium" for="ticket-description">
        {{ t('ticketForm.field.description') }}
      </label>
      <!-- The longest free text this system accepts. It must render correctly
           in both directions, including a mixed Arabic-and-Latin body. -->
      <textarea
        id="ticket-description"
        v-model="description"
        rows="6"
        class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
      ></textarea>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="block text-sm font-medium" for="ticket-category">
          {{ t('ticketForm.field.category') }}
        </label>
        <select
          id="ticket-category"
          v-model="category"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        >
          <!-- Rendered from an i18n key, never from a stored English label. -->
          <option v-for="value in TICKET_CATEGORIES" :key="value" :value="value">
            {{ t(`ticket.category.${value}`) }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium" for="ticket-priority">
          {{ t('ticketForm.field.priority') }}
        </label>
        <select
          id="ticket-priority"
          v-model="priority"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-start dark:border-slate-600 dark:bg-slate-800"
        >
          <option v-for="value in TICKET_PRIORITIES" :key="value" :value="value">
            {{ t(`ticket.priority.${value}`) }}
          </option>
        </select>
      </div>
    </div>

    <div class="flex gap-3">
      <button
        type="submit"
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="submitting"
      >
        {{ t('action.create') }}
      </button>
      <RouterLink :to="{ name: 'ticket-list' }" class="rounded-md border px-4 py-2 text-sm">
        {{ t('action.cancel') }}
      </RouterLink>
    </div>
  </form>
</template>
