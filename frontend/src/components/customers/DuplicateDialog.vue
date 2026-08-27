<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { DuplicateMatch } from '../../services/customers.service';

const props = defineProps<{
  open: boolean;
  matches: DuplicateMatch[];
  /** Editing an existing record rather than creating one (FR-021). */
  editing?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-existing', customerId: number): void;
  (e: 'amend'): void;
  (e: 'proceed'): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();

const dialog = ref<HTMLElement | null>(null);
/**
 * Focus lands on "Open the existing customer" — the most likely correct action
 * — and NEVER on "create anyway". Someone dismissing dialogs on autopilot must
 * not create a duplicate by reflex (contracts/customer-ui.md).
 */
// A ref inside v-for collects into an ARRAY in Vue 3 — reading it as a single
// element silently does nothing, which would leave focus wherever it was and
// defeat the whole point of this dialog.
const openButtons = ref<HTMLButtonElement[]>([]);
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      openButtons.value[0]?.focus();
    } else {
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  },
  // Immediate, so a dialog mounted already-open still moves focus. Without it
  // the watcher only fires on a CHANGE, and the whole focus guarantee silently
  // depends on the parent happening to toggle rather than mount.
  { immediate: true },
);

function messageFor(match: DuplicateMatch): string {
  return t(match.matchedOn === 'phone' ? 'duplicate.matchedPhone' : 'duplicate.matchedEmail', {
    name: match.customer.displayName,
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('cancel');
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;

  const focusable = dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
      aria-labelledby="duplicate-dialog-heading"
      class="w-full max-w-lg rounded-md bg-white p-6 shadow-lg"
    >
      <h2 id="duplicate-dialog-heading" class="text-lg font-semibold">
        {{ t('duplicate.title') }}
      </h2>
      <p class="mt-2 text-sm text-slate-600">
        {{ t(editing ? 'duplicate.introEdit' : 'duplicate.intro') }}
      </p>

      <!-- Every match, not just the first (FR-022). -->
      <ul class="mt-4 flex flex-col gap-3">
        <li
          v-for="match in matches"
          :key="`${match.customer.id}-${match.matchedOn}`"
          class="rounded-md border border-slate-200 p-3"
        >
          <p class="text-sm font-medium">{{ messageFor(match) }}</p>

          <p class="mt-1 text-sm text-slate-600">
            <span v-if="match.customer.company">{{ match.customer.company }} · </span>
            <!-- The raw value, never the normalised form (rule 3). -->
            <span v-if="match.customer.primaryPhone">{{ match.customer.primaryPhone.raw }}</span>
            <span v-if="match.customer.primaryEmail"> · {{ match.customer.primaryEmail }}</span>
          </p>

          <!-- Otherwise a deactivated match looks like a stranger's record. -->
          <p v-if="!match.customer.isActive" class="mt-1 text-xs text-amber-700">
            {{ t('duplicate.inactiveMatch') }}
          </p>

          <button
            ref="openButtons"
            type="button"
            class="mt-3 rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
            @click="emit('open-existing', match.customer.id)"
          >
            {{ t('duplicate.open') }}
          </button>
        </li>
      </ul>

      <div class="mt-6 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          class="rounded-md border border-slate-300 px-4 py-2 text-sm"
          @click="emit('amend')"
        >
          {{ t('duplicate.amend') }}
        </button>

        <!--
          Present but visually secondary, and never the default focus. A shared
          household phone is legitimate, so this must remain possible (FR-023) —
          it must simply not be the thing Enter reaches for.
        -->
        <button
          type="button"
          class="rounded-md border border-amber-500 px-4 py-2 text-sm text-amber-800 disabled:opacity-50"
          :disabled="busy"
          @click="emit('proceed')"
        >
          {{ t(editing ? 'duplicate.saveAnyway' : 'duplicate.createAnyway') }}
        </button>
      </div>
    </div>
  </div>
</template>
