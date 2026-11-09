import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'axonio': resolve(__dirname, '../../sdks/typescript/src/index.ts'),
      'axonio-langchain': resolve(__dirname, '../../adapters/langchain/src/index.ts'),
      'axonio-openai-agents': resolve(__dirname, '../../adapters/openai/src/index.ts'),
      'axonio-vercel-ai': resolve(__dirname, '../../adapters/vercel-ai/src/index.ts'),
      'axonio-errors': resolve(__dirname, '../../packages/errors/src/index.ts'),
      'axonio-proto': resolve(__dirname, '../../packages/proto/src/index.ts'),
      'axonio-types': resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['typescript.test.ts'],
    hookTimeout: 60000,
    testTimeout: 60000,
  },
});
