import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // The single shared .env lives at the repository root (FR-001); this is how
  // VITE_API_BASE_URL reaches the frontend without a second env file.
  envDir: '..',
  server: {
    port: 5173,
  },
});
