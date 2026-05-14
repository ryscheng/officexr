import { defineConfig, devices } from '@playwright/test';

/**
 * Studio end-to-end regression suite. Boots `pnpm dev:studio` once,
 * shares one Vite dev server across all tests, and runs against
 * chromium headless. Designed to be fast enough to run after every
 * implementation task.
 *
 * Failures auto-capture screenshots into `test-results/`. Add
 * `--ui` to debug interactively, `--headed` to watch the browser.
 */
export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false, // 3D scenes are heavy; serialize to avoid GPU contention
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm --filter @officexr/studio dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
