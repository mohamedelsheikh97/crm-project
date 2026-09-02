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
          // Set here rather than left to the caller, so `npm test` can never
          // accidentally run against the development schema. dotenv does not
          // override variables that are already present, so these win over .env.
          env: {
            NODE_ENV: 'test',
            // Lets delivery reach the loopback receiver the webhook tests stand
            // up. `config/env.ts` refuses to start with this set outside
            // NODE_ENV=test, so it cannot leak into a deployment — and setting
            // it HERE rather than in .env keeps it out of the developer's own
            // environment too.
            WEBHOOK_ALLOW_LOOPBACK: 'true',
            DB_NAME: 'crm_support_test',
            LOG_LEVEL: 'silent',
          },
          // Real database round-trips plus bcrypt at cost 12, which is
          // deliberately slow. The default 5s is not enough.
          testTimeout: 20_000,
          // `setupTestDatabase` shells out to `sequelize-cli db:migrate` once
          // per file, so this budget grows with the migration count — Phase 5
          // added eleven and pushed the slowest file past 30s. Raised rather
          // than worked around: the setup genuinely takes this long, and a
          // timeout tuned to yesterday's schema fails for a reason that has
          // nothing to do with the test it kills.
          hookTimeout: 90_000,
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
