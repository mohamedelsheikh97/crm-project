import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // CommonJS sequelize-cli migration/seeder files live outside the TS project
    // on purpose (research.md D9), so they are not linted as TS ESM.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'backend/src/db/**/*.cjs'],
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
    // TypeScript already reports undefined identifiers, and it knows about DOM
    // lib types that ESLint's environment does not. Leaving no-undef on here
    // means every `document` or `HTMLElement` reference is a false positive.
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      'no-undef': 'off',
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

      // Phase 7. The rule exists to catch a combining character somebody pasted
      // into a character class by accident — `[é]` that is really `e` plus a
      // combining acute, and matches neither.
      //
      // The Arabic tokenizer's character classes are combining marks ON PURPOSE:
      // stripping harakat is the whole job of `MARKS` in
      // `backend/src/lib/text-normalise.ts`. `allowEscape` keeps the rule doing
      // what it is for while accepting the deliberate case, and it demands the
      // characters be written as `\uXXXX` escapes to qualify — which is the
      // outcome we want anyway. A literal combining mark is invisible in a
      // source file: it renders as nothing, or attaches itself to the bracket
      // beside it, and no reviewer can verify what a class actually contains.
      'no-misleading-character-class': ['error', { allowEscape: true }],
    },
  },
  // Must stay last so formatting rules do not fight Prettier.
  prettier,
);
