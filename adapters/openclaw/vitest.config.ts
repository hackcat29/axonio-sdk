import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'axonio': resolve(__dirname, '../../sdks/typescript/src/index.ts')
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node'
  }
});
