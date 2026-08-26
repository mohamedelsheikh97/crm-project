import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Backend tests drive the exported Express app through supertest against
        // a real MySQL schema (crm_support_test), so they need a node environment.
        test: {
          name: 'backend',
          environment: 'node',
          include: ['backend/tests/**/*.test.ts'],
          // Real database round-trips plus bcrypt at cost 12, which is
          // deliberately slow. The default 5s is not enough.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // Integration tests share one database, so they must not interleave.
          fileParallelism: false,
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'frontend',
          environment: 'happy-dom',
          include: ['frontend/tests/**/*.test.ts'],
        },
      },
    ],
  },
});
