<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError } from '../../services/http';
import * as reportsService from '../../services/reports.service';
import type { ExportFormat, ReportQuery } from '../../services/reports.service';

/**
 * Export menu (Phase 10, US3, FR-046).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE FORMATS, TWO CODE PATHS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CSV and Excel are produced by the server, which records that the data left
 * (FR-051). PDF is `window.print()` — the browser's own pipeline, because a
 * PDF containing Arabic needs an embedded font, bidirectional reordering AND
 * contextual glyph shaping, and the browser is already doing all three
 * correctly for the screen in front of the reader. See `print.css`.
 *
 * The consequence is stated honestly rather than hidden: a browser print
 * cannot be prevented or reliably audited, so the PDF path posts a best-effort
 * notification and nothing more.
 */
const props = defineProps<{
  /** The report's key, as the export endpoint knows it. */
  report: string;
  /** The filters currently on screen — the export must match what is displayed. */
  query: ReportQuery;
}>();

const { t } = useI18n();

const busy = ref<ExportFormat | 'pdf' | null>(null);
const error = ref<string | null>(null);

async function download(format: ExportFormat): Promise<void> {
  busy.value = format;
  error.value = null;

  try {
    const file = await reportsService.exportReport(props.report, format, props.query);

    /**
     * An object URL and a synthetic click.
     *
     * A plain `<a href>` would arrive unauthenticated — the access token lives
     * in memory, not in a cookie the browser would attach.
     */
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Revoked on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (caught) {
    /**
     * The over-ceiling refusal gets its OWN message, and it says what to do.
     *
     * "Export failed" leaves the reader with no action. "Too large — narrow the
     * period" tells them the one thing that will work, and it is why the server
     * puts the row count in the error rather than refusing anonymously.
     */
    error.value =
      caught instanceof ApiError && caught.status === 413
        ? t('reports.export.tooLarge')
        : t('reports.export.failed');
  } finally {
    busy.value = null;
  }
}

function printPdf(): void {
  busy.value = 'pdf';

  // Fire-and-forget, BEFORE the print dialog, because `window.print()` blocks
  // the main thread in some browsers until the dialog closes. Never awaited: a
  // failed notification must not delay or block the print the reader asked for.
  void reportsService.notifyPrint(props.report, props.query);

  window.print();
  busy.value = null;
}
</script>

<template>
  <!-- `data-print="hide"`: the export menu is chrome, and prints as a wasted
       row at the top of the PDF it just produced. -->
  <div class="export-menu" data-print="hide">
    <span id="export-menu-label" class="export-menu__label">
      {{ t('reports.export.label') }}
    </span>

    <div class="export-menu__buttons" role="group" aria-labelledby="export-menu-label">
      <button type="button" :disabled="busy !== null" @click="download('csv')">
        {{ busy === 'csv' ? t('reports.export.working') : t('reports.export.csv') }}
      </button>

      <button type="button" :disabled="busy !== null" @click="download('xlsx')">
        {{ busy === 'xlsx' ? t('reports.export.working') : t('reports.export.excel') }}
      </button>

      <button type="button" :disabled="busy !== null" @click="printPdf">
        {{ t('reports.export.pdf') }}
      </button>
    </div>

    <!-- `role="alert"`: an export that silently did nothing is indistinguishable
         from one still in progress, and the reader will click again. -->
    <p v-if="error" class="export-menu__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.export-menu {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.export-menu__label {
  font-size: 0.8125rem;
  color: var(--viz-text-secondary, #4b5563);
}

.export-menu__buttons {
  display: flex;
  gap: 0.375rem;
}

.export-menu__buttons button {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--viz-grid, #e5e7eb);
  border-radius: 0.375rem;
  background: var(--viz-surface, #fcfcfb);
  color: var(--viz-text-primary, #0b0b0b);
  font-size: 0.8125rem;
  cursor: pointer;
  /* 2.25rem tall at this font size; the 44px touch target comes from the
     surrounding padding on touch layouts. */
  min-height: 2.25rem;
}

.export-menu__buttons button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.export-menu__buttons button:focus-visible {
  outline: 2px solid var(--viz-focus, #1d4ed8);
  outline-offset: 2px;
}

.export-menu__error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--viz-status-critical, #b91c1c);
}
</style>
