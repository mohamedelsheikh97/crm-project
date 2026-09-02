<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import * as adminService from '../../services/ai-admin.service';
import type { AiConfig } from '../../services/ai-admin.service';

/**
 * AI configuration (Phase 9, US6, FR-002, FR-060).
 *
 * WHAT THIS SCREEN CANNOT DO, and it says so on the page: it cannot change
 * where processing happens. Staff features may use an external provider and the
 * customer assistant may not, and that split is fixed in code rather than
 * configured here (research D2, FR-008a). An administrator who needs it changed
 * needs a deployment and a constitution amendment, not a toggle.
 *
 * Displaying that fact rather than omitting it is the point. A settings screen
 * with five toggles and no mention of egress invites the assumption that egress
 * is one of the toggles.
 */
const { t } = useI18n();

const config = ref<AiConfig | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const FEATURES = ['summary', 'draft', 'classify', 'similar', 'assistant'] as const;
const METERED = ['summary', 'draft', 'classify', 'assistant'] as const;

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    config.value = await adminService.config();
  } catch {
    error.value = t('ai.admin.loadFailed');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!config.value) return;

  saving.value = true;
  error.value = null;

  try {
    config.value = await adminService.updateConfig({
      features: config.value.features,
      ceilings: config.value.ceilings,
      assistantLangs: config.value.assistantLangs,
      groundingFloor: config.value.groundingFloor,
    });
  } catch {
    error.value = t('ai.admin.saveFailed');
    await load();
  } finally {
    saving.value = false;
  }
}

function toggleLang(lang: 'ar' | 'en'): void {
  if (!config.value) return;

  const langs = new Set(config.value.assistantLangs);
  if (langs.has(lang)) langs.delete(lang);
  else langs.add(lang);

  config.value.assistantLangs = [...langs];
}

onMounted(load);
</script>

<template>
  <section class="ai-settings">
    <h1 class="ai-settings__title">{{ t('ai.admin.title') }}</h1>

    <p v-if="loading" role="status">{{ t('ai.admin.loading') }}</p>
    <p v-else-if="error" role="alert" class="ai-settings__error">{{ error }}</p>

    <template v-else-if="config">
      <!-- FR-001: with the deployment switch off, the toggles below do nothing,
           and saying so is kinder than letting somebody flip five of them. -->
      <p v-if="!config.enabled" class="ai-settings__notice" role="status">
        {{ t('ai.admin.deploymentDisabled') }}
      </p>

      <fieldset class="ai-settings__group">
        <legend>{{ t('ai.admin.features') }}</legend>

        <label v-for="feature in FEATURES" :key="feature" class="ai-settings__row">
          <input v-model="config.features[feature]" type="checkbox" />
          <span>{{ t(`ai.admin.feature.${feature}`) }}</span>
        </label>
      </fieldset>

      <fieldset class="ai-settings__group">
        <legend>{{ t('ai.admin.ceilings') }}</legend>
        <p class="ai-settings__hint">{{ t('ai.admin.ceilingsHint') }}</p>

        <label v-for="feature in METERED" :key="feature" class="ai-settings__row">
          <span>{{ t(`ai.admin.feature.${feature}`) }}</span>
          <input v-model.number="config.ceilings[feature]" type="number" min="1" />
        </label>
      </fieldset>

      <fieldset class="ai-settings__group">
        <legend>{{ t('ai.admin.assistant') }}</legend>

        <p class="ai-settings__hint">{{ t('ai.admin.langsHint') }}</p>

        <label class="ai-settings__row">
          <input
            type="checkbox"
            :checked="config.assistantLangs.includes('en')"
            @change="toggleLang('en')"
          />
          <span>{{ t('language.name.en') }}</span>
        </label>
        <label class="ai-settings__row">
          <input
            type="checkbox"
            :checked="config.assistantLangs.includes('ar')"
            @change="toggleLang('ar')"
          />
          <span>{{ t('language.name.ar') }}</span>
        </label>

        <label class="ai-settings__row">
          <span>{{ t('ai.admin.groundingFloor') }}</span>
          <input v-model.number="config.groundingFloor" type="number" min="0" max="1" step="0.05" />
        </label>
        <p class="ai-settings__hint">{{ t('ai.admin.groundingFloorHint') }}</p>
      </fieldset>

      <!-- Not a toggle, and deliberately shown as text. -->
      <div class="ai-settings__boundary">
        <h2 class="ai-settings__subtitle">{{ t('ai.admin.boundary') }}</h2>
        <p class="ai-settings__hint">{{ t('ai.admin.boundaryExplained') }}</p>
      </div>

      <button type="button" class="ai-settings__save" :disabled="saving" @click="save">
        {{ saving ? t('ai.admin.saving') : t('action.save') }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.ai-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 40rem;
}

.ai-settings__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.ai-settings__subtitle {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.ai-settings__group {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ai-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.875rem;
}

.ai-settings__row input[type='number'] {
  width: 7rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.25rem 0.375rem;
  font: inherit;
}

.ai-settings__hint {
  margin: 0;
  font-size: 0.75rem;
  color: #4b5563;
}

.ai-settings__notice {
  padding: 0.625rem;
  border: 1px solid #fcd34d;
  border-radius: 0.375rem;
  background: #fffbeb;
  font-size: 0.875rem;
  margin: 0;
}

.ai-settings__boundary {
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #f9fafb;
}

.ai-settings__error {
  color: #b91c1c;
}

.ai-settings__save {
  align-self: flex-start;
  min-height: 2.5rem;
  padding-inline: 1rem;
  border: 1px solid #1d4ed8;
  border-radius: 0.375rem;
  background: #1d4ed8;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.ai-settings__save:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
