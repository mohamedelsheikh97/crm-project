<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmDialog from '../admin/ConfirmDialog.vue';
import EmptyState from '../admin/EmptyState.vue';
import { usePermissions } from '../../composables/usePermissions';
import * as notesService from '../../services/customer-notes.service';
import type { CustomerNote } from '../../services/customer-notes.service';
import { ApiError } from '../../services/http';
import { useAuthStore } from '../../stores/auth.store';

const props = defineProps<{ customerId: number }>();

const { t, locale } = useI18n();
const { can } = usePermissions();
const auth = useAuthStore();

const notes = ref<CustomerNote[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const draft = ref('');
const submitting = ref(false);

const editingId = ref<number | null>(null);
const editingBody = ref('');

const pendingDelete = ref<CustomerNote | null>(null);
const dialogError = ref<string | null>(null);

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
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
    notes.value = (await notesService.list(props.customerId)).items;
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function add(): Promise<void> {
  if (draft.value.trim() === '') return;

  submitting.value = true;
  error.value = null;

  try {
    await notesService.create(props.customerId, draft.value);
    draft.value = '';
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    submitting.value = false;
  }
}

function startEdit(note: CustomerNote): void {
  editingId.value = note.id;
  editingBody.value = note.body;
}

async function saveEdit(): Promise<void> {
  if (editingId.value === null) return;

  submitting.value = true;
  error.value = null;

  try {
    await notesService.update(props.customerId, editingId.value, editingBody.value);
    editingId.value = null;
    await load();
  } catch (cause) {
    error.value = messageFor(cause);
  } finally {
    submitting.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return;

  dialogError.value = null;

  try {
    await notesService.remove(props.customerId, pendingDelete.value.id);
    pendingDelete.value = null;
    await load();
  } catch (cause) {
    dialogError.value = messageFor(cause);
  }
}

/**
 * A user may always edit their own note; editing someone else's needs
 * `notes:manage` (FR-027). Omitted rather than shown-disabled, so nobody is
 * offered a control that will refuse them.
 */
function mayModify(note: CustomerNote): boolean {
  return note.author.id === auth.user?.id || can('notes:manage');
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
</script>

<template>
  <section>
    <h2 class="mb-4 text-lg font-semibold">{{ t('customerProfile.notes') }}</h2>

    <p v-if="error" role="alert" class="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
      {{ error }}
    </p>

    <form v-if="can('notes:create')" class="mb-6" @submit.prevent="add">
      <label class="mb-1 block text-sm font-medium text-slate-700" for="note-draft">
        {{ t('notes.add') }}
      </label>
      <textarea
        id="note-draft"
        v-model="draft"
        rows="3"
        :placeholder="t('notes.placeholder')"
        class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      ></textarea>
      <button
        type="submit"
        :disabled="submitting || draft.trim() === ''"
        class="mt-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {{ t('notes.save') }}
      </button>
    </form>

    <p v-if="loading" class="text-sm text-slate-500">{{ t('table.loading') }}</p>

    <EmptyState
      v-else-if="notes.length === 0"
      title-key="notes.empty.title"
      description-key="notes.empty.description"
    />

    <ol v-else class="flex flex-col gap-4">
      <li v-for="note in notes" :key="note.id" class="rounded-md border border-slate-200 p-4">
        <div
          class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500"
        >
          <span>{{ note.author.fullName }} · {{ formatTime(note.createdAt) }}</span>
          <!-- A silently rewritten note is worse than no note (FR-026). -->
          <span v-if="note.editedAt" class="italic">{{ t('notes.edited') }}</span>
        </div>

        <template v-if="editingId === note.id">
          <textarea
            v-model="editingBody"
            rows="3"
            :aria-label="t('notes.add')"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          ></textarea>
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              class="rounded-md bg-blue-700 px-3 py-1.5 text-sm text-white"
              :disabled="submitting"
              @click="saveEdit"
            >
              {{ t('action.save') }}
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              @click="editingId = null"
            >
              {{ t('action.cancel') }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="whitespace-pre-wrap text-sm text-slate-800">{{ note.body }}</p>

          <div v-if="mayModify(note)" class="mt-3 flex gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-300 px-2 py-1 text-xs"
              @click="startEdit(note)"
            >
              {{ t('action.edit') }}
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-300 px-2 py-1 text-xs"
              @click="pendingDelete = note"
            >
              {{ t('notes.delete.confirm') }}
            </button>
          </div>
        </template>
      </li>
    </ol>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title-key="notes.delete.title"
      message-key="notes.delete.message"
      :confirm-label="t('notes.delete.confirm')"
      :error="dialogError ?? undefined"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>
