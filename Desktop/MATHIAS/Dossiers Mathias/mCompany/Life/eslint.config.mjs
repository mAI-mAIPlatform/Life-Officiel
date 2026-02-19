import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
            },
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                KeyboardEvent: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'react-hooks/exhaustive-deps': 'off',
        },
    },
];
