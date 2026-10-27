import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The dev server seeds a scratch data dir from packages/world, so specs that write documents
// (e.g. through `/mcp`) never touch the checked-in ones. Set on process.env so workers,
// which reload this config, inherit the same dir instead of making their own.
process.env.OFFICEXR_E2E_STUDIO_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'officexr-e2e-studio-'));

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
    env: { OFFICEXR_STUDIO_DATA_DIR: process.env.OFFICEXR_E2E_STUDIO_DATA_DIR },
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
