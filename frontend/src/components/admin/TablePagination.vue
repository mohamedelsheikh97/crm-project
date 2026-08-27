<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ page: number; pageSize: number; total: number }>();
const emit = defineEmits<{ (event: 'update:page', page: number): void }>();

const { t } = useI18n();

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const canGoBack = computed(() => props.page > 1);
const canGoForward = computed(() => props.page < pageCount.value);
</script>

<template>
  <nav :aria-label="t('pagination.label')" class="mt-4 flex items-center justify-between gap-4">
    <!-- Position announced in text, not by colour or position alone. -->
    <p class="text-sm text-slate-600">
      {{ t('pagination.position', { page, pageCount, total }) }}
    </p>

    <div class="flex gap-2">
      <button
        type="button"
        class="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
        :disabled="!canGoBack"
        @click="emit('update:page', page - 1)"
      >
        {{ t('pagination.previous') }}
      </button>
      <button
        type="button"
        class="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
        :disabled="!canGoForward"
        @click="emit('update:page', page + 1)"
      >
        {{ t('pagination.next') }}
      </button>
    </div>
  </nav>
</template>
