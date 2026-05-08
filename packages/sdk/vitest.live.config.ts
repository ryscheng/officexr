import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/__tests__/integration-live/**/*.test.ts'],
    // Live tests share a single Supabase instance and must run sequentially
    // to avoid race conditions on presence state across cases.
    fileParallelism: false,
    pool: 'forks',
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
