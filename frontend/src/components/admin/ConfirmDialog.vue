<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  open: boolean;
  titleKey: string;
  messageKey: string;
  messageValues?: Record<string, unknown>;
  /** States the specific consequence — never "OK" (contracts/admin-ui.md). */
  confirmLabel: string;
  /** A server refusal is surfaced here rather than swallowed. */
  error?: string;
  busy?: boolean;
}>();

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

const { t } = useI18n();

const dialog = ref<HTMLElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      confirmButton.value?.focus();
    } else {
      // Focus returns to whatever opened the dialog.
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  },
);

/** Keeps Tab inside the dialog while it is open. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('cancel');
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;

  const focusable = dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );

  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
    @keydown="onKeydown"
  >
    <div
      ref="dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${titleKey}-heading`"
      class="w-full max-w-md rounded-md bg-white p-6 shadow-lg"
    >
      <h2 :id="`${titleKey}-heading`" class="text-lg font-semibold">{{ t(titleKey) }}</h2>
      <p class="mt-2 text-sm text-slate-600">{{ t(messageKey, messageValues ?? {}) }}</p>

      <p v-if="error" role="alert" class="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
        {{ error }}
      </p>

      <div class="mt-6 flex justify-end gap-3">
        <button
          type="button"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
          @click="emit('cancel')"
        >
          {{ t('action.cancel') }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          class="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
