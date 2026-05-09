import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Integration tests probe a shared Supabase instance and must not race
    // each other on presence state. Disable file-level parallelism; per-test
    // unique officeIds keep cases independent within a single file.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
