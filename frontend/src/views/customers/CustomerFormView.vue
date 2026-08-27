<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import FormField from '../../components/admin/FormField.vue';
import DuplicateDialog from '../../components/customers/DuplicateDialog.vue';
import * as customersService from '../../services/customers.service';
import type { DuplicateMatch } from '../../services/customers.service';
import { ApiError } from '../../services/http';

interface ContactRow {
  kind: 'phone' | 'email';
  value: string;
  isPrimary: boolean;
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const id = computed(() => (route.params.id ? Number(route.params.id) : null));
const isEdit = computed(() => id.value !== null);

const displayName = ref('');
const company = ref('');
const address = ref('');
const contacts = ref<ContactRow[]>([{ kind: 'phone', value: '', isPrimary: true }]);
const version = ref(0);

const submitting = ref(false);
const formError = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});

const duplicates = ref<DuplicateMatch[]>([]);
const showDuplicates = ref(false);

onMounted(async () => {
  // Carried from the list's empty state, so the Agent does not retype what they
  // just searched for.
  if (!isEdit.value && typeof route.query.name === 'string') {
    displayName.value = route.query.name;
  }

  if (!isEdit.value || id.value === null) return;

  try {
    const customer = await customersService.get(id.value);
    displayName.value = customer.displayName;
    company.value = customer.company ?? '';
    address.value = customer.address ?? '';
    version.value = customer.version;
    contacts.value = customer.contacts.map((contact) => ({
      kind: contact.kind,
      // What the user typed — the form must not reformat it (rule 3).
      value: contact.raw,
      isPrimary: contact.isPrimary,
    }));
  } catch {
    formError.value = t('error.unexpected');
  }
});

function addContact(kind: 'phone' | 'email'): void {
  const isFirstOfKind = !contacts.value.some((contact) => contact.kind === kind);
  contacts.value.push({ kind, value: '', isPrimary: isFirstOfKind });
}

function removeContact(index: number): void {
  contacts.value.splice(index, 1);
}

function setPrimary(index: number): void {
  const target = contacts.value[index];
  if (!target) return;

  for (const contact of contacts.value) {
    if (contact.kind === target.kind) {
      contact.isPrimary = contact === target;
    }
  }
}

function applyError(cause: unknown): void {
  fieldErrors.value = {};
  formError.value = null;

  if (cause instanceof ApiError) {
    for (const detail of cause.details) {
      fieldErrors.value[detail.field] = t(detail.message);
    }

    if (cause.details.length === 0) {
      formError.value = cause.code === 'CONFLICT' ? t('error.conflict') : t('error.unexpected');
    }
  } else {
    formError.value = t('error.unexpected');
  }

  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

async function save(acknowledgeDuplicates = false): Promise<void> {
  submitting.value = true;
  fieldErrors.value = {};
  formError.value = null;

  const payload = {
    displayName: displayName.value,
    company: company.value || null,
    address: address.value || null,
    contacts: contacts.value
      .filter((contact) => contact.value.trim() !== '')
      .map((contact) => ({
        kind: contact.kind,
        value: contact.value,
        isPrimary: contact.isPrimary,
      })),
    acknowledgeDuplicates,
  };

  try {
    const saved =
      isEdit.value && id.value !== null
        ? await customersService.update(id.value, { ...payload, version: version.value })
        : await customersService.create(payload);

    showDuplicates.value = false;
    await router.push({ name: 'customer-profile', params: { id: saved.id } });
  } catch (cause) {
    const matches = customersService.duplicatesFrom(cause);

    if (matches) {
      // The barrier: a match may have appeared since any live check.
      duplicates.value = matches;
      showDuplicates.value = true;
      return;
    }

    applyError(cause);
  } finally {
    submitting.value = false;
  }
}

async function openExisting(customerId: number): Promise<void> {
  showDuplicates.value = false;
  await router.push({ name: 'customer-profile', params: { id: customerId } });
}
</script>

<template>
  <section class="mx-auto max-w-xl px-6 py-8">
    <h1 class="mb-6 text-2xl font-semibold tracking-tight">
      {{ t(isEdit ? 'customerForm.editTitle' : 'customerForm.createTitle') }}
    </h1>

    <p v-if="formError" role="alert" class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ formError }}
    </p>

    <form novalidate @submit.prevent="save(false)">
      <FormField
        label-key="customerForm.field.displayName"
        :error="fieldErrors.displayName"
        required
      >
        <template #default="{ id: fieldId, describedBy, invalid }">
          <input
            :id="fieldId"
            v-model="displayName"
            type="text"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField label-key="customerForm.field.company" :error="fieldErrors.company">
        <template #default="{ id: fieldId, describedBy }">
          <input
            :id="fieldId"
            v-model="company"
            type="text"
            :aria-describedby="describedBy"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </template>
      </FormField>

      <FormField label-key="customerForm.field.address" :error="fieldErrors.address">
        <template #default="{ id: fieldId, describedBy }">
          <textarea
            :id="fieldId"
            v-model="address"
            rows="3"
            :aria-describedby="describedBy"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          ></textarea>
        </template>
      </FormField>

      <fieldset class="mt-6">
        <legend class="mb-1 text-sm font-medium text-slate-700">
          {{ t('customerForm.contacts') }}
        </legend>
        <!-- Stated before submission, not discovered by refusal (FR-003). -->
        <p class="mb-3 text-xs text-slate-500">{{ t('customerForm.contactRequired') }}</p>

        <p
          v-if="fieldErrors.contacts"
          role="alert"
          class="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700"
        >
          {{ fieldErrors.contacts }}
        </p>

        <div
          v-for="(contact, index) in contacts"
          :key="index"
          class="mb-3 flex flex-wrap items-center gap-2"
        >
          <span class="w-16 text-sm text-slate-600">
            {{ t(`customerForm.kind.${contact.kind}`) }}
          </span>
          <input
            v-model="contact.value"
            :type="contact.kind === 'email' ? 'email' : 'tel'"
            :aria-label="t(`customerForm.kind.${contact.kind}`)"
            class="min-w-48 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <label class="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="radio"
              :checked="contact.isPrimary"
              :name="`primary-${contact.kind}`"
              @change="setPrimary(index)"
            />
            {{ t('customerForm.primary') }}
          </label>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs"
            :disabled="contacts.length === 1"
            @click="removeContact(index)"
          >
            {{ t('customerForm.removeContact') }}
          </button>
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            @click="addContact('phone')"
          >
            {{ t('customerForm.addPhone') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            @click="addContact('email')"
          >
            {{ t('customerForm.addEmail') }}
          </button>
        </div>
      </fieldset>

      <div class="mt-8 flex gap-3">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ t(isEdit ? 'action.save' : 'action.create') }}
        </button>
        <RouterLink
          :to="{ name: 'customer-list' }"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          {{ t('action.cancel') }}
        </RouterLink>
      </div>
    </form>

    <DuplicateDialog
      :open="showDuplicates"
      :matches="duplicates"
      :editing="isEdit"
      :busy="submitting"
      @open-existing="openExisting"
      @amend="showDuplicates = false"
      @proceed="save(true)"
      @cancel="showDuplicates = false"
    />
  </section>
</template>
