import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: 'perf-turn.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'pnpm --filter @officexr/web dev:hud-preview',
    url: 'http://localhost:5176/hud-preview',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
