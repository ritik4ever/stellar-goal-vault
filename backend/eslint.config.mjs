import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/**
 * Flat config (ESLint >= 9 ignores `.eslintrc.*`, so `npm run lint` could not
 * run at all on ESLint 10). This mirrors the previous `.eslintrc.json`:
 *   - typescript-eslint recommended rules
 *   - `no-console: error` in application code, relaxed in tests
 *   - `src/services/campaignController.ts` stays ignored (as before)
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'src/services/campaignController.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': 'error',
      // `_next`, `_pass`, `_configuredLevel` are the project's convention for
      // intentionally unused parameters, and unused `catch (error)` bindings are
      // required by the language (the failure itself is handled/logged).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      // Test fixtures build deliberately partial objects (express mocks, log
      // payloads, SQL rows) where `any` is the honest type. Production code
      // keeps the rule enabled.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
