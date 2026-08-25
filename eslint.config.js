import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // CommonJS sequelize-cli migration/seeder files live outside the TS project
    // on purpose (research.md D9), so they are not linted as TS ESM.
    ignores: ['**/dist/**', '**/node_modules/**', 'backend/src/db/**/*.cjs'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['frontend/**/*.vue'],
    languageOptions: {
      parserOptions: {
        // Lets vue-eslint-parser hand <script setup lang="ts"> blocks to the
        // TypeScript parser instead of choking on them.
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    rules: {
      // A leading underscore marks a parameter that must exist but is unused —
      // Express identifies error middleware by its 4-arity signature, so
      // `next` cannot simply be dropped.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Must stay last so formatting rules do not fight Prettier.
  prettier,
);
