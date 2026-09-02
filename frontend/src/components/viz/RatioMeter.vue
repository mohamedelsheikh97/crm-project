<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A single ratio against a target (Phase 10, research D7).
 *
 * NOT A TWO-SLICE PIE. "Met versus breached" is one number against a limit, and
 * a pie of two slices is harder to read than the number itself — the reader has
 * to compare two areas to recover a figure that could simply be printed.
 *
 * SAME-RAMP TRACK: the fill and the track are the same hue at different
 * lightness, so the bar reads as a proportion rather than as two competing
 * series. A red-versus-green meter would be status colours doing a magnitude
 * job, and it would fail in greyscale.
 *
 * The target marker is a LINE WITH A LABEL, never colour alone.
 */
const props = defineProps<{
  /** 0..1, or null where the sample cannot support a rate (FR-006). */
  value: number | null;
  /** 0..1. The promise the value is measured against. */
  target?: number;
  label: string;
  /** Shown instead of the meter when the figure is suppressed. */
  suppressedNote?: string | null;
}>();

const { n } = useI18n();

const percent = computed(() => (props.value === null ? 0 : Math.round(props.value * 1000) / 10));
const targetPercent = computed(() => (props.target ?? 0) * 100);

const meetsTarget = computed(
  () => props.value !== null && props.target !== undefined && props.value >= props.target,
);
</script>

<template>
  <div class="meter">
    <p class="meter__label">{{ label }}</p>

    <p v-if="suppressedNote || value === null" class="meter__suppressed">
      {{ suppressedNote ?? '—' }}
    </p>

    <template v-else>
      <p class="meter__value">{{ n(percent) }}%</p>

      <div
        class="meter__track"
        role="meter"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="label"
      >
        <span class="meter__fill" :style="{ inlineSize: `${percent}%` }"></span>

        <span
          v-if="target !== undefined"
          class="meter__target"
          :style="{ insetInlineStart: `${targetPercent}%` }"
          aria-hidden="true"
        ></span>
      </div>

      <p v-if="target !== undefined" class="meter__target-label">
        <!-- The status is stated in words as well as position: a marker alone
             would be colour-and-geometry doing a job text should do. -->
        {{ meetsTarget ? '✓' : '✗' }} {{ n(targetPercent) }}%
      </p>
    </template>
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.meter__label {
  margin: 0;
  font-size: 0.75rem;
  color: var(--viz-text-secondary, #52514e);
}

.meter__value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--viz-text-primary, #0b0b0b);
}

.meter__suppressed {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-text-muted, #6b7280);
}

.meter__track {
  position: relative;
  block-size: 0.75rem;
  /* The lightest step of the same ramp the fill uses. */
  background: var(--viz-seq-100, #eef2ff);
  border-radius: 2px;
  overflow: hidden;
}

.meter__fill {
  display: block;
  block-size: 100%;
  background: var(--viz-seq-550, #1c5cab);
  border-start-end-radius: 4px;
  border-end-end-radius: 4px;
  min-inline-size: 2px;
}

.meter__target {
  position: absolute;
  inset-block: 0;
  inline-size: 2px;
  background: var(--viz-text-primary, #0b0b0b);
}

.meter__target-label {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--viz-text-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}
</style>
