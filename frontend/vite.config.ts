import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Two build outputs, not one (Phase 5, research.md D14).
 *
 * `vite build --mode widget` produces the standalone chat widget bundle; a
 * plain `vite build` produces the application. They are separate because the
 * widget is embedded on a page the organisation does not control, and shipping
 * the authenticated application to such a page would put its routes, stores,
 * and API client somewhere they have no business being (FR-068).
 *
 * The widget shares the locale files and nothing else.
 *
 * `--mode` rather than an environment variable, because `VAR=1 cmd` is not
 * portable to the Windows shells this project is developed on, and adding
 * `cross-env` to dodge that would be a dependency bought for one line.
 */
export default defineConfig(({ mode }) => {
  const isWidgetBuild = mode === 'widget';

  return {
    plugins: [vue(), tailwindcss()],
    // The single shared .env lives at the repository root (FR-001); this is how
    // VITE_API_BASE_URL reaches the frontend without a second env file.
    envDir: '..',
    server: {
      port: 5173,
    },
    build: isWidgetBuild
      ? {
          outDir: 'dist-widget',
          emptyOutDir: true,
          lib: {
            entry: fileURLToPath(new URL('./src/widget/main.ts', import.meta.url)),
            name: 'CrmSupportChat',
            // One file, one script tag. A host page should not have to learn a
            // module graph to embed a chat button.
            formats: ['iife' as const],
            fileName: () => 'crm-chat-widget.js',
          },
          // Styles are inlined into the bundle rather than emitted separately,
          // for the same reason: one tag, and nothing for the host to forget.
          cssCodeSplit: false,
        }
      : {},
  };
});
