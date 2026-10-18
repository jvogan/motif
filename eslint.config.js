import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist-motif',
    'node_modules',
    'playwright-report',
    'test-results',
    'output',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Motif intentionally replaces parser/runtime failures with bounded,
      // public-safe messages. Attaching raw causes can retain paths or input
      // details that must not cross the connector's error boundary.
      'preserve-caught-error': 'off',
      // Keep core hook rules active while allowing intentional manual
      // memoization and ref/effect patterns in the portable workbench.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Node ES-module tooling (build, release, and gate scripts), MCP modules,
    // and the plugin's bundled skill scripts. Recommended JavaScript rules
    // only; no type-aware rules. Generated bundles are regenerated from their
    // TypeScript sources, which are linted, so they are skipped here.
    files: ['scripts/**/*.mjs', 'mcp/**/*.mjs', 'src/**/*.mjs'],
    ignores: ['src/**/workspace-validator.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Same public-safe error policy as the TypeScript sources.
      'preserve-caught-error': 'off',
      // Diagnostic sanitizers strip control characters on purpose.
      'no-control-regex': 'off',
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['e2e/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // The workbench reads and updates DOM geometry through guarded layout
      // effects; the rule treats those DOM references as immutable state.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
