<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmDialog from '../admin/ConfirmDialog.vue';
import EmptyState from '../admin/EmptyState.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as attachmentsService from '../../services/customer-attachments.service';
import type { CustomerAttachment } from '../../services/customer-attachments.service';
import { ApiError } from '../../services/http';

const props = defineProps<{ customerId: number }>();

const { t, locale } = useI18n();
const { can } = usePermissions();

const attachments = ref<CustomerAttachment[]>([]);
const loading = ref(false);
const uploading = ref(false);
const error = ref<string | null>(null);

const pendingDelete = ref<CustomerAttachment | null>(null);
const dialogError = ref<string | null>(null);

/** Shown BEFORE an attempt, not only after a refusal. */
const sizeLimitLabel = computed(() => formatSize(10 * 1024 * 1024));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    // The server's reason names which rule was broken — too large, or type not
    // permitted — rather than a generic failure.
    const detail = cause.details[0]?.message;
    if (detail) return t(detail);
    if (cause.code === 'FORBIDDEN') return t('error.forbidden');
  }

  return t('error.unexpected');
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    attachments.value = (await attachmentsService.list(props.customerId)).items;
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  uploading.value = true;
  error.value = null;

  try {
    await attachmentsService.upload(props.customerId, file);
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    uploading.value = false;
    // Clear it, or choosing the same file again fires no change event.
    input.value = '';
  }
}

async function download(attachment: CustomerAttachment): Promise<void> {
  error.value = null;

  try {
    await attachmentsService.download(props.customerId, attachment);
  } catch (cause) {
    error.value = messageFor(cause);
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return;

  dialogError.value = null;

  try {
    await attachmentsService.remove(props.customerId, pendingDelete.value.id);
    pendingDelete.value = null;
    await load();
  } catch (cause) {
    dialogError.value = messageFor(cause);
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value));
}
</script>

<template>
  <section>
    <h2 class="mb-4 text-lg font-semibold">{{ t('customerProfile.attachments') }}</h2>

    <p v-if="error" role="alert" class="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <div v-if="can('attachments:upload')" class="mb-6">
      <label class="mb-1 block text-sm font-medium text-slate-700" for="attachment-input">
        {{ t('attachments.upload') }}
      </label>
      <input
        id="attachment-input"
        type="file"
        class="block text-sm"
        :disabled="uploading"
        @change="onFileChosen"
      />
      <p class="mt-1 text-xs text-slate-500">
        {{ t('attachments.limits', { size: sizeLimitLabel }) }}
      </p>
      <!-- A 10 MB file on a slow connection is otherwise indistinguishable
           from a hung page. -->
      <p v-if="uploading" role="status" class="mt-2 text-sm text-slate-600">
        {{ t('attachments.uploading') }}
      </p>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">{{ t('table.loading') }}</p>

    <EmptyState
      v-else-if="attachments.length === 0"
      title-key="attachments.empty.title"
      description-key="attachments.empty.description"
    />

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="attachment in attachments"
        :key="attachment.id"
        class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">{{ attachment.originalName }}</p>
          <p class="text-xs text-slate-500">
            {{ formatSize(attachment.sizeBytes) }} · {{ attachment.uploadedBy.fullName }} ·
            {{ formatTime(attachment.createdAt) }}
          </p>
        </div>

        <div class="flex gap-2">
          <!-- Goes through the authenticated endpoint, never a direct path. -->
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            @click="download(attachment)"
          >
            {{ t('attachments.download') }}
          </button>
          <button
            v-if="can('attachments:delete')"
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            @click="pendingDelete = attachment"
          >
            {{ t('attachments.delete.title') }}
          </button>
        </div>
      </li>
    </ul>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title-key="attachments.delete.title"
      message-key="attachments.delete.message"
      :confirm-label="t('attachments.delete.confirm', { name: pendingDelete?.originalName ?? '' })"
      :error="dialogError ?? undefined"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>
