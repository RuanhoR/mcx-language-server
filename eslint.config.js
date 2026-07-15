import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  js.configs.recommended,

  {
    files: ['**/*.js', '**/*.mjs', 'eslint.config.js', 'vitest.config.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['packages/**/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      'prefer-const': 'error',
      'no-var': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off',
    },
  },

  {
    files: ['packages/**/__test__/**/*.ts', 'extensions/**/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      'prefer-const': 'error',
      'no-var': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off',
    },
  },

  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
    ],
  },
]
