<script setup lang="ts">
/**
 * A row of stat tiles (Phase 10, research D7).
 *
 * The form for a handful of headline numbers. Wraps rather than scrolls, so on a
 * phone the tiles stack instead of hiding behind a horizontal scrollbar.
 */
</script>

<template>
  <div class="kpi-row">
    <slot />
  </div>
</template>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
}
</style>
