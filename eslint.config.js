import { createRequire } from 'node:module';

const require = createRequire(new URL('./frontend/package.json', import.meta.url));
const typescriptParser = require('@typescript-eslint/parser');

export default [
  {
    ignores: [
      '**/node_modules/**',
      '.git/**',
      'frontend/dist/**',
      'frontend/coverage/**',
      'backend/build/**',
      'backend/.gradle/**',
      'backend/src/main/resources/static/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
    },
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
];
