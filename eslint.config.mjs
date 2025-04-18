import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import eslintConfigPrettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'

const compat = new FlatCompat({
  // import.meta.dirname is available after Node.js v20.11.0
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
})

const eslintConfig = [
  eslintConfigPrettier,
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      'prettier/prettier': ['error', { usePrettierrc: true }],
    },
  },
  ...compat.config({
    extends: ['next', 'next/core-web-vitals', 'next/typescript'],
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }),
  {
    ignores: [
      '.next',
      '.cache',
      'yarn.lock',
      'public',
      'node_modules',
      'next-env.d.ts',
      'next.config.ts',
    ],
  },
]

export default eslintConfig
