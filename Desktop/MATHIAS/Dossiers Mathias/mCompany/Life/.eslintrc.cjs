/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-check
const { defineConfig } = require('eslint-define-config');

/** @type {import('eslint').Linter.Config} */
module.exports = {
    root: true,
    env: {
        browser: true,
        es2022: true,
        worker: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true,
        },
        project: './tsconfig.json',
    },
    plugins: [
        '@typescript-eslint',
        'react-hooks',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'plugin:react-hooks/recommended',
    ],
    rules: {
        // ── TypeScript ────────────────────────────────────────────────────
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['warn', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
        }],
        '@typescript-eslint/consistent-type-imports': ['error', {
            prefer: 'type-imports',
        }],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',

        // ── General ──────────────────────────────────────────────────────
        'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
        'no-debugger': 'error',
        'prefer-const': 'error',
        'no-var': 'error',

        // ── React Hooks ──────────────────────────────────────────────────
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
    },
    ignorePatterns: [
        'dist/',
        'node_modules/',
        '*.config.cjs',
        '*.config.js',
        'scripts/',
    ],
    settings: {
        react: {
            version: 'detect',
        },
    },
};
