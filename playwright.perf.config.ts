import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.HUD_PORT ?? 5176);

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: 'perf-turn.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 480, height: 300 } },
  webServer: process.env.HUD_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @officexr/web exec vite preview --config vite.hud-preview.config.ts --configLoader runner',
        url: `http://localhost:${port}/hud-preview`,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
