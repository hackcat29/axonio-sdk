import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'axonio-proto': resolve(__dirname, '../../packages/proto/src/index.ts'),
      'axonio-types': resolve(__dirname, '../../packages/types/src/index.ts'),
      'axonio-errors': resolve(__dirname, '../../packages/errors/src/index.ts')
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node'
  }
});
