import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom for UI-control tests (PointerEvent / document.body /
    // window listeners); studio's other unit tests don't touch the
    // DOM and don't mind running in jsdom either.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
    setupFiles: [
      './src/__tests__/setup-rapier.ts',
      './src/__tests__/setup-canvas.ts',
    ],
  },
});
