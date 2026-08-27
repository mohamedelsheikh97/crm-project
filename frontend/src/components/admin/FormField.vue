<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  labelKey: string;
  /** Server-supplied message for this field, already translated by the caller. */
  error?: string;
  required?: boolean;
}>();

const { t } = useI18n();

const id = useId();
const errorId = computed(() => `${id}-error`);
</script>

<template>
  <div class="mb-4">
    <!-- A real <label> bound by for/id. Placeholder text is never the only label. -->
    <label :for="id" class="mb-1 block text-sm font-medium text-slate-700">
      {{ t(props.labelKey) }}
      <span v-if="required" aria-hidden="true" class="text-red-600">*</span>
    </label>

    <slot :id="id" :described-by="error ? errorId : undefined" :invalid="Boolean(error)" />

    <!--
      Referenced by aria-describedby with aria-invalid on the input, so the
      error is announced rather than conveyed by colour alone (FR-047).
    -->
    <p v-if="error" :id="errorId" class="mt-1 text-sm text-red-700">{{ error }}</p>
  </div>
</template>
