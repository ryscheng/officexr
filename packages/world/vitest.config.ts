import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    setupFiles: ['./src/__tests__/setup-rapier.ts'],
  },
});
